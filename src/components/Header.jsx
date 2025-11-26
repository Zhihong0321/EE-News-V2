import React from 'react';
import './Header.css';

const tags = ['All', 'Solar', 'Energy', 'Malaysia', 'Technology', 'Business'];

const Header = ({ activeTag, setActiveTag, language, setLanguage }) => {
    return (
        <header className="header">
            <div className="header-top container">
                <h1 className="site-title">News</h1>
                <div className="language-selector">
                    <select 
                        value={language} 
                        onChange={(e) => setLanguage(e.target.value)}
                        style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            fontSize: '14px',
                            cursor: 'pointer'
                        }}
                    >
                        <option value="en">EN</option>
                        <option value="zh">中文</option>
                        <option value="ms">BM</option>
                    </select>
                </div>
            </div>
            <div className="tags-scroll-container no-scrollbar">
                <div className="tags-wrapper">
                    {tags.map((tag) => (
                        <button
                            key={tag}
                            className={`tag-chip ${activeTag === tag ? 'active' : ''}`}
                            onClick={() => setActiveTag(tag)}
                        >
                            {tag}
                        </button>
                    ))}
                </div>
            </div>
        </header>
    );
};

export default Header;
