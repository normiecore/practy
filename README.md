# Practy

A web-based, AI-native practice management platform for law firms. Pilot firm: Soul Legal, a plaintiff personal injury practice in Perth and Baldivis, WA.

## Docs

- [Strategy, compliance and architecture](docs/STRATEGY.md): start here
- [MCP-first architecture](docs/architecture/MCP-FIRST.md)
- [Design-partner terms](docs/DESIGN-PARTNER.md)
- Research notes:
  - [01 Market landscape](docs/research/01-market-landscape.md)
  - [02 Australia / WA compliance](docs/research/02-compliance-australia-wa.md)
  - [03 Global compliance](docs/research/03-compliance-global.md)
  - [04 PI workflow and AI opportunity](docs/research/04-pi-workflows.md)

## Development (Phase 0)

Requires Node 22+.

```bash
npm install
npm run check   # typecheck + tests
npm run dev     # http://localhost:3000 — REST at /api/commands, MCP at /mcp
```

Connect Claude Code to a local server (dev tokens only, never use them with real client data):

```bash
claude mcp add --transport http practy http://localhost:3000/mcp --header "Authorization: Bearer dev-solicitor"
```

### Layout

| Path | Contents |
|---|---|
| `src/core` | Command registry, command bus (roles, matter guard, approval tiers), hash-chained audit log, WA working-day calendar |
| `src/domain` | Matters, parties, fuzzy conflict search, WA PI key-date rule pack (ICWA motor vehicle, WorkCover WA, Medicare) |
| `src/trust` | Shadow trust ledger: Xero and trust add-on sources, three-way reconciliation, Uniform Law checks, payment authorities |
| `src/server` | Composition root, REST API, remote MCP server (one command definition drives both) |

Phase 0 uses in-memory storage and static dev tokens. Before any real client data is loaded, they are replaced by Postgres (row-level security, AU region) and OAuth 2.1 with firm SSO.
