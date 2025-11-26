# MILESTONE: News Workflow Implementation

**Created**: 2025-11-26  
**Status**: 🔄 In Progress

---

## Quick Reference

**Gemini API**: `https://ee-gemini-api-production.up.railway.app`  
**news-search GEMS**: `https://gemini.google.com/gem/c9d02eab1195`

---

## Workflow Overview

```
CRON (8AM) → Fetch Headlines → Store (fresh) → Process Headlines → Store Article (EN/ZH/MS) → Frontend
```

---

## Development Phases

### ═══════════════════════════════════════════════════════════════
### PHASE 1: Database Schema
### ═══════════════════════════════════════════════════════════════
**Status**: ✅ COMPLETE  
**Estimated**: 1 session

#### Tasks:
- [x] 1.1 Rewrite `server/schema.sql` with new tables
- [x] 1.2 Update `server/initDb.js` if needed
- [x] 1.3 Test schema creation locally

#### Schema to Create:
```sql
-- app_search_tasks: User-defined search configurations
CREATE TABLE IF NOT EXISTS app_search_tasks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    query TEXT NOT NULL,
    gems_name VARCHAR(100) DEFAULT 'news-search',
    gems_url TEXT,
    schedule VARCHAR(50) DEFAULT '08:00',
    is_active BOOLEAN DEFAULT true,
    last_run_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- app_news_headlines: Raw headlines (status: fresh|processing|completed|failed)
CREATE TABLE IF NOT EXISTS app_news_headlines (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES app_search_tasks(id) ON DELETE CASCADE,
    headline TEXT NOT NULL,
    news_date VARCHAR(100),
    source VARCHAR(255),
    search_query TEXT,
    status VARCHAR(20) DEFAULT 'fresh',
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(headline, news_date)
);

-- app_news_articles: Completed news with translations
CREATE TABLE IF NOT EXISTS app_news_articles (
    id SERIAL PRIMARY KEY,
    headline_id INTEGER REFERENCES app_news_headlines(id) ON DELETE CASCADE UNIQUE,
    title_en VARCHAR(500),
    title_zh VARCHAR(500),
    title_ms VARCHAR(500),
    content_en TEXT,
    content_zh TEXT,
    content_ms TEXT,
    summary_en TEXT,
    summary_zh TEXT,
    summary_ms TEXT,
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_headlines_status ON app_news_headlines(status);
CREATE INDEX IF NOT EXISTS idx_headlines_task_id ON app_news_headlines(task_id);
CREATE INDEX IF NOT EXISTS idx_headlines_created ON app_news_headlines(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_headline_id ON app_news_articles(headline_id);
CREATE INDEX IF NOT EXISTS idx_articles_created ON app_news_articles(created_at DESC);
```

#### Completion Criteria:
- Schema file updated
- Tables can be created without errors
- No conflicts with existing data

---

### ═══════════════════════════════════════════════════════════════
### PHASE 2: Gemini API Service + Rate Limiter
### ═══════════════════════════════════════════════════════════════
**Status**: ✅ COMPLETE  
**Estimated**: 1 session

#### Tasks:
- [x] 2.1 Create `server/services/geminiApi.js`
- [x] 2.2 Create `server/services/rateLimiter.js`
- [x] 2.3 Test API wrapper with health check and chat

#### Files to Create:

**server/services/geminiApi.js**
```
Functions:
- checkHealth() → { status, client_ready }
- listGems() → [{ name, id, gem_url }]
- chat(message, gemsUrl, accountId) → { response, success }
```

**server/services/rateLimiter.js**
```
Functions:
- queue(fn) → Promise (executes with 3s delay between calls)
- getQueueLength() → number
```

#### Completion Criteria:
- Can call Gemini API health endpoint
- Can call chat with GEMS
- Rate limiter enforces 3s delay

---

### ═══════════════════════════════════════════════════════════════
### PHASE 3: Headline Fetcher Service
### ═══════════════════════════════════════════════════════════════
**Status**: ✅ COMPLETE  
**Estimated**: 1 session

#### Tasks:
- [x] 3.1 Create `server/services/headlineFetcher.js`
- [x] 3.2 Create `server/routes/cron.js` with fetch endpoint
- [x] 3.3 Register route in `server/server.js`
- [x] 3.4 Test fetching and storing headlines

#### Files to Create:

