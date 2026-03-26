# GraphLens — SAP Order-to-Cash Graph System

An interactive graph visualization and LLM-powered query system for SAP O2C data.

## Project Structure

```
graphlens/
├── data/
│   └── sap_data.json            ← Pre-processed SAP dataset
├── backend/
│   ├── server.js                ← Express API + SSE streaming
│   ├── schema.js                ← LLM system prompt builder
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── main.js              ← App + D3 graph + chat UI
│   │   ├── graph.js             ← Node/edge construction
│   │   ├── api.js               ← API client + SSE streaming
│   │   └── styles.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── package.json                 ← Root monorepo scripts
└── README.md
```

## Graph Model

9 node types: BusinessPartner, SalesOrder, SalesOrderItem, Delivery, BillingDocument, Payment, Product, Plant, JournalEntry

8 edge types: PLACED, HAS_ITEM, MATERIAL, FROM_PLANT, SHIPS_FROM, BILLED_TO, SETTLED_BY, JOURNAL

## Quick Start

### Requirements
- Node.js 18+
- Anthropic API key → https://console.anthropic.com

### 1. Install dependencies
```bash
npm install && npm run install:all
```

### 2. Configure environment
```bash
cp backend/.env.example backend/.env
# Edit backend/.env and add your GROQ_API_KEY
```

### 3. Start development
```bash
npm run dev
# Backend:  http://localhost:3001
# Frontend: http://localhost:5173
```

## API Endpoints

| Method | Endpoint     | Description                     |
|--------|--------------|---------------------------------|
| GET    | /api/health  | Health check + record counts    |
| GET    | /api/data    | Full SAP dataset (JSON)         |
| GET    | /api/stats   | Summary stats + top customers   |
| POST   | /api/chat    | LLM chat with SSE streaming     |

### Chat request format
```json
POST /api/chat
{
  "messages": [
    { "role": "user", "content": "Which products have the most billing documents?" }
  ]
}
```

## Deployment

### Railway
1. Push to GitHub
2. New Project → Deploy from GitHub repo
3. Add **backend** service: root dir = `backend`, start = `npm start`
   - Env vars: `ANTHROPIC_API_KEY`, `PORT=3001`, `FRONTEND_URL=<your-frontend-url>`
4. Add **frontend** service: root dir = `frontend`, build = `npm run build`, start = `npx serve dist`
   - Update `vite.config.js` to proxy to your deployed backend URL

### Render
- Backend: Web Service, build = `cd backend && npm install`, start = `node server.js`
- Frontend: Static Site, build = `cd frontend && npm install && npm run build`, publish = `frontend/dist`

### VPS / Ubuntu
```bash
git clone <repo> graphlens && cd graphlens
npm install && npm run install:all
cp backend/.env.example backend/.env && nano backend/.env
npm run build:frontend
npm install -g pm2 serve
pm2 start backend/server.js --name graphlens-api
serve frontend/dist -p 5173
```

## Example Queries
- "Which products have the most billing documents?"
- "Trace billing document 90504274 full flow"
- "Find sales orders with incomplete flows"
- "Top customers by total order value"
- "Show all payments for customer Nelson, Fitzpatrick and Jordan"
- "Which billing documents are unpaid?"

Off-topic queries are rejected by guardrails.

## Tech Stack
- **Backend**: Node.js · Express · @anthropic-ai/sdk (SSE streaming)
- **Frontend**: Vanilla JS ES Modules · D3.js v7 · Vite
- **LLM**: Claude claude-sonnet-4-20250514
- **Graph**: D3 Force-Directed Simulation
