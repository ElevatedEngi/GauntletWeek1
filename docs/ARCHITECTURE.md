# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CLIENT (Browser)                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    React Application                             │   │
│  │                  (apps/frontend/src/)                            │   │
│  │                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │              UI Components Layer                        │   │   │
│  │  │  - LoginPage (Google OAuth)                             │   │   │
│  │  │  - BoardPage (Main canvas area)                         │   │   │
│  │  │  - PresenceList (Online users)                          │   │   │
│  │  │  - CursorList (Multiplayer cursors)                     │   │   │
│  │  │  - AICommandInput (Command executor)                    │   │   │
│  │  │  - Canvas (Fabric.js infinite board)                    │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  │                           ▲                                       │   │
│  │                           │                                       │   │
│  │  ┌────────────────────────┴────────────────────────────────┐   │   │
│  │  │        Zustand State Management Layer                   │   │   │
│  │  │  - authStore (user, auth state)                         │   │   │
│  │  │  - boardStore (board, objects, cursors, presence)       │   │   │
│  │  └────────────────────────────────────────────────────────┘   │   │
│  │                           ▲                                       │   │
│  │                           │                                       │   │
│  │  ┌────────────────────────┴────────────────────────────────┐   │   │
│  │  │         Services Layer (API & WebSocket)               │   │   │
│  │  │  - Socket.io Client (real-time sync)                    │   │   │
│  │  │  - REST API Client (boards, auth, AI)                   │   │   │
│  │  │  - localStorage (session persistence)                   │   │   │
│  │  └────────────────────────────────────────────────────────┘   │   │
│  │                           ▲                                       │   │
│  └───────────────────────────┼───────────────────────────────────────┘   │
│                              │                                           │
│         HTTP REST + WebSocket │                                           │
│         (port 3000)          │                                           │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
         HTTP (REST)                 WebSocket (Socket.io)
                │                             │
                ▼                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      SERVER (Node.js + Express)                          │
