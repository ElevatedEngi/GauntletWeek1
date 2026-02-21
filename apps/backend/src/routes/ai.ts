import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { aiAgent } from '../services/ai/agent.js';

const router = Router();

// Execute AI command
router.post(
  '/execute-command',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { command, boardId, boardObjects } = req.body;

    if (!command || !boardId) {
      return res.status(400).json({ error: 'Missing command or boardId' });
    }

    try {
      const result = await aiAgent.executeCommand(
        command,
        boardId,
        req.user.id,
        boardObjects || {},
      );
      return res.json(result);
    } catch (error) {
      console.error('AI route error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        fallback: 'Please try again later',
      });
    }
  },
);

// Get command history
router.get(
  '/history/:boardId',
  authenticateToken,
  (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // TODO: Retrieve command history from database
    return res.json({ commands: [] });
  },
);

export default router;
