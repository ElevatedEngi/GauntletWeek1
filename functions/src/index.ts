import { initializeApp } from 'firebase-admin/app';

// Initialize Firebase Admin
initializeApp();

// Export all functions
export { createBoard, getBoard, updateBoard, deleteBoard, listBoards } from './api/boards';
