# Quick Reference Guide

## File Locations

### Frontend Files
```
apps/frontend/
├── src/
│   ├── components/
│   │   ├── Auth/LoginPage.tsx           # OAuth login UI
│   │   ├── Board/BoardPage.tsx          # Main application layout
│   │   ├── Board/PresenceList.tsx       # Online users display
│   │   ├── Board/CursorList.tsx         # Multiplayer cursor tracking
│   │   ├── Board/AICommandInput.tsx     # AI command executor
│   │   └── Canvas/WhiteboardCanvas.tsx  # Canvas rendering
│   ├── stores/
│   │   ├── authStore.ts                 # Authentication state
│   │   └── boardStore.ts                # Board collaboration state
│   ├── App.tsx                          # Main app component
│   └── main.tsx                         # Entry point
├── vite.config.ts                       # Build configuration
├── tsconfig.json                        # TypeScript config
└── package.json                         # Dependencies
```

### Backend Files
```
apps/backend/
├── src/
│   ├── routes/
│   │   ├── auth.ts                      # Auth endpoints
│   │   ├── board.ts                     # Board CRUD
│   │   └── ai.ts                        # AI commands
│   ├── middleware/
│   │   └── auth.ts                      # JWT verification
│   ├── services/
│   │   ├── websocket/socketHandlers.ts # Socket.io handlers
│   │   ├── ai/agent.ts                 # AI agent service
│   │   ├── database/                   # DB operations (ready)
│   │   └── redis/                      # Cache service (ready)
│   ├── types/                          # TypeScript interfaces
│   └── server.ts                       # Express server
├── .env.example                        # Environment template
├── tsconfig.json                       # TypeScript config
└── package.json                        # Dependencies
```

### Shared Types
```
packages/shared-types/
└── src/
    └── index.ts                        # All shared types and interfaces
```

## Common Commands

```bash
# Development
npm run dev                             # Start all services (http://localhost:5173 + :3000)
npm run dev -w @whiteboard/frontend     # Frontend only
npm run dev -w @whiteboard/backend      # Backend only

# Building & Deployment
npm run build                           # Build all packages
npm run build -w @whiteboard/frontend   # Build frontend for Vercel
npm run build -w @whiteboard/backend    # Build backend for Railway

# Code Quality
npm run lint                            # ESLint all packages
npm run format                          # Prettier format
npm run type-check                      # TypeScript strict check
npm run clean                           # Remove build artifacts

# Testing (to be implemented)
npm run test                            # Run all tests
```

## Adding New Dependencies

```bash
# Frontend
npm install -w @whiteboard/frontend react-new-library

# Backend
npm install -w @whiteboard/backend express-new-middleware

# Dev dependencies
npm install --save-dev -w @whiteboard/frontend @types/new-lib
```

## Key Imports

### Frontend Stores
```typescript
import useAuthStore from '@/stores/authStore';
import useBoardStore from '@/stores/boardStore';

// In components
const { user, logout } = useAuthStore();
const { board, objects, cursors } = useBoardStore();
```

### Shared Types
```typescript
import {
  Board,
  BoardObject,
  User,
  ObjectType,
  Position,
  WebSocketEvent,
  CursorMoveEvent,
  ObjectUpdateEvent,
} from '@whiteboard/shared-types';
```

### Backend Routes
```typescript
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.get('/protected', authenticateToken, (req, res) => {
  // req.user contains decoded JWT
});
```

## WebSocket Events

### Client → Server
```typescript
socket.emit('join:board', boardId);
socket.emit('cursor:move', { x: 100, y: 200, color: '#FF0000' }, boardId);
socket.emit('object:create', objectData, boardId);
socket.emit('object:update', objectId, updates, boardId);
socket.emit('object:delete', objectId, boardId);
```

### Server → Client
```typescript
socket.on('presence:join', (user) => {});
socket.on('presence:leave', (user) => {});
socket.on('cursor:move', (cursorData) => {});
socket.on('object:update', (updateData) => {});
```

## API Endpoints

### Authentication
- `GET /api/auth/me` - Get current user (requires JWT)
- `GET /api/auth/google/callback` - Google OAuth callback
- `POST /api/auth/logout` - Logout (requires JWT)

### Boards
- `POST /api/boards` - Create board (requires JWT)
- `GET /api/boards` - List user's boards (requires JWT)
- `GET /api/boards/:id` - Get board data (requires JWT)
- `PUT /api/boards/:id` - Update board (requires JWT)
- `DELETE /api/boards/:id` - Delete board (requires JWT)

### AI
- `POST /api/ai/execute-command` - Execute AI command (requires JWT)
- `GET /api/ai/history/:boardId` - Get command history (requires JWT)

## Environment Variables

### Development
```
FRONTEND_URL=http://localhost:5173
PORT=3000
```

### Production
```
FRONTEND_URL=https://your-app.vercel.app
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=... (min 32 chars)
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
REDIS_URL=...
ANTHROPIC_API_KEY=...
VERCEL_URL=...
RAILWAY_URL=...
```

## Debugging Tips

### Frontend
```bash
# Check in browser console
console.log(useAuthStore.getState());  # Auth state
console.log(useBoardStore.getState()); # Board state

# Network tab in DevTools
# - Check WebSocket connection in WS tab
# - Verify HTTP requests to /api/...
```

### Backend
```bash
# Terminal logs show:
# - Connected clients
# - WebSocket events
# - Database queries
# - API requests

# Check health
curl http://localhost:3000/health
```

### TypeScript
```bash
npm run type-check   # Find type errors
npm run build        # Full build check
```

## Common Issues & Solutions

### Port Already in Use
```bash
# Kill process using port
lsof -ti:3000 | xargs kill -9   # Kill port 3000
lsof -ti:5173 | xargs kill -9   # Kill port 5173

# Or change ports in config
```

### WebSocket Not Connecting
- Check CORS origin matches
- Ensure JWT token is valid
- Verify backend is running
- Check browser console for errors

### TypeScript Errors
```bash
npm run type-check  # Get all errors at once
npm run build       # Full build validation
```

### Dependencies Won't Install
```bash
npm run clean       # Remove node_modules and artifacts
npm install         # Fresh install
```

## Performance Metrics to Track

```
1. Frame Rate (60 FPS target)
   - Monitor in browser DevTools
   - Check during heavy object manipulation

2. WebSocket Latency (<50ms cursors, <100ms objects)
   - Log socket.io message timings
   - Check Network tab timestamps

3. API Response Time (<2s AI commands)
   - Monitor in Network tab
   - Check backend logs

4. Canvas Rendering
   - Use DevTools Performance tab
   - Profile Fabric.js rendering
```

## Git Workflow

### Commit Messages
```
feat(canvas): add infinite pan and zoom
fix(auth): handle token expiration
docs(readme): update setup instructions
perf(sync): optimize cursor throttling
```

### Branching (if needed)
```
main          → Production-ready
staging       → Ready for testing
feature/*     → Feature development
bugfix/*      → Bug fixes
```

## Next: Implementing Fabric.js

Once framework is running:

1. Import Fabric.js canvas
2. Create infinite canvas viewport
3. Add pan/zoom controls
4. Implement object manipulation
5. Add visual feedback for selections

See Phase 1 in SETUP.md for detailed timeline.

---

**Last Updated:** February 16, 2026
