-- SAFE INITIALIZATION SCRIPT
-- This script only creates tables if they do not exist.
-- It will NEVER drop existing tables or delete data.

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
