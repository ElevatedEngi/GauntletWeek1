import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { Board } from '@whiteboard/shared-types';

const router = Router();

// In-memory storage for MVP (will be replaced with database)
const boards = new Map<string, Board>();

// Create board
router.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { name } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Invalid board name' });
  }

  const board: Board = {
    id: uuidv4(),
    name,
    ownerId: req.user.id,
    objects: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  boards.set(board.id, board);
  return res.status(201).json(board);
});

// Get board
router.get('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const board = boards.get(id);

  if (!board) {
    return res.status(404).json({ error: 'Board not found' });
  }

  return res.json(board);
});

// Update board
router.put('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { id } = req.params;
  const board = boards.get(id);

  if (!board) {
    return res.status(404).json({ error: 'Board not found' });
  }

  if (board.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { name } = req.body;
  if (name) {
    board.name = name;
    board.updatedAt = Date.now();
  }

  return res.json(board);
});

// Delete board
router.delete('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { id } = req.params;
  const board = boards.get(id);

  if (!board) {
    return res.status(404).json({ error: 'Board not found' });
  }

  if (board.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  boards.delete(id);
  return res.json({ message: 'Board deleted' });
});

// Get all boards for user
router.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const userBoards = Array.from(boards.values()).filter((b) => b.ownerId === req.user!.id);
  return res.json(userBoards);
});

export default router;
