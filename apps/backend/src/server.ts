import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import boardRoutes from './routes/board.js';
import authRoutes from './routes/auth.js';
import aiRoutes from './routes/ai.js';
import { authenticateSocket } from './middleware/auth.js';
import { handleSocketConnection } from './services/websocket/socketHandlers.js';

dotenv.config({ path: '.env.local' });

const app: Express = express();
const httpServer = createServer(app);
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://whiteboard-collab-98431547.web.app',
  'https://whiteboard-collab-98431547.firebaseapp.com',
  'http://localhost:5173',
].filter(Boolean) as string[];

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/ai', aiRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WebSocket connection
io.use(authenticateSocket);

io.on('connection', (socket) => {
  handleSocketConnection(socket, io);
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready for connections`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export { app, httpServer, io };
