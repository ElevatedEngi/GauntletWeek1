# Testing Guide - Real-time Collaboration

## Quick Start

### 1. Start Development Servers
```bash
npm run dev
```

This starts:
- **Frontend:** http://localhost:5173
- **Backend:** http://localhost:3000

### 2. Test Real-time Collaboration

#### Single Browser (Multiple Tabs)
1. Open http://localhost:5173 in your browser
2. Login with any email (e.g., `alice@test.com`)
3. You'll be redirected to a new board
4. Open a **new tab** (Ctrl+T / Cmd+T)
5. Open http://localhost:5173 again
6. Login with a different email (e.g., `bob@test.com`)
7. Copy the board URL from tab 1
8. Paste it in tab 2 to join the same board

#### Test Features

**✅ Infinite Board**
- Right-click + drag to pan
- Ctrl/Cmd + scroll to zoom
- Click "Reset View" to center

**✅ Creating Objects**
- Click "📝 Sticky Note" to create a sticky note
- Click "▭ Rectangle" to create a rectangle
- Click "● Circle" to create a circle
- Objects appear instantly in both tabs

**✅ Moving & Editing Objects**
- Click and drag objects to move them
- Click corners to resize
- Select object and press Delete/Backspace to remove
- Changes sync in real-time to other users

**✅ Text Editing (Sticky Notes)**
- Double-click sticky note text to edit
- Type your message
- Click outside to finish editing
- Text syncs to other users

**✅ Multiplayer Cursors**
- Move your mouse in tab 1
- See your cursor with name label in tab 2
- Each user has a unique color
- Cursors update at 60fps

**✅ Presence Awareness**
- Right sidebar shows "👥 Online Users"
- See who's currently on the board
- Green dot = online
- Users disappear when they close the tab

**✅ Cursor Tracking**
- "🎯 Cursors" section shows cursor positions
- See exact coordinates of other users

## Expected Behavior

### What Should Work ✅
- [x] Creating objects (sticky notes, rectangles, circles)
- [x] Moving objects with drag & drop
- [x] Resizing objects
- [x] Deleting objects (Select + Delete/Backspace)
- [x] Editing text in sticky notes
- [x] Real-time sync between multiple users
- [x] Multiplayer cursors with names
- [x] Presence list (who's online)
- [x] Pan and zoom
- [x] Connection status indicator

### Known Limitations ⚠️
- Authentication is mock-only (not real Google OAuth)
- No database persistence (board data lost on server restart)
- No AI agent integration (placeholder only)
- No line drawing tool (defined but not implemented)
- Sticky note text editing may need double-click to activate

## Troubleshooting

### Backend won't start (Port 3000 in use)
```bash
lsof -ti:3000 | xargs kill -9
npm run dev
```

### Frontend shows "Disconnected"
- Check backend is running on port 3000
- Check CORS settings in backend/src/server.ts
- Verify JWT_SECRET in backend/.env.local

### Objects not syncing
- Open browser console (F12)
- Check for WebSocket errors
- Verify both users are on the same board URL
- Check backend logs for object:create/update events

### Text editing not working
- Try double-clicking the text area
- Ensure you're clicking inside the sticky note
- Check console for errors

## Performance Testing

### Test with Multiple Users
1. Open 3-4 browser tabs
2. Login with different emails in each
3. Join the same board
4. Create 50+ objects quickly
5. Move objects rapidly

**Expected:**
- 60 FPS rendering
- <100ms object sync latency
- <50ms cursor sync latency
- No lag or stuttering

### Test Edge Cases
- Create 100+ objects (should handle smoothly)
- Rapidly create and delete objects
- Edit text while others are moving objects
- Disconnect and reconnect (close tab, reopen)

## Development Tips

### View Backend Logs
Backend logs show all WebSocket events:
```
✅ User connected: alice (user_abc123)
📍 User alice joined board board_xyz789
✏️ Object created: obj_123 in board board_xyz789
```

### View Frontend Console
Open DevTools (F12) to see:
- WebSocket connection status
- Object updates received
- Cursor movements
- Presence events

### Test WebSocket Connection
```javascript
// In browser console
console.log('WebSocket connected:', window.socket?.connected);
```

## Next Steps

After testing locally:
1. ✅ Verify all MVP features work
2. 🚀 Deploy to production (see DEPLOYMENT.md)
3. 🎨 Add polish & animations
4. 🤖 Integrate AI agent (optional)
5. 🔐 Add real Google OAuth (optional)

---

**Status:** ✅ MVP Complete - Ready for Testing!
**Created:** 2026-02-16
