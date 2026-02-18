import { Server as SocketIOServer, Socket } from 'socket.io';
import {
  addObjectToBoard,
  updateObjectInBoard,
  deleteObjectFromBoard,
  getBoardObjects,
} from '../database/yjs-board-service.js';

const activeUsers = new Map<string, { userId: string; userName: string; userEmail: string; boardId: string }>();

export const handleSocketConnection = (socket: Socket, io: SocketIOServer) => {
  const userId = socket.data.user?.id;
  const userName = socket.data.user?.name || 'Anonymous';
  const userEmail = socket.data.user?.email || '';

  console.log(`✅ User connected: ${userName} (${userId})`);

  // Join board-specific room
  socket.on('join:board', (boardId: string) => {
    socket.join(`board:${boardId}`);
    activeUsers.set(socket.id, { userId, userName, userEmail, boardId });

    console.log(`📍 User ${userName} joined board ${boardId}`);

    // Get current board state
    const boardObjects = getBoardObjects(boardId);

    // Send board state to joining user
    socket.emit('board:init', {
      objects: boardObjects,
      users: Array.from(activeUsers.values())
        .filter((u) => u.boardId === boardId)
        .map((u) => ({
          userId: u.userId,
          userName: u.userName,
          email: u.userEmail,
          status: 'online',
          lastSeen: Date.now(),
        })),
    });

    // Broadcast presence
    io.to(`board:${boardId}`).emit('presence:join', {
      userId,
      userName,
      email: userEmail,
      status: 'online',
      lastSeen: Date.now(),
    });
  });

  // Handle cursor movements (ephemeral, not persisted)
  socket.on('cursor:move', (data: { x: number; y: number; color: string }, boardId: string) => {
    io.to(`board:${boardId}`).emit('cursor:move', {
      userId,
      userName,
      position: { x: data.x, y: data.y },
      color: data.color,
      timestamp: Date.now(),
    });
  });

  // Handle object creation
  socket.on('object:create', (object: any, boardId: string) => {
    // Add to in-memory board state
    addObjectToBoard(boardId, object);

    // Broadcast to all users in board
    io.to(`board:${boardId}`).emit('object:update', {
      action: 'create',
      object: { ...object, userId },
      timestamp: Date.now(),
    });

    console.log(`✏️ Object created: ${object.id} in board ${boardId}`);
  });

  // Handle object updates
  socket.on('object:update', (objectId: string, updates: any, boardId: string) => {
    // Update in-memory board state
    updateObjectInBoard(boardId, objectId, updates);

    // Broadcast to all users in board
    io.to(`board:${boardId}`).emit('object:update', {
      action: 'update',
      objectId,
      updates,
      userId,
      timestamp: Date.now(),
    });

    console.log(`📝 Object updated: ${objectId}`);
  });

  // Handle object deletion
  socket.on('object:delete', (objectId: string, boardId: string) => {
    // Remove from in-memory board state
    deleteObjectFromBoard(boardId, objectId);

    // Broadcast to all users in board
    io.to(`board:${boardId}`).emit('object:update', {
      action: 'delete',
      objectId,
      userId,
      timestamp: Date.now(),
    });

    console.log(`🗑️ Object deleted: ${objectId}`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const userInfo = activeUsers.get(socket.id);
    if (userInfo) {
      console.log(`❌ User disconnected: ${userName} (${userId})`);

      // Broadcast user offline to their board
      io.to(`board:${userInfo.boardId}`).emit('presence:leave', {
        userId,
        userName,
        email: userEmail,
        status: 'offline',
        lastSeen: Date.now(),
      });

      activeUsers.delete(socket.id);
    }
  });

  // Error handling
  socket.on('error', (error: any) => {
    console.error(`Socket error for ${userName}:`, error);
  });
};
