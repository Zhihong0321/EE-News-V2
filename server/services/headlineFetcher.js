/**
 * Headline Fetcher Service
 * Fetches news headlines from Gemini GEMS and stores them in the database
 */

import { query } from '../db.js';
import { chat } from './geminiApi.js';

/**
 * Fetch headlines for a specific search task
 * @param {number} taskId - Task ID
 * @returns {Promise<{success: boolean, count: number, headlines: Array}>}
 */
export async function fetchHeadlinesForTask(taskId) {
    try {
        // Get task details
        const taskResult = await query(
            'SELECT * FROM app_search_tasks WHERE id = $1 AND is_active = true',
            [taskId]
        );

        if (taskResult.rows.length === 0) {
            return { success: false, count: 0, headlines: [], error: 'Task not found or inactive' };
        }

        const task = taskResult.rows[0];
        const gemsUrl = task.gems_url || 'https://gemini.google.com/gem/c9d02eab1195';

        // Call Gemini GEMS with the search query
        const chatResult = await chat(task.query, gemsUrl);

        if (!chatResult.success) {
            return { success: false, count: 0, headlines: [], error: 'Chat failed' };
        }

        // Parse the response - expecting JSON format
        let parsedData;
        try {
            // Try to extract JSON from the response
            const jsonMatch = chatResult.response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsedData = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            console.error('Failed to parse GEMS response:', parseError);
            return { success: false, count: 0, headlines: [], error: 'Failed to parse response' };
        }

        // Extract headlines from parsed data
        const headlinesData = parsedData.data || [];
        const storedHeadlines = [];

        // Store each headline in the database
        for (const item of headlinesData) {
            try {
                const result = await query(
                    `INSERT INTO app_news_headlines 
                    (task_id, headline, news_date, source, search_query, status)
                    VALUES ($1, $2, $3, $4, $5, 'fresh')
                    ON CONFLICT (headline, news_date) DO NOTHING
                    RETURNING *`,
                    [
                        taskId,
                        item.headline,
                        item.date || null,
                        item.source || null,
                        item.next_agent_search_query || task.query
                    ]
                );

                if (result.rows.length > 0) {
                    storedHeadlines.push(result.rows[0]);
                }
            } catch (error) {
                console.error('Failed to store headline:', error);
            }
        }

        // Update task's last_run_at
        await query(
            'UPDATE app_search_tasks SET last_run_at = CURRENT_TIMESTAMP WHERE id = $1',
            [taskId]
        );

        return {
            success: true,
            count: storedHeadlines.length,
            headlines: storedHeadlines
        };
    } catch (error) {
        console.error('fetchHeadlinesForTask error:', error);
        return { success: false, count: 0, headlines: [], error: error.message };
    }
}

/**
 * Fetch headlines for all active tasks
 * @returns {Promise<{success: boolean, results: Array}>}
 */
export async function fetchAllActiveTaskHeadlines() {
    try {
        // Get all active tasks
        const tasksResult = await query(
            'SELECT id FROM app_search_tasks WHERE is_active = true ORDER BY id'
        );

        const results = [];

        for (const task of tasksResult.rows) {
            const result = await fetchHeadlinesForTask(task.id);
            results.push({
                taskId: task.id,
                ...result
            });
        }

        return {
            success: true,
            results
        };
    } catch (error) {
        console.error('fetchAllActiveTaskHeadlines error:', error);
        return { success: false, results: [], error: error.message };
    }
}
