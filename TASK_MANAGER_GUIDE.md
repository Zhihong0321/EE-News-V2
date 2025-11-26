# Task Manager Guide

## Access the Task Manager

Navigate to: **http://localhost:3000/manage-task** (or your deployed URL)

Or click the **Tasks** button in the bottom navigation bar.

## Features

### 1. Create New Task
- Click "+ New Task" button
- Fill in:
  - **Task Name**: Descriptive name (e.g., "Daily Tech News")
  - **Search Query**: What to search for (e.g., "latest technology news")
  - **GEMS URL**: Optional custom GEMS URL (leave empty for default)
  - **Schedule Time**: When to run automatically (e.g., "08:00")
  - **Active**: Toggle to enable/disable the task

### 2. Edit Task
- Click "✎ Edit" button on any task
- Modify fields and click "Update Task"

### 3. Delete Task
- Click "🗑 Delete" button
- Confirm deletion (this will also delete all associated headlines)

### 4. Manual Run with Debug Logging
- Click "▶ Run Now" button
- Watch the **Execution Log** section for real-time progress:
  - **Blue**: Info messages (steps being executed)
  - **Green**: Success messages (completed operations)
  - **Orange**: Warnings (partial failures)
  - **Red**: Errors (failures with details)

The log shows:
- Step 1: Fetching headlines
- Number of headlines fetched
- Number of articles processed
- Individual headline processing results
- Any errors encountered

## Database Safety

✅ **Your database is SAFE on Railway deployment**

The initialization script uses `CREATE TABLE IF NOT EXISTS`, which means:
- Tables are only created if they don't exist
- Existing data is NEVER deleted
- No DROP statements anywhere in the code

## API Endpoints

- `GET /api/tasks` - List all tasks
- `POST /api/tasks` - Create new task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task
- `POST /api/cron/manual-run` - Manual execution with detailed logging

## Navigation

- **Home** → News feed
- **Tasks** → Task management page
- **← Back to News** → Return to news feed from task manager