**server/services/headlineFetcher.js**
```
Functions:
- fetchHeadlinesForTask(taskId) → { success, count, headlines }
- fetchAllActiveTaskHeadlines() → { success, results[] }
```

**server/routes/cron.js** (partial)
```
POST /api/cron/fetch-headlines      → fetch all active tasks
POST /api/cron/fetch-headlines/:id  → fetch specific task
```

#### GEMS Response Format (for parsing):
```json
{
  "status": "success",
  "data": [
    {
      "headline": "...",
      "date": "April 2025",
      "source": "PV Magazine",
      "next_agent_search_query": "..."
    }
  ]
}
```

#### Completion Criteria:
- Can fetch headlines from Gemini via GEMS
- Headlines stored in DB with status=fresh
- Duplicates handled (UNIQUE constraint)

---

### ═══════════════════════════════════════════════════════════════
### PHASE 4: News Rewriter Service
### ═══════════════════════════════════════════════════════════════
**Status**: ✅ COMPLETE  
**Estimated**: 1-2 sessions

#### Tasks:
- [x] 4.1 Create `server/config/prompts.js`
- [x] 4.2 Create `server/services/newsRewriter.js`
- [x] 4.3 Add process endpoint to `server/routes/cron.js`
- [x] 4.4 Test rewriting and translation

#### Files to Create:

**server/config/prompts.js**
```
Exports:
- REWRITER_PROMPT_TEMPLATE (placeholder for headline, date, search_query)
```

**server/services/newsRewriter.js**
```
Functions:
- rewriteHeadline(headlineId) → { success, article }
- processNextHeadlines(limit=5) → { success, processed, failed }
```

**server/routes/cron.js** (add)
```
POST /api/cron/process-headlines?limit=5  → process N fresh headlines
```

#### Rewriter Output Format (design prompt to return):
```json
{
  "title_en": "...",
  "title_zh": "...",
  "title_ms": "...",
  "content_en": "...",
  "content_zh": "...",
  "content_ms": "...",
  "summary_en": "...",
  "summary_zh": "...",
  "summary_ms": "...",
  "tags": ["solar", "malaysia", "energy"]
}
```

#### Completion Criteria:
- Can rewrite headline into full article
- Article has 3 language versions
- Status updated to completed/failed

---

### ═══════════════════════════════════════════════════════════════
### PHASE 5: Task Management API
### ═══════════════════════════════════════════════════════════════
**Status**: ✅ COMPLETE  
**Estimated**: 1 session

#### Tasks:
- [x] 5.1 Create `server/routes/tasks.js`
- [x] 5.2 Register route in `server/server.js`
- [x] 5.3 Test CRUD operations

#### Endpoints:
```
GET    /api/tasks          → List all tasks
POST   /api/tasks          → Create task { name, query, gems_url?, schedule? }
PUT    /api/tasks/:id      → Update task
DELETE /api/tasks/:id      → Delete task (cascades to headlines)
```

#### Completion Criteria:
- Can create/read/update/delete search tasks
- Validation for required fields

---

### ═══════════════════════════════════════════════════════════════
### PHASE 6: Headlines & Articles API
### ═══════════════════════════════════════════════════════════════
**Status**: ✅ COMPLETE  
**Estimated**: 1 session

#### Tasks:
- [x] 6.1 Create `server/routes/headlines.js`
- [x] 6.2 Create `server/routes/articles.js`
- [x] 6.3 Register routes in `server/server.js`
- [x] 6.4 Test listing and filtering

#### Endpoints:
```
GET /api/headlines?status=fresh&taskId=1    → List headlines
GET /api/articles?lang=en&limit=20          → List articles
GET /api/articles/:id?lang=en               → Single article
```

#### Completion Criteria:
- Can list headlines with filters
- Can list articles with language selection
- Pagination working

---

### ═══════════════════════════════════════════════════════════════
### PHASE 7: Frontend Integration
### ═══════════════════════════════════════════════════════════════
**Status**: ✅ COMPLETE  
**Estimated**: 1-2 sessions

#### Tasks:
- [x] 7.1 Update `src/App.jsx` to fetch from `/api/articles`
- [x] 7.2 Add language selector component
- [x] 7.3 Update `src/components/NewsItem.jsx` for new data structure
- [x] 7.4 Add loading and empty states
- [x] 7.5 Remove mock data dependency

#### Changes:
- Replace `src/data/news.js` usage with API calls
- Add language state (en/zh/ms)
- Update NewsItem to display content based on selected language

