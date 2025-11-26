import React from 'react';
import './NewsItem.css';

const NewsItem = ({ news, onClick }) => {
    return (
        <article className="news-item" onClick={onClick}>
            <div className="news-meta">
                <span className="news-date">{news.date}</span>
                <span className="news-dot">·</span>
                <span className="news-tags">{news.tags[0]}</span>
            </div>
            <h2 className="news-title">{news.title}</h2>
            <p className="news-content">{news.content}</p>
            <div className="news-actions">
                <button className="action-btn" aria-label="Comment">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                    <span className="action-count">12</span>
                </button>
                <button className="action-btn" aria-label="Share">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
                </button>
                <button className="action-btn" aria-label="Bookmark">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
                </button>
            </div>
        </article>
    );
};

export default NewsItem;
