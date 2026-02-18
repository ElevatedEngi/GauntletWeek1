import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, onValue, set, onDisconnect } from 'firebase/database';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { realtimeDb, db } from '../../services/firebase';
import useAuthStore from '../../stores/authStore';
import useBoardStore from '../../stores/boardStore';
import WhiteboardCanvas from '../Canvas/WhiteboardCanvas';
import PresenceList from './PresenceList';
import CursorList from './CursorList';
import AICommandInput from './AICommandInput';
import { Board, Cursor, PresenceUser } from '@whiteboard/shared-types';

const BoardPage: React.FC = () => {
  const { id: boardId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const {
    board,
    setBoard,
    objects,
    isConnected,
    setConnected,
    setCursor,
    setPresenceUser,
    removePresenceUser,
    removeCursor,
    addObject,
    deleteObject,
  } = useBoardStore();

  const [showMenu, setShowMenu] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);

  // Editable board name state
  const [boardName, setBoardName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync local name state when board loads
  useEffect(() => {
    if (board?.name) setBoardName(board.name);
  }, [board?.name]);

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  const showToast = (msg: string) => {
    setSaveToast(msg);
    setTimeout(() => setSaveToast(null), 2500);
  };

  // Persist the board name to Firestore immediately
  const commitName = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!boardId || !trimmed || trimmed === board?.name) {
      // Revert to original if empty
      if (!trimmed && board?.name) setBoardName(board.name);
      setIsEditingName(false);
      return;
    }
    try {
      const boardRef = doc(db, 'boards', boardId);
      await updateDoc(boardRef, { name: trimmed, updatedAt: Date.now() });
      setBoardName(trimmed);
      // Update document title so the browser tab reflects the new name
      document.title = trimmed;
      showToast('Board renamed!');
    } catch (err) {
      console.error('Failed to rename board:', err);
      showToast('Rename failed.');
      if (board?.name) setBoardName(board.name);
    } finally {
      setIsEditingName(false);
    }
  }, [boardId, board?.name]);

  // Save board objects + current name to Firestore
  const handleSave = useCallback(async () => {
    if (!boardId || !board) return;
    setIsSaving(true);
    try {
      const boardRef = doc(db, 'boards', boardId);
      await updateDoc(boardRef, {
        name: boardName || board.name,
        objects: Array.from(objects.values()),
        updatedAt: Date.now(),
      });
      showToast('Board saved!');
    } catch (err) {
      console.error('Failed to save board:', err);
      showToast('Save failed. Try again.');
    } finally {
      setIsSaving(false);
    }
  }, [boardId, board, boardName, objects]);

  // Make board public and copy share link to clipboard
  const handleShare = useCallback(async () => {
    if (!boardId) return;
    try {
      if (!isPublic) {
        const boardRef = doc(db, 'boards', boardId);
        await updateDoc(boardRef, { isPublic: true });
        setIsPublic(true);
      }
      await navigator.clipboard.writeText(window.location.href);
      showToast('Link copied! Anyone with the link can view this board.');
    } catch (err) {
      console.error('Failed to share board:', err);
      showToast('Could not copy link.');
    }
  }, [boardId, isPublic]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Link copied!');
    } catch {
      showToast('Could not copy link.');
    }
  }, []);

  // Load board from Firestore and set up Realtime Database listeners
  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!boardId) {
      navigate('/board');
      return;
    }

    let cleanupListeners: (() => void) | null = null;
    let cancelled = false;

    const loadBoard = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const boardRef = doc(db, 'boards', boardId);
        const boardSnap = await getDoc(boardRef);

        if (cancelled) return;

        if (!boardSnap.exists()) {
          setError('Board not found');
          return;
        }

        const rawData = boardSnap.data()!;
        const boardData: Board = {
          ...rawData,
          id: boardSnap.id,
          objects: rawData.objects || [],
          collaborators: rawData.collaborators || [],
        } as unknown as Board;

        setIsPublic(rawData.isPublic === true);
        setBoardName(rawData.name || '');
        document.title = rawData.name || 'Whiteboard';
        setBoard(boardData);
        cleanupListeners = setupRealtimeListeners(boardId);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load board:', err);
        setError('Failed to load board. Please try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadBoard();

    return () => {
      cancelled = true;
      if (cleanupListeners) cleanupListeners();
    };
  }, [user, boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setupRealtimeListeners = (currentBoardId: string) => {
    setConnected(true);

    const objectsRef = ref(realtimeDb, `boards/${currentBoardId}/objects`);
    const objectsUnsubscribe = onValue(objectsRef, (snapshot) => {
      const objectsData = snapshot.val() || {};
      const incomingIds = new Set(Object.keys(objectsData));

      // Add or update objects that exist in Firebase
      Object.values(objectsData).forEach((obj: any) => {
        addObject(obj);
      });

      // Remove objects from local store that were deleted from Firebase
      const currentObjects = useBoardStore.getState().objects;
      currentObjects.forEach((_, id) => {
        if (!incomingIds.has(id)) {
          deleteObject(id);
        }
      });
    });

    const cursorsRef = ref(realtimeDb, `boards/${currentBoardId}/cursors`);
    const cursorsUnsubscribe = onValue(cursorsRef, (snapshot) => {
      const cursors = snapshot.val() || {};
      Object.entries(cursors).forEach(([userId, cursorData]: [string, any]) => {
        if (userId !== user?.id) {
          const cursor: Cursor = {
            userId,
            userName: cursorData.userName,
            position: cursorData.position,
            color: cursorData.color,
          };
          setCursor(userId, cursor);
        }
      });
    });

    const presenceRef = ref(realtimeDb, `boards/${currentBoardId}/presence`);
    const presenceUnsubscribe = onValue(presenceRef, (snapshot) => {
      const presence = snapshot.val() || {};
      Object.values(presence).forEach((p: any) => {
        if (p.online) {
          setPresenceUser(p as PresenceUser);
        } else {
          removePresenceUser(p.userId);
          removeCursor(p.userId);
        }
      });
    });

    if (user) {
      const myPresenceRef = ref(realtimeDb, `boards/${currentBoardId}/presence/${user.id}`);
      set(myPresenceRef, {
        userId: user.id,
        userName: user.name,
        email: user.email,
        status: 'online',
        lastSeen: Date.now(),
        online: true,
      });
      onDisconnect(myPresenceRef).set({
        userId: user.id,
        userName: user.name,
        email: user.email,
        status: 'offline',
        lastSeen: Date.now(),
        online: false,
      });
    }

    return () => {
      objectsUnsubscribe();
      cursorsUnsubscribe();
      presenceUnsubscribe();
      setConnected(false);
    };
  };


  const isOwner = board?.ownerId === user?.id;

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-500 text-lg mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !board) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-gray-500 text-lg mb-4">Loading board...</p>
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Toast notification */}
      {saveToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          {saveToast}
        </div>
      )}

      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-4 bg-white border-b border-gray-200 px-4 py-2 shadow-sm shrink-0 z-10">
        {/* Board Title + Connection Status */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Editable name — owner only */}
          {isOwner && isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              onBlur={() => commitName(boardName)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName(boardName);
                if (e.key === 'Escape') {
                  setBoardName(board.name);
                  setIsEditingName(false);
                }
              }}
              className="text-gray-700 font-semibold bg-white border border-blue-400 rounded px-2 py-0.5 text-sm outline-none focus:ring-2 focus:ring-blue-300 min-w-0 w-56 max-w-xs"
              maxLength={80}
            />
          ) : (
            <button
              onClick={() => isOwner && setIsEditingName(true)}
              title={isOwner ? 'Click to rename' : undefined}
              className={`text-gray-700 font-semibold truncate text-left max-w-xs ${
                isOwner ? 'hover:bg-gray-100 rounded px-2 py-0.5 -mx-2 cursor-text transition' : 'cursor-default'
              }`}
            >
              {boardName || board.name}
            </button>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {isPublic && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full shrink-0">
              Public
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {isOwner && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isSaving ? (
                <>
                  <div className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Save
                </>
              )}
            </button>
          )}

          {isOwner ? (
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              {isPublic ? 'Copy Link' : 'Share'}
            </button>
          ) : (
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy Link
            </button>
          )}
        </div>

        {/* User Menu */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="bg-gray-100 rounded-full p-2 hover:bg-gray-200 transition"
          >
            <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {showMenu && (
            <div className="absolute top-full mt-2 right-0 bg-white rounded-lg shadow-lg p-2 z-50 w-48">
              <div className="px-4 py-2 text-sm text-gray-700 border-b">
                <p className="font-semibold">{user?.name}</p>
                <p className="text-gray-500 text-xs">{user?.email}</p>
              </div>
              <button
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded transition"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 min-h-0">
        {/* Canvas Area */}
        <div className="flex-1 relative bg-white min-w-0">
          <WhiteboardCanvas boardId={board.id} />
        </div>

        {/* Right Sidebar */}
        <div className="w-80 bg-white border-l border-gray-200 flex flex-col shrink-0">
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-800 mb-3">Online Users</h3>
              <PresenceList />
            </div>
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-800 mb-3">Cursors</h3>
              <CursorList />
            </div>
          </div>
          <div className="p-4 border-t border-gray-200">
            <AICommandInput boardId={board.id} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BoardPage;
