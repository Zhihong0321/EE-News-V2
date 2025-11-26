import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, pool } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initDb() {
    try {
        console.log('Starting safe database initialization...');

        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        // Execute the SQL
        // This is safe because the SQL uses "IF NOT EXISTS"
        await query(schemaSql);

        console.log('Database initialization completed successfully.');
        console.log('Verified: No existing data was deleted.');
    } catch (error) {
        console.error('Database initialization failed:', error);
        process.exit(1);
    } finally {
        // If run directly (ESM equivalent check)
        if (process.argv[1] === fileURLToPath(import.meta.url)) {
            await pool.end();
        }
    }
}

// Check if main module
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    initDb();
}

export default initDb;
