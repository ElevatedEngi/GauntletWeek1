import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import useAuthStore from '../../stores/authStore';
import useBoardStore from '../../stores/boardStore';

interface BoardSummary {
  id: string;
  name: string;
  ownerId: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
}

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const resetBoard = useBoardStore((s) => s.reset);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadBoards();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadBoards = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const boardsRef = collection(db, 'boards');
      const q = query(
        boardsRef,
        where('ownerId', '==', user.id),
        orderBy('updatedAt', 'desc'),
      );
      const snapshot = await getDocs(q);
      const results: BoardSummary[] = snapshot.docs.map((d) => ({
        id: d.id,
        name: d.data().name || 'Untitled',
        ownerId: d.data().ownerId,
        isPublic: d.data().isPublic === true,
        createdAt: d.data().createdAt || 0,
        updatedAt: d.data().updatedAt || 0,
      }));
      setBoards(results);
    } catch (err) {
      console.error('Failed to load boards:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewBoard = () => {
    resetBoard();
    navigate('/board');
  };

  const handleOpenBoard = (boardId: string) => {
    resetBoard();
    navigate(`/board/${boardId}`);
  };

  const handleDeleteBoard = async (boardId: string) => {
    if (!confirm('Delete this board? This cannot be undone.')) return;
    setDeletingId(boardId);
    try {
      await deleteDoc(doc(db, 'boards', boardId));
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
    } catch (err) {
      console.error('Failed to delete board:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm(`Delete all ${boards.length} boards? This cannot be undone.`)) return;
    setIsDeletingAll(true);
    try {
      await Promise.all(boards.map((b) => deleteDoc(doc(db, 'boards', b.id))));
      setBoards([]);
    } catch (err) {
      console.error('Failed to delete all boards:', err);
    } finally {
      setIsDeletingAll(false);
    }
  };

  const formatDate = (ts: number) => {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">Whiteboard AI</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{user?.name}</span>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="text-sm text-red-600 hover:text-red-700 transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Title row */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-gray-800">My Boards</h2>
          <div className="flex items-center gap-2">
            {boards.length > 0 && (
              <button
                onClick={handleDeleteAll}
                disabled={isDeletingAll}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50 transition font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {isDeletingAll ? 'Deleting...' : 'Delete All'}
              </button>
            )}
            <button
              onClick={handleNewBoard}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium shadow"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Board
            </button>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
            <p className="text-gray-500">Loading boards...</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && boards.length === 0 && (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            <p className="text-gray-500 text-lg mb-4">No boards yet</p>
            <button
              onClick={handleNewBoard}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
            >
              Create your first board
            </button>
          </div>
        )}

        {/* Board grid */}
        {!isLoading && boards.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {boards.map((b) => (
              <div
                key={b.id}
                className="bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition cursor-pointer group"
                onClick={() => handleOpenBoard(b.id)}
              >
                {/* Card preview area */}
                <div className="h-32 bg-gradient-to-br from-gray-50 to-gray-100 rounded-t-xl flex items-center justify-center">
                  <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                </div>

                {/* Card content */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-gray-800 truncate">{b.name}</h3>
                      <p className="text-xs text-gray-400 mt-1">
                        Updated {formatDate(b.updatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {b.isPublic && (
                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                          Public
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteBoard(b.id); }}
                        disabled={deletingId === b.id}
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition"
                        title="Delete board"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default HomePage;