│                     (apps/backend/src/server.ts)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │               HTTP Routes (Express)                             │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │  /api/auth:      authentication endpoints               │   │   │
│  │  │  - POST /login   - verify OAuth token                   │   │   │
│  │  │  - GET /me       - get current user                     │   │   │
│  │  │  - POST /logout  - invalidate session                   │   │   │
│  │  │                                                          │   │   │
│  │  │  /api/boards:    board management endpoints              │   │   │
│  │  │  - POST /        - create new board                      │   │   │
│  │  │  - GET /         - list user's boards                    │   │   │
│  │  │  - GET /:id      - get board data                        │   │   │
│  │  │  - PUT /:id      - update board                          │   │   │
│  │  │  - DELETE /:id   - delete board                          │   │   │
│  │  │                                                          │   │   │
│  │  │  /api/ai:        AI command endpoints                    │   │   │
│  │  │  - POST /execute-command - execute AI command           │   │   │
│  │  │  - GET /history/:boardId - command history              │   │   │
│  │  │                                                          │   │   │
│  │  │  /health:        health check                            │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │            WebSocket Handlers (Socket.io)                       │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │  Connection Flow:                                      │   │   │
│  │  │  1. Client authenticates with JWT token               │   │   │
│  │  │  2. Client joins board room                            │   │   │
│  │  │  3. Server broadcasts presence:join                    │   │   │
│  │  │                                                          │   │   │
│  │  │  Event Handlers:                                       │   │   │
│  │  │  - join:board        → enter board room                │   │   │
│  │  │  - cursor:move       → broadcast cursor position       │   │   │
│  │  │  - object:create     → sync new object                 │   │   │
│  │  │  - object:update     → sync object changes             │   │   │
│  │  │  - object:delete     → sync object removal             │   │   │
│  │  │  - disconnect        → presence:leave broadcast        │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                           ▲                                               │
│                           │                                               │
│  ┌────────────────────────┴───────────────────────────────────────┐   │   │
│  │        Middleware Layer (Authentication, CORS, etc.)           │   │   │
│  │  - authenticateToken    (JWT verification)                     │   │   │
│  │  - authenticateSocket   (WebSocket JWT verification)           │   │   │
│  │  - helmet               (Security headers)                     │   │   │
│  │  - cors                 (Cross-origin requests)                │   │   │
│  │  - express.json()       (JSON body parsing)                    │   │   │
│  └────────────────────────┬───────────────────────────────────────┘   │   │
│                           │                                               │
│  ┌────────────────────────┴───────────────────────────────────────┐   │   │
│  │           Services Layer (Business Logic)                      │   │   │
│  │                                                                │   │   │
│  │  ┌─────────────────────────────────────────────────────┐     │   │   │
│  │  │ Database Service (Supabase PostgreSQL)              │     │   │   │
│  │  │ - User management                                   │     │   │   │
│  │  │ - Board CRUD operations                             │     │   │   │
│  │  │ - Board snapshots (for Yjs sync)                    │     │   │   │
│  │  │ - Command history                                   │     │   │   │
│  │  └─────────────────────────────────────────────────────┘     │   │   │
│  │                                                                │   │   │
│  │  ┌─────────────────────────────────────────────────────┐     │   │   │
│  │  │ Cache Service (Redis / Upstash)                     │     │   │   │
│  │  │ - Cursor positions (ephemeral, <50ms)               │     │   │   │
│  │  │ - Presence state (online users)                     │     │   │   │
│  │  │ - AI responses (60% hit rate)                       │     │   │   │
│  │  └─────────────────────────────────────────────────────┘     │   │   │
│  │                                                                │   │   │
│  │  ┌─────────────────────────────────────────────────────┐     │   │   │
│  │  │ AI Service (Anthropic Claude)                       │     │   │   │
│  │  │ - Command parsing                                   │     │   │   │
│  │  │ - Action validation                                 │     │   │   │
│  │  │ - Multi-step command execution                      │     │   │   │
│  │  │ - Error handling & fallbacks                        │     │   │   │
│  │  └─────────────────────────────────────────────────────┘     │   │   │
│  │                                                                │   │   │
│  │  ┌─────────────────────────────────────────────────────┐     │   │   │
│  │  │ Sync Service (Yjs CRDT)                             │     │   │   │
│  │  │ - Document state management                         │     │   │   │
│  │  │ - Conflict-free merging                             │     │   │   │
│  │  │ - WebSocket provider integration                    │     │   │   │
│  │  └─────────────────────────────────────────────────────┘     │   │   │
│  │                                                                │   │   │
│  └────────────────────────┬───────────────────────────────────────┘   │   │
│                           │                                               │
└───────────────────────────┼───────────────────────────────────────────────┘
                            │
    ┌───────────────────────┼───────────────────────┐
    │                       │                       │
    ▼                       ▼                       ▼
┌──────────────┐   ┌──────────────┐       ┌──────────────────┐
│ Supabase     │   │ Redis/       │       │  Anthropic       │
│ PostgreSQL   │   │  Upstash     │       │  Claude API      │
│              │   │              │       │                  │
│ - users      │   │ - sessions   │       │ - GPT-4          │
│ - boards     │   │ - cache      │       │ - CachedContent  │
│ - objects    │   │ - presence   │       │ - Tokenization   │
│ - snapshots  │   │ - cursor pos │       │                  │
│ - auth       │   │              │       │  $0.30/month     │
│              │   │  Free tier:  │       │  budget w/cache  │
│ Free tier:   │   │  10k cmds/day│       │                  │
│ 500MB DB     │   │              │       │                  │
│ Auth incl.   │   │  $5 -> $0/mo │       │                  │
└──────────────┘   └──────────────┘       └──────────────────┘
```

## Data Flow Examples

### Example 1: User Joins Board
```
1. Client connects to WebSocket with JWT token
   → socket.on('connect', emit token)

2. Server authenticates socket
   → middleware verifies JWT

3. Client joins board room
   → socket.emit('join:board', boardId)

4. Server broadcasts presence
   → io.to(room).emit('presence:join', user)

5. Client updates presence list
   → boardStore.setPresenceUser(user)

6. UI re-renders with online users
   → PresenceList component shows new user
