# Railway Deployment Guide for EE-NewsSearch

## ✅ Pre-Deployment Checklist

- [ ] Railway account created
- [ ] PostgreSQL database ready (Railway or external)
- [ ] Database connection string available
- [ ] Code pushed to GitHub repository
- [ ] `.env.example` reviewed for required variables

## Prerequisites
1. A Railway account ([railway.app](https://railway.app))
2. An existing PostgreSQL database on Railway (or elsewhere)
3. Your database connection string

## Deployment Steps

### 1. Prepare Your PostgreSQL Database
**IMPORTANT**: This app will create its own tables but will NEVER delete existing data.

The app creates these tables (if they don't exist):
- `app_search_tasks` - User-defined search configurations
- `app_news_headlines` - Raw headlines from searches
- `app_news_articles` - Processed articles with translations

All table names are prefixed with `app_` to avoid conflicts with your existing data.

### 2. Create a New Railway Project

1. Go to [railway.app](https://railway.app) and create a new project
2. Click **"Deploy from GitHub repo"** (or use Railway CLI)
3. Select your repository

### 3. Configure Environment Variables

In Railway, add these environment variables:

```
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:port/database
```

**Getting DATABASE_URL:**
- If you have an existing Railway Postgres service, copy the `DATABASE_URL` from its Variables tab
- If using an external Postgres, use your connection string

### 4. Deploy

Railway will automatically:
1. Detect the `Dockerfile`
2. Build your app using Docker
3. Run `npm run build` to create the production frontend
4. Start the server with `npm start`
5. Initialize the database tables (safely, without deleting data)

### 5. Verify Deployment

Once deployed, Railway will give you a public URL like:
```
https://your-app.up.railway.app
```

Visit these endpoints to verify:
- `https://your-app.up.railway.app/` - Your React frontend (news feed)
- `https://your-app.up.railway.app/manage-task` - Task management page
- `https://your-app.up.railway.app/api/health` - API health check
- `https://your-app.up.railway.app/api/tasks` - Tasks API

## Database Safety Features

✅ **Safe Schema Creation**: Uses `CREATE TABLE IF NOT EXISTS`
✅ **No DROP statements**: The schema never drops tables
✅ **Namespaced Tables**: All tables prefixed with `app_`
✅ **Read-only on existing data**: Only creates new tables, never modifies existing ones

## Local Testing

To test locally before deploying:

1. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

2. Update `DATABASE_URL` in `.env` with your local/test database

3. Build and run:
```bash
npm run build
npm start
```

4. Visit `http://localhost:3000`

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Ensure SSL is enabled for production Postgres (already configured in `server/db.js`)
- Check Railway logs for connection errors

### Build Failures
- Ensure all dependencies are in `package.json`
- Check Railway build logs for specific errors

### Port Issues
- Railway automatically sets the `PORT` environment variable
- The app uses `process.env.PORT || 3000`

## Railway CLI (Optional)

For faster deployments, use Railway CLI:

```bash
npm i -g @railway/cli
railway login
railway link
railway up
```

## Features Available After Deployment

✅ **News Feed** - View processed articles at `/`
✅ **Task Manager** - Create and manage search tasks at `/manage-task`
✅ **Manual Execution** - Run tasks manually with detailed debug logs
✅ **API Endpoints** - Full REST API for tasks, headlines, and articles

## Environment Variables Required

```
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:port/database
GEMINI_API_KEY=your_gemini_api_key (optional, for API access)
```

## Next Steps

After successful deployment:
1. Navigate to `/manage-task` to create your first search task
2. Click "Run Now" to test the task execution
3. View processed articles on the home page
4. Set up cron jobs for automated execution (see CRON_SETUP.md)
