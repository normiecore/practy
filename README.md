# Practy

A web-based, AI-native practice management platform for law firms. Pilot firm: Soul Legal, a plaintiff personal injury practice in Perth and Baldivis, WA.

## Docs

- [Strategy, compliance and architecture](docs/STRATEGY.md): start here
- [MCP-first architecture](docs/architecture/MCP-FIRST.md)
- [Design-partner terms](docs/DESIGN-PARTNER.md)
- [Pilot build status and handover](docs/PILOT-BUILD.md)
- [Deployment (AWS Sydney)](docs/DEPLOY.md)
- [Onboarding runbook (Soul Legal)](docs/ONBOARDING.md)
- Research notes:
  - [01 Market landscape](docs/research/01-market-landscape.md)
  - [02 Australia / WA compliance](docs/research/02-compliance-australia-wa.md)
  - [03 Global compliance](docs/research/03-compliance-global.md)
  - [04 PI workflow and AI opportunity](docs/research/04-pi-workflows.md)

## Development

Requires Node 22+ (and Postgres 16 for persistence).

```bash
npm install
npm run check                     # typecheck (server + web + e2e) and tests
npm run test:e2e                  # browser tests: builds the web app and starts servers on :3100 and, for the sample firm, :3101 (first run: npx playwright install chromium)
npm run demo                      # preview: builds the web app and serves a fictional sample firm on :3000
PRACTY_DEV_LOGIN=1 PRACTY_BOOTSTRAP_ADMIN_EMAIL=you@example.com npm run dev   # API on :3000 (in-memory unless DATABASE_URL is set)
npm run dev:web                   # web app on :5173, proxied to :3000
npm run build && npm run start:prod
```

Sign in at http://localhost:3000/auth/login with the bootstrap email (dev login is refused in production).

**Previewing with sample data.** `npm run demo` starts Practy with a made-up firm, so someone looking at it sees realistic work instead of an empty app. Open http://localhost:3000/auth/login/dev and sign in as `principal@example.com`; `solicitor@example.com` and `paralegal@example.com` also work. The firm has five ICWA motor vehicle and WorkCover WA matters with clients, other parties and references, key dates (some confirmed, some proposed, two overdue and several in the next fortnight), tasks, file notes, evidence requests with chase dates, sample PDFs named by the firm's convention, a damages model and Authority to Settle, time entries, and two requests from the paralegal waiting in Approvals. Dates are relative to today. Every name and detail is fictional. The data is entered through the same commands staff use (`src/server/demo.ts`), is held in memory and is lost when you stop the demo. Only the development sign-in is enabled, and no network, AI model, Box, Gmail or Xero is needed (the Assistant works only if a model is configured). The demo refuses to start when `NODE_ENV=production` or `DATABASE_URL` is set, so it can never seed a real database. Set `PORT` to use another port.

Connect Claude Code to a running server (OAuth: approve the consent screen in the browser; the firm must enable external AI clients in Settings → AI):

```bash
claude mcp add --transport http practy http://localhost:3000/mcp
```

### Layout

| Path | Contents |
|---|---|
| `src/core` | Command registry, command bus (roles, matter guard, approval tiers), hash-chained audit log, persistence, secrets, calendar |
| `src/auth`, `src/admin` | Staff sign-in (Google/Microsoft OIDC), sessions, API keys, MCP OAuth server; firm settings and users |
| `src/domain` | Matters, parties, conflict search, WA PI key-date rule pack |
| `src/documents`, `src/docgen` | Document index and generation (Authority to Settle, letters, Form 17, particulars, court books, naming convention) |
| `src/filing` | Email-to-matter matching, filing into Box, review queue, label bridge |
| `src/damages`, `src/costs` | Damages engine, settlement/Authority figures, clearances; scales, time, costs disclosure |
| `src/trust` | Shadow trust ledger (Xero or add-on), three-way reconciliation, payment authorities |
| `src/ai` | Model gateway (Claude API / Bedrock Sydney), assistant, verified medical chronology |
| `src/compliance` | Privacy requests, breaches, ADM register, AML screening, retention, AI-use log |
| `src/connectors`, `src/integrations` | Box, local store, Gmail, Microsoft Graph, calendars, PracticePanther/CSV import; per-firm wiring and OAuth connect flows |
| `src/server` | REST API, MCP server, chat SSE, jobs, config |
| `web/` | React web app |
