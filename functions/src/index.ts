import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as express from 'express';
import * as cors from 'cors';
import { aiAgent } from './services/ai/agent';

// Initialize Firebase Admin
initializeApp();

// Define secrets
const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

// Export existing board functions
export { createBoard, getBoard, updateBoard, deleteBoard, listBoards } from './api/boards';

// --- Express API for AI commands ---
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Auth middleware using Firebase Admin
async function authenticateRequest(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await getAuth().verifyIdToken(token);
    (req as any).user = {
      id: decoded.uid,
      email: decoded.email,
      name: decoded.name || decoded.email,
    };
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// AI execute command
app.post('/api/ai/execute-command', authenticateRequest, async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { command, boardId, boardObjects } = req.body;

  if (!command || !boardId) {
    res.status(400).json({ error: 'Missing command or boardId' });
    return;
  }

  try {
    const apiKey = anthropicApiKey.value();
    if (!apiKey) {
      res.status(500).json({
        success: false,
        error: 'AI service is not configured',
        fallback: 'ANTHROPIC_API_KEY secret is not set',
      });
      return;
    }

    const result = await aiAgent.executeCommand(
      command,
      boardId,
      user.id,
      apiKey,
      boardObjects || {},
    );
    res.json(result);
  } catch (error) {
    console.error('AI route error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      fallback: 'Please try again later',
    });
  }
});

// AI command history (placeholder)
app.get('/api/ai/history/:boardId', authenticateRequest, (_req, res) => {
  res.json({ commands: [] });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Export the Express app as a Cloud Function
export const api = onRequest(
  {
    timeoutSeconds: 300,
    memory: '1GiB',
    secrets: [anthropicApiKey],
  },
  app,
);
