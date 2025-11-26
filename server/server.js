import express from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import initDb from './initDb.js';
import { query } from './db.js';
import cronRoutes from './routes/cron.js';
import tasksRoutes from './routes/tasks.js';
import headlinesRoutes from './routes/headlines.js';
import articlesRoutes from './routes/articles.js';
import { checkHealth as checkGeminiHealth, listGems } from './services/geminiApi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// Serve static files from the React app build directory
// In production (Railway), this will be 'dist' in the root
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// API Routes
app.get('/api/health', async (req, res) => {
    try {
        // Check database
        let dbStatus = 'ok';
        try {
            await query('SELECT 1');
        } catch (err) {
            dbStatus = 'error';
        }

        // Check Gemini API
        let geminiStatus = { ready: false, active_sessions: 0 };
        try {
            const geminiHealth = await checkGeminiHealth();
            geminiStatus = {
                ready: geminiHealth.client_ready || false,
                active_sessions: geminiHealth.active_sessions || 0
            };
        } catch (err) {
            console.error('Gemini health check failed:', err);
        }

        res.json({
            status: dbStatus === 'ok' ? 'ok' : 'degraded',
            timestamp: new Date(),
            db: dbStatus,
            gemini: geminiStatus
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// GEMS proxy endpoint
app.get('/api/gems', async (req, res) => {
    try {
        const gems = await listGems();
        res.json({ success: true, gems });
    } catch (error) {
        console.error('List GEMS error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Example API to get recent searches (Safe read)
app.get('/api/searches', async (req, res) => {
    try {
        const result = await query('SELECT * FROM app_news_searches ORDER BY created_at DESC LIMIT 10');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Cron routes
app.use('/api/cron', cronRoutes);

// Task management routes
app.use('/api/tasks', tasksRoutes);

// Headlines routes
app.use('/api/headlines', headlinesRoutes);

// Articles routes
app.use('/api/articles', articlesRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal server error'
    });
});

// Catch-all handler for any request that doesn't match an API route
// Sends back the React index.html
app.get('/*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// Initialize DB and start server
async function startServer() {
    await initDb(); // Ensure tables exist

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`Serving static files from ${distPath}`);
    });
}

startServer();
