/**
 * Headlines Routes
 * API for accessing news headlines
 */

import express from 'express';
import { query } from '../db.js';

const router = express.Router();

/**
 * GET /api/headlines?status=fresh&taskId=1&limit=20&offset=0
 * List headlines with filters
 */
router.get('/', async (req, res) => {
    try {
        const { status, taskId, limit = 20, offset = 0 } = req.query;

        // Build query dynamically
        const conditions = [];
        const values = [];
        let paramCount = 1;

        if (status) {
            conditions.push(`status = $${paramCount++}`);
            values.push(status);
        }

        if (taskId) {
            conditions.push(`task_id = $${paramCount++}`);
            values.push(parseInt(taskId));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        
        values.push(parseInt(limit));
        values.push(parseInt(offset));

        const result = await query(
            `SELECT h.*, t.name as task_name
            FROM app_news_headlines h
            LEFT JOIN app_search_tasks t ON h.task_id = t.id
            ${whereClause}
            ORDER BY h.created_at DESC
            LIMIT $${paramCount++} OFFSET $${paramCount++}`,
            values
        );

        // Get total count
        const countResult = await query(
            `SELECT COUNT(*) as total FROM app_news_headlines h ${whereClause}`,
            values.slice(0, -2)
        );

        res.json({
            success: true,
            headlines: result.rows,
            total: parseInt(countResult.rows[0].total),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('List headlines error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
