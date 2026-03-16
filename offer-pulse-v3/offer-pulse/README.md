# The Offer Pulse v2

Real-time Hiring Intent Scores on **any** job posting, for **any** company — powered by live signals + Claude AI.

---

## Architecture

```
Job posting page
      ↓
Chrome Extension (content.js)
  - Detects company name from any job site
  - Calls your backend API
  - Shows score badge on the page
      ↓
Backend API (server.js)
  - Fetches live signals (news, layoffs, funding, job postings)
  - Sends signals to Claude AI for scoring
  - Caches result for 24h
  - Returns: score, recommendation, signals, summary
```

---

## Step 1 — Deploy the Backend

### Option A: Railway (recommended, free tier available)
1. Create account at railway.app
2. New Project → Deploy from GitHub (or upload folder)
3. Set environment variable: `ANTHROPIC_API_KEY=sk-ant-your-key`
4. Deploy — Railway gives you a URL like `https://offer-pulse.railway.app`

### Option B: Render
1. Create account at render.com
2. New Web Service → connect repo or upload
3. Build command: `npm install`
4. Start command: `node server.js`
5. Add env var: `ANTHROPIC_API_KEY`

### Option C: Local (for testing)
```bash
cd backend
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
npm install
npm start
# API runs at http://localhost:3000
```

### Test the backend
```bash
curl https://your-app.railway.app/score/Stripe
# Should return JSON with score, recommendation, signals
```

---

## Step 2 — Configure the Extension

1. Open `extension/content.js`
2. Find line: `const API_BASE = "https://YOUR_BACKEND_URL.railway.app";`
3. Replace with your deployed backend URL
4. Save

---

## Step 3 — Install the Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The Offer Pulse icon appears in your toolbar

---

## How it works

When you visit any job posting:
1. Extension detects the company name from the page
2. Calls your backend: `GET /api/score/CompanyName`
3. Backend fetches live signals from news, layoff trackers, funding databases
4. Claude AI analyzes all signals and produces a Hiring Intent Score 0–100
5. Extension injects a color-coded badge on the page
6. Result is cached for 24h so repeat visits are instant

**Works on:** LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, Workday, Ashby, SmartRecruiters, and any careers page

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/score/:company` | GET | Score a company by name |
| `/score` | POST `{company}` | Score via POST |
| `/score/batch` | POST `{companies:[]}` | Score up to 10 at once |
| `/cache/:company` | DELETE | Clear cached score |

---

## Score Guide

| Score | Color | Meaning |
|-------|-------|---------|
| 70–100 | Green | High intent — apply now |
| 40–69 | Amber | Mixed signals — selective |
| 0–39 | Red | Low intent — wait or avoid |

---

## Popup Settings

Click the extension icon → Settings tab → paste your backend URL → Save & test connection.
The popup also lets you look up any company manually without visiting a job posting.

---

The Offer Pulse · theofferpulse.com
