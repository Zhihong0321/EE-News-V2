# News Workflow API Reference

This document describes the API endpoints for the News Workflow application.

## Base URL
- Development: `http://localhost:3000`
- Production: Your Railway deployment URL

---

## Health & Status

### GET /api/health
Check system health including database and Gemini API status.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2025-11-26T...",
  "db": "ok",
  "gemini": {
    "ready": true,
    "active_sessions": 0
  }
}
```

### GET /api/gems
List available GEMS (Gemini Extensions).

**Response**:
```json
{
  "success": true,
  "gems": [
    {
      "name": "news-search",
      "id": "https://gemini.google.com/gem/c9d02eab1195",
      "gem_id": "",
      "desc": ""
    }
  ]
}
```

---

## Task Management

### GET /api/tasks
List all search tasks.

**Response**:
```json
{
  "success": true,
  "tasks": [
    {
      "id": 1,
      "name": "Solar News Malaysia",
      "query": "Search for latest solar energy news in Malaysia",
      "gems_url": "https://gemini.google.com/gem/c9d02eab1195",
      "schedule": "08:00",
      "is_active": true,
      "last_run_at": "2025-11-26T08:00:00Z",
      "created_at": "2025-11-26T00:00:00Z"
    }
  ]
}
```

### POST /api/tasks
Create a new search task.

**Request Body**:
```json
{
  "name": "Solar News Malaysia",
  "query": "Search for latest solar energy news in Malaysia",
  "gems_url": "https://gemini.google.com/gem/c9d02eab1195",
  "schedule": "08:00"
}
```

### PUT /api/tasks/:id
Update a search task.

**Request Body** (all fields optional):
```json
{
  "name": "Updated Name",
  "query": "Updated query",
  "is_active": false
}
```

### DELETE /api/tasks/:id
Delete a search task (cascades to headlines).

---

## Headlines

### GET /api/headlines
List headlines with filters.

**Query Parameters**:
- `status` - Filter by status (fresh, processing, completed, failed)
- `taskId` - Filter by task ID
- `limit` - Results per page (default: 20)
- `offset` - Pagination offset (default: 0)

**Response**:
```json
{
  "success": true,
  "headlines": [
    {
      "id": 1,
      "task_id": 1,
      "headline": "Malaysia launches new solar initiative",
      "news_date": "April 2025",
      "source": "PV Magazine",
      "status": "completed",
      "created_at": "2025-11-26T..."
    }
  ],
  "total": 50,
  "limit": 20,
  "offset": 0
}
```

---

## Articles

### GET /api/articles
List completed articles with language selection.

**Query Parameters**:
- `lang` - Language (en, zh, ms) - default: en
- `limit` - Results per page (default: 20)
- `offset` - Pagination offset (default: 0)

**Response**:
```json
{
  "success": true,
  "articles": [
    {
      "id": 1,
      "title": "Malaysia Launches New Solar Initiative",
      "content": "Full article content...",
      "summary": "Brief summary...",
      "tags": ["solar", "malaysia", "energy"],
      "created_at": "2025-11-26T...",
      "original_headline": "...",
      "news_date": "April 2025",
      "source": "PV Magazine"
    }
  ],
  "language": "en",
  "total": 50,
  "limit": 20,
  "offset": 0
}
```

### GET /api/articles/:id
Get a single article by ID.

**Query Parameters**:
- `lang` - Language (en, zh, ms) - default: en

---

## Cron Endpoints

### POST /api/cron/fetch-headlines
Fetch headlines for all active tasks.

**Response**:
```json
{
  "success": true,
  "results": [
    {
      "taskId": 1,
      "success": true,
      "count": 5,
      "headlines": [...]
    }
  ]
}
```

### POST /api/cron/fetch-headlines/:id
Fetch headlines for a specific task.

### POST /api/cron/process-headlines?limit=5
Process fresh headlines into articles.

**Query Parameters**:
- `limit` - Number of headlines to process (default: 5)

**Response**:
```json
{
  "success": true,
  "processed": 5,
  "failed": 0,
  "total": 5
}
```

---

## Workflow

1. **Create Task**: `POST /api/tasks`
2. **Fetch Headlines**: `POST /api/cron/fetch-headlines`
3. **Process Headlines**: `POST /api/cron/process-headlines`
4. **View Articles**: `GET /api/articles?lang=en`

---

## External Gemini API

**Base URL**: `https://ee-gemini-api-production.up.railway.app`

### GET /health
Check Gemini API status.

### GET /gems
List available GEMS.

### POST /chat
Send a message to Gemini GEMS.

**Request Body**:
```json
{
  "message": "Your message",
  "gems_url": "https://gemini.google.com/gem/..."
}
```
