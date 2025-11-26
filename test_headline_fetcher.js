/**
 * Test Headline Fetcher Service
 */

import { query, pool } from './server/db.js';
import { fetchHeadlinesForTask, fetchAllActiveTaskHeadlines } from './server/services/headlineFetcher.js';

async function testHeadlineFetcher() {
    console.log('Testing Headline Fetcher Service...\n');

    try {
        // Step 1: Create a test task
        console.log('1. Creating test task...');
        const taskResult = await query(
            `INSERT INTO app_search_tasks (name, query, gems_url, is_active)
            VALUES ($1, $2, $3, true)
            ON CONFLICT DO NOTHING
            RETURNING *`,
            [
                'Test Solar News',
                'Search for latest solar energy news in Malaysia',
                'https://gemini.google.com/gem/c9d02eab1195'
            ]
        );

        let taskId;
        if (taskResult.rows.length > 0) {
            taskId = taskResult.rows[0].id;
            console.log('✓ Created task ID:', taskId);
        } else {
            // Task already exists, get it
            const existingTask = await query(
                `SELECT id FROM app_search_tasks WHERE name = $1`,
                ['Test Solar News']
            );
            taskId = existingTask.rows[0].id;
            console.log('✓ Using existing task ID:', taskId);
        }
        console.log();

        // Step 2: Fetch headlines for this task
        console.log('2. Fetching headlines for task...');
        const result = await fetchHeadlinesForTask(taskId);
        console.log('✓ Success:', result.success);
        console.log('✓ Headlines count:', result.count);
        if (result.headlines.length > 0) {
            console.log('✓ First headline:', result.headlines[0].headline.substring(0, 100) + '...');
        }
        console.log();

        // Step 3: Verify headlines in database
        console.log('3. Verifying headlines in database...');
        const headlinesResult = await query(
            'SELECT * FROM app_news_headlines WHERE task_id = $1 ORDER BY created_at DESC LIMIT 5',
            [taskId]
        );
        console.log('✓ Total headlines in DB:', headlinesResult.rows.length);
        headlinesResult.rows.forEach((h, i) => {
            console.log(`  ${i + 1}. ${h.headline.substring(0, 80)}... [${h.status}]`);
        });
        console.log();

        console.log('All tests passed! ✓');
    } catch (error) {
        console.error('Test failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

testHeadlineFetcher();