```

### Example 2: Object Creation
```
1. User clicks canvas to create sticky note
   → Canvas click handler triggers creation

2. Frontend creates local object
   → optimistic update in Zustand store
   → object appears immediately (60 FPS)

3. Frontend sends to backend
   → socket.emit('object:create', objectData)

4. Backend broadcasts to room
   → io.to(boardId).emit('object:update', {...})

5. All clients receive update
   → boardStore.addObject(object)
   → Canvas re-renders with new object

6. Backend persists via Yjs
   → CRDT handles concurrent edits
   → conflicts resolved automatically
```

### Example 3: AI Command Execution
```
1. User types AI command
   → "Create a sticky note saying hello"

2. Frontend sends command
   → HTTP POST /api/ai/execute-command
   → includes board ID and user context

3. Backend checks cache
   → Redis lookup on command hash
   → 60% hit rate for common commands
   → immediate response if cached

4. If cache miss, query Claude
   → Send simplified board state
   → Claude parses command
   → Validates against allowed actions
   → Returns action JSON

5. Backend executes action
   → Create object in board
   → Broadcast via WebSocket
   → Update database
   → Cache result in Redis

6. Frontend receives update
   → Socket.io: object:update event
   → Zustand store updated
   → Canvas re-renders

7. User sees new sticky note
   → Appears instantly (<200ms total)
```

### Example 4: Multiplayer Cursor Tracking
```
1. User moves mouse over canvas
   → mousemove event fires

2. Frontend throttles cursor updates
   → 60Hz maximum (16ms intervals)
   → reduces network traffic

3. Frontend sends cursor position
   → socket.emit('cursor:move', {x, y, color})
   → to specific board room

4. Server broadcasts to others
   → io.to(room).emit('cursor:move', {...})
   → <50ms latency from Redis cache

5. Other clients receive position
   → boardStore.setCursor(userId, cursor)

6. UI renders cursors
   → CursorList shows positions
   → Canvas renders cursor pointer
   → Name label displays on hover
```

## State Management Flow

```
┌─────────────────────────────────────────────────────────┐
│         Frontend State (Zustand Stores)                 │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  authStore                    boardStore                │
│  ├─ user                      ├─ board                  │
│  ├─ isAuthenticated           ├─ objects (Map)          │
│  ├─ isLoading                 ├─ cursors (Map)          │
│  ├─ setUser                   ├─ presenceUsers (Map)    │
│  ├─ logout                    ├─ isConnected            │
│  └─ checkAuth                 ├─ addObject              │
│                               ├─ updateObject           │
│                               ├─ deleteObject           │
│                               ├─ setCursor              │
│                               ├─ setPresenceUser        │
│                               └─ reset                  │
│                                                          │
│  Actions:                        Actions:               │
│  ├─ Login with Google            ├─ Create object       │
│  ├─ Logout                       ├─ Update object       │
│  ├─ Parse OAuth token            ├─ Delete object       │
│  └─ Refresh session              ├─ Receive WebSocket   │
│                                  └─ Sync with board     │
│                                                          │
└─────────────────────────────────────────────────────────┘
         ▲
         │
     (updates)
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│     Component Layer (React Components)                  │
├─────────────────────────────────────────────────────────┤
│  - Subscribe to Zustand stores                          │
│  - Render based on state                                │
│  - Dispatch actions on user interaction                 │
│  - Managed component re-renders via Zustand subscribers │
└─────────────────────────────────────────────────────────┘
```

## Real-time Synchronization Architecture

```
LOCAL-FIRST
┌──────────────────────────────────────────────────────────────┐
│ Frontend (Yjs Doc)                                           │
│                                                              │
│  Optimistic Updates (Instant)                                │
│  ├─ User action (create, move, edit)                         │
│  ├─ Update local Yjs document                                │
│  ├─ Zustand store updated                                    │
│  ├─ Component re-renders → 60 FPS                            │
│  └─ User sees change immediately                             │
│                                                              │
│  Sync in Background (<100ms)                                 │
│  ├─ Yjs sends update to server via WebSocket                 │
│  ├─ Server applies update to doc                             │
│  ├─ Server broadcasts to other users                         │
│  └─ Conflict-free merging via CRDT algorithm                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
        ▲                               │
        │                               ▼
    UPSTREAM              ┌──────────────────────────────────────────┐
    (100ms)               │ Backend (Yjs Server)                     │
    <100ms                │                                          │
        │                 │  Receives Update                         │
        │                 │  ├─ Apply to Yjs document               │
        │                 │  ├─ Persist to PostgreSQL (debounced)   │
        │                 │  ├─ Cache in Redis                      │
        │                 │  └─ Broadcast to other clients          │
        │                 │                                          │
        │                 │  Handles Conflicts                       │
        │                 │  ├─ CRDT automatically merges changes    │
        │                 │  ├─ No manual conflict resolution needed │
        │                 │  └─ Deterministic ordering                │
        │                 │                                          │
        ├─────────────────┤  Sends Updates to Other Clients          │
        │                 │  ├─ Socket.io broadcast                  │
        │                 │  ├─ <50ms latency                        │
        │                 │  └─ Updated doc applied locally          │
        │                 │                                          │
        └──────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────┐
        │  Other Clients                  │
        │  Receive Update                 │
        │  ├─ Apply to local Yjs doc      │
        │  ├─ No conflicts (CRDT handles) │
        │  ├─ Zustand updated             │
        │  └─ Re-render (60 FPS)          │
        └─────────────────────────────────┘
