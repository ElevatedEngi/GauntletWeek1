import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { ref, set, update, remove, onValue, onDisconnect } from 'firebase/database';
import { realtimeDb } from '../../services/firebase';
import { BoardObject, ObjectType } from '@whiteboard/shared-types';
import useBoardStore from '../../stores/boardStore';
import useAuthStore from '../../stores/authStore';
import { viewportRef } from '../../utils/viewportRef';
import { rectEdgeIntersection, circleEdgeIntersection } from '../../utils/edgeIntersection';
import CursorOverlay from './CursorOverlay';

// Debounce helper
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

interface CanvasState {
  scale: number;
  offsetX: number;
  offsetY: number;
  selectedObjectId: string | null;
  isDrawing: boolean;
  drawStart: { x: number; y: number } | null;
}

interface WhiteboardCanvasProps {
  boardId: string;
}

const GRID_SIZE = 20;
const DEFAULT_OBJECT_WIDTH = 150;
const DEFAULT_OBJECT_HEIGHT = 100;
const OBJECT_COLORS = ['#FEE2E2', '#FEF3C7', '#DCFCE7', '#DBEAFE', '#E9D5FF'];
const COLOR_PALETTE = [
  '#FEE2E2', '#FEF3C7', '#DCFCE7', '#DBEAFE', '#E9D5FF', // pastel
  '#FCA5A5', '#FCD34D', '#6EE7B7', '#93C5FD', '#C4B5FD', // medium
  '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', // vivid
  '#FFFFFF', '#F3F4F6', '#9CA3AF', '#4B5563', '#1F2937', // grays
];

