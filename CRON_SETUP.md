# Cron Setup Guide

This guide explains how to set up automated news fetching and processing.

## Overview

The news workflow consists of two main cron jobs:
1. **Fetch Headlines** - Runs daily at 8 AM to fetch new headlines
2. **Process Headlines** - Runs every hour to convert headlines into articles

---

## Option 1: External Cron Service (Recommended for Railway)

Use a service like **cron-job.org** or **EasyCron** to trigger your API endpoints.

### Setup Steps

1. **Create Account** at [cron-job.org](https://cron-job.org)

2. **Add Fetch Headlines Job**
   - URL: `https://your-app.railway.app/api/cron/fetch-headlines`
   - Method: POST
   - Schedule: Daily at 08:00
   - Timezone: Your timezone

3. **Add Process Headlines Job**
   - URL: `https://your-app.railway.app/api/cron/process-headlines?limit=5`
   - Method: POST
   - Schedule: Every hour
   - Timezone: Your timezone

### Security (Optional)

Add a secret token to protect your cron endpoints:

```javascript
// In server/routes/cron.js
const CRON_SECRET = process.env.CRON_SECRET;

router.post('/fetch-headlines', async (req, res) => {
    if (req.headers['x-cron-secret'] !== CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    // ... rest of code
});
```

Then add the header in your cron service:
- Header: `X-Cron-Secret`
- Value: Your secret token

---

## Option 2: Node-Cron (In-Process Scheduler)

Install node-cron:
```bash
npm install node-cron
```

Create `server/scheduler.js`:
```javascript
import cron from 'node-cron';
import { fetchAllActiveTaskHeadlines } from './services/headlineFetcher.js';
import { processNextHeadlines } from './services/newsRewriter.js';

export function startScheduler() {
    // Fetch headlines daily at 8 AM
    cron.schedule('0 8 * * *', async () => {
        console.log('Running scheduled headline fetch...');
        try {
            const result = await fetchAllActiveTaskHeadlines();
            console.log('Fetch result:', result);
        } catch (error) {
            console.error('Scheduled fetch failed:', error);
        }
    });

    // Process headlines every hour
    cron.schedule('0 * * * *', async () => {
        console.log('Running scheduled headline processing...');
        try {
            const result = await processNextHeadlines(5);
            console.log('Process result:', result);
        } catch (error) {
            console.error('Scheduled processing failed:', error);
        }
    });

    console.log('Scheduler started');
}
```

Update `server/server.js`:
```javascript
import { startScheduler } from './scheduler.js';

async function startServer() {
    await initDb();
    startScheduler(); // Add this line
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
```

---

## Option 3: Manual Triggers

You can manually trigger the cron jobs using curl or Postman:

### Fetch Headlines
```bash
curl -X POST https://your-app.railway.app/api/cron/fetch-headlines
```

### Fetch Headlines for Specific Task
```bash
curl -X POST https://your-app.railway.app/api/cron/fetch-headlines/1
```

### Process Headlines
```bash
curl -X POST "https://your-app.railway.app/api/cron/process-headlines?limit=5"
```

---

## Monitoring

### Check Task Status
```bash
curl https://your-app.railway.app/api/tasks
```

### Check Headlines
```bash
curl "https://your-app.railway.app/api/headlines?status=fresh&limit=10"
```

### Check Articles
```bash
curl "https://your-app.railway.app/api/articles?lang=en&limit=10"
```

---

## Workflow Example

1. **Create a Search Task**
```bash
curl -X POST https://your-app.railway.app/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Solar News Malaysia",
    "query": "Search for latest solar energy news in Malaysia",
    "gems_url": "https://gemini.google.com/gem/c9d02eab1195",
    "schedule": "08:00"
  }'
```

2. **Trigger Headline Fetch** (or wait for cron)
```bash
curl -X POST https://your-app.railway.app/api/cron/fetch-headlines
```

3. **Trigger Processing** (or wait for cron)
```bash
curl -X POST "https://your-app.railway.app/api/cron/process-headlines?limit=5"
```

4. **View Results**
```bash
curl "https://your-app.railway.app/api/articles?lang=en"
```

---

## Troubleshooting

### Headlines Not Fetching
- Check task is active: `GET /api/tasks`
- Check Gemini API health: `GET /api/health`
- Check GEMS URL is correct
- Review server logs

### Processing Fails
- Check headline status: `GET /api/headlines?status=failed`
- Review error messages in database
- Check Gemini API rate limits (3s delay enforced)

### Rate Limiting
The system enforces a 3-second delay between Gemini API calls. If you have many tasks:
- Reduce number of active tasks
- Increase processing interval
- Monitor queue length: Check server logs

---

## Best Practices

1. **Start Small**: Begin with 1-2 tasks, monitor performance
2. **Monitor Logs**: Check Railway logs regularly
3. **Set Alerts**: Use Railway's monitoring features
4. **Backup Data**: Regular database backups
5. **Test First**: Use manual triggers before setting up cron

---

## Cron Schedule Reference

```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, 0 and 7 are Sunday)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

Examples:
- `0 8 * * *` - Daily at 8:00 AM
- `0 * * * *` - Every hour
- `*/30 * * * *` - Every 30 minutes
- `0 8,20 * * *` - At 8 AM and 8 PM
- `0 8 * * 1-5` - Weekdays at 8 AM
