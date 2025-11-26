/**
 * Articles Routes
 * API for accessing completed news articles
 */

import express from 'express';
import { query } from '../db.js';

const router = express.Router();

/**
 * GET /api/articles?lang=en&limit=20&offset=0
 * List articles with language selection
 */
router.get('/', async (req, res) => {
    try {
        const { lang = 'en', limit = 20, offset = 0 } = req.query;

        // Validate language
        const validLangs = ['en', 'zh', 'ms'];
        if (!validLangs.includes(lang)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid language. Use: en, zh, or ms' 
            });
        }

        // Select fields based on language
        const titleField = `title_${lang}`;
        const contentField = `content_${lang}`;
        const summaryField = `summary_${lang}`;

        const result = await query(
            `SELECT 
                a.id,
                a.${titleField} as title,
                a.${contentField} as content,
                a.${summaryField} as summary,
                a.tags,
                a.created_at,
                h.headline as original_headline,
                h.news_date,
                h.source
            FROM app_news_articles a
            JOIN app_news_headlines h ON a.headline_id = h.id
            ORDER BY a.created_at DESC
            LIMIT $1 OFFSET $2`,
            [parseInt(limit), parseInt(offset)]
        );

        // Get total count
        const countResult = await query('SELECT COUNT(*) as total FROM app_news_articles');

        res.json({
            success: true,
            articles: result.rows,
            language: lang,
            total: parseInt(countResult.rows[0].total),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('List articles error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/articles/:id?lang=en
 * Get a single article by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const articleId = parseInt(req.params.id);
        if (isNaN(articleId)) {
            return res.status(400).json({ success: false, error: 'Invalid article ID' });
        }

        const { lang = 'en' } = req.query;

        // Validate language
        const validLangs = ['en', 'zh', 'ms'];
        if (!validLangs.includes(lang)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid language. Use: en, zh, or ms' 
            });
        }

        // Select fields based on language
        const titleField = `title_${lang}`;
        const contentField = `content_${lang}`;
        const summaryField = `summary_${lang}`;

        const result = await query(
            `SELECT 
                a.id,
                a.${titleField} as title,
                a.${contentField} as content,
                a.${summaryField} as summary,
                a.tags,
                a.created_at,
                h.headline as original_headline,
                h.news_date,
                h.source,
                h.search_query
            FROM app_news_articles a
            JOIN app_news_headlines h ON a.headline_id = h.id
            WHERE a.id = $1`,
            [articleId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Article not found' });
        }

        res.json({
            success: true,
            article: result.rows[0],
            language: lang
        });
    } catch (error) {
        console.error('Get article error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
