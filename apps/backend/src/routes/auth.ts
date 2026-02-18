import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Mock login endpoint for MVP (returns JWT token)
router.post('/mock-login', (req: AuthRequest, res: Response) => {
  const { id, email, name } = req.body;

  if (!id || !email || !name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Create JWT token
  const token = jwt.sign(
    { id, email, name },
    process.env.JWT_SECRET || 'default-secret',
    { expiresIn: '7d' }
  );

  return res.json({ token, user: { id, email, name } });
});

// Get current user
router.get('/me', authenticateToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  return res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
  });
});

// Google OAuth callback (simplified - full implementation in integration phase)
router.get('/google/callback', (_req: AuthRequest, res: Response) => {
  // TODO: Implement Google OAuth callback
  // This will be handled by frontend redirect and backend verification
  return res.json({ message: 'OAuth callback handler' });
});

// Logout
router.post('/logout', authenticateToken, (_req: AuthRequest, res: Response) => {
  return res.json({ message: 'Logged out successfully' });
});

export default router;
