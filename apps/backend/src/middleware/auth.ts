import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Socket } from 'socket.io';

// Initialize Firebase Admin SDK with just project ID (no service account key needed)
// Firebase Admin can verify ID tokens using only the project ID by fetching
// Google's public keys automatically.
if (getApps().length === 0) {
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'whiteboard-collab-98431547',
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = {
      id: decoded.uid,
      email: decoded.email || '',
      name: decoded.name || decoded.email || '',
    };
    return next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

export const authenticateSocket = async (socket: Socket, next: (err?: Error) => void) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication error: no token'));
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    socket.data.user = {
      id: decoded.uid,
      email: decoded.email || '',
      name: decoded.name || decoded.email || '',
    };
    next();
  } catch (error) {
    next(new Error('Authentication error: invalid token'));
  }
};
