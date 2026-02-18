# Firebase Deployment Guide

## ✅ What's Been Completed

### Phase 1: Firebase Setup ✓
- ✅ Firebase project created: `whiteboard-collab-98431547`
- ✅ Firebase SDK installed (frontend)
- ✅ Firebase Admin SDK installed (functions)
- ✅ Configuration files created:
  - `firebase.json`
  - `firestore.rules`
  - `database.rules.json`
  - `firestore.indexes.json`
  - `.firebaserc`
- ✅ Environment variables configured in `apps/frontend/.env.local`

### Phase 2: Authentication Migration ✓
- ✅ Firebase service initialization (`apps/frontend/src/services/firebase.ts`)
- ✅ Auth store migrated to Firebase Authentication
- ✅ LoginPage updated with Google OAuth
- ✅ App.tsx updated to use Firebase auth listener
- ✅ Mock JWT authentication removed

### Phase 3: Firebase Functions ✓
- ✅ Created Firebase Functions for:
  - `createBoard` - Create new boards
  - `getBoard` - Fetch board metadata
  - `updateBoard` - Update board details
  - `deleteBoard` - Delete boards
  - `listBoards` - List user's boards
- ✅ Auth middleware created (`functions/src/middleware/auth.ts`)
- ✅ Functions compiled successfully

### Phase 4: Real-Time Sync Migration ✓
- ✅ BoardPage.tsx migrated to Firebase Realtime Database
- ✅ WhiteboardCanvas.tsx migrated to Firebase Realtime Database
- ✅ Real-time object synchronization (create/update/delete)
- ✅ Real-time cursor tracking
- ✅ Real-time presence awareness
- ✅ Socket.io completely removed
- ✅ All WebSocket code replaced with Firebase listeners

---

## 📋 Next Steps for Deployment

### Step 1: Enable Firebase Services (If Not Done)

