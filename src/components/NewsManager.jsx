import React, { useState, useEffect } from 'react';
import './NewsManager.css';

function NewsManager() {
  const [view, setView] = useState('headlines'); // headlines or articles
  const [headlines, setHeadlines] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({});
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [articleLoading, setArticleLoading] = useState(false);

  useEffect(() => {
    fetchStats();
    if (view === 'headlines') {
      fetchHeadlines();
    } else {
      fetchArticles();
    }
  }, [view]);

  const fetchStats = async () => {
    try {
      const [headlinesRes, articlesRes] = await Promise.all([
        fetch('/api/headlines?limit=1'),
        fetch('/api/articles?limit=1')
      ]);
      const headlinesData = await headlinesRes.json();
      const articlesData = await articlesRes.json();
      
      setStats({
        totalHeadlines: headlinesData.total || 0,
        totalArticles: articlesData.total || 0
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchHeadlines = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/headlines?limit=100');
      const data = await response.json();
      if (data.success) {
        setHeadlines(data.headlines);
      }
    } catch (error) {
      console.error('Error fetching headlines:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchArticles = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/articles?limit=100');
      const data = await response.json();
      if (data.success) {
        setArticles(data.articles);
      }
    } catch (error) {
      console.error('Error fetching articles:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'fresh': return '#2196F3';
      case 'processing': return '#FF9800';
      case 'completed': return '#4CAF50';
      case 'failed': return '#F44336';
      default: return '#999';
    }
  };

  const openArticle = async (articleId) => {
    setArticleLoading(true);
    try {
      const response = await fetch(`/api/articles/${articleId}?lang=en`);
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

  const closeArticle = () => {
    setSelectedArticle(null);
  };

  return (
    <div className="news-manager">
      <div className="news-header">
        <h1>News Database</h1>
        <div className="stats">
          <div className="stat-card">
            <div className="stat-number">{stats.totalHeadlines || 0}</div>
            <div className="stat-label">Headlines</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.totalArticles || 0}</div>
            <div className="stat-label">Articles</div>
          </div>
        </div>
      </div>

      <div className="view-tabs">
        <button 
          className={view === 'headlines' ? 'active' : ''}
          onClick={() => setView('headlines')}
        >
          Headlines ({stats.totalHeadlines || 0})
        </button>
        <button 
          className={view === 'articles' ? 'active' : ''}
          onClick={() => setView('articles')}
        >
          Articles ({stats.totalArticles || 0})
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <>
          {view === 'headlines' && (
            <div className="headlines-list">
              {headlines.length === 0 ? (
                <div className="empty">No headlines yet. Run a task to fetch headlines.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Headline</th>
                      <th>Task</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headlines.map(h => (
                      <tr key={h.id}>
                        <td>{h.id}</td>
                        <td className="headline-text">{h.headline}</td>
                        <td>{h.task_name}</td>
                        <td>
                          <span 
                            className="status-badge" 
                            style={{ backgroundColor: getStatusColor(h.status) }}
                          >
                            {h.status}
                          </span>
                        </td>
                        <td>{h.news_date}</td>
                        <td>{new Date(h.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {view === 'articles' && (
            <div className="articles-list">
              {articles.length === 0 ? (
                <div className="empty">No articles yet. Headlines need to be processed by the rewriter.</div>
              ) : (
                <div className="articles-grid">
                  {articles.map(article => (
                    <div 
                      key={article.id} 
                      className="article-card"
                      onClick={() => openArticle(article.id)}
                    >
                      <h3>{article.title}</h3>
                      <div className="article-meta">
                        <span>Original: {article.original_headline}</span>
                        <span>{new Date(article.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="article-summary">{article.summary}</p>
                      <div className="article-tags">
                        {article.tags?.map((tag, idx) => (
                          <span key={idx} className="tag">{tag}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {selectedArticle && (
        <div className="article-modal" onClick={closeArticle}>
          <div className="article-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-button" onClick={closeArticle}>×</button>
            {articleLoading ? (
              <div className="loading">Loading article...</div>
            ) : (
              <>
                <h1>{selectedArticle.title}</h1>
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NewsManager;
