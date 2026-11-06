# FreshCheck AI

AI-powered stale-answer detection and fact verification using Tavily and Bifrost.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment template and fill in your credentials:
   ```bash
   cp .env.example .env
   ```
3. Start the backend and frontend:
   ```bash
   npm run dev
   ```
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001

## Scripts

- `npm run dev` — run backend + frontend together
- `npm run server` — run only the Express backend
- `npm run client` — run only the Vite frontend
- `npm run build` — build the frontend
- `npm test` — run backend tests

## Environment variables

See `.env.example`. Tavily, Bifrost URL, virtual key and model are all configured via environment variables. Set `MOCK_MODE=true` (or leave credentials unset) to use clearly-labeled mock results for UI testing.

## Notes

- No database, authentication, Docker or deployment configuration is included.
- Mock results are explicitly marked as mock and are not real verification.