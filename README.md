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
npm run test:e2e                  # browser tests: builds the web app and starts a server on :3100 (first run: npx playwright install chromium)
PRACTY_DEV_LOGIN=1 PRACTY_BOOTSTRAP_ADMIN_EMAIL=you@example.com npm run dev   # API on :3000 (in-memory unless DATABASE_URL is set)
npm run dev:web                   # web app on :5173, proxied to :3000
npm run build && npm run start:prod
```

Sign in at http://localhost:3000/auth/login with the bootstrap email (dev login is refused in production).

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