const WhiteboardCanvas: React.FC<WhiteboardCanvasProps> = ({ boardId }) => {
  // canvasAreaRef: a plain div that React renders. We imperatively create the
  // canvas element inside it so React's reconciliation never sees (or touches)
  // the canvas — preventing React from tearing down Fabric's canvas-container wrapper.
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Scenario 2: track canvas readiness for button disabled state
  const [canvasReady, setCanvasReady] = useState(false);
  // Scenario 3: protect recently created objects from syncObjectsToCanvas removal loop
  const recentlyCreatedIds = useRef(new Set<string>());
  // Throttle tracker for real-time drag position broadcasts (per objectId)
  const lastMoveSyncRef = useRef<Map<string, number>>(new Map());
  const MOVE_SYNC_HZ = 30; // 30 broadcasts/sec during drag (~33ms, matches cursor rate)

  // Keyboard / Space pan refs — direct viewport mutation, no React state
  const PAN_SPEED = 8;                                          // px per frame at ~60 fps
  const isSpacePanRef    = useRef(false);                       // Space held → pan mode
  const keysHeldRef      = useRef(new Set<string>());           // currently-held arrow keys
  const panAnimFrameRef  = useRef<number | null>(null);         // rAF handle
  const panVelocityRef   = useRef({ x: 0, y: 0 });             // pan delta per frame
  const coordsDisplayRef = useRef<HTMLSpanElement | null>(null);// live coords DOM node

  // Text editing lock state
  const currentLocksRef = useRef<Map<string, { lockedBy: string; lockedByName: string }>>(new Map());
  const activeEditingObjectId = useRef<string | null>(null);
  const [confirmButtonPos, setConfirmButtonPos] = useState<{ left: number; top: number } | null>(null);
  const [lockToastMsg, setLockToastMsg] = useState<string | null>(null);

  // ── Connector state ──────────────────────────────────────────────────────────
  // Index: objectId → set of connectorIds that reference it (rebuilt each sync)
  const connectorIndexRef = useRef<Map<string, Set<string>>>(new Map());
  // Connection mode: user is clicking objects to create a connector
  const [isConnecting, setIsConnecting] = useState(false);
  const connectionSourceRef = useRef<string | null>(null);
  const connectionStyleRef = useRef<'line' | 'arrow'>('arrow');
  const rubberBandLineRef = useRef<fabric.Line | null>(null);
  const sourceHighlightRef = useRef<fabric.Object | null>(null);

  // ── Color picker state ─────────────────────────────────────────────────────
  const [selectedObjId, setSelectedObjId] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // ── Clipboard for copy/paste ───────────────────────────────────────────────
  const clipboardRef = useRef<BoardObject[]>([]);

  const { objects, addObject, updateObject: updateObjectStore, deleteObject, isConnected } = useBoardStore();
  const { user, cursorColor } = useAuthStore();

  // Create debounced sync function for text updates to Firebase
  const debouncedTextSync = useRef(
    debounce((objectId: string, content: string) => {
      const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${objectId}`);
      update(objectRef, { content, updatedAt: Date.now() }).catch((error) => {
        console.error('Failed to sync text to Firebase:', error);
      });
    }, 500)
  ).current;

  const [canvasState, setCanvasState] = useState<CanvasState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    selectedObjectId: null,
    isDrawing: false,
    drawStart: null,
  });

  // Sync the CSS grid position/size with the current Fabric viewport transform.
  // Also updates the live coordinate display. Called on every pan and zoom frame.
  const syncCssGrid = (vp: number[]) => {
    // Keep singleton up-to-date so cursor broadcast/display can convert coordinates
    viewportRef.current = vp;
    if (!canvasAreaRef.current) return;
    const scale = vp[0];
    const g = GRID_SIZE * scale;
    canvasAreaRef.current.style.backgroundPosition =
      `${((vp[4] % g) + g) % g}px ${((vp[5] % g) + g) % g}px`;
    canvasAreaRef.current.style.backgroundSize = `${g}px ${g}px`;
    if (coordsDisplayRef.current) {
      coordsDisplayRef.current.textContent =
        `X:${(-vp[4] / scale).toFixed(0)}  Y:${(-vp[5] / scale).toFixed(0)}`;
    }
  };

  // ── Helper: compute connector line endpoints from source/target objects ───────
  function getConnectorEndpoints(
    canvas: fabric.Canvas,
    connObj: BoardObject,
  ): { x1: number; y1: number; x2: number; y2: number; angle: number } | null {
    const store = useBoardStore.getState();
    const srcData = store.objects.get(connObj.sourceObjectId || '');
    const tgtData = store.objects.get(connObj.targetObjectId || '');
    if (!srcData || !tgtData) return null;

    // Prefer live Fabric positions (accurate during drag)
    const srcShape = canvas.getObjects().find(
      (o) => o.data?.objectId === srcData.id && o.data?.type === 'shape'
    );
    const tgtShape = canvas.getObjects().find(
      (o) => o.data?.objectId === tgtData.id && o.data?.type === 'shape'
    );

    const sx = srcShape?.left ?? srcData.position.x;
    const sy = srcShape?.top ?? srcData.position.y;
    const tx = tgtShape?.left ?? tgtData.position.x;
    const ty = tgtShape?.top ?? tgtData.position.y;

    const srcCenter = { x: sx + srcData.width / 2, y: sy + srcData.height / 2 };
    const tgtCenter = { x: tx + tgtData.width / 2, y: ty + tgtData.height / 2 };

    let srcEdge: { x: number; y: number };
    let tgtEdge: { x: number; y: number };

    if (srcData.type === ObjectType.CIRCLE) {
      const r = Math.min(srcData.width, srcData.height) / 2;
      srcEdge = circleEdgeIntersection(srcCenter.x, srcCenter.y, r, tgtCenter.x, tgtCenter.y);
    } else {
      srcEdge = rectEdgeIntersection(
        { x: sx, y: sy, width: srcData.width, height: srcData.height },
        tgtCenter.x, tgtCenter.y,
      );
    }

    if (tgtData.type === ObjectType.CIRCLE) {
      const r = Math.min(tgtData.width, tgtData.height) / 2;
      tgtEdge = circleEdgeIntersection(tgtCenter.x, tgtCenter.y, r, srcCenter.x, srcCenter.y);
    } else {
      tgtEdge = rectEdgeIntersection(
        { x: tx, y: ty, width: tgtData.width, height: tgtData.height },
        srcCenter.x, srcCenter.y,
      );
    }

    const angle = Math.atan2(tgtEdge.y - srcEdge.y, tgtEdge.x - srcEdge.x);
    return { x1: srcEdge.x, y1: srcEdge.y, x2: tgtEdge.x, y2: tgtEdge.y, angle };
  }

  // ── Helper: update a single connector's Fabric objects on canvas ─────────────
  function updateConnectorOnCanvas(canvas: fabric.Canvas, connectorId: string) {
    const store = useBoardStore.getState();
    const connObj = store.objects.get(connectorId);
    if (!connObj || connObj.type !== ObjectType.CONNECTOR) return;

    const ep = getConnectorEndpoints(canvas, connObj);
    if (!ep) return;

    // Update connector line
    const lineObj = canvas.getObjects().find(
      (o) => o.data?.objectId === connectorId && o.data?.type === 'connector'
    ) as fabric.Line | undefined;

    if (lineObj) {
      lineObj.set({ x1: ep.x1, y1: ep.y1, x2: ep.x2, y2: ep.y2 });
      lineObj.setCoords();
    }

    // Update arrowhead
    const arrowHead = canvas.getObjects().find(
      (o) => o.data?.objectId === connectorId && o.data?.type === 'arrowhead'
    ) as fabric.Triangle | undefined;

    if (arrowHead) {
      arrowHead.set({
        left: ep.x2,
        top: ep.y2,
        angle: (ep.angle * 180 / Math.PI) + 90,
      });
      arrowHead.setCoords();
    }
  }

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasAreaRef.current || !containerRef.current) return;

    const canvasArea = canvasAreaRef.current;
    // Use the canvas area's dimensions (not the outer container) for Fabric
    const width  = canvasArea.clientWidth  || window.innerWidth  * 0.7;
    const height = canvasArea.clientHeight || window.innerHeight * 0.8;

    // Create canvas element IMPERATIVELY so React never touches it.
    // If we put <canvas> in JSX, React's reconciliation removes Fabric's
    // canvas-container wrapper on every re-render, detaching the canvas from the DOM.
    const canvasEl = document.createElement('canvas');
    canvasArea.appendChild(canvasEl);

    // Create Fabric canvas
    const fabricCanvas = new fabric.Canvas(canvasEl, {
      width,
      height,
      backgroundColor: 'transparent',
      renderOnAddRemove: false,
      enableRetinaScaling: true,
    });

    fabricCanvasRef.current = fabricCanvas;
    // Scenario 2: signal buttons are now usable
    setCanvasReady(true);

    // Focus the container so keyboard events (arrow-key pan, Z-zoom) work
    // immediately without requiring the user to click first.
    containerRef.current?.focus();

    console.log('[Canvas] initialized', { width: fabricCanvas.width, height: fabricCanvas.height });

    // Grid is rendered as CSS background on canvasAreaRef (moves with viewport)

    // Setup event listeners ONCE (not on every sync)
    setupCanvasEventListeners(fabricCanvas);

    // Render initial objects
    syncObjectsToCanvas(fabricCanvas, Array.from(objects.values()), user?.id || '');

    // Scenario 1: ResizeObserver re-sizes canvas if canvas area grows after mount
    const ro = new ResizeObserver(() => {
      const w = canvasArea.clientWidth;
      const h = canvasArea.clientHeight;
      if (w > 0 && h > 0 && (fabricCanvas.width !== w || fabricCanvas.height !== h)) {
        fabricCanvas.setDimensions({ width: w, height: h });
        fabricCanvas.renderAll();
      }
    });
    ro.observe(canvasArea);

    // Handle window resize
    const handleResize = () => {
      const newWidth = canvasArea.clientWidth;
      const newHeight = canvasArea.clientHeight;
      fabricCanvas.setDimensions({ width: newWidth, height: newHeight });
      fabricCanvas.calcOffset();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', handleResize);
      // Scenario 2: null out ref BEFORE dispose so stale ref can't pass guard
      fabricCanvasRef.current = null;
      setCanvasReady(false);
      // Remove all canvas event listeners
      fabricCanvas.off('object:modified');
      fabricCanvas.off('text:changed');
      fabricCanvas.off('text:editing:entered');
      fabricCanvas.off('text:editing:exited');
      fabricCanvas.off('object:moving');
      fabricCanvas.off('object:scaling');
      fabricCanvas.off('mouse:dblclick');
      fabricCanvas.off('mouse:down');
      fabricCanvas.off('mouse:move');
      fabricCanvas.dispose();
    };
  }, []);

  // Track if we're currently editing text
  const isEditingTextRef = useRef(false);

  // Track if Z key is held for zoom mode
  const isZKeyPressedRef = useRef(false);

  // Sync store objects to canvas (but not while editing text)
  useEffect(() => {
    if (!fabricCanvasRef.current) return;
    // Per-object guards inside syncObjectsToCanvas protect the specific textbox
    // being edited (isEditing check) and any actively-dragged shape (isShapeActive).
    // Removing the global isEditingTextRef guard here lets remote adds/moves/deletes
    // remain visible to a user who is currently typing.
    syncObjectsToCanvas(fabricCanvasRef.current, Array.from(objects.values()), user?.id || '');
  }, [objects, user?.id]);

  // Subscribe to editing locks from Firebase — controls who can edit which text object
  useEffect(() => {
    if (!boardId) return;
    const locksDbRef = ref(realtimeDb, `boards/${boardId}/locks`);
    const unsubscribe = onValue(locksDbRef, (snapshot) => {
      const locksData = snapshot.val() || {};
      const newLocks = new Map<string, { lockedBy: string; lockedByName: string }>();
      Object.entries(locksData).forEach(([objectId, lockData]: [string, any]) => {
        newLocks.set(objectId, { lockedBy: lockData.lockedBy, lockedByName: lockData.lockedByName });
      });
      currentLocksRef.current = newLocks;

      // Enable/disable text objects based on whether they're locked by someone else
      const canvas = fabricCanvasRef.current;
      const currentUser = useAuthStore.getState().user;
      if (!canvas || !currentUser) return;
      canvas.getObjects().forEach((obj) => {
        const objectId = obj.data?.objectId as string;
        if (!objectId || obj.data?.type !== 'text') return;
        const lock = newLocks.get(objectId);
        if (lock && lock.lockedBy !== currentUser.id) {
          obj.set({ evented: false, selectable: false, hoverCursor: 'not-allowed' });
        } else {
          obj.set({ evented: true, selectable: true, hoverCursor: 'text' });
        }
      });
      canvas.renderAll();
    });
    return () => unsubscribe();
  }, [boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Commit the active text edit (called by the ✓ button)
  const commitTextEdit = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const activeObj = canvas.getActiveObject() as fabric.Textbox;
    if (activeObj && (activeObj as any).isEditing) {
      activeObj.exitEditing();
    }
    canvas.discardActiveObject();
    canvas.renderAll();
    // text:editing:exited handler takes care of Firebase sync + lock release
  }, []);

  // Handle canvas zoom with mouse wheel (hold Z + scroll)
  useEffect(() => {
    if (!fabricCanvasRef.current) return;

    const canvas = fabricCanvasRef.current;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'z' || e.key === 'Z') {
        if (!isEditingTextRef.current) isZKeyPressedRef.current = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'z' || e.key === 'Z') {
        isZKeyPressedRef.current = false;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!isZKeyPressedRef.current) return;
      e.preventDefault();

      const zoomDelta = -e.deltaY * 0.001;
      const newScale = Math.max(0.1, Math.min(5, canvas.getZoom() + zoomDelta));

      setCanvasState((prev) => ({ ...prev, scale: newScale }));
      // Zoom toward the cursor position so the point under the mouse stays fixed
      canvas.zoomToPoint(new fabric.Point(e.offsetX, e.offsetY), newScale);
      canvas.requestRenderAll();
      syncCssGrid(canvas.viewportTransform as number[]);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    canvasAreaRef.current?.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      canvasAreaRef.current?.removeEventListener('wheel', handleWheel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard panning: Arrow keys (continuous rAF loop) + Space-pan mode ──────
  useEffect(() => {
    const PAN_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

    const updateVelocity = () => {
      let x = 0, y = 0;
      if (keysHeldRef.current.has('ArrowLeft'))  x += PAN_SPEED;
      if (keysHeldRef.current.has('ArrowRight')) x -= PAN_SPEED;
      if (keysHeldRef.current.has('ArrowUp'))    y += PAN_SPEED;
      if (keysHeldRef.current.has('ArrowDown'))  y -= PAN_SPEED;
      panVelocityRef.current = { x, y };
    };

    const startLoop = () => {
      if (panAnimFrameRef.current !== null) return; // already running
      const tick = () => {
        const { x, y } = panVelocityRef.current;
        const canvas = fabricCanvasRef.current;
        if (canvas && (x !== 0 || y !== 0)) {
          const vp = [...(canvas.viewportTransform || [1, 0, 0, 1, 0, 0])];
          vp[4] += x;
          vp[5] += y;
          canvas.setViewportTransform(vp as any);
          canvas.requestRenderAll();
          syncCssGrid(vp);
        }
        panAnimFrameRef.current = requestAnimationFrame(tick);
      };
      panAnimFrameRef.current = requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      if (panAnimFrameRef.current !== null) {
        cancelAnimationFrame(panAnimFrameRef.current);
        panAnimFrameRef.current = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Never pan while the user is typing inside a Fabric textbox
      if (isEditingTextRef.current) return;
      if (e.key === ' ') {
        isSpacePanRef.current = true;
        if (canvasAreaRef.current) canvasAreaRef.current.style.cursor = 'grab';
        return;
      }
      if (PAN_KEYS.has(e.key)) {
        e.preventDefault(); // prevent browser scroll
        keysHeldRef.current.add(e.key);
        updateVelocity();
        startLoop();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        isSpacePanRef.current = false;
        if (canvasAreaRef.current) canvasAreaRef.current.style.cursor = '';
        return;
      }
      if (PAN_KEYS.has(e.key)) {
        keysHeldRef.current.delete(e.key);
        updateVelocity();
        if (keysHeldRef.current.size === 0) stopLoop();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      stopLoop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle mouse events for panning and selection
  useEffect(() => {
    if (!fabricCanvasRef.current || !canvasAreaRef.current) return;

    const canvas = fabricCanvasRef.current;
    const canvasArea = canvasAreaRef.current;
    let isPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      const isRightClick = e.button === 2;
      const isSpaceLeftClick = e.button === 0 && isSpacePanRef.current;
      if (isRightClick || isSpaceLeftClick) {
        isPanning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        canvasArea.style.cursor = 'grabbing';
        e.preventDefault();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      const deltaX = e.clientX - lastPanX;
      const deltaY = e.clientY - lastPanY;
      lastPanX = e.clientX;
      lastPanY = e.clientY;

      const vp = [...(canvas.viewportTransform || [1, 0, 0, 1, 0, 0])];
      vp[4] += deltaX;
      vp[5] += deltaY;
      canvas.setViewportTransform(vp as any);
      canvas.requestRenderAll();
      syncCssGrid(vp);
    };

    const handleMouseUp = () => {
      if (!isPanning) return;
      isPanning = false;
      canvasArea.style.cursor = isSpacePanRef.current ? 'grab' : '';
    };

    canvasArea.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    canvasArea.addEventListener('contextmenu', (e: Event) => e.preventDefault());

    return () => {
      canvasArea.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ── Helper: collect all unique objectIds from active selection (single or multi) ──
  const getSelectedObjectIds = useCallback((canvas: fabric.Canvas): string[] => {
    const active = canvas.getActiveObject();
    if (!active) return [];
    // Multi-select (ActiveSelection)
    if (active.type === 'activeSelection') {
      const group = active as fabric.ActiveSelection;
      const ids = new Set<string>();
      group.getObjects().forEach((obj) => {
        if (obj.data?.objectId) ids.add(obj.data.objectId as string);
      });
      return Array.from(ids);
    }
    // Single select
    if (active.data?.objectId) return [active.data.objectId as string];
    return [];
  }, []);

  // ── Helper: delete a single object by ID (with connector cascade) ──────────
  const deleteObjectById = useCallback((canvas: fabric.Canvas, objectId: string) => {
    const store = useBoardStore.getState();
    const objData = store.objects.get(objectId);
    if (!objData) return;

    // If deleting a shape, cascade-delete all attached connectors
    if (objData.type !== ObjectType.CONNECTOR) {
      const attachedConnectors = connectorIndexRef.current.get(objectId);
      if (attachedConnectors) {
        attachedConnectors.forEach((connId) => {
          deleteObject(connId);
          const connRef = ref(realtimeDb, `boards/${boardId}/objects/${connId}`);
          remove(connRef).catch(console.error);
          canvas.getObjects()
            .filter((o) => o.data?.objectId === connId)
            .forEach((o) => canvas.remove(o));
        });
      }
    }

    // Delete from local store + Firebase
    deleteObject(objectId);
    const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${objectId}`);
    remove(objectRef).catch(console.error);

    // Remove all canvas items for this object
    canvas.getObjects()
      .filter((obj) => obj.data?.objectId === objectId)
      .forEach((obj) => canvas.remove(obj));
  }, [deleteObject, boardId]);

  // ── Helper: duplicate objects by IDs ────────────────────────────────────────
  const duplicateObjects = useCallback((sourceObjects: BoardObject[], offset = 20) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !user) return;

    sourceObjects.forEach((srcObj) => {
      if (srcObj.type === ObjectType.CONNECTOR) return; // skip connectors
      const newId = uuidv4();
      const newObject: BoardObject = {
        ...srcObj,
        id: newId,
        position: { x: srcObj.position.x + offset, y: srcObj.position.y + offset },
        userId: user.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        childObjectIds: undefined, // frames lose children on duplicate
      };

      recentlyCreatedIds.current.add(newId);
      setTimeout(() => recentlyCreatedIds.current.delete(newId), 2000);

      addObject(newObject);
      const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${newId}`);
      set(objectRef, newObject).catch(console.error);
    });
  }, [user, boardId, addObject]);

  // Handle keyboard events: delete, duplicate, copy/paste
  useEffect(() => {
    if (!fabricCanvasRef.current) return;

    const canvas = fabricCanvasRef.current;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape cancels connection mode
      if (e.key === 'Escape' && isConnecting) {
        cancelConnectionMode(canvas);
        return;
      }

      // Don't handle shortcuts while editing text (except Escape)
      if (isEditingTextRef.current) return;

      const metaOrCtrl = e.metaKey || e.ctrlKey;

      // ── Copy (Ctrl+C) ──────────────────────────────────────────────────
      if (metaOrCtrl && e.key === 'c') {
        const ids = getSelectedObjectIds(canvas);
        if (ids.length === 0) return;
        const store = useBoardStore.getState();
        clipboardRef.current = ids
          .map((id) => store.objects.get(id))
          .filter((obj): obj is BoardObject => !!obj && obj.type !== ObjectType.CONNECTOR);
        e.preventDefault();
        return;
      }

      // ── Paste (Ctrl+V) ─────────────────────────────────────────────────
      if (metaOrCtrl && e.key === 'v') {
        if (clipboardRef.current.length > 0) {
          duplicateObjects(clipboardRef.current, 30);
          e.preventDefault();
        }
        return;
      }

      // ── Duplicate (Ctrl+D) ─────────────────────────────────────────────
      if (metaOrCtrl && e.key === 'd') {
        const ids = getSelectedObjectIds(canvas);
        if (ids.length === 0) return;
        const store = useBoardStore.getState();
        const objs = ids
          .map((id) => store.objects.get(id))
          .filter((obj): obj is BoardObject => !!obj);
        duplicateObjects(objs, 20);
        e.preventDefault();
        return;
      }

      // ── Select All (Ctrl+A) ────────────────────────────────────────────
      if (metaOrCtrl && e.key === 'a') {
        e.preventDefault();
        canvas.discardActiveObject();
        const selectableObjs = canvas.getObjects().filter(
          (o) => o.selectable && o.data?.type === 'shape'
        );
        if (selectableObjs.length > 0) {
          const sel = new fabric.ActiveSelection(selectableObjs, { canvas });
          canvas.setActiveObject(sel);
          canvas.requestRenderAll();
        }
        return;
      }

      // ── Delete / Backspace ─────────────────────────────────────────────
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = canvas.getActiveObject();
        if (!active) return;

        // Don't delete if a textbox is being edited
        const isTextbox = active.type === 'textbox' || active.type === 'i-text';
        if (isTextbox && (active as any).isEditing) return;

        const ids = getSelectedObjectIds(canvas);
        canvas.discardActiveObject();
        ids.forEach((id) => deleteObjectById(canvas, id));
        canvas.renderAll();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deleteObject, boardId, isConnecting, getSelectedObjectIds, deleteObjectById, duplicateObjects]); // eslint-disable-line react-hooks/exhaustive-deps

  // Throttled cursor position broadcast to Firebase (30 Hz).
  // Uses canvasAreaRef (inner Fabric canvas div) — not the outer BoardPage wrapper —
  // so the rect origin exactly matches the top-left of the Fabric canvas.
  useEffect(() => {
    if (!isConnected || !user || !boardId) return;

    const myCursorRef = ref(realtimeDb, `boards/${boardId}/cursors/${user.id}`);
    let lastSend = 0;

    const throttledMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastSend > 33) {
        const rect = canvasAreaRef.current?.getBoundingClientRect();
        const vp = viewportRef.current;
        const areaX = rect ? e.clientX - rect.left : e.clientX;
        const areaY = rect ? e.clientY - rect.top  : e.clientY;
        const canvasX = (areaX - vp[4]) / vp[0];
        const canvasY = (areaY - vp[5]) / vp[3];
        set(myCursorRef, {
          position: { x: canvasX, y: canvasY },
          color: cursorColor,
          userName: user.name,
          lastUpdate: now,
        }).catch(() => {});
        lastSend = now;
      }
    };

    document.addEventListener('mousemove', throttledMouseMove);
    onDisconnect(myCursorRef).remove();

    return () => {
      document.removeEventListener('mousemove', throttledMouseMove);
      remove(myCursorRef);
    };
  }, [isConnected, user, boardId, cursorColor]); // eslint-disable-line react-hooks/exhaustive-deps

  // createObject: defined as useCallback so it always captures current user/boardId/canvas
  const createObject = useCallback((type: 'sticky_note' | 'rectangle' | 'circle' | 'arrow' | 'text_box' | 'frame') => {
    const canvas = fabricCanvasRef.current;
    // Scenario 2: log guard failures so they're visible in DevTools
    if (!user || !canvas) {
      console.error('[createObject] blocked — user:', !!user, 'canvas:', !!canvas,
        'canvasDims:', canvas ? { w: canvas.width, h: canvas.height } : null);
      return;
    }
    console.log('[createObject]', type, { canvasW: canvas.width, canvasH: canvas.height });

    const randomColor = OBJECT_COLORS[Math.floor(Math.random() * OBJECT_COLORS.length)];
    // Place object at viewport center in canvas coordinates (pan + zoom aware)
    const vp   = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const zoom = canvas.getZoom();
    const viewCenterX = (canvas.width  || 800) / 2;
    const viewCenterY = (canvas.height || 600) / 2;
    const centerX = (viewCenterX - vp[4]) / zoom - DEFAULT_OBJECT_WIDTH  / 2 + (Math.random() * 60 - 30);
    const centerY = (viewCenterY - vp[5]) / zoom - DEFAULT_OBJECT_HEIGHT / 2 + (Math.random() * 60 - 30);
    const textPadding = 15;

    const defaultContent =
      type === 'sticky_note' ? 'Double-click to edit' :
      type === 'rectangle' ? 'Click to edit text' :
      type === 'arrow' ? 'Label arrow' :
      type === 'text_box' ? 'Type here' :
      type === 'frame' ? '' :
      'Edit me!';

    const FRAME_WIDTH = 400;
    const FRAME_HEIGHT = 300;
    const objectWidth = type === 'frame' ? FRAME_WIDTH : DEFAULT_OBJECT_WIDTH;
    const objectHeight = type === 'arrow' ? 60 : type === 'frame' ? FRAME_HEIGHT : DEFAULT_OBJECT_HEIGHT;
    const defaultFontSize = type === 'text_box' ? 24 : 13;

    const newObject: BoardObject = {
      id: uuidv4(),
      type: ObjectType[type.toUpperCase() as keyof typeof ObjectType],
      position: { x: centerX, y: centerY },
      width: objectWidth,
      height: objectHeight,
      rotation: 0,
      content: defaultContent,
      color: randomColor,
      userId: user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(type === 'text_box' ? { fontSize: defaultFontSize } : {}),
      ...(type === 'frame' ? { childObjectIds: [], frameLabel: 'Frame' } : {}),
    };

    // Immediately render on canvas (don't wait for store→effect→sync chain)
    let shapeObj: fabric.Object | null = null;
    if (type === 'sticky_note') {
      shapeObj = new fabric.Rect({
        left: centerX, top: centerY,
        width: DEFAULT_OBJECT_WIDTH, height: objectHeight,
        fill: randomColor, stroke: '#d4a574', strokeWidth: 2, rx: 4,
        hasControls: true, selectable: true,
      });
    } else if (type === 'rectangle') {
      shapeObj = new fabric.Rect({
        left: centerX, top: centerY,
        width: DEFAULT_OBJECT_WIDTH, height: objectHeight,
        fill: randomColor, stroke: '#6b7280', strokeWidth: 2,
        selectable: true, hasControls: true,
      });
    } else if (type === 'circle') {
      shapeObj = new fabric.Circle({
        left: centerX, top: centerY,
        radius: Math.min(DEFAULT_OBJECT_WIDTH, objectHeight) / 2,
        fill: randomColor, stroke: '#6b7280', strokeWidth: 2,
        selectable: true, hasControls: true,
      });
    } else if (type === 'arrow') {
      const headWidth = objectHeight * 0.8;
      const shaftHeight = objectHeight * 0.4;
      const arrowPoints = [
        { x: 0, y: (objectHeight - shaftHeight) / 2 },
        { x: DEFAULT_OBJECT_WIDTH - headWidth, y: (objectHeight - shaftHeight) / 2 },
        { x: DEFAULT_OBJECT_WIDTH - headWidth, y: 0 },
        { x: DEFAULT_OBJECT_WIDTH, y: objectHeight / 2 },
        { x: DEFAULT_OBJECT_WIDTH - headWidth, y: objectHeight },
        { x: DEFAULT_OBJECT_WIDTH - headWidth, y: (objectHeight + shaftHeight) / 2 },
        { x: 0, y: (objectHeight + shaftHeight) / 2 },
      ];
      shapeObj = new fabric.Polygon(arrowPoints, {
        left: centerX, top: centerY,
        fill: randomColor, stroke: '#6b7280', strokeWidth: 2,
        selectable: true, hasControls: true, objectCaching: false,
      });
    }

    // FRAME: dashed rectangle container for grouping objects
    if (type === 'frame') {
      const frameRect = new fabric.Rect({
        left: centerX, top: centerY,
        width: FRAME_WIDTH, height: FRAME_HEIGHT,
        fill: 'rgba(59, 130, 246, 0.04)',
        stroke: '#3b82f6', strokeWidth: 2,
        strokeDashArray: [8, 4],
        rx: 8,
        hasControls: true, selectable: true,
      });
      frameRect.set({
        data: { objectId: newObject.id, userId: user.id, type: 'shape', isFrame: true },
      });
      canvas.add(frameRect);
      canvas.sendToBack(frameRect);

      // Frame label
      const label = new fabric.Text('Frame', {
        left: centerX + 8, top: centerY - 22,
        fontSize: 12, fontFamily: 'Arial, sans-serif',
        fill: '#3b82f6', fontWeight: 'bold',
        selectable: false, evented: false,
      });
      label.set({ data: { objectId: newObject.id, type: 'frameLabel' } });
      canvas.add(label);

      canvas.renderAll();

      recentlyCreatedIds.current.add(newObject.id);
      setTimeout(() => recentlyCreatedIds.current.delete(newObject.id), 2000);

      addObject(newObject);
      const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${newObject.id}`);
      set(objectRef, newObject).catch(console.error);
      return;
    }

    // TEXT_BOX: single textbox that acts as both shape and text
    if (type === 'text_box') {
      const tbObj = new fabric.Textbox(defaultContent, {
        left: centerX,
        top: centerY,
        width: DEFAULT_OBJECT_WIDTH,
        fontSize: defaultFontSize,
        fontFamily: 'Arial, sans-serif',
        fill: '#1f2937',
        editable: true,
        hasControls: true,
        selectable: true,
        evented: true,
        hoverCursor: 'move',
        splitByGrapheme: true,
        textAlign: 'center',
        lineHeight: 1.2,
        borderColor: '#3b82f6',
        editingBorderColor: '#3b82f6',
        padding: 8,
      });
      tbObj.set({
        data: {
          objectId: newObject.id, userId: user.id, type: 'shape',
          isTextBox: true, baseFontSize: defaultFontSize,
        },
      });
      canvas.add(tbObj);
      canvas.renderAll();

      recentlyCreatedIds.current.add(newObject.id);
      setTimeout(() => recentlyCreatedIds.current.delete(newObject.id), 2000);

      addObject(newObject);
      const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${newObject.id}`);
      set(objectRef, newObject).catch((err) => {
        console.error('Failed to write object to Firebase:', err);
      });
      return; // TEXT_BOX uses a single canvas object — skip the shape+text pair below
    }

    if (shapeObj) {
      shapeObj.set({ data: { objectId: newObject.id, userId: user.id, type: 'shape' } });
      canvas.add(shapeObj);

      const textObj = new fabric.Textbox(defaultContent, {
        left: centerX + textPadding, top: centerY + textPadding,
        width: DEFAULT_OBJECT_WIDTH - textPadding * 2,
        fontSize: 13, fontFamily: 'Arial, sans-serif', fill: '#1f2937',
        editable: true, hasControls: false,
        lockMovementX: true, lockMovementY: true,
        lockScalingX: true, lockScalingY: true, lockRotation: true,
        selectable: true, evented: true, hoverCursor: 'text',
        splitByGrapheme: true, textAlign: 'left', lineHeight: 1.2,
        borderColor: 'transparent', editingBorderColor: 'transparent',
      });
      textObj.set({
        data: { objectId: newObject.id, userId: user.id, type: 'text',
          parentShapeId: newObject.id, maxWidth: DEFAULT_OBJECT_WIDTH - textPadding * 2 }
      });
      canvas.add(textObj);
      canvas.renderAll();
    }

    // Scenario 3: protect this object from syncObjectsToCanvas removal for 2s
    recentlyCreatedIds.current.add(newObject.id);
    setTimeout(() => recentlyCreatedIds.current.delete(newObject.id), 2000);

    // Sync to store and Firebase
    addObject(newObject);
    const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${newObject.id}`);
    set(objectRef, newObject).catch((err) => {
      console.error('Failed to write object to Firebase:', err);
    });
  }, [user, boardId, addObject]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create a connector between two objects ────────────────────────────────────
  const createConnector = useCallback((
    sourceId: string,
    targetId: string,
    style: 'line' | 'arrow',
  ) => {
    if (!user) return;
    const connId = uuidv4();
    const connObject: BoardObject = {
      id: connId,
      type: ObjectType.CONNECTOR,
      position: { x: 0, y: 0 },
      width: 0,
      height: 0,
      rotation: 0,
      content: '',
      color: '#6b7280',
      userId: user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceObjectId: sourceId,
      targetObjectId: targetId,
      connectorStyle: style,
    };

    recentlyCreatedIds.current.add(connId);
    setTimeout(() => recentlyCreatedIds.current.delete(connId), 2000);

    addObject(connObject);
    const objRef = ref(realtimeDb, `boards/${boardId}/objects/${connId}`);
    set(objRef, connObject).catch((err) => {
      console.error('Failed to write connector to Firebase:', err);
    });
  }, [user, boardId, addObject]);

  // ── Cancel connection mode ────────────────────────────────────────────────────
  const cancelConnectionMode = useCallback((canvas: fabric.Canvas) => {
    setIsConnecting(false);
    connectionSourceRef.current = null;
    if (rubberBandLineRef.current) {
      canvas.remove(rubberBandLineRef.current);
      rubberBandLineRef.current = null;
    }
    if (sourceHighlightRef.current) {
      sourceHighlightRef.current.set({ stroke: sourceHighlightRef.current.data?._origStroke || '#6b7280' });
      sourceHighlightRef.current = null;
    }
    canvas.defaultCursor = 'default';
    canvas.renderAll();
  }, []);

  // ── Start connection mode from toolbar ────────────────────────────────────────
  const startConnectionMode = useCallback((style: 'line' | 'arrow') => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // If already connecting, cancel first
    if (isConnecting) {
      cancelConnectionMode(canvas);
      return;
    }

    connectionStyleRef.current = style;
    connectionSourceRef.current = null;
    setIsConnecting(true);
    canvas.defaultCursor = 'crosshair';
    canvas.discardActiveObject();
    canvas.renderAll();
  }, [isConnecting, cancelConnectionMode]);

  // ── Connection mode: Fabric event handlers ────────────────────────────────────
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (opt: fabric.IEvent) => {
      if (!isConnecting) return;

      const target = opt.target;

      // Find the shape objectId under click
      let clickedObjectId: string | null = null;
      if (target?.data?.objectId && (target.data.type === 'shape' || target.data.type === 'text')) {
        clickedObjectId = target.data.objectId as string;
      }

      if (!connectionSourceRef.current) {
        // First click — select source
        if (!clickedObjectId) {
          cancelConnectionMode(canvas);
          return;
        }

        // Don't allow connecting from connectors
        const obj = useBoardStore.getState().objects.get(clickedObjectId);
        if (!obj || obj.type === ObjectType.CONNECTOR) return;

        connectionSourceRef.current = clickedObjectId;

        // Highlight the source shape
        const shapeObj = canvas.getObjects().find(
          (o) => o.data?.objectId === clickedObjectId && o.data?.type === 'shape'
        );
        if (shapeObj) {
          shapeObj.data._origStroke = shapeObj.stroke;
          shapeObj.set({ stroke: '#3b82f6' });
          sourceHighlightRef.current = shapeObj;
        }

        canvas.renderAll();
      } else {
        // Second click — select target and create connector
        if (!clickedObjectId || clickedObjectId === connectionSourceRef.current) {
          cancelConnectionMode(canvas);
          return;
        }

        const obj = useBoardStore.getState().objects.get(clickedObjectId);
        if (!obj || obj.type === ObjectType.CONNECTOR) {
          cancelConnectionMode(canvas);
          return;
        }

        createConnector(connectionSourceRef.current, clickedObjectId, connectionStyleRef.current);
        cancelConnectionMode(canvas);
      }
    };

    const handleMouseMove = (opt: fabric.IEvent) => {
      if (!isConnecting || !connectionSourceRef.current) return;

      const pointer = canvas.getPointer(opt.e);
      const sourceId = connectionSourceRef.current;
      const store = useBoardStore.getState();
      const srcData = store.objects.get(sourceId);
      if (!srcData) return;

      const srcShape = canvas.getObjects().find(
        (o) => o.data?.objectId === sourceId && o.data?.type === 'shape'
      );
      const sx = srcShape?.left ?? srcData.position.x;
      const sy = srcShape?.top ?? srcData.position.y;
      const cx = sx + srcData.width / 2;
      const cy = sy + srcData.height / 2;

      if (!rubberBandLineRef.current) {
        const line = new fabric.Line([cx, cy, pointer.x, pointer.y], {
          stroke: '#3b82f6',
          strokeWidth: 2,
          strokeDashArray: [6, 4],
          selectable: false,
          evented: false,
          excludeFromExport: true,
        });
        rubberBandLineRef.current = line;
        canvas.add(line);
      } else {
        rubberBandLineRef.current.set({ x1: cx, y1: cy, x2: pointer.x, y2: pointer.y });
        rubberBandLineRef.current.setCoords();
      }

      canvas.renderAll();
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
    };
  }, [isConnecting, createConnector, cancelConnectionMode]);

  // ── Selection tracking for color picker ────────────────────────────────────
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const onSelected = () => {
      const active = canvas.getActiveObject();
      if (active?.data?.objectId) {
        const objType = active.data.type as string;
        // Only show color picker for shapes (including textbox shapes), not connectors/arrowheads
        if (objType === 'shape' || objType === 'text') {
          setSelectedObjId(active.data.objectId as string);
          return;
        }
      }
      setSelectedObjId(null);
      setShowColorPicker(false);
    };

    const onCleared = () => {
      setSelectedObjId(null);
      setShowColorPicker(false);
    };

    canvas.on('selection:created', onSelected);
    canvas.on('selection:updated', onSelected);
    canvas.on('selection:cleared', onCleared);

    return () => {
      canvas.off('selection:created', onSelected);
      canvas.off('selection:updated', onSelected);
      canvas.off('selection:cleared', onCleared);
    };
  }, []);

  // ── Change color of selected object ────────────────────────────────────────
  const changeObjectColor = useCallback((color: string) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !selectedObjId) return;

    const store = useBoardStore.getState();
    const objData = store.objects.get(selectedObjId);
    if (!objData) return;

    const isTextBox = objData.type === ObjectType.TEXT_BOX;

    // Update all canvas objects for this ID
    canvas.getObjects().forEach((o) => {
      if (o.data?.objectId !== selectedObjId) return;
      const dtype = o.data?.type as string;

      if (dtype === 'shape') {
        if (isTextBox) {
          // Text box: change the text fill color
          (o as fabric.Textbox).set({ fill: color });
        } else {
          // Regular shape: change the background fill
          o.set({ fill: color });
        }
      }
    });
    canvas.renderAll();

    // Update store and Firebase
    updateObjectStore(selectedObjId, { color });
    const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${selectedObjId}`);
    update(objectRef, { color, updatedAt: Date.now() }).catch(console.error);

    setShowColorPicker(false);
  }, [selectedObjId, boardId, updateObjectStore]);

  return (
    <div ref={containerRef} tabIndex={-1} className="w-full h-full flex flex-col bg-white outline-none">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-4 border-b border-gray-200 bg-gray-50">
        <button
          onClick={() => createObject('sticky_note')}
          disabled={!canvasReady}
          className="px-3 py-2 bg-yellow-200 text-gray-900 rounded hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm font-medium"
          title="Create sticky note"
        >
          📝 Sticky Note
        </button>

        <button
          onClick={() => createObject('rectangle')}
          disabled={!canvasReady}
          className="px-3 py-2 bg-blue-200 text-gray-900 rounded hover:bg-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm font-medium"
          title="Create rectangle"
        >
          ▭ Rectangle
        </button>

        <button
          onClick={() => createObject('circle')}
          disabled={!canvasReady}
          className="px-3 py-2 bg-green-200 text-gray-900 rounded hover:bg-green-300 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm font-medium"
          title="Create circle"
        >
          ● Circle
        </button>

        <button
          onClick={() => createObject('arrow')}
          disabled={!canvasReady}
          className="px-3 py-2 bg-purple-200 text-gray-900 rounded hover:bg-purple-300 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm font-medium"
          title="Create arrow"
        >
          ➜ Arrow
        </button>

        <button
          onClick={() => createObject('text_box')}
          disabled={!canvasReady}
          className="px-3 py-2 bg-gray-200 text-gray-900 rounded hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm font-medium"
          title="Create text box — resize to scale text"
        >
          Aa Text
        </button>

        {/* Separator */}
        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Connect buttons */}
        <button
          onClick={() => startConnectionMode('line')}
          disabled={!canvasReady}
          className={`px-3 py-2 rounded transition text-sm font-medium ${
            isConnecting && connectionStyleRef.current === 'line'
              ? 'bg-orange-500 text-white'
              : 'bg-orange-200 text-gray-900 hover:bg-orange-300'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
          title="Connect two objects with a line"
        >
          ─ Line
        </button>

        <button
          onClick={() => startConnectionMode('arrow')}
          disabled={!canvasReady}
          className={`px-3 py-2 rounded transition text-sm font-medium ${
            isConnecting && connectionStyleRef.current === 'arrow'
              ? 'bg-orange-500 text-white'
              : 'bg-orange-200 text-gray-900 hover:bg-orange-300'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
          title="Connect two objects with an arrow"
        >
          → Arrow
        </button>

        {/* Separator */}
        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Frame button */}
        <button
          onClick={() => createObject('frame')}
          disabled={!canvasReady}
          className="px-3 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm font-medium border border-blue-300 border-dashed"
          title="Create a frame to group objects"
        >
          [ ] Frame
        </button>

        {/* Color picker — visible when an object is selected */}
        {selectedObjId && (
          <>
            <div className="w-px h-6 bg-gray-300 mx-1" />
            <div className="relative">
              <button
                onClick={() => setShowColorPicker((v) => !v)}
                className="px-3 py-2 bg-white border border-gray-300 rounded hover:bg-gray-100 transition text-sm font-medium flex items-center gap-1.5"
                title="Change color"
              >
                <span
                  className="inline-block w-4 h-4 rounded border border-gray-400"
                  style={{ backgroundColor: objects.get(selectedObjId)?.color || '#ccc' }}
                />
                Color
              </button>
              {showColorPicker && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1 w-40">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => changeObjectColor(c)}
                      className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* Live canvas coordinates — updated via DOM ref (no React re-render) */}
        <span
          ref={coordsDisplayRef}
          className="text-xs text-gray-400 font-mono w-28 text-right select-none"
        >
          X:0  Y:0
        </span>

        <div className="text-sm text-gray-600 ml-2">
          Zoom: {(canvasState.scale * 100).toFixed(0)}%
        </div>

        <button
          onClick={() => {
            setCanvasState((prev) => ({ ...prev, scale: 1, offsetX: 0, offsetY: 0 }));
            const c = fabricCanvasRef.current;
            if (c) {
              c.setZoom(1);
              c.setViewportTransform([1, 0, 0, 1, 0, 0]);
              c.requestRenderAll();
            }
            if (canvasAreaRef.current) {
              canvasAreaRef.current.style.backgroundSize = `${GRID_SIZE}px ${GRID_SIZE}px`;
              canvasAreaRef.current.style.backgroundPosition = '0px 0px';
            }
            if (coordsDisplayRef.current) coordsDisplayRef.current.textContent = 'X:0  Y:0';
          }}
          className="px-3 py-2 bg-gray-200 text-gray-900 rounded hover:bg-gray-300 transition text-sm font-medium"
        >
          Reset View
        </button>
      </div>

      {/* Connection mode banner */}
      {isConnecting && (
        <div className="bg-orange-50 border-b border-orange-200 px-4 py-1.5 text-sm text-orange-700 flex items-center gap-2">
          <span className="font-medium">
            {connectionSourceRef.current ? 'Click a target object to complete the connection' : 'Click a source object to start connecting'}
          </span>
          <button
            onClick={() => fabricCanvasRef.current && cancelConnectionMode(fabricCanvasRef.current)}
            className="ml-auto text-xs px-2 py-0.5 bg-orange-200 rounded hover:bg-orange-300 transition"
          >
            Cancel (Esc)
          </button>
        </div>
      )}

      {/* Canvas area — React renders an empty div here.
          The actual <canvas> element is created imperatively in useEffect
          so React's reconciler never touches it or Fabric's canvas-container wrapper. */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={canvasAreaRef}
          className="w-full h-full"
          style={{
            backgroundColor: '#ffffff',
            backgroundImage:
              `linear-gradient(#e5e7eb 1px, transparent 1px),
               linear-gradient(90deg, #e5e7eb 1px, transparent 1px)`,
            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
            backgroundPosition: '0px 0px',
          }}
        />

        {/* ✓ Confirm button — appears next to the text being edited */}
        {confirmButtonPos && (
          <button
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); commitTextEdit(); }}
            className="absolute z-50 w-8 h-8 bg-green-500 hover:bg-green-600 active:bg-green-700 text-white rounded-full shadow-lg flex items-center justify-center font-bold text-base transition-colors"
            style={{ left: confirmButtonPos.left, top: confirmButtonPos.top }}
            title="Confirm edit — saves text to board"
          >
            ✓
          </button>
        )}

        {/* Lock toast — shown when trying to edit a locked object */}
        {lockToastMsg && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none flex items-center gap-2">
            🔒 {lockToastMsg}
          </div>
        )}

        {/* Remote cursor overlay — rendered here so absolute inset-0 matches Fabric canvas origin */}
        <CursorOverlay />
      </div>

      {/* Controls reference */}
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-gray-200 shadow-sm leading-5 select-none">
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">↑ ↓ ← →</kbd> Pan canvas</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Space</kbd> + drag to pan</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Z</kbd> + scroll to zoom</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Del</kbd> Delete selected</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Ctrl+D</kbd> Duplicate</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Ctrl+C/V</kbd> Copy / Paste</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Ctrl+A</kbd> Select all</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Shift+click</kbd> Multi-select</p>
        <p>Drag empty area to box-select</p>
      </div>
    </div>
  );

  // Helper functions

  // Setup canvas event listeners (called once during initialization)
  function setupCanvasEventListeners(canvas: fabric.Canvas) {
    const textPadding = 15;

    // Handle object modification (shape moved/resized/rotated)
    canvas.on('object:modified', (e: fabric.IEvent) => {
      const target = e.target;
      if (!target || !target.data?.objectId) return;

      const objectId = target.data.objectId as string;
      const targetType = target.data.type as string;

      // Handle multi-select (ActiveSelection) — sync each child object
      if (target.type === 'activeSelection') {
        const group = target as fabric.ActiveSelection;
        group.getObjects().forEach((child) => {
          if (!child.data?.objectId || child.data?.type !== 'shape') return;
          const childId = child.data.objectId as string;
          // Get the actual canvas position (group offsets child coords)
          const matrix = child.calcTransformMatrix();
          const point = new fabric.Point(0, 0);
          const absPos = fabric.util.transformPoint(point, matrix);
          const newW = (child.width || DEFAULT_OBJECT_WIDTH) * (child.scaleX || 1);
          const newH = (child.height || DEFAULT_OBJECT_HEIGHT) * (child.scaleY || 1);

          const childUpdates: Record<string, unknown> = {
            position: { x: absPos.x - newW / 2, y: absPos.y - newH / 2 },
            width: newW,
            height: newH,
            rotation: child.angle || 0,
            updatedAt: Date.now(),
          };
          updateObjectStore(childId, childUpdates);
          const objRef = ref(realtimeDb, `boards/${boardId}/objects/${childId}`);
          update(objRef, childUpdates).catch(console.error);
        });
        canvas.renderAll();
        return;
      }

      // Only sync shape modifications (not text, since text is locked to shape)
      if (targetType === 'shape') {
        const isTextBox = !!target.data?.isTextBox;
        const isFrame = !!target.data?.isFrame;

        // Normalize scale: bake scaleX/Y into width/height, reset scale to 1
        const newWidth = (target.width || DEFAULT_OBJECT_WIDTH) * (target.scaleX || 1);
        const newHeight = (target.height || DEFAULT_OBJECT_HEIGHT) * (target.scaleY || 1);

        if (!isTextBox) {
          target.set({ width: newWidth, height: newHeight, scaleX: 1, scaleY: 1 });
          target.setCoords();

          // For regular shapes, find and update the corresponding text position + width
          const textObj = canvas.getObjects().find(
            (obj) => obj.data?.objectId === objectId && obj.data?.type === 'text'
          ) as fabric.Textbox;

          if (textObj) {
            textObj.set({
              left: (target.left || 0) + textPadding,
              top: (target.top || 0) + textPadding,
              width: Math.max(50, newWidth - textPadding * 2),
            });
            textObj.data.maxWidth = newWidth - textPadding * 2;
            textObj.setCoords();
          }
        }

        const updates: Record<string, unknown> = {
          position: { x: target.left || 0, y: target.top || 0 },
          width: newWidth,
          height: newHeight,
          rotation: target.angle || 0,
          updatedAt: Date.now(),
        };

        // For TEXT_BOX, also persist the current fontSize
        if (isTextBox) {
          updates.fontSize = (target as fabric.Textbox).fontSize || 24;
        }

        // Update local store (optimistic update)
        updateObjectStore(objectId, updates);

        // Update in Firebase Realtime Database
        const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${objectId}`);
        update(objectRef, updates).catch((error) => {
          console.error('Failed to update object in Firebase:', error);
        });

        // Update all connectors attached to this object
        const attachedConnectors = connectorIndexRef.current.get(objectId);
        if (attachedConnectors) {
          attachedConnectors.forEach((connId) => updateConnectorOnCanvas(canvas, connId));
        }

        // Frame: move children with frame
        if (isFrame && e.transform) {
          const transform = e.transform as any;
          const dx = (target.left || 0) - (transform.original?.left || 0);
          const dy = (target.top || 0) - (transform.original?.top || 0);
          if (dx !== 0 || dy !== 0) {
            const store = useBoardStore.getState();
            const frameData = store.objects.get(objectId);
            const childIds = frameData?.childObjectIds || [];
            childIds.forEach((childId: string) => {
              const childShape = canvas.getObjects().find(
                (o) => o.data?.objectId === childId && o.data?.type === 'shape'
              );
              if (childShape) {
                childShape.set({
                  left: (childShape.left || 0) + dx,
                  top: (childShape.top || 0) + dy,
                });
                childShape.setCoords();
                // Also move the child text
                const childText = canvas.getObjects().find(
                  (o) => o.data?.objectId === childId && o.data?.type === 'text'
                );
                if (childText) {
                  childText.set({
                    left: (childText.left || 0) + dx,
                    top: (childText.top || 0) + dy,
                  });
                  childText.setCoords();
                }
                // Sync child position to Firebase
                const childUpdates = {
                  position: { x: childShape.left || 0, y: childShape.top || 0 },
                  updatedAt: Date.now(),
                };
                updateObjectStore(childId, childUpdates);
                const childRef = ref(realtimeDb, `boards/${boardId}/objects/${childId}`);
                update(childRef, childUpdates).catch(console.error);
              }
            });
          }
        }

        // Frame membership: if a non-frame shape was dropped inside a frame, add it as a child
        if (!target.data?.isFrame && targetType === 'shape') {
          const store = useBoardStore.getState();
          const objLeft = target.left || 0;
          const objTop = target.top || 0;
          const objW = (target.width || 0) * (target.scaleX || 1);
          const objH = (target.height || 0) * (target.scaleY || 1);
          const objCenterX = objLeft + objW / 2;
          const objCenterY = objTop + objH / 2;

          // Find if the object center is inside any frame
          let newParentFrameId: string | null = null;
          store.objects.forEach((frameObj) => {
            if (frameObj.type !== ObjectType.FRAME) return;
            if (objCenterX >= frameObj.position.x && objCenterX <= frameObj.position.x + frameObj.width &&
                objCenterY >= frameObj.position.y && objCenterY <= frameObj.position.y + frameObj.height) {
              newParentFrameId = frameObj.id;
            }
          });

          // Remove from any previous frame
          store.objects.forEach((frameObj) => {
            if (frameObj.type !== ObjectType.FRAME || !frameObj.childObjectIds) return;
            if (frameObj.childObjectIds.includes(objectId) && frameObj.id !== newParentFrameId) {
              const newChildren = frameObj.childObjectIds.filter((id: string) => id !== objectId);
              updateObjectStore(frameObj.id, { childObjectIds: newChildren });
              const frameRef = ref(realtimeDb, `boards/${boardId}/objects/${frameObj.id}`);
              update(frameRef, { childObjectIds: newChildren, updatedAt: Date.now() }).catch(console.error);
            }
          });

          // Add to new frame if applicable
          if (newParentFrameId) {
            const frameObj = store.objects.get(newParentFrameId);
            if (frameObj) {
              const currentChildren = frameObj.childObjectIds || [];
              if (!currentChildren.includes(objectId)) {
                const newChildren = [...currentChildren, objectId];
                updateObjectStore(newParentFrameId, { childObjectIds: newChildren });
                const frameRef = ref(realtimeDb, `boards/${boardId}/objects/${newParentFrameId}`);
                update(frameRef, { childObjectIds: newChildren, updatedAt: Date.now() }).catch(console.error);
              }
            }
          }
        }

        canvas.renderAll();
      }
    });

    // Handle text changes in all shapes (with debounced sync)
    canvas.on('text:changed', (e: fabric.IEvent) => {
      const target = e.target as fabric.Textbox;
      if (!target || !target.data?.objectId) return;
      // Allow text changes from 'text' type (regular shapes) and 'shape' with isTextBox (TEXT_BOX)
      if (target.data?.type !== 'text' && !target.data?.isTextBox) return;

      const objectId = target.data.objectId as string;

      // Ensure text stays within bounds
      const maxWidth = target.data.maxWidth as number;
      if (maxWidth && target.width && target.width > maxWidth) {
        target.set({ width: maxWidth });
      }

      const content = target.text || '';

      // Don't update store while typing - only debounced sync to backend
      debouncedTextSync(objectId, content);
    });

    // Handle text editing mode
    canvas.on('text:editing:entered', (e: fabric.IEvent) => {
      const target = e.target as fabric.Textbox;
      if (!target || !target.data?.objectId) return;

      isEditingTextRef.current = true;
      canvas.selection = false;

      const objectId = target.data.objectId as string;
      activeEditingObjectId.current = objectId;

      // Acquire lock in Firebase so other users cannot edit this object.
      // onDisconnect ensures the lock is released even if the browser tab closes.
      const currentUser = useAuthStore.getState().user;
      if (currentUser) {
        const lockRef = ref(realtimeDb, `boards/${boardId}/locks/${objectId}`);
        set(lockRef, { lockedBy: currentUser.id, lockedByName: currentUser.name }).catch(console.error);
        onDisconnect(lockRef).remove().catch(console.error);
      }

      // Position the ✓ confirm button next to the text object
      const vp = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const scale = vp[0];
      const objLeft = (target.left || 0) * scale + vp[4];
      const objTop = (target.top || 0) * scale + vp[5];
      const objWidth = (target.width || 100) * (target.scaleX || 1) * scale;
      setConfirmButtonPos({ left: objLeft + objWidth + 10, top: objTop - 4 });
    });

    canvas.on('text:editing:exited', (e: fabric.IEvent) => {
      const target = e.target as fabric.Textbox;

      // Update store with final text value when editing completes
      if (target && target.data?.objectId && (target.data?.type === 'text' || target.data?.isTextBox)) {
        const objectId = target.data.objectId as string;
        const content = target.text || '';
        updateObjectStore(objectId, { content });

        // Force final sync to Firebase
        const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${objectId}`);
        update(objectRef, { content, updatedAt: Date.now() }).catch((error) => {
          console.error('Failed to update text in Firebase:', error);
        });

        // Release the editing lock
        const lockRef = ref(realtimeDb, `boards/${boardId}/locks/${objectId}`);
        remove(lockRef).catch(console.error);
      }

      canvas.selection = true;
      activeEditingObjectId.current = null;
      isEditingTextRef.current = false;
      setConfirmButtonPos(null);
    });

    // Handle object moving — keep text glued to shape locally AND broadcast to other users
    // Track previous frame position for delta calculation during drag
    const frameDragPrev = new Map<string, { x: number; y: number }>();

    canvas.on('object:moving', (e: fabric.IEvent) => {
      const target = e.target;
      if (!target || !target.data?.objectId) return;

      const objectId = target.data.objectId as string;
      const targetType = target.data.type as string;

      if (targetType === 'shape') {
        const isFrame = !!target.data?.isFrame;

        // Keep text object visually glued to shape
        const textObj = canvas.getObjects().find(
          (obj) => obj.data?.objectId === objectId && obj.data?.type === 'text'
        ) as fabric.Textbox;

        if (textObj) {
          textObj.set({
            left: (target.left || 0) + textPadding,
            top: (target.top || 0) + textPadding,
          });
          textObj.setCoords();
        }

        // Frame: move label and children with it
        if (isFrame) {
          // Update frame label position
          const frameLabel = canvas.getObjects().find(
            (o) => o.data?.objectId === objectId && o.data?.type === 'frameLabel'
          );
          if (frameLabel) {
            frameLabel.set({
              left: (target.left || 0) + 8,
              top: (target.top || 0) - 22,
            });
            frameLabel.setCoords();
          }

          // Move children with frame (delta-based)
          const prev = frameDragPrev.get(objectId);
          const curX = target.left || 0;
          const curY = target.top || 0;
          if (prev) {
            const dx = curX - prev.x;
            const dy = curY - prev.y;
            if (dx !== 0 || dy !== 0) {
              const store = useBoardStore.getState();
              const frameData = store.objects.get(objectId);
              const childIds = frameData?.childObjectIds || [];
              childIds.forEach((childId: string) => {
                const childShape = canvas.getObjects().find(
                  (o) => o.data?.objectId === childId && o.data?.type === 'shape'
                );
                if (childShape) {
                  childShape.set({
                    left: (childShape.left || 0) + dx,
                    top: (childShape.top || 0) + dy,
                  });
                  childShape.setCoords();
                  // Also move child text
                  const childText = canvas.getObjects().find(
                    (o) => o.data?.objectId === childId && o.data?.type === 'text'
                  );
                  if (childText) {
                    childText.set({
                      left: (childText.left || 0) + dx,
                      top: (childText.top || 0) + dy,
                    });
                    childText.setCoords();
                  }
                  // Update connectors attached to child
                  const attachedConns = connectorIndexRef.current.get(childId);
                  if (attachedConns) {
                    attachedConns.forEach((connId) => updateConnectorOnCanvas(canvas, connId));
                  }
                }
              });
            }
          }
          frameDragPrev.set(objectId, { x: curX, y: curY });
        }

        // Update all connectors attached to this object in real-time
        const attachedConnectors = connectorIndexRef.current.get(objectId);
        if (attachedConnectors) {
          attachedConnectors.forEach((connId) => updateConnectorOnCanvas(canvas, connId));
        }

        // Throttled broadcast to Firebase so remote users see live movement
        const now = Date.now();
        const last = lastMoveSyncRef.current.get(objectId) || 0;
        if (now - last >= 1000 / MOVE_SYNC_HZ) {
          lastMoveSyncRef.current.set(objectId, now);
          const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${objectId}`);
          update(objectRef, {
            position: { x: target.left || 0, y: target.top || 0 },
            updatedAt: now,
          }).catch(() => {}); // ignore transient errors during drag
        }
      }
    });

    // Initialize frame drag tracking on mouse:down
    canvas.on('mouse:down', (e: fabric.IEvent) => {
      const target = e.target;
      if (target?.data?.isFrame && target.data?.objectId) {
        frameDragPrev.set(target.data.objectId as string, {
          x: target.left || 0,
          y: target.top || 0,
        });
      }
    });

    // Handle object scaling (update text position and width during resize)
    canvas.on('object:scaling', (e: fabric.IEvent) => {
      const target = e.target;
      if (!target || !target.data?.objectId) return;

      const objectId = target.data.objectId as string;
      const targetType = target.data.type as string;

      // Only shapes can be scaled
      if (targetType === 'shape') {
        const isTextBox = !!target.data?.isTextBox;

        if (isTextBox) {
          // TEXT_BOX: scale fontSize proportionally, then reset scale to 1
          const tbTarget = target as fabric.Textbox;
          const scaleAvg = ((target.scaleX || 1) + (target.scaleY || 1)) / 2;
          const baseFontSize = (target.data?.baseFontSize as number) || 24;
          const newFontSize = Math.max(8, Math.round(baseFontSize * scaleAvg));
          const newWidth = (target.width || DEFAULT_OBJECT_WIDTH) * (target.scaleX || 1);

          tbTarget.set({
            fontSize: newFontSize,
            width: Math.max(50, newWidth),
            scaleX: 1,
            scaleY: 1,
          });
          target.data.baseFontSize = newFontSize;
          tbTarget.setCoords();
        } else {
          const textObj = canvas.getObjects().find(
            (obj) => obj.data?.objectId === objectId && obj.data?.type === 'text'
          ) as fabric.Textbox;

          if (textObj) {
            // Calculate new dimensions based on shape's scaled size
            const newWidth = ((target.width || 0) * (target.scaleX || 1)) - (textPadding * 2);
            const newLeft = (target.left || 0) + textPadding;
            const newTop = (target.top || 0) + textPadding;

            textObj.set({
              left: newLeft,
              top: newTop,
              width: Math.max(50, newWidth), // Minimum width to prevent text from disappearing
            });
            textObj.setCoords();

            // Update maxWidth in data for future reference
            textObj.data.maxWidth = newWidth;
          }
        }
      }
    });

    // Handle double-click on shapes/textboxes to activate text editing
    canvas.on('mouse:dblclick', (e: fabric.IEvent) => {
      const target = e.target;
      if (!target || !target.data?.objectId) return;

      const objectId = target.data.objectId as string;
      const targetType = target.data.type as string;

      // Resolve the objectId for lock check — textboxes share their parent shape's objectId
      const lockObjectId = targetType === 'text'
        ? (target.data?.parentShapeId as string || objectId)
        : objectId;

      // Check if this object is locked by another user (applies to both shape and text clicks)
      const lock = currentLocksRef.current.get(lockObjectId);
      const currentUser = useAuthStore.getState().user;
      if (lock && lock.lockedBy !== currentUser?.id) {
        setLockToastMsg(`${lock.lockedByName} is currently editing this`);
        setTimeout(() => setLockToastMsg(null), 2500);
        return;
      }

      // Find the textbox associated with this object (whether user clicked shape or text)
      const textObj = canvas.getObjects().find(
        (obj) => obj.data?.objectId === lockObjectId && obj.data?.type === 'text'
      ) as fabric.Textbox;

      // TEXT_BOX: the target IS the textbox — enter editing directly
      if (target.data?.isTextBox) {
        const tbTarget = target as fabric.Textbox;
        if (!(tbTarget as any).isEditing) {
          canvas.setActiveObject(tbTarget);
          tbTarget.enterEditing();
          tbTarget.selectAll();
          canvas.requestRenderAll();
        }
        return;
      }

      if (targetType === 'shape' || targetType === 'text') {
        if (textObj && !(textObj as any).isEditing) {
          canvas.setActiveObject(textObj);
          textObj.enterEditing();
          textObj.selectAll();
          canvas.requestRenderAll();
        }
      }
    });
  }

  function syncObjectsToCanvas(
    canvas: fabric.Canvas,
    boardObjects: BoardObject[],
    currentUserId: string
  ) {
    // Build O(1) lookup maps
    const existingObjectIds = new Set<string>();
    const canvasShapeMap = new Map<string, fabric.Object>();
    const canvasTextMap = new Map<string, fabric.Textbox>();
    const canvasConnectorMap = new Map<string, fabric.Line>();

    canvas.getObjects().forEach((obj: fabric.Object) => {
      const objectId = obj.data?.objectId as string;
      if (!objectId) return;
      existingObjectIds.add(objectId);
      if (obj.data?.type === 'shape') canvasShapeMap.set(objectId, obj);
      else if (obj.data?.type === 'text') canvasTextMap.set(objectId, obj as fabric.Textbox);
      else if (obj.data?.type === 'connector') canvasConnectorMap.set(objectId, obj as fabric.Line);
    });

    // Get board object IDs
    const boardObjectIds = new Set(boardObjects.map(obj => obj.id));

    // Separate shapes/etc from connectors for two-pass rendering
    const shapeObjects: BoardObject[] = [];
    const connectorObjects: BoardObject[] = [];
    boardObjects.forEach((obj) => {
      if (obj.type === ObjectType.CONNECTOR) connectorObjects.push(obj);
      else shapeObjects.push(obj);
    });

    // Remove objects that no longer exist in the board
    canvas.getObjects().forEach((obj: fabric.Object) => {
      const objectId = obj.data?.objectId as string;
      const isBackground = obj === canvas.backgroundImage;
      const isBeingEdited = (obj.type === 'textbox' || obj.type === 'i-text') && (obj as any).isEditing;

      // Scenario 3: never remove an object that was just created locally (2s grace window)
      if (!isBackground && !isBeingEdited && objectId
          && !boardObjectIds.has(objectId)
          && !recentlyCreatedIds.current.has(objectId)) {
        canvas.remove(obj);
      }
    });

    // ── Pass 1: Shapes ──────────────────────────────────────────────────────
    shapeObjects.forEach((obj) => {
      // Object already on canvas — update position and text from remote data
      if (existingObjectIds.has(obj.id)) {
        const textPadding = 15;
        const activeObj = canvas.getActiveObject();
        const shapeOnCanvas = canvasShapeMap.get(obj.id);
        const textOnCanvas = canvasTextMap.get(obj.id);
        // isShapeActive: local user is dragging this shape — don't overwrite their in-flight position
        const isShapeActive = !!shapeOnCanvas && activeObj === shapeOnCanvas;

        // TEXT_BOX: single textbox object — update position, text, fontSize, and color
        if (obj.type === ObjectType.TEXT_BOX && shapeOnCanvas && !isShapeActive) {
          const tb = shapeOnCanvas as fabric.Textbox;
          if (!(tb as any).isEditing) {
            tb.set({
              left: obj.position.x,
              top: obj.position.y,
              text: obj.content || '',
              fontSize: obj.fontSize || 24,
              width: obj.width || DEFAULT_OBJECT_WIDTH,
              fill: obj.color || '#1f2937',
            });
            tb.data.baseFontSize = obj.fontSize || 24;
            (tb as any).dirty = true;
            tb.setCoords();
          }
          return;
        }

        if (shapeOnCanvas && !isShapeActive) {
          shapeOnCanvas.set({
            left: obj.position.x, top: obj.position.y, fill: obj.color,
            width: obj.width, height: obj.height,
          });
          shapeOnCanvas.setCoords();

          // Update frame label position if this is a frame
          if (obj.type === ObjectType.FRAME) {
            const frameLabel = canvas.getObjects().find(
              (o) => o.data?.objectId === obj.id && o.data?.type === 'frameLabel'
            );
            if (frameLabel) {
              frameLabel.set({ left: obj.position.x + 8, top: obj.position.y - 22 });
              frameLabel.setCoords();
            }
          }
        }
        // Also skip text update while the local user is dragging the parent shape
        if (textOnCanvas && !isShapeActive && !(textOnCanvas as any).isEditing) {
          textOnCanvas.set({
            left: obj.position.x + textPadding,
            top: obj.position.y + textPadding,
            text: obj.content || '',
            width: Math.max(50, obj.width - textPadding * 2),
          });
          (textOnCanvas as any).dirty = true;
          textOnCanvas.setCoords();
        }
        return;
      }

      let shapeObj: fabric.Object | null = null;

      // Create the shape based on type
      if (obj.type === ObjectType.STICKY_NOTE) {
        shapeObj = new fabric.Rect({
          left: obj.position.x,
          top: obj.position.y,
          width: obj.width,
          height: obj.height,
          fill: obj.color,
          stroke: '#d4a574',
          strokeWidth: 2,
          rx: 4,
          hasControls: true,
          selectable: true,
        });
      } else if (obj.type === ObjectType.RECTANGLE) {
        shapeObj = new fabric.Rect({
          left: obj.position.x,
          top: obj.position.y,
          width: obj.width,
          height: obj.height,
          fill: obj.color,
          stroke: '#6b7280',
          strokeWidth: 2,
          selectable: true,
          hasControls: true,
        });
      } else if (obj.type === ObjectType.CIRCLE) {
        shapeObj = new fabric.Circle({
          left: obj.position.x,
          top: obj.position.y,
          radius: Math.min(obj.width, obj.height) / 2,
          fill: obj.color,
          stroke: '#6b7280',
          strokeWidth: 2,
          selectable: true,
          hasControls: true,
        });
      } else if (obj.type === ObjectType.ARROW) {
        // Create arrow shape using polygon
        const arrowWidth = obj.width;
        const arrowHeight = obj.height;
        const headWidth = arrowHeight * 0.8;
        const shaftHeight = arrowHeight * 0.4;

        // Arrow pointing right
        const arrowPoints = [
          { x: 0, y: (arrowHeight - shaftHeight) / 2 },
          { x: arrowWidth - headWidth, y: (arrowHeight - shaftHeight) / 2 },
          { x: arrowWidth - headWidth, y: 0 },
          { x: arrowWidth, y: arrowHeight / 2 },
          { x: arrowWidth - headWidth, y: arrowHeight },
          { x: arrowWidth - headWidth, y: (arrowHeight + shaftHeight) / 2 },
          { x: 0, y: (arrowHeight + shaftHeight) / 2 },
        ];

        shapeObj = new fabric.Polygon(arrowPoints, {
          left: obj.position.x,
          top: obj.position.y,
          fill: obj.color,
          stroke: '#6b7280',
          strokeWidth: 2,
          selectable: true,
          hasControls: true,
          objectCaching: false,
        });
      } else if (obj.type === ObjectType.TEXT_BOX) {
        // TEXT_BOX: single textbox, no separate shape+text pair
        const tbFontSize = obj.fontSize || 24;
        const tbObj = new fabric.Textbox(obj.content || 'Type here', {
          left: obj.position.x,
          top: obj.position.y,
          width: obj.width || DEFAULT_OBJECT_WIDTH,
          fontSize: tbFontSize,
          fontFamily: 'Arial, sans-serif',
          fill: obj.color || '#1f2937',
          editable: true,
          hasControls: true,
          selectable: true,
          evented: true,
          hoverCursor: 'move',
          splitByGrapheme: true,
          textAlign: 'center',
          lineHeight: 1.2,
          borderColor: '#3b82f6',
          editingBorderColor: '#3b82f6',
          padding: 8,
        });
        tbObj.set({
          data: {
            objectId: obj.id, userId: obj.userId, type: 'shape',
            isTextBox: true, baseFontSize: tbFontSize,
          },
          opacity: currentUserId === obj.userId ? 1 : 0.8,
        });
        canvas.add(tbObj);
        return; // skip the shape+text pair logic below
      } else if (obj.type === ObjectType.FRAME) {
        // FRAME: dashed rectangle container for grouping
        const frameRect = new fabric.Rect({
          left: obj.position.x,
          top: obj.position.y,
          width: obj.width || 400,
          height: obj.height || 300,
          fill: 'rgba(59, 130, 246, 0.04)',
          stroke: '#3b82f6',
          strokeWidth: 2,
          strokeDashArray: [8, 4],
          rx: 8,
          hasControls: true,
          selectable: true,
        });
        frameRect.set({
          data: { objectId: obj.id, userId: obj.userId, type: 'shape', isFrame: true },
          opacity: currentUserId === obj.userId ? 1 : 0.85,
        });
        canvas.add(frameRect);
        canvas.sendToBack(frameRect);

        // Frame label
        const label = new fabric.Text(obj.frameLabel || 'Frame', {
          left: obj.position.x + 8,
          top: obj.position.y - 22,
          fontSize: 12,
          fontFamily: 'Arial, sans-serif',
          fill: '#3b82f6',
          fontWeight: 'bold',
          selectable: false,
          evented: false,
        });
        label.set({ data: { objectId: obj.id, type: 'frameLabel' } });
        canvas.add(label);
        return; // skip the shape+text pair logic below
      }

      if (shapeObj) {
        // Store object ID in the shape
        shapeObj.set({
          data: { objectId: obj.id, userId: obj.userId, type: 'shape' },
          opacity: currentUserId === obj.userId ? 1 : 0.8,
        });
        canvas.add(shapeObj);

        // Add text on top of the shape with proper wrapping
        const textPadding = 15;
        const text = new fabric.Textbox(obj.content || 'Click to edit', {
          left: obj.position.x + textPadding,
          top: obj.position.y + textPadding,
          width: obj.width - (textPadding * 2),
          fontSize: 13,
          fontFamily: 'Arial, sans-serif',
          fill: '#1f2937',
          editable: true,
          hasControls: false,
          lockMovementX: true,
          lockMovementY: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
          selectable: true,
          evented: true,
          hoverCursor: 'text',
          splitByGrapheme: true,
          textAlign: 'left',
          lineHeight: 1.2,
          borderColor: 'transparent',
          editingBorderColor: 'transparent',
        });

        // Store object ID in the text and link to parent shape
        text.set({
          data: {
            objectId: obj.id,
            userId: obj.userId,
            type: 'text',
            parentShapeId: obj.id,
            maxWidth: obj.width - (textPadding * 2)
          }
        });
        canvas.add(text);
      }
    });

    // ── Pass 2: Connectors (after shapes so endpoint positions are available) ──
    // Rebuild connector index
    const newIndex = new Map<string, Set<string>>();
    connectorObjects.forEach((conn) => {
      if (conn.sourceObjectId && conn.targetObjectId) {
        if (!newIndex.has(conn.sourceObjectId)) newIndex.set(conn.sourceObjectId, new Set());
        if (!newIndex.has(conn.targetObjectId)) newIndex.set(conn.targetObjectId, new Set());
        newIndex.get(conn.sourceObjectId)!.add(conn.id);
        newIndex.get(conn.targetObjectId)!.add(conn.id);
      }
    });
    connectorIndexRef.current = newIndex;

    connectorObjects.forEach((conn) => {
      // Orphan cleanup: if source or target is gone, delete the connector
      if (!boardObjectIds.has(conn.sourceObjectId || '') || !boardObjectIds.has(conn.targetObjectId || '')) {
        deleteObject(conn.id);
        const connRef = ref(realtimeDb, `boards/${boardId}/objects/${conn.id}`);
        remove(connRef).catch(console.error);
        canvas.getObjects()
          .filter((o) => o.data?.objectId === conn.id)
          .forEach((o) => canvas.remove(o));
        return;
      }

      // Existing connector — update endpoints
      if (existingObjectIds.has(conn.id)) {
        updateConnectorOnCanvas(canvas, conn.id);
        return;
      }

      // New connector — create line + optional arrowhead
      const ep = getConnectorEndpoints(canvas, conn);
      if (!ep) return;

      const line = new fabric.Line([ep.x1, ep.y1, ep.x2, ep.y2], {
        stroke: conn.color || '#6b7280',
        strokeWidth: 2,
        selectable: true,
        hasControls: false,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        evented: true,
        perPixelTargetFind: true,
      });
      line.set({
        data: {
          objectId: conn.id,
          type: 'connector',
          sourceObjectId: conn.sourceObjectId,
          targetObjectId: conn.targetObjectId,
        },
      });
      canvas.add(line);
      canvas.sendToBack(line);

      if (conn.connectorStyle === 'arrow') {
        const arrowHead = new fabric.Triangle({
          left: ep.x2,
          top: ep.y2,
          width: 12,
          height: 12,
          fill: conn.color || '#6b7280',
          angle: (ep.angle * 180 / Math.PI) + 90,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        arrowHead.set({
          data: { objectId: conn.id, type: 'arrowhead' },
        });
        canvas.add(arrowHead);
        canvas.sendToBack(arrowHead);
      }
    });

    canvas.renderAll();
  }
};

export default WhiteboardCanvas;
