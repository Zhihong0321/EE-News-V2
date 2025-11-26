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

/**
 * POST /api/cron/manual-run
 * Manual task execution with detailed logging
 * Body: { taskId: number }
 */
router.post('/manual-run', async (req, res) => {
    try {
        const { taskId } = req.body;
        if (!taskId) {
            return res.status(400).json({ success: false, error: 'taskId is required' });
        }

        const details = [];
        
        // Step 1: Fetch headlines
        const fetchResult = await fetchHeadlinesForTask(taskId);
        if (!fetchResult.success) {
            return res.json({
                success: false,
                error: fetchResult.error,
                details: [{ step: 'fetch', error: fetchResult.error }]
            });
        }

        const headlinesFetched = fetchResult.headlines_fetched || 0;
        
        // Step 2: Process headlines
        const processResult = await processNextHeadlines(10, taskId);
        
        // Collect detailed results
        if (processResult.results) {
            processResult.results.forEach(result => {
                details.push({
                    headline: result.headline,
                    status: result.status,
                    error: result.error || null
                });
            });
        }

        res.json({
            success: true,
            stats: {
                headlines_fetched: headlinesFetched,
                articles_processed: processResult.processed || 0
            },
            details
        });
    } catch (error) {
        console.error('Manual run error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: [{ step: 'execution', error: error.message }]
        });
    }
});

export default router;
