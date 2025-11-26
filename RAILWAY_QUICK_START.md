# 🚀 Railway Quick Start

## TL;DR - Deploy in 5 Minutes

### Step 1: Verify Locally ✅
```bash
npm run verify-deploy
```
**Status**: ✅ All checks passed!

### Step 2: Push to GitHub
```bash
git add .
git commit -m "Deploy to Railway"
git push
```

### Step 3: Deploy on Railway

1. Go to [railway.app](https://railway.app)
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your repository
4. Add environment variable:
   ```
   DATABASE_URL=your_postgres_connection_string
   ```
5. Click **"Deploy"**

### Step 4: Test Your Deployment

Visit your Railway URL:
- **News Feed**: `https://your-app.up.railway.app/`
- **Task Manager**: `https://your-app.up.railway.app/manage-task`

---

## What Happens During Deployment

Railway will automatically:
1. ✅ Detect your `Dockerfile`
2. ✅ Install dependencies with `npm ci`
3. ✅ Build frontend with `npm run build`
4. ✅ Start server with `npm start`
5. ✅ Initialize database tables (safely, no data loss)

## Database Safety Guarantee

✅ **Your existing PostgreSQL data is 100% safe**

- Uses `CREATE TABLE IF NOT EXISTS`
- No DROP statements
- Only creates new tables if they don't exist
- Never modifies or deletes existing data

## Environment Variables

Only **1 required** variable:

```
DATABASE_URL=postgresql://user:password@host:port/database
```

Optional:
```
NODE_ENV=production  (Railway sets this automatically)
PORT=3000           (Railway sets this automatically)
```

## Getting Your DATABASE_URL

### If using Railway Postgres:
1. Go to your Postgres service in Railway
2. Click **"Variables"** tab
3. Copy the `DATABASE_URL` value
4. Paste it in your app's environment variables

### If using external Postgres:
Use your connection string format:
```
postgresql://username:password@host:port/database
```

## Post-Deployment Checklist

- [ ] Visit home page - should show news feed
- [ ] Visit `/manage-task` - should show task manager
- [ ] Create a test task
- [ ] Click "Run Now" - should see execution logs
- [ ] Check `/api/health` - should return `{"status":"ok"}`

## Troubleshooting

### "Cannot connect to database"
→ Check `DATABASE_URL` is correct and SSL is enabled

### "404 Not Found" on routes
→ Wait for build to complete, check Railway logs

### "Build failed"
→ Check Railway build logs, verify `npm run build` works locally

## Need Help?

- **Full Guide**: `RAILWAY_DEPLOYMENT.md`
- **Task Manager**: `TASK_MANAGER_GUIDE.md`
- **API Docs**: `API_REFERENCE.md`

---

**Ready to deploy?** Run `npm run verify-deploy` first! ✅
