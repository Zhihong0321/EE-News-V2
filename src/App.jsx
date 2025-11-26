import React, { useState, useEffect } from 'react';
import './App.css';
import Header from './components/Header';
import NewsItem from './components/NewsItem';
import BottomBar from './components/BottomBar';
import TaskManager from './components/TaskManager';
import NewsManager from './components/NewsManager';

function App() {
  const [currentPage, setCurrentPage] = useState('news');
  const [activeTag, setActiveTag] = useState('All');
  const [isDark, setIsDark] = useState(false);
  const [language, setLanguage] = useState('en');
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [articleLoading, setArticleLoading] = useState(false);

  // Handle routing and browser back button
  useEffect(() => {
    const handleRoute = () => {
      const path = window.location.pathname;
      const articleMatch = path.match(/^\/article\/(\d+)$/);
      
      if (articleMatch) {
        const articleId = parseInt(articleMatch[1]);
        setCurrentPage('article');
        openArticle(articleId);
      } else if (path === '/manage-task') {
        setCurrentPage('tasks');
      } else if (path === '/news-database') {
        setCurrentPage('database');
      } else {
        setCurrentPage('news');
        setSelectedArticle(null);
      }
    };

    handleRoute();
    window.addEventListener('popstate', handleRoute);
    return () => window.removeEventListener('popstate', handleRoute);
  }, [language]);

  const navigateTo = (page) => {
    setCurrentPage(page);
    const paths = {
      'tasks': '/manage-task',
      'database': '/news-database',
      'news': '/'
    };
    window.history.pushState({}, '', paths[page] || '/');
  };

  // Initialize theme
  useEffect(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDark(prefersDark);
    if (prefersDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  // Fetch articles from API
  useEffect(() => {
    const fetchArticles = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/articles?lang=${language}&limit=50`);
        if (!response.ok) {
          throw new Error('Failed to fetch articles');
        }
        const data = await response.json();
        
        // Transform API data to match NewsItem component format
        const transformedArticles = data.articles.map(article => ({
          id: article.id,
          title: article.title,
          content: article.summary || article.content?.substring(0, 200) + '...',
          date: article.news_date || new Date(article.created_at).toLocaleDateString(),
          tags: article.tags || [],
          source: article.source
        }));
        
        setArticles(transformedArticles);
      } catch (err) {
        console.error('Error fetching articles:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchArticles();
  }, [language]);

  const toggleTheme = () => {
    setIsDark(!isDark);
    if (!isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  };

  const filteredNews = activeTag === 'All'
    ? articles
    : articles.filter(item => item.tags.includes(activeTag));

  const openArticle = async (articleId) => {
    setCurrentPage('article');
    setArticleLoading(true);
    window.history.pushState({}, '', `/article/${articleId}`);
    
    try {
      const response = await fetch(`/api/articles/${articleId}?lang=${language}`);
      const data = await response.json();
      if (data.success) {
        setSelectedArticle(data.article);
      }
    } catch (error) {
      console.error('Error fetching article:', error);
    } finally {
      setArticleLoading(false);
    }
  };

  const goBackToNews = () => {
    setCurrentPage('news');
    setSelectedArticle(null);
    window.history.pushState({}, '', '/');
  };

  return (
    <div className="app">
      {currentPage === 'news' && (
        <>
          <Header 
            activeTag={activeTag} 
            setActiveTag={setActiveTag}
            language={language}
            setLanguage={setLanguage}
          />

          <main className="container" style={{ paddingTop: '16px' }}>
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading articles...
              </div>
            ) : error ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Error: {error}
              </div>
            ) : filteredNews.length > 0 ? (
              filteredNews.map(news => (
                <NewsItem key={news.id} news={news} onClick={() => openArticle(news.id)} />
              ))
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No news found for this category.
              </div>
            )}
          </main>

          <BottomBar 
            toggleTheme={toggleTheme} 
            isDark={isDark} 
            navigateTo={navigateTo}
            currentPage={currentPage}
          />
        </>
      )}

      {currentPage === 'article' && (
        <>
          <div className="article-page">
            {articleLoading ? (
              <div className="loading-page">Loading article...</div>
            ) : selectedArticle ? (
              <>
                <h1 className="article-title">{selectedArticle.title}</h1>
                <div className="article-meta-full">
                  <span className="source">{selectedArticle.source}</span>
                  <span className="date">{new Date(selectedArticle.news_date).toLocaleDateString()}</span>
                </div>
                <div className="article-tags">
                  {selectedArticle.tags?.map((tag, idx) => (
                    <span key={idx} className="tag">{tag}</span>
                  ))}
                </div>
                <div className="article-content">
                  {selectedArticle.content}
                </div>
                <div className="article-footer">
                  <small>Original: {selectedArticle.original_headline}</small>
                </div>
              </>
            ) : (
              <div className="loading-page">Article not found</div>
            )}
          </div>
          <BottomBar 
            toggleTheme={toggleTheme} 
            isDark={isDark} 
            navigateTo={navigateTo}
            currentPage={currentPage}
            goBack={goBackToNews}
          />
        </>
      )}

      {currentPage === 'tasks' && (
        <>
          <div style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
            <button 
              onClick={() => navigateTo('news')}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: 'var(--primary-color)', 
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              ← Back to News
            </button>
          </div>
          <TaskManager />
        </>
      )}

      {currentPage === 'database' && (
        <>
          <div style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
            <button 
              onClick={() => navigateTo('news')}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: 'var(--primary-color)', 
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              ← Back to News
            </button>
          </div>
          <NewsManager />
        </>
      )}
    </div>
  );
}

export default App;
