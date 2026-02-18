import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const db = getFirestore();

/**
 * Create a new board
 * POST /createBoard
 * Body: { name: string }
 */
export const createBoard = onRequest({ cors: true }, async (req, res) => {
  try {
    // Authenticate user
    await authenticate(req as AuthenticatedRequest);
    const user = (req as AuthenticatedRequest).user!;

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Board name is required' });
      return;
    }

    // Create board document
    const boardData = {
      name,
      ownerId: user.uid,
      collaborators: [],
      isPublic: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const boardRef = await db.collection('boards').add(boardData);

    res.status(201).json({
      id: boardRef.id,
      ...boardData,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } catch (error: any) {
    console.error('Create board error:', error);
    res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

/**
 * Get a board by ID
 * GET /getBoard?id=<boardId>
 */
export const getBoard = onRequest({ cors: true }, async (req, res) => {
  try {
    await authenticate(req as AuthenticatedRequest);
    const user = (req as AuthenticatedRequest).user!;

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const boardId = req.query.id as string;
    if (!boardId) {
      res.status(400).json({ error: 'Board ID is required' });
      return;
    }

    const boardDoc = await db.collection('boards').doc(boardId).get();

    if (!boardDoc.exists) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }

    const boardData = boardDoc.data()!;

    // Check permissions
    const hasAccess =
      boardData.ownerId === user.uid ||
      boardData.collaborators?.includes(user.uid) ||
      boardData.isPublic === true;

    if (!hasAccess) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.status(200).json({
      id: boardDoc.id,
      ...boardData,
      objects: [], // Objects are stored in Realtime DB
    });
  } catch (error: any) {
    console.error('Get board error:', error);
    res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

/**
 * Update a board
 * PUT /updateBoard
 * Body: { id: string, name?: string, collaborators?: string[], isPublic?: boolean }
 */
export const updateBoard = onRequest({ cors: true }, async (req, res) => {
  try {
    await authenticate(req as AuthenticatedRequest);
    const user = (req as AuthenticatedRequest).user!;

    if (req.method !== 'PUT') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { id, name, collaborators, isPublic } = req.body;
    if (!id) {
      res.status(400).json({ error: 'Board ID is required' });
      return;
    }

    const boardRef = db.collection('boards').doc(id);
    const boardDoc = await boardRef.get();

    if (!boardDoc.exists) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }

    const boardData = boardDoc.data()!;

    // Only owner can update board
    if (boardData.ownerId !== user.uid) {
      res.status(403).json({ error: 'Only the owner can update the board' });
      return;
    }

    const updates: any = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (name !== undefined) updates.name = name;
    if (collaborators !== undefined) updates.collaborators = collaborators;
    if (isPublic !== undefined) updates.isPublic = isPublic;

    await boardRef.update(updates);

    res.status(200).json({
      id,
      ...boardData,
      ...updates,
      updatedAt: Date.now(),
    });
  } catch (error: any) {
    console.error('Update board error:', error);
    res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

/**
 * Delete a board
 * DELETE /deleteBoard?id=<boardId>
 */
export const deleteBoard = onRequest({ cors: true }, async (req, res) => {
  try {
    await authenticate(req as AuthenticatedRequest);
    const user = (req as AuthenticatedRequest).user!;

    if (req.method !== 'DELETE') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const boardId = req.query.id as string;
    if (!boardId) {
      res.status(400).json({ error: 'Board ID is required' });
      return;
    }

    const boardRef = db.collection('boards').doc(boardId);
    const boardDoc = await boardRef.get();

    if (!boardDoc.exists) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }

    const boardData = boardDoc.data()!;

    // Only owner can delete board
    if (boardData.ownerId !== user.uid) {
      res.status(403).json({ error: 'Only the owner can delete the board' });
      return;
    }

    await boardRef.delete();

    res.status(200).json({ message: 'Board deleted successfully' });
  } catch (error: any) {
    console.error('Delete board error:', error);
    res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

/**
 * List all boards for the authenticated user
 * GET /listBoards
 */
export const listBoards = onRequest({ cors: true }, async (req, res) => {
  try {
    await authenticate(req as AuthenticatedRequest);
    const user = (req as AuthenticatedRequest).user!;

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Get boards owned by user
    const ownedBoards = await db
      .collection('boards')
      .where('ownerId', '==', user.uid)
      .orderBy('updatedAt', 'desc')
      .get();

    // Get boards where user is a collaborator
    const sharedBoards = await db
      .collection('boards')
      .where('collaborators', 'array-contains', user.uid)
      .orderBy('updatedAt', 'desc')
      .get();

    const boards = [
      ...ownedBoards.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      ...sharedBoards.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    ];

    res.status(200).json({ boards });
  } catch (error: any) {
    console.error('List boards error:', error);
    res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});
