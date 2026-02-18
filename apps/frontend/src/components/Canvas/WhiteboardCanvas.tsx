import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { ref, set, update, remove, onValue, onDisconnect } from 'firebase/database';
import { realtimeDb } from '../../services/firebase';
import { BoardObject, ObjectType } from '@whiteboard/shared-types';
import useBoardStore from '../../stores/boardStore';
import useAuthStore from '../../stores/authStore';
import { viewportRef } from '../../utils/viewportRef';

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

  const { objects, addObject, updateObject: updateObjectStore, deleteObject } = useBoardStore();
  const { user } = useAuthStore();

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
      fabricCanvas.dispose();
    };
  }, []);

  // Track if we're currently editing text
  const isEditingTextRef = useRef(false);

  // Track if Z key is held for zoom mode
  const isZKeyPressedRef = useRef(false);

  // Sync store objects to canvas (but not while editing text)
  useEffect(() => {
    if (!fabricCanvasRef.current || isEditingTextRef.current) return;

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

  // Handle keyboard events for object deletion
  useEffect(() => {
    if (!fabricCanvasRef.current) return;

    const canvas = fabricCanvasRef.current;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't delete if we're editing text
      if (isEditingTextRef.current) return;

      const target = canvas.getActiveObject();

      // Only delete on Delete/Backspace keys, and only if not editing text
      if ((e.key === 'Delete' || e.key === 'Backspace') && target) {
        // Check if the target is a text object being edited
        const isTextbox = target.type === 'textbox' || target.type === 'i-text';
        if (isTextbox && (target as any).isEditing) {
          // Don't delete the object, let the text editor handle backspace
          return;
        }

        if (target.data?.objectId) {
          const objectId = target.data.objectId as string;

          // Delete from local store
          deleteObject(objectId);

          // Delete from Firebase Realtime Database
          const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${objectId}`);
          remove(objectRef).catch((error) => {
            console.error('Failed to delete object from Firebase:', error);
          });

          // Remove both shape and text if they exist
          const objectsToRemove = canvas.getObjects().filter(
            (obj) => obj.data?.objectId === objectId
          );

          objectsToRemove.forEach((obj) => canvas.remove(obj));
        } else {
          // If no objectId, just remove the selected object
          canvas.remove(target);
        }

        canvas.renderAll();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deleteObject, boardId]);

  // createObject: defined as useCallback so it always captures current user/boardId/canvas
  const createObject = useCallback((type: 'sticky_note' | 'rectangle' | 'circle' | 'arrow') => {
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
      'Edit me!';

    const objectHeight = type === 'arrow' ? 60 : DEFAULT_OBJECT_HEIGHT;

    const newObject: BoardObject = {
      id: uuidv4(),
      type: ObjectType[type.toUpperCase() as keyof typeof ObjectType],
      position: { x: centerX, y: centerY },
      width: DEFAULT_OBJECT_WIDTH,
      height: objectHeight,
      rotation: 0,
      content: defaultContent,
      color: randomColor,
      userId: user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
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

      {/* Canvas area — React renders an empty div here.
          The actual <canvas> element is created imperatively in useEffect
          so React's reconciler never touches it or Fabric's canvas-container wrapper. */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={canvasAreaRef}
          className="w-full h-full"
          onClick={() => containerRef.current?.focus()}
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
      </div>

      {/* Controls reference */}
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-gray-200 shadow-sm leading-5 select-none">
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">↑ ↓ ← →</kbd> Pan canvas</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Space</kbd> + drag to pan</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Right-click</kbd> + drag to pan</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Z</kbd> + scroll to zoom</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Del</kbd> / <kbd className="font-mono bg-gray-100 px-1 rounded">Backspace</kbd> to remove</p>
        <p><kbd className="font-mono bg-gray-100 px-1 rounded">Dbl-click</kbd> shape to edit text</p>
      </div>
    </div>
  );

  // Helper functions

  // Setup canvas event listeners (called once during initialization)
  function setupCanvasEventListeners(canvas: fabric.Canvas) {
    const textPadding = 15;

    // Handle object modification (shape moved/resized)
    canvas.on('object:modified', (e: fabric.IEvent) => {
      const target = e.target;
      if (!target || !target.data?.objectId) return;

      const objectId = target.data.objectId as string;
      const targetType = target.data.type as string;

      // Only sync shape modifications (not text, since text is locked to shape)
      if (targetType === 'shape') {
        // Find and update the corresponding text position
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

        const updates = {
          position: { x: target.left || 0, y: target.top || 0 },
          width: target.width || DEFAULT_OBJECT_WIDTH,
          height: target.height || DEFAULT_OBJECT_HEIGHT,
          rotation: target.angle || 0,
          updatedAt: Date.now(),
        };

        // Update local store (optimistic update)
        updateObjectStore(objectId, updates);

        // Update in Firebase Realtime Database
        const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${objectId}`);
        update(objectRef, updates).catch((error) => {
          console.error('Failed to update object in Firebase:', error);
        });

        canvas.renderAll();
      }
    });

    // Handle text changes in all shapes (with debounced sync)
    canvas.on('text:changed', (e: fabric.IEvent) => {
      const target = e.target as fabric.Textbox;
      if (!target || !target.data?.objectId || target.data?.type !== 'text') return;

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
      if (target && target.data?.objectId && target.data?.type === 'text') {
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
      setConfirmButtonPos(null);

      setTimeout(() => {
        isEditingTextRef.current = false;
      }, 100);
    });

    // Handle object moving — keep text glued to shape locally AND broadcast to other users
    canvas.on('object:moving', (e: fabric.IEvent) => {
      const target = e.target;
      if (!target || !target.data?.objectId) return;

      const objectId = target.data.objectId as string;
      const targetType = target.data.type as string;

      if (targetType === 'shape') {
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

    // Handle object scaling (update text position and width during resize)
    canvas.on('object:scaling', (e: fabric.IEvent) => {
      const target = e.target;
      if (!target || !target.data?.objectId) return;

      const objectId = target.data.objectId as string;
      const targetType = target.data.type as string;

      // Only shapes can be scaled
      if (targetType === 'shape') {
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
    });

    // Handle double-click on shapes to activate text editing
    canvas.on('mouse:dblclick', (e: fabric.IEvent) => {
      const target = e.target;
      if (!target || !target.data?.objectId) return;

      const objectId = target.data.objectId as string;
      const targetType = target.data.type as string;

      // If double-clicked on a shape, activate its text for editing
      if (targetType === 'shape') {
        // Check if this object is locked by another user
        const lock = currentLocksRef.current.get(objectId);
        const currentUser = useAuthStore.getState().user;
        if (lock && lock.lockedBy !== currentUser?.id) {
          setLockToastMsg(`${lock.lockedByName} is currently editing this`);
          setTimeout(() => setLockToastMsg(null), 2500);
          return;
        }

        const textObj = canvas.getObjects().find(
          (obj) => obj.data?.objectId === objectId && obj.data?.type === 'text'
        ) as fabric.Textbox;

        if (textObj) {
          canvas.discardActiveObject();
          canvas.setActiveObject(textObj);
          textObj.enterEditing();
          textObj.selectAll();
          canvas.renderAll();
        }
      }
    });
  }

  function syncObjectsToCanvas(
    canvas: fabric.Canvas,
    boardObjects: BoardObject[],
    currentUserId: string
  ) {
    // Don't clear and re-sync if we're editing text
    if (isEditingTextRef.current) {
      return;
    }

    // Build O(1) lookup maps: one for shapes, one for text objects
    const existingObjectIds = new Set<string>();
    const canvasShapeMap = new Map<string, fabric.Object>();
    const canvasTextMap = new Map<string, fabric.Textbox>();

    canvas.getObjects().forEach((obj: fabric.Object) => {
      const objectId = obj.data?.objectId as string;
      if (!objectId) return;
      existingObjectIds.add(objectId);
      if (obj.data?.type === 'shape') canvasShapeMap.set(objectId, obj);
      else if (obj.data?.type === 'text') canvasTextMap.set(objectId, obj as fabric.Textbox);
    });

    // Get board object IDs
    const boardObjectIds = new Set(boardObjects.map(obj => obj.id));

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

    // Add or update objects from store
    boardObjects.forEach((obj) => {
      // Object already on canvas — update position and text from remote data (O(1) map lookup)
      if (existingObjectIds.has(obj.id)) {
        const textPadding = 15;
        const activeObj = canvas.getActiveObject();
        const shapeOnCanvas = canvasShapeMap.get(obj.id);
        const textOnCanvas = canvasTextMap.get(obj.id);
        // isShapeActive: local user is dragging this shape — don't overwrite their in-flight position
        const isShapeActive = !!shapeOnCanvas && activeObj === shapeOnCanvas;

        if (shapeOnCanvas && !isShapeActive) {
          shapeOnCanvas.set({ left: obj.position.x, top: obj.position.y });
          shapeOnCanvas.setCoords();
        }
        // Also skip text update while the local user is dragging the parent shape
        if (textOnCanvas && !isShapeActive && !(textOnCanvas as any).isEditing) {
          textOnCanvas.set({
            left: obj.position.x + textPadding,
            top: obj.position.y + textPadding,
            text: obj.content || '',
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
          { x: 0, y: (arrowHeight - shaftHeight) / 2 }, // Top left of shaft
          { x: arrowWidth - headWidth, y: (arrowHeight - shaftHeight) / 2 }, // Top of shaft before head
          { x: arrowWidth - headWidth, y: 0 }, // Top of arrowhead
          { x: arrowWidth, y: arrowHeight / 2 }, // Point of arrow
          { x: arrowWidth - headWidth, y: arrowHeight }, // Bottom of arrowhead
          { x: arrowWidth - headWidth, y: (arrowHeight + shaftHeight) / 2 }, // Bottom of shaft before head
          { x: 0, y: (arrowHeight + shaftHeight) / 2 }, // Bottom left of shaft
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
      }

      if (shapeObj) {
        // Store object ID in the shape
        shapeObj.set({
          data: { objectId: obj.id, userId: obj.userId, type: 'shape' },
          opacity: currentUserId === obj.userId ? 1 : 0.8,
          lockScalingX: true,
          lockScalingY: true,
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

    canvas.renderAll();
  }
};

export default WhiteboardCanvas;