Go to [Firebase Console](https://console.firebase.google.com/project/whiteboard-collab-98431547)

#### 1.1 Enable Authentication
1. Navigate to **Build → Authentication**
2. Click "Get Started"
3. Go to **Sign-in method** tab
4. Enable **Google** provider
5. Add support email
6. Save

#### 1.2 Verify Firestore Database
1. Go to **Build → Firestore Database**
2. Ensure database is created in **production mode**

#### 1.3 Verify Realtime Database
1. Go to **Build → Realtime Database**
2. Ensure database is created

#### 1.4 Upgrade to Blaze Plan (Required for Cloud Functions)
1. Go to **Upgrade** (bottom left)
2. Select **Blaze (Pay as you go)**
3. Note: With your usage (~100 users), expect ~$7-10/month

---

### Step 2: Authenticate Firebase CLI

You need to authenticate Firebase CLI to deploy. Choose one option:

**Option A: Local Firebase Login**
```bash
firebase login
```
This will open a browser for authentication.

**Option B: CI Token (For Non-Interactive Environments)**
Run this on your local machine:
```bash
firebase login:ci
```
Copy the token and set it as an environment variable in Codespaces:
```bash
export FIREBASE_TOKEN="<your-token-here>"
```

---

### Step 3: Deploy to Firebase

Once authenticated, run the deployment commands:

#### 3.1 Deploy Security Rules
```bash
cd /workspaces/GauntletWeek1
firebase deploy --only firestore:rules,database
```

#### 3.2 Deploy Firebase Functions
```bash
firebase deploy --only functions
```

#### 3.3 Build Frontend
```bash
cd apps/frontend
npm run build
```

#### 3.4 Deploy Frontend to Firebase Hosting
```bash
cd /workspaces/GauntletWeek1
firebase deploy --only hosting
```

#### Or Deploy Everything at Once
```bash
cd /workspaces/GauntletWeek1
firebase deploy
```

---

### Step 4: Configure Authorized Domains

1. Go to **Firebase Console → Authentication → Settings**
2. Under "Authorized domains", add:
   - `whiteboard-collab-98431547.web.app`
   - `whiteboard-collab-98431547.firebaseapp.com`
   - Any custom domains you plan to use

---

### Step 5: Test the Deployment

1. Your app will be deployed at:
   - Primary: `https://whiteboard-collab-98431547.web.app`
   - Alt: `https://whiteboard-collab-98431547.firebaseapp.com`

2. Test the following:
   - ✅ Google OAuth login works
   - ✅ Board creation persists after refresh
   - ✅ Open 2 browser tabs (incognito + regular)
   - ✅ Create objects in one → appears in other
   - ✅ Cursor movements sync between users
   - ✅ Presence list shows online users
   - ✅ Text editing syncs in real-time
   - ✅ Object deletion syncs across users

---

## 🚀 Local Development

To run the app locally with Firebase:

### Start Frontend Only
```bash
cd apps/frontend
npm run dev
```

This will use the production Firebase services (Authentication, Firestore, Realtime DB, Functions).

### Use Firebase Emulators (Optional)
If you want to test locally without using production Firebase:

```bash
# Install emulators
firebase init emulators

# Start emulators
firebase emulators:start

# Uncomment emulator connection code in apps/frontend/src/services/firebase.ts
```

---

## 📊 Firebase Architecture

### Firestore Database (Persistent Metadata)
```
users/{userId}
  - email, name, avatar, createdAt
  - preferences: { cursorColor }

boards/{boardId}
  - name, ownerId, collaborators[], createdAt, updatedAt, isPublic
```

### Realtime Database (Real-Time Collaboration)
```
boards/{boardId}/
  objects/{objectId}      - Board objects (sticky notes, shapes, etc.)
  cursors/{userId}        - User cursor positions (30Hz updates)
  presence/{userId}       - User online/offline status
```

### Cloud Functions (Serverless API)
- `createBoard` - POST /createBoard
- `getBoard` - GET /getBoard?id={boardId}
- `updateBoard` - PUT /updateBoard
- `deleteBoard` - DELETE /deleteBoard?id={boardId}
- `listBoards` - GET /listBoards

---

## 🔐 Security

### Firestore Rules
- Users can only write to their own profile
- Board access: owner, collaborators, or public boards only
- Only owners can update/delete boards

### Realtime Database Rules
- Authenticated users can read all boards
- Users can only write to their own cursor and presence
- Object writes require authentication

---

## 💰 Cost Estimate

For **100 daily active users**:
- Firestore: ~$1/month
- Realtime Database: ~$6/month
- Cloud Functions: ~$0 (within free tier)
- Hosting: $0 (within free tier)
- Authentication: $0 (within free tier)

**Total: ~$7-10/month**

---

## ⚠️ Important Notes

1. **No Backend Server Needed**: The Express backend (`apps/backend`) is no longer used and can be removed
2. **Authentication**: Users must sign in with Google - no mock auth
3. **Persistence**: All data persists across sessions via Firestore and Realtime DB
4. **Real-Time**: Uses Firebase Realtime Database for instant collaboration
5. **Scalability**: Firebase auto-scales to handle traffic spikes

---

## 🐛 Troubleshooting

### "Failed to authenticate" Error
- Run `firebase login` to authenticate
- Or set `FIREBASE_TOKEN` environment variable

### "Permission denied" on Realtime Database
- Deploy security rules: `firebase deploy --only database`
- Ensure user is authenticated

### "Function not found" Error
- Deploy functions: `firebase deploy --only functions`
- Wait 2-3 minutes for functions to propagate

### Google Sign-In Popup Blocked
- Allow popups for the Firebase domain
- Add domain to authorized domains in Firebase Console

### CORS Errors with Functions
- Functions have `cors: true` enabled
- Check browser console for specific CORS error

---

## 📝 Next Development Steps

After deployment, you can enhance the app with:

1. **Board Sharing**: Implement collaborator invites
2. **Board List Page**: Show user's boards
3. **Real-Time AI**: Integrate AI commands with Firebase Functions
4. **Export/Import**: Download boards as JSON/images
5. **Templates**: Pre-built board templates
6. **Comments**: Add threaded comments to objects
7. **Version History**: Track object changes over time

---

## 🎉 Congratulations!

Your collaborative whiteboard is now powered by Firebase and ready for production use! 🚀

**Live URL (after deployment):**
- https://whiteboard-collab-98431547.web.app

**Firebase Console:**
- https://console.firebase.google.com/project/whiteboard-collab-98431547
