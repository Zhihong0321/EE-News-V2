# EE-News-V2 🌐

A sophisticated, AI-powered multi-language news workflow system that automatically fetches, rewrites, and translates news articles using Gemini AI.

[![Status](https://img.shields.io/badge/status-production--ready-brightgreen)]()
[![Languages](https://img.shields.io/badge/languages-EN%20%7C%20ZH%20%7C%20MS-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

## ✨ Features

- 🤖 **AI-Powered**: Automated news fetching and rewriting using Gemini GEMS
- 🌍 **Multi-Language**: Full support for English, Chinese (中文), and Malay (Bahasa Melayu)
- 📰 **Rich Content**: Comprehensive articles with analysis, context, and stakeholder impact
- ⚡ **Real-Time**: Automated workflow with scheduled headline fetching and processing
- 🎨 **Modern UI**: Clean, mobile-first interface with dark/light mode
- 🔄 **Status Tracking**: Complete workflow monitoring from headline to published article
- 🛡️ **Rate Limited**: Built-in 3-second delay between API calls
- 📊 **Task Management**: Create and manage multiple search tasks

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Express    │────▶│  PostgreSQL │
│   (React)   │     │   Backend    │     │  Database   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Gemini API  │
                    │   + GEMS     │
                    └──────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL
- Gemini API access

### Installation

```bash
# Clone the repository
git clone https://github.com/Zhihong0321/EE-News-V2.git
cd EE-News-V2

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL and GEMINI_API_URL

# Initialize database
node server/initDb.js

# Build frontend
npm run build

# Start server
npm start
```

### Development Mode

```bash
# Terminal 1: Start backend
npm run dev

# Terminal 2: Start frontend dev server
npm run dev:client
```

## 📖 Documentation

- **[MILESTONE.md](MILESTONE.md)** - Complete development phases and progress
- **[API_REFERENCE.md](API_REFERENCE.md)** - Full API documentation
- **[CRON_SETUP.md](CRON_SETUP.md)** - Automated workflow setup guide
- **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - Technical implementation details
- **[REWRITER_GEMS_VERIFIED.md](REWRITER_GEMS_VERIFIED.md)** - Rewriter GEMS verification
- **[RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md)** - Deployment guide

## 🔄 Workflow

```
1. Create Task → 2. Fetch Headlines → 3. Store (fresh) → 
4. Process Headlines → 5. Rewrite & Translate → 6. Store Article → 
7. Display in Frontend
```

### Example Usage

```bash
# 1. Create a search task
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Solar News Malaysia",
    "query": "Search for latest solar energy news in Malaysia"
  }'

# 2. Fetch headlines
curl -X POST http://localhost:3000/api/cron/fetch-headlines

# 3. Process headlines into articles
curl -X POST "http://localhost:3000/api/cron/process-headlines?limit=5"

# 4. View articles
curl "http://localhost:3000/api/articles?lang=en"
```

## 🗄️ Database Schema

### Tables

- **app_search_tasks** - User-defined search configurations
- **app_news_headlines** - Raw headlines with status tracking
- **app_news_articles** - Completed articles with translations

### Status Flow

```
fresh → processing → completed/failed
```

## 🌐 API Endpoints

### Task Management
- `GET /api/tasks` - List all tasks
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

### Headlines
- `GET /api/headlines` - List headlines (with filters)

### Articles
- `GET /api/articles?lang=en` - List articles
- `GET /api/articles/:id?lang=zh` - Get single article

### Cron Jobs
- `POST /api/cron/fetch-headlines` - Fetch all tasks
- `POST /api/cron/process-headlines` - Process headlines

### Utility
- `GET /api/health` - System health check
- `GET /api/gems` - List available GEMS

## 🎨 Frontend

Built with React + Vite, featuring:
- Language selector (EN/中文/BM)
- Dark/Light mode toggle
- Mobile-first responsive design
- Loading and error states
- Tag-based filtering

## 🔧 Tech Stack

### Frontend
- React 19.2.0
- Vite 7.2.4
- CSS Variables for theming

### Backend
- Express 5.1.0
- PostgreSQL (pg 8.16.3)
- Node.js 20

### AI Integration
- Gemini API
- Custom GEMS (news-search, rewriter)
- Rate limiting with queue system

### Deployment
- Railway-ready
- Docker support
- Environment-based configuration

## 📊 Project Stats

- **57 files** created
- **8,833 lines** of code
- **9 phases** completed
- **11 API endpoints** implemented
- **3 languages** supported
- **2 custom GEMS** integrated

## 🛠️ Development

### Project Structure

```
EE-News-V2/
├── server/
│   ├── config/          # Configuration files
│   ├── services/        # Business logic
│   ├── routes/          # API routes
│   ├── db.js           # Database connection
│   ├── schema.sql      # Database schema
│   └── server.js       # Express server
├── src/
│   ├── components/     # React components
│   ├── data/          # Mock data
│   └── styles/        # CSS files
├── test_*.js          # Test scripts
└── docs/              # Documentation
```

### Testing

```bash
# Test Gemini API
node test_gemini_service.js

# Test rewriter GEMS
node test_rewriter_gems.js

# Test headline fetcher (requires DB)
node test_headline_fetcher.js
```

## 🚢 Deployment

### Railway

1. Connect GitHub repository
2. Set environment variables:
   - `DATABASE_URL`
   - `GEMINI_API_URL`
3. Deploy automatically

See [RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md) for detailed instructions.

## 📝 Environment Variables

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:password@host:port/database
GEMINI_API_URL=https://ee-gemini-api-production.up.railway.app
```

## 🤝 Contributing

Contributions are welcome! Please read the documentation before submitting PRs.

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Gemini API for AI capabilities
- Railway for hosting platform
- React and Express communities

## 📞 Contact

For questions or support, please open an issue on GitHub.

---

**Built with ❤️ using AI-powered automation**
