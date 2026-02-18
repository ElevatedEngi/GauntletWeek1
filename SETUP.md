# Whiteboard AI - MVP Setup Guide

## Framework Implementation Complete ✅

The MVP framework has been successfully initialized with a comprehensive monorepo structure, following the architecture outlined in the Pre-Search Technical Document.

## What's Been Set Up

### Project Structure
- **Turborepo-based monorepo** for efficient multi-package management
- **Apps directory** with frontend and backend applications
- **Packages directory** with shared types
- **Unified TypeScript configuration** across all packages

### Frontend Application (`apps/frontend/`)
```
src/
├── components/
│   ├── Auth/           # Login page, OAuth handlers
│   ├── Board/          # Board page, presence list, cursors
│   └── Canvas/         # Canvas rendering
├── stores/             # Zustand state management
│   ├── authStore.ts    # Authentication state
│   └── boardStore.ts   # Board and collaboration state
├── hooks/              # Custom React hooks (ready for implementation)
├── services/           # API client services (ready for implementation)
└── App.tsx             # Main app component with routing
```

- **Vite** development server with HMR
- **React Router** for client-side routing
- **Tailwind CSS** for styling
- **Zustand** stores for auth and board state

### Backend Application (`apps/backend/`)
```
src/
├── routes/             # Express route handlers
│   ├── auth.ts        # Authentication endpoints
│   ├── board.ts       # Board CRUD operations
│   └── ai.ts          # AI command endpoints
├── middleware/
│   └── auth.ts        # JWT and WebSocket authentication
├── services/
│   ├── websocket/     # Socket.io handlers
│   ├── ai/            # AI agent service (Claude integration)
│   ├── database/      # Supabase integration (ready)
│   └── redis/         # Cache service (ready)
├── types/             # TypeScript interfaces
└── server.ts          # Express app initialization
```

- **Express** web framework
- **Socket.io** for WebSocket real-time communication
- **JWT authentication** with token verification
- **CORS** and security middleware configured

### Shared Types Package (`packages/shared-types/`)

Comprehensive TypeScript interfaces shared between frontend and backend:
- `Board`, `BoardObject`, `User` - Core domain models
- `ObjectType` enum - Supported object types
- `Position` interface - Coordinate system
- `WebSocketEvent` types - Real-time communication contracts
- `AppState` - Redux-style state shape

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Environment Variables
```bash
# Copy the example file
cp apps/backend/.env.example apps/backend/.env.local

# Edit with your configuration (optional for basic dev)
```

### 3. Start Development Servers
```bash
npm run dev
```

This will start:
- **Frontend:** http://localhost:5173 (React dev server with HMR)
- **Backend:** http://localhost:3000 (Express API + WebSocket)

### 4. Verify Setup
- Frontend should load at http://localhost:5173
- Backend health check: `curl http://localhost:3000/health`
- WebSocket ready for connections (test in Phase 1)

## Development Scripts

```bash
# Development
npm run dev                              # Start all services
npm run dev -w @whiteboard/frontend     # Frontend only
npm run dev -w @whiteboard/backend      # Backend only

# Building
npm run build                            # Build all packages
npm run build -w @whiteboard/backend    # Build specific package

# Code Quality
npm run lint                             # Lint all packages
npm run format                           # Format all code
npm run type-check                       # TypeScript validation
npm run clean                            # Clean artifacts
```

## Architecture Overview

### Technology Choices (Rationale from Presearch)

| Layer | Technology | Why? |
|-------|-----------|------|
| Frontend Framework | React 18 | Fast dev velocity, great AI support |
| Build Tool | Vite | Sub-second builds, instant HMR |
| State Management | Zustand | Minimal boilerplate, perfect for MVP |
| Styling | Tailwind CSS | Rapid UI dev, AI-friendly |
| Backend Runtime | Node.js 20 | Shared language with frontend |
| WebSocket | Socket.io | Mature, battle-tested |
| Canvas | Fabric.js | Handles 500+ objects easily |
| Sync Protocol | Yjs CRDT | Auto conflict resolution (Phase 1) |
| Database | Supabase | Managed PostgreSQL, Auth included |
| Cache | Redis/Upstash | Sub-50ms cursor sync |
| AI | Anthropic Claude | Best reasoning, <2s latency |

### Key Design Decisions

1. **Monorepo over Multiple Repos** - Shared types, single npm install, unified build
2. **Monolithic Backend** - No microservices complexity for MVP scale
3. **Managed Services** - Eliminate 20+ hours of DevOps work
4. **TypeScript Everywhere** - One language, better tooling, fewer bugs
5. **Local-first Sync** - Yjs provides instant local updates

## Implementation Roadmap (Next Phases)

### Phase 1: Canvas & Real-time (24-hour Checkpoint)
**Goal:** MVP with all hard requirements

- [ ] Fabric.js infinite canvas implementation
- [ ] Object creation (sticky notes, shapes)
- [ ] Yjs CRDT integration
- [ ] WebSocket real-time sync
- [ ] Multiplayer cursors
- [ ] Presence awareness
- [ ] Basic UI polish

**Estimated Duration:** 18-20 hours

### Phase 2: Authentication (Parallel with Phase 1)
**Goal:** Secure user authentication

- [ ] Google OAuth setup with Supabase
- [ ] JWT token management
- [ ] Protected routes
- [ ] Session persistence

**Estimated Duration:** 2-3 hours

### Phase 3: AI Agent (After Phase 1)
**Goal:** Claude-powered commands

