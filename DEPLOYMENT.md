# Deployment Guide

## Quick Deploy Options

### Option A: Render.com (Recommended - Free Tier)

#### Backend Deployment
1. Go to [Render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name:** whiteboard-backend
   - **Root Directory:** `apps/backend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Add environment variables:
   ```
   PORT=10000
   FRONTEND_URL=<your-frontend-url>
   JWT_SECRET=<generate-32-char-secret>
   NODE_ENV=production
   ```
6. Click "Create Web Service"
7. Wait for deployment (5-10 minutes)
8. Copy the backend URL (e.g., `https://whiteboard-backend.onrender.com`)

#### Frontend Deployment
1. Click "New +" → "Static Site"
2. Connect your GitHub repository
3. Configure:
   - **Name:** whiteboard-frontend
   - **Root Directory:** `apps/frontend`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
4. Add environment variable:
   ```
   VITE_API_URL=<your-backend-url>
   ```
5. Click "Create Static Site"
6. Wait for deployment
7. Your app is live! 🎉

### Option B: Railway.app (Faster, Also Free)

#### Backend Deployment
1. Go to [Railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Add "New Service" → Select "apps/backend"
5. In Settings:
   - **Root Directory:** `apps/backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm run dev`
6. In Variables tab, add:
   ```
   PORT=3000
   FRONTEND_URL=<your-frontend-url>
   JWT_SECRET=<generate-32-char-secret>
   NODE_ENV=production
   ```
7. Railway will auto-deploy
8. Copy the public URL

#### Frontend Deployment (Vercel)
1. Go to [Vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your GitHub repository
4. Configure:
   - **Framework Preset:** Vite
   - **Root Directory:** `apps/frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Add environment variable:
   ```
   VITE_API_URL=<your-railway-backend-url>
   ```
6. Click "Deploy"
7. Your app is live! 🎉

### Option C: Full Manual Setup

#### Prerequisites
- A server with Node.js 20+ (AWS EC2, DigitalOcean, etc.)
- Domain name (optional but recommended)

#### Backend Setup
```bash
# SSH into your server
ssh user@your-server

# Clone repository
git clone <your-repo-url>
cd whiteboard-ai/apps/backend

# Install dependencies
npm install

# Create .env file
cat > .env <<EOF
PORT=3000
FRONTEND_URL=https://your-frontend-domain.com
JWT_SECRET=$(openssl rand -base64 32)
NODE_ENV=production
EOF

# Build (if you have TypeScript build step)
npm run build

# Install PM2 for process management
npm install -g pm2

# Start backend
pm2 start npm --name "whiteboard-backend" -- start
pm2 save
pm2 startup
```

#### Frontend Setup
```bash
cd ../../apps/frontend

# Create .env
echo "VITE_API_URL=https://your-backend-domain.com" > .env

# Build
npm install
npm run build

# Serve with nginx or any static host
# Copy dist/ folder to your web server
```

## Environment Variables Reference

### Backend (.env)
```bash
# Required
PORT=3000                          # Server port
FRONTEND_URL=http://localhost:5173 # Frontend URL for CORS
JWT_SECRET=your-secret-key         # Min 32 characters
NODE_ENV=production                # production | development

# Optional (for future features)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
REDIS_URL=
REDIS_TOKEN=
ANTHROPIC_API_KEY=
```

### Frontend (.env)
```bash
VITE_API_URL=http://localhost:3000 # Backend URL
```

## Post-Deployment Checklist

- [ ] Backend is accessible at public URL
- [ ] Frontend is accessible at public URL
- [ ] WebSocket connection works (check browser console)
- [ ] CORS is configured correctly
- [ ] Environment variables are set
- [ ] SSL/HTTPS is enabled (recommended)
- [ ] Test login flow
- [ ] Test object creation and sync
- [ ] Test multiplayer cursors
- [ ] Test with 2+ users in different locations

## Troubleshooting

### CORS Errors
Update backend CORS origin to match your frontend URL:
```typescript
// apps/backend/src/server.ts
cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
})
```

### WebSocket Connection Fails
1. Ensure backend supports WebSocket upgrades
2. Check firewall allows WebSocket connections
3. Verify Railway/Render supports WebSocket (they do)
4. Check browser console for connection errors

### "Failed to fetch" errors
1. Verify VITE_API_URL is correct
2. Check backend is running
3. Verify CORS headers
4. Check network tab in DevTools

## Monitoring

### Check Backend Health
```bash
curl https://your-backend-url/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Check WebSocket
```javascript
// In browser console
const socket = io('https://your-backend-url');
socket.on('connect', () => console.log('Connected!'));
```

## Scaling Considerations

For production with many users:

1. **Database:** Replace in-memory storage with Supabase PostgreSQL
2. **Redis:** Add Redis/Upstash for cursor caching
3. **Multiple Instances:** Use sticky sessions for WebSocket
4. **CDN:** Use Cloudflare or similar for frontend assets
5. **Monitoring:** Add Sentry or LogRocket for error tracking

## Cost Estimate (Free Tier)

- **Backend (Render):** Free (512MB RAM, sleeps after 15min inactivity)
- **Frontend (Vercel):** Free (100GB bandwidth)
- **Total:** $0/month

**Note:** Free tier backends sleep after inactivity. First request may take 30s to wake up.

## Production Upgrades

When ready to scale:
- **Render:** $7/month (always-on, 512MB RAM)
- **Railway:** $5/month (always-on, 512MB RAM)
- **Vercel Pro:** $20/month (more bandwidth, faster builds)

---

**Status:** Ready to deploy! 🚀
**Estimated Time:** 15-30 minutes
**Difficulty:** Easy
