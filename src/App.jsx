import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import NewsItem from './components/NewsItem';
import BottomBar from './components/BottomBar';

function App() {
  const [activeTag, setActiveTag] = useState('All');
  const [isDark, setIsDark] = useState(false);
  const [language, setLanguage] = useState('en');
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  return (
    <div className="app">
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
            <NewsItem key={news.id} news={news} />
          ))
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No news found for this category.
          </div>
        )}
      </main>

      <BottomBar toggleTheme={toggleTheme} isDark={isDark} />
    </div>
  );
}

export default App;
