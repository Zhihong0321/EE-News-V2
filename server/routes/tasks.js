/**
 * Task Management Routes
 * CRUD operations for search tasks
 */

import express from 'express';
import { query } from '../db.js';

const router = express.Router();

/**
 * GET /api/tasks
 * List all search tasks
 */
router.get('/', async (req, res) => {
    try {
        const result = await query(
            'SELECT * FROM app_search_tasks ORDER BY created_at DESC'
        );
        res.json({ success: true, tasks: result.rows });
    } catch (error) {
        console.error('List tasks error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/tasks
 * Create a new search task
 */
router.post('/', async (req, res) => {
    try {
        const { name, query: searchQuery, gems_url, schedule } = req.body;

        // Validation
        if (!name || !searchQuery) {
            return res.status(400).json({ 
                success: false, 
                error: 'Name and query are required' 
            });
        }

        const result = await query(
            `INSERT INTO app_search_tasks (name, query, gems_url, schedule)
            VALUES ($1, $2, $3, $4)
            RETURNING *`,
            [
                name,
                searchQuery,
                gems_url || null,
                schedule || '08:00'
            ]
        );

        res.status(201).json({ success: true, task: result.rows[0] });
    } catch (error) {
        console.error('Create task error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/tasks/:id
 * Update a search task
 */
router.put('/:id', async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        const { name, query: searchQuery, gems_url, schedule, is_active } = req.body;

        // Build update query dynamically
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramCount++}`);
            values.push(name);
        }
        if (searchQuery !== undefined) {
            updates.push(`query = $${paramCount++}`);
            values.push(searchQuery);
        }
        if (gems_url !== undefined) {
            updates.push(`gems_url = $${paramCount++}`);
            values.push(gems_url);
        }
        if (schedule !== undefined) {
            updates.push(`schedule = $${paramCount++}`);
            values.push(schedule);
        }
        if (is_active !== undefined) {
            updates.push(`is_active = $${paramCount++}`);
            values.push(is_active);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(taskId);

        const result = await query(
            `UPDATE app_search_tasks 
            SET ${updates.join(', ')}
            WHERE id = $${paramCount}
            RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        res.json({ success: true, task: result.rows[0] });
    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/tasks/:id
 * Delete a search task (cascades to headlines)
 */
router.delete('/:id', async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        const result = await query(
            'DELETE FROM app_search_tasks WHERE id = $1 RETURNING *',
            [taskId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        res.json({ success: true, message: 'Task deleted', task: result.rows[0] });
    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
