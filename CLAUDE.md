# Practy: notes for coding agents

GitHub (`normiecore/practy`) is the source of truth. **Work may be picked up by a different account or session at any time**, so:
- Read `docs/PILOT-BUILD.md` first. It holds the pilot scope, the current status of every workstream and the next steps. Update it in the same commit as the work.
- Commit and push small working increments (`npm run check` green) to the working branch. Never leave important work only in a local checkout.
- Decisions live in `docs/STRATEGY.md` §10. Matters of taste go to the user; anything that can support both options is built for both.

## Conventions
- TypeScript, ESM, Node 22. Run `npm run check` (typecheck + vitest) before every commit. Postgres tests run when `TEST_DATABASE_URL` is set.
- **Every capability is a command** (`defineCommand` in `src/core/registry.ts`) registered in `src/server/app.ts`. The same definition serves the web UI, REST (`/api/commands/:name`) and MCP (`/mcp`). Do not add UI-only or API-only behaviour.
- Approval tiers: 0 read, 1 internal draft, 2 legal-risk (practitioner approval in the app), 3 trust money (two trust authorisers in the app). Anything outward-facing (sending email, filing in court, finalising particulars/authority) is tier 2.
- State lives in tenant-keyed `Collection`s from `store.collection(kind)`. Mutations must call `collection.set(record)`; in-place edits are not persisted.
- Money is integer cents. Dates are ISO `YYYY-MM-DD` strings (`src/core/calendar.ts`).
- Legal rules are data with provenance (`ruleVerified`, `source`). Unverified rules must not produce a computed legal date or figure without a human confirming it. Keep the verification register in `docs/STRATEGY.md` §9 current.
- External systems sit behind interfaces in `src/connectors/*/types.ts` with fetch injected so tests use fakes. No network access in tests.
- Never put real client data, firm templates/branding (letterhead, Authority to Settle form) or staff details in the repo. Those are tenant data loaded at onboarding (see `docs/PILOT-BUILD.md`).
- Do not include model identifiers in commits or code comments.
