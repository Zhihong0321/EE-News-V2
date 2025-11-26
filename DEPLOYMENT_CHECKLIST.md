# EE-NewsSearch Deployment Checklist

## Pre-Deployment Checklist

### ✅ Code Preparation
- [x] Frontend built successfully (`npm run build`)
- [x] Server code converted to ESM modules
- [x] Database connection configured with SSL support
- [x] Environment variables documented (`.env.example`)
- [x] Dockerfile created and optimized
- [x] Railway configuration file created (`railway.json`)

### ✅ Database Safety
- [x] Schema uses `CREATE TABLE IF NOT EXISTS`
- [x] No DROP, TRUNCATE, or DELETE statements
- [x] Tables namespaced with `app_` prefix
- [x] Safe initialization script created
- [x] Safety documentation created (`DATABASE_SAFETY.md`)

### ✅ Railway Configuration
- [ ] Create new Railway project
- [ ] Link to GitHub repository (or deploy via CLI)
- [ ] Set environment variables:
  - [ ] `NODE_ENV=production`
  - [ ] `DATABASE_URL=<your_postgres_connection_string>`
- [ ] Verify Dockerfile is detected
- [ ] Monitor first deployment logs

## Deployment Steps

### 1. Push to GitHub
```bash
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

### 2. Deploy to Railway

**Option A: GitHub Integration**
1. Go to [railway.app](https://railway.app)
2. Create new project → Deploy from GitHub
3. Select your repository
4. Add environment variables
5. Deploy

**Option B: Railway CLI**
```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

### 3. Configure Environment Variables

In Railway dashboard, add:
```
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:port/database
```

### 4. Monitor Deployment

Watch for:
- ✅ Docker build success
- ✅ `npm run build` completes
- ✅ Database initialization logs: "Database initialization completed successfully"
- ✅ Server starts: "Server is running on port XXXX"

### 5. Verify Deployment

Test these endpoints:
- `https://your-app.up.railway.app/` → Frontend loads
- `https://your-app.up.railway.app/api/health` → Returns `{"status":"ok"}`

## Post-Deployment

### Verify Database Tables Created
Connect to your Postgres and verify:
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_name LIKE 'app_%';
```

Should return:
- `app_news_searches`
- `app_news_articles`

### Test API Endpoints
```bash
curl https://your-app.up.railway.app/api/health
curl https://your-app.up.railway.app/api/searches
```

## Troubleshooting

### Build Fails
- Check Railway logs for specific error
- Verify all dependencies in `package.json`
- Ensure Dockerfile syntax is correct

### Database Connection Fails
- Verify `DATABASE_URL` is correct
- Check SSL settings (should be enabled for Railway Postgres)
- Ensure database user has CREATE TABLE permissions

### Server Won't Start
- Check Railway logs for port binding issues
- Verify `npm start` works locally
- Ensure `PORT` environment variable is not hardcoded

## Next Steps After Deployment

1. ✅ Verify deployment is stable
2. 🔄 Implement news fetching from Gemini API
3. 🔄 Add news search functionality
4. 🔄 Connect frontend to backend API
5. 🔄 Add error handling and logging
6. 🔄 Set up monitoring and alerts

## Rollback Plan

If deployment fails:
1. Check Railway logs for errors
2. Roll back to previous deployment in Railway dashboard
3. Fix issues locally and redeploy

To remove app tables from database:
```sql
DROP TABLE IF EXISTS app_news_articles;
DROP TABLE IF EXISTS app_news_searches;
```

---

**Status**: Ready for Railway deployment ✅