- [ ] Claude API integration
- [ ] Command parsing and execution
- [ ] Redis caching (60% hit rate target)
- [ ] Error handling and fallbacks

**Estimated Duration:** 4-5 hours

### Phase 4: Deployment (After Phase 3)
**Goal:** Production-ready application

- [ ] Supabase project setup
- [ ] Railway backend deployment
- [ ] Vercel frontend deployment
- [ ] Environment configuration
- [ ] Performance verification

**Estimated Duration:** 2-3 hours

### Phase 5: Polish & Documentation (Days 5-7)
**Goal:** Presentation-ready

- [ ] UI/UX refinement
- [ ] Animations and micro-interactions
- [ ] Comprehensive documentation
- [ ] Demo video creation

**Estimated Duration:** 20+ hours

## File Structure Details

### Frontend Components

**Auth/LoginPage.tsx**
- Google OAuth login button
- Redirects to backend OAuth flow
- Stores JWT token in localStorage

**Board/BoardPage.tsx**
- Main application layout
- Presence list sidebar
- Cursor tracking display
- User menu with logout
- AI command input area

**Canvas/WhiteboardCanvas.tsx**
- Canvas rendering scaffold
- Click event handling
- Object drawing (placeholder)
- Ready for Fabric.js integration

### Backend Routes

**GET /api/auth/me**
- Verify JWT token
- Return current user
- Protected route

**POST /api/boards**
- Create new board
- Requires authentication
- Returns board object

**GET /api/boards/:id**
- Fetch board data
- Returns board with all objects

**POST /api/ai/execute-command**
- Process AI commands
- Requires authentication
- Placeholder for Claude integration

### WebSocket Events

```typescript
// Client to Server
'join:board'         // Join board room
'cursor:move'        // Send cursor position
'object:create'      // Add object
'object:update'      // Move/edit object
'object:delete'      // Remove object

// Server to Client
'presence:join'      // User came online
'presence:leave'     // User went offline
'cursor:move'        // Other user cursor
'object:update'      // Other user's changes
```

## Type Safety

The `@whiteboard/shared-types` package provides:

```typescript
// Domain Models
Board, BoardObject, User, PresenceUser, Cursor

// Enums
ObjectType.STICKY_NOTE, ObjectType.RECTANGLE, ObjectType.CIRCLE, ObjectType.LINE

// Utility Types
Position, AppState, WebSocketEvent

// API Request/Response Types
LoginRequest, CreateBoardRequest, AICommandRequest, AICommandResponse
```

Both frontend and backend import from this package, ensuring type consistency.

## Performance Monitoring

The framework includes performance measurement infrastructure:

- FPS tracking (before/after Fabric.js)
- WebSocket latency measurement
- Canvas rendering optimization hooks
- AI response timing

See `src/services/` (frontend) and `src/services/` (backend) for implementation details.

## Environment Configuration

### Required for Development
```
FRONTEND_URL=http://localhost:5173  # For CORS
```

### Required for Production
```
# Authentication
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=32-char-minimum-secret

# Database (Supabase)
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...

# Cache (Upstash)
REDIS_URL=...
REDIS_TOKEN=...

# AI (Anthropic)
ANTHROPIC_API_KEY=...

# Deployment URLs
VERCEL_URL=...
RAILWAY_URL=...
```

## Troubleshooting

### Frontend not loading?
```bash
# Clear node_modules and reinstall
npm run clean && npm install && npm run dev
```

### WebSocket connection failed?
- Ensure backend is running on port 3000
- Check CORS origin matches frontend URL
- Verify `authenticateSocket` middleware isn't rejecting requests

### TypeScript errors?
```bash
npm run type-check  # Get complete type errors
npm run build       # Verify build succeeds
```

### Port already in use?
```bash
# Change port in vite.config.ts (frontend)
# Change port in .env.local (backend)
```

## Next Steps

1. **Review Architecture** - Examine `/docs/Presearch` for detailed rationale
2. **Start Phase 1** - Begin Canvas implementation
3. **Run Development** - `npm run dev` and verify both servers start
4. **Create First Issue** - Document initial blockers on GitHub
5. **Implement Fabric.js** - Add infinite canvas with pan/zoom

## Success Criteria

✅ **Framework Complete When:**
- All dependencies install without errors
- `npm run dev` starts both frontend and backend
- Frontend loads at http://localhost:5173
- Backend health check passes
- TypeScript compilation succeeds (`npm run type-check`)
- All types resolve correctly

## Additional Resources

- **Presearch Document:** [docs/Presearch](../docs/Presearch) - Comprehensive architecture
- **Vite Documentation:** https://vitejs.dev/
- **Socket.io Guide:** https://socket.io/docs/v4/
- **Zustand Docs:** https://github.com/pmndrs/zustand
- **Fabric.js API:** http://fabricjs.com/docs/

## Performance Targets Summary

Once implementation begins, these targets guide development decisions:

| Metric | Target | Method |
|--------|--------|--------|
| **Frame Rate** | 60 FPS | Viewport culling, rendering optimization |
| **Object Sync** | <100ms | Yjs local-first, background WebSocket |
| **Cursor Sync** | <50ms | Throttled ephemeral channel |
| **AI Response** | <2s | 60% cache hit rate via Redis |
| **Objects** | 500+ capacity | Fabric.js optimization |

---

**Setup Version:** 1.0
**Status:** ✅ Framework Complete - Ready for Implementation
**Created:** February 16, 2026
