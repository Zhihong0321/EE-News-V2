/**
 * Cron Routes
 * Endpoints for scheduled tasks (headline fetching and processing)
 */

import express from 'express';
import { fetchHeadlinesForTask, fetchAllActiveTaskHeadlines } from '../services/headlineFetcher.js';
import { processNextHeadlines } from '../services/newsRewriter.js';

const router = express.Router();

/**
 * POST /api/cron/fetch-headlines
 * Fetch headlines for all active tasks
 */
router.post('/fetch-headlines', async (req, res) => {
    try {
        const result = await fetchAllActiveTaskHeadlines();
        res.json(result);
    } catch (error) {
        console.error('Fetch headlines error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/cron/fetch-headlines/:id
 * Fetch headlines for a specific task
 */
router.post('/fetch-headlines/:id', async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        const result = await fetchHeadlinesForTask(taskId);
        res.json(result);
    } catch (error) {
        console.error('Fetch headlines error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/cron/process-headlines?limit=5
 * Process fresh headlines into articles
 */
router.post('/process-headlines', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;
        const result = await processNextHeadlines(limit);
        res.json(result);
    } catch (error) {
        console.error('Process headlines error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