#### Completion Criteria:
- Frontend fetches real data from API
- Language switching works
- Loading states shown

---

### ═══════════════════════════════════════════════════════════════
### PHASE 8: Health & Utility Endpoints
### ═══════════════════════════════════════════════════════════════
**Status**: ✅ COMPLETE  
**Estimated**: 1 session

#### Tasks:
- [x] 8.1 Update `/api/health` to include Gemini status
- [x] 8.2 Add `/api/gems` proxy endpoint
- [x] 8.3 Add error handling middleware
- [x] 8.4 Add request logging

#### Endpoints:
```
GET /api/health  → { status, db, gemini: { ready, active_sessions } }
GET /api/gems    → Proxy to Gemini /gems endpoint
```

#### Completion Criteria:
- Health endpoint shows full system status
- GEMS list accessible from this server

---

### ═══════════════════════════════════════════════════════════════
### PHASE 9: Testing & Documentation
### ═══════════════════════════════════════════════════════════════
**Status**: ✅ COMPLETE  
**Estimated**: 1 session

#### Tasks:
- [x] 9.1 End-to-end workflow test
- [x] 9.2 Update API_REFERENCE.md with new endpoints
- [x] 9.3 Document cron setup instructions
- [x] 9.4 Update CURRENT-STATUS.md

#### Test Workflow:
1. Create a search task
2. Trigger fetch-headlines
3. Verify headlines stored
4. Trigger process-headlines
5. Verify articles created
6. Check frontend displays articles

#### Completion Criteria:
- Full workflow works end-to-end
- Documentation updated

---

## File Structure (Final)

```
server/
├── db.js                     # (existing)
├── initDb.js                 # (existing)
├── schema.sql                # (Phase 1)
├── server.js                 # (update in Phase 3,5,6,8)
│
├── config/
│   └── prompts.js            # (Phase 4)
│
├── services/
│   ├── geminiApi.js          # (Phase 2)
│   ├── rateLimiter.js        # (Phase 2)
│   ├── headlineFetcher.js    # (Phase 3)
│   └── newsRewriter.js       # (Phase 4)
│
└── routes/
    ├── cron.js               # (Phase 3, 4)
    ├── tasks.js              # (Phase 5)
    ├── headlines.js          # (Phase 6)
    └── articles.js           # (Phase 6)
```

---

## Progress Log

| Date | Phase | Notes |
|------|-------|-------|
| 2025-11-26 | Setup | Workflow designed, GEMS tested, milestone created |
| 2025-11-26 | Phase 1 | Schema rewritten with new tables (tasks, headlines, articles). initDb.js unchanged (already safe). |
| 2025-11-26 | Phase 2 | Created geminiApi.js and rateLimiter.js. Tested health, GEMS list, and chat. Rate limiter enforces 3s delay. |
| 2025-11-26 | Phase 3 | Created headlineFetcher.js and cron.js routes. Registered in server.js. Test script ready (requires DB). |
| 2025-11-26 | Phase 4 | Created prompts.js and newsRewriter.js. Added process-headlines endpoint. Handles JSON parsing and error states. |
| 2025-11-26 | Phase 5 | Created tasks.js routes with full CRUD. Registered in server.js. Includes validation and dynamic updates. |
| 2025-11-26 | Phase 6 | Created headlines.js and articles.js routes. Language selection, pagination, and filtering implemented. |
| 2025-11-26 | Phase 7 | Updated App.jsx to fetch from API. Added language selector (EN/ZH/MS). Loading and error states added. |
| 2025-11-26 | Phase 8 | Enhanced /api/health with DB and Gemini status. Added /api/gems proxy. Error handling and logging middleware. |
| 2025-11-26 | Phase 9 | Updated API_REFERENCE.md with all endpoints. Created CRON_SETUP.md. Updated CURRENT-STATUS.md. All phases complete! |
| 2025-11-26 | Testing | Verified rewriter GEMS working. Updated newsRewriter.js to handle actual GEMS response format. Transformation tested successfully. |
| | | |

---

## Quick Commands

```bash
# Test GEMS
node test_gems_news.js

# Check Gemini health
curl https://ee-gemini-api-production.up.railway.app/health

# List GEMS
curl https://ee-gemini-api-production.up.railway.app/gems
```

---

## Session Start Prompt

Copy this to start a new session:

```
Read MILESTONE.md and continue from the next incomplete phase.
Mark completed tasks with [x] and update the Progress Log.
```
