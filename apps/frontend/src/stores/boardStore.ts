import { create } from 'zustand';
import { Board, BoardObject, Cursor, PresenceUser } from '@whiteboard/shared-types';

interface BoardStore {
  board: Board | null;
  objects: Map<string, BoardObject>;
  cursors: Map<string, Cursor>;
  presenceUsers: Map<string, PresenceUser>;
  isConnected: boolean;

  setBoard: (board: Board) => void;
  addObject: (object: BoardObject) => void;
  updateObject: (id: string, updates: Partial<BoardObject>) => void;
  deleteObject: (id: string) => void;
  setCursor: (userId: string, cursor: Cursor) => void;
  removeCursor: (userId: string) => void;
  setPresenceUser: (user: PresenceUser) => void;
  removePresenceUser: (userId: string) => void;
  setConnected: (connected: boolean) => void;
  reset: () => void;
}

const useBoardStore = create<BoardStore>((set) => ({
  board: null,
  objects: new Map(),
  cursors: new Map(),
  presenceUsers: new Map(),
  isConnected: false,

  setBoard: (board) => {
    set((state) => {
      // Scenario 3: don't wipe objects already loaded from Realtime DB.
      // Firestore stores board metadata with objects:[] — the real objects
      // live in Realtime DB and are populated via addObject(). Only seed from
      // Firestore if the store is currently empty.
      const firestoreObjects = new Map((board.objects || []).map((obj) => [obj.id, obj]));
      const objects = state.objects.size > 0 ? state.objects : firestoreObjects;
      return { board, objects };
    });
  },

  addObject: (object) => {
    set((state) => {
      const newObjects = new Map(state.objects);
      newObjects.set(object.id, object);
      return { objects: newObjects };
    });
  },

  updateObject: (id, updates) => {
    set((state) => {
      const newObjects = new Map(state.objects);
      const existing = newObjects.get(id);
      if (existing) {
        newObjects.set(id, { ...existing, ...updates, updatedAt: Date.now() });
      }
      return { objects: newObjects };
    });
  },

  deleteObject: (id) => {
    set((state) => {
      const newObjects = new Map(state.objects);
      newObjects.delete(id);
      return { objects: newObjects };
    });
  },

  setCursor: (userId, cursor) => {
    set((state) => {
      const newCursors = new Map(state.cursors);
      newCursors.set(userId, cursor);
      return { cursors: newCursors };
    });
  },

  removeCursor: (userId) => {
    set((state) => {
      const newCursors = new Map(state.cursors);
      newCursors.delete(userId);
      return { cursors: newCursors };
    });
  },

  setPresenceUser: (user) => {
    set((state) => {
      const newPresenceUsers = new Map(state.presenceUsers);
      newPresenceUsers.set(user.userId, user);
      return { presenceUsers: newPresenceUsers };
    });
  },

  removePresenceUser: (userId) => {
    set((state) => {
      const newPresenceUsers = new Map(state.presenceUsers);
      newPresenceUsers.delete(userId);
      return { presenceUsers: newPresenceUsers };
    });
  },

  setConnected: (connected) => {
    set({ isConnected: connected });
  },

  reset: () => {
    set({
      board: null,
      objects: new Map(),
      cursors: new Map(),
      presenceUsers: new Map(),
      isConnected: false,
    });
  },
}));

export default useBoardStore;
