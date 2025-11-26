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

/**
 * PUT /api/articles/:id
 * Update an article
 */
router.put('/:id', async (req, res) => {
    try {
        const articleId = parseInt(req.params.id);
        if (isNaN(articleId)) {
            return res.status(400).json({ success: false, error: 'Invalid article ID' });
        }

        const { title_en, title_zh, title_ms, content_en, content_zh, content_ms, summary_en, summary_zh, summary_ms, tags } = req.body;

        const result = await query(
            `UPDATE app_news_articles 
            SET title_en = COALESCE($1, title_en),
                title_zh = COALESCE($2, title_zh),
                title_ms = COALESCE($3, title_ms),
                content_en = COALESCE($4, content_en),
                content_zh = COALESCE($5, content_zh),
                content_ms = COALESCE($6, content_ms),
                summary_en = COALESCE($7, summary_en),
                summary_zh = COALESCE($8, summary_zh),
                summary_ms = COALESCE($9, summary_ms),
                tags = COALESCE($10, tags)
            WHERE id = $11
            RETURNING *`,
            [title_en, title_zh, title_ms, content_en, content_zh, content_ms, summary_en, summary_zh, summary_ms, tags, articleId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Article not found' });
        }

        res.json({
            success: true,
            article: result.rows[0],
            message: 'Article updated successfully'
        });
    } catch (error) {
        console.error('Update article error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/articles/:id
 * Delete an article
 */
router.delete('/:id', async (req, res) => {
    try {
        const articleId = parseInt(req.params.id);
        if (isNaN(articleId)) {
            return res.status(400).json({ success: false, error: 'Invalid article ID' });
        }

        const result = await query(
            'DELETE FROM app_news_articles WHERE id = $1 RETURNING id',
            [articleId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Article not found' });
        }

        res.json({
            success: true,
            message: 'Article deleted successfully',
            deletedId: articleId
        });
    } catch (error) {
        console.error('Delete article error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
