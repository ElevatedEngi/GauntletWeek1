import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { aiAgent } from '../services/ai/agent.js';

const router = Router();

// Execute AI command (standard JSON response)
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

// Execute AI command with SSE streaming — objects appear as they're created
router.post(
  '/execute-command-stream',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { command, boardId, boardObjects } = req.body;

    if (!command || !boardId) {
      return res.status(400).json({ error: 'Missing command or boardId' });
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let sentOpsCount = 0;

    try {
      const result = await aiAgent.executeCommand(
        command,
        boardId,
        req.user.id,
        boardObjects || {},
        // onProgress callback — streams new operations as SSE events
        (allOps) => {
          const newOps = allOps.slice(sentOpsCount);
          if (newOps.length > 0) {
            res.write(`data: ${JSON.stringify({ type: 'operations', operations: newOps })}\n\n`);
            sentOpsCount = allOps.length;
          }
        },
      );

      // Send final result
      res.write(`data: ${JSON.stringify({ type: 'done', result })}\n\n`);
      res.end();
    } catch (error) {
      console.error('AI stream error:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Internal server error' })}\n\n`);
      res.end();
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
