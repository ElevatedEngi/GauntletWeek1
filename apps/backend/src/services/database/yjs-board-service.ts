// Service for managing board state with Yjs CRDT
import * as Y from 'yjs';
import { BoardObject } from '@whiteboard/shared-types';

interface YjsBoard {
  doc: Y.Doc;
  objects: Y.Map<any>;
}

const boards = new Map<string, YjsBoard>();

export function getOrCreateBoard(boardId: string): YjsBoard {
  if (!boards.has(boardId)) {
    const doc = new Y.Doc();
    const objectsMap = doc.getMap('objects');

    boards.set(boardId, {
      doc,
      objects: objectsMap,
    });
  }

  return boards.get(boardId)!;
}

export function addObjectToBoard(boardId: string, object: BoardObject) {
  const board = getOrCreateBoard(boardId);
  board.objects.set(object.id, {
    ...object,
    position: { x: object.position.x, y: object.position.y },
  });
}

export function updateObjectInBoard(boardId: string, objectId: string, updates: Partial<BoardObject>) {
  const board = getOrCreateBoard(boardId);
  const existing = board.objects.get(objectId);

  if (existing) {
    board.objects.set(objectId, {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    });
  }
}

export function deleteObjectFromBoard(boardId: string, objectId: string) {
  const board = getOrCreateBoard(boardId);
  board.objects.delete(objectId);
}

export function getBoardObjects(boardId: string): BoardObject[] {
  const board = getOrCreateBoard(boardId);
  const objects: BoardObject[] = [];

  board.objects.forEach((obj) => {
    objects.push(obj);
  });

  return objects;
}

export function clearBoard(boardId: string) {
  boards.delete(boardId);
}