```

## Performance Optimization Strategies

```
┌─────────────────────────────────────────────────────────────┐
│                  60 FPS Target                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Strategy 1: Viewport Culling                               │
│  ├─ Only render visible objects                             │
│  ├─ Skip canvas drawing for off-screen items                │
│  └─ Handles 500+ objects with no frame drops                │
│                                                              │
│  Strategy 2: Object Caching                                 │
│  ├─ Cache rendered object bitmaps in Fabric.js              │
│  ├─ Reduce re-rendering overhead                            │
│  └─ Especially important for text content                   │
│                                                              │
│  Strategy 3: Throttled Events                               │
│  ├─ Cursor moves: 60Hz (16ms intervals)                     │
│  ├─ Scroll/pan: requestAnimationFrame                       │
│  └─ Object edits: debounced 500ms                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              <50ms Cursor Sync Target                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Strategy 1: Ephemeral Updates                              │
│  ├─ Cursor position → not persisted                         │
│  ├─ Send every 16ms (60Hz throttle)                         │
│  ├─ Store in Redis (sub-ms retrieval)                       │
│  └─ Broadcast immediately via Socket.io                     │
│                                                              │
│  Strategy 2: Redis Caching                                  │
│  ├─ Cursor state in fast memory                             │
│  ├─ No database lookup required                             │
│  ├─ Natural expiration (30s timeout)                        │
│  └─ Upstash free tier: 10k commands/day                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│           <2s AI Response Target                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Path 1: Cache Hit (60% expected)                            │
│  ├─ Client sends command                                    │
│  ├─ Backend hashes command → Redis lookup                   │
│  ├─ Response found → instant (10ms)                         │
│  └─ Total latency: ~50ms                                    │
│                                                              │
│  Path 2: Cache Miss (40% expected)                           │
│  ├─ Redis lookup fails                                      │
│  ├─ Query Claude API (~800ms latency)                       │
│  ├─ Parse response (20ms)                                   │
│  ├─ Execute board operations (100ms)                        │
│  ├─ Cache result in Redis (5ms)                             │
│  └─ Total latency: ~1000ms (under 2s target)                │
│                                                              │
│  Cost Optimization                                          │
│  ├─ 60% cache hit rate → 75% cost savings                   │
│  ├─ $1.05/month (no cache) → $0.30/month (with cache)       │
│  ├─ Within $25 budget comfortably                           │
│  └─ Rate limited: 10 commands/hour/user                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Next Steps

1. **Implement Canvas** - Integrate Fabric.js infinite board
2. **Add Objects** - Sticky notes and shapes
3. **Setup Yjs** - CRDT synchronization
4. **Configure Supabase** - Database and auth
5. **Deploy** - Railway + Vercel

See SETUP.md for quick start instructions.
