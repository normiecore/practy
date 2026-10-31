# Pilot build: scope, status and handover

*This is the living plan. Update the status column in the same commit as the work, so anyone picking up (another account, another session) can continue from GitHub alone.*

**Working branch:** `main` (all earlier branches are merged into it). Feature work goes on short branches with a PR into `main`.
**Pilot:** Soul Legal (Perth/Baldivis). ICWA motor vehicle and WorkCover WA matters. Box stays the document store. Xero (or a trust add-on) stays the trust record during the shadow phase.

## Firm context discovered (from Soul Legal's existing Claude skills)
- **Current tools:** PracticePanther (practice management; matter numbers such as `1998`), Gmail, Box, Xero. Their Apps Script automation files Gmail into Box:
  - It prints each email to PDF and saves the PDF, the `.eml` and attachments into each fee earner's own Box email archive.
  - It copies matched mail into the matter's `Emails` folder.
  - The Gmail label `Box Filed/Refile/<matter no>` forces refiling.
- **Box layout:** matter folders sit under a PracticePanther root folder and are named `1998 - Priestley, Toni - MVA`. Each has subfolders (Emails, Medical Reports, Tax Documents, Court Documents, …).
- **Naming convention:** `YYYY.MM.DD [SIER# –] Type – by/from Author – Profession – Practice – $Amount`, plus email rules (`EM to X` / `EM from X` / `EMC with X`, never naming the fee earner). Encoded in `src/docgen/naming.ts`.
- **Authority to Settle rules:**
  - Total Offer = A(a)…A(e).
  - Medicare advance = 10% of the Total Offer, including costs.
  - Two flags decide B(b) and B(j).
  - Net in hand and net total are calculated.
  - Section B and C amounts are shown as E$ (estimates).
- **Particulars of damages:** Stott CPC-A1 format. The firm's standing rules:
  - net = gross less income tax only (no Medicare levy);
  - SG rates by financial year;
  - Jongen discount of 15% on future superannuation;
  - 6% weekly multiplier table, whole years only;
  - 5% contingencies;
  - interest at 3%;
  - annual cost ÷ 52.14 for weekly costs;
  - working life to age 67.
- **Bill of costs:**
  - LCC determinations 2020, 2022, 2024 and 2026 (the 2026 determination applies from 21/9/2026), with rates for SP, JP, C/PL and counsel;
  - WorkCover forum Magistrates Court rates;
  - 6-minute unit heuristics;
  - Table B items and caps.
- **Form 17 List of Documents:** fixed court layout, standard category order and privilege boilerplate.
- **Letters:** on the firm letterhead `.docx`. Only the body is replaced; the header, footer and logo are kept.

Firm templates (the Authority to Settle form and the letterhead) are **tenant assets**. They are uploaded at onboarding and never committed.

## Workstreams

| # | Workstream | Status | Notes |
|---|---|---|---|
| 1 | Core: command registry, bus, approval tiers, audit chain | ✅ done | `src/core` |
| 2 | Persistence: in-memory collections with Postgres write-through, append-only audit table | ✅ done | One deployment per firm for the pilot |
| 3 | Matters, conflicts, WA PI key-date rules | ✅ done | `src/domain` |
| 4 | Shadow trust ledger: Xero and trust add-on sources, reconciliation | ✅ done | `src/trust` |
| 5 | Auth: Google and Microsoft sign-in (OIDC), dev login, sessions; OAuth 2.1 for MCP clients | ✅ done | `src/auth`; consent screen; firm switch for external clients; max-tier cap |
| 6 | Secrets store (encrypted connector tokens), tenant settings, users and roles | ✅ done | `src/core/secrets.ts`, `src/admin` |
| 7 | Connectors (merged from `pilot/connectors`): Box and local document stores; Gmail and Microsoft 365 mail; Google and Outlook calendars; PracticePanther and CSV matter import | ✅ done | `src/connectors`, wired per firm in `src/integrations` (Box CCG, Gmail/Graph, calendars, Xero, PracticePanther and CSV import, OAuth connect flows) |
| 8 | Document generation (parallel agent, branch `pilot/docgen`): naming convention, Authority to Settle (firm-template filler and tagged templates), letterhead letters, Form 17, affidavit/master book PDF, email-to-PDF, particulars docx | ✅ done | `src/docgen` (merged) + `src/documents` commands: templates, Authority to Settle, letters, Form 17, particulars, court books, tracked-changes markup, indexing of existing Box files |
| 9 | Damages and settlement engine (parallel agent, branch `pilot/damages-costs`): particulars heads, settlement and Authority figures, clearances (Medicare, Centrelink, NDIS), Centrelink preclusion estimate | ✅ done | `src/damages` (merged); open questions for the firm listed below |
| 10 | Costs (branch `pilot/damages-costs`): scales by determination and date, 6-minute time capture, timesheet, costs disclosure thresholds, uplift cap | ✅ done | `src/costs` (merged) |
| 11 | Email filing pipeline: matching rules (matter number plus surname, thread history, party addresses), review queue, misc archive; a mode that drives the existing Apps Script through labels | ✅ done | `src/filing`; scheduled sweep wiring pending (#15) |
| 12 | AI: model gateway (Anthropic API and Bedrock Sydney), in-app chat agent over the command registry, medical chronology with verified page citations, AI policy and consent | ✅ done | `src/ai`; chat streams over SSE at `/api/chat/:id/messages`; model id is configuration (`PRACTY_AI_MODEL`) |
| 13 | Compliance: privacy requests (APP 12/13), breach register (NDB 30-day and ransomware 72-hour timers), ADM register and privacy-policy clause, AML intake screening, evidence-document flag, retention and legal hold, AI-use log export | ✅ done | `src/compliance` |
| 14 | Web app (React): matters, matter workspace, approvals inbox, diary, filing review, documents, chronology, damages, settlement, trust, compliance, settings, chat | ✅ done | `web/`. Hash routing; every screen calls the command API. `web/command-form.tsx` renders any command from its JSON Schema, so every command is usable in the app (matter "All actions" tab, "All commands" page) before it gets a bespoke screen. Dedicated forms for damages and Authority to Settle; Playwright tests in CI. `pilot/web` was never pushed, so this replaces it |
| 15 | Deploy: Dockerfile, docker-compose, AWS ap-southeast-2 guide, backups, onboarding runbook | ✅ done | `Dockerfile`, `docker-compose.yml`, `docs/DEPLOY.md`, `docs/ONBOARDING.md`; CI builds the image |

## Pilot onboarding inputs (gathered inside Soul Legal; never committed)
- The Authority to Settle `.docx` and letterhead `.docx` (uploaded in Settings → Templates).
- Staff list with fee-earner categories (SP / JP / C/PL) and roles.
- Box: the enterprise app (Client Credentials Grant) and the PracticePanther root folder id.
- Google Workspace: OAuth client (Gmail and Calendar scopes, domain-wide or per user).
- Xero app credentials, the trust bank account id and the tracking category name. Or, if trust sits in an add-on: a cashbook export.
- Opening trust balances for the shadow ledger, as at the start date.
- An Anthropic API key, or AWS Bedrock in ap-southeast-2.

## Open questions for Soul Legal (from building the damages and costs engines)
1. **Interest on accruing losses:** past super and gratuitous services currently accrue interest at 3% from the start of each head to the calculation date. Should that be full-period or half-period?
2. **Item 19 cap across Determinations:** the cap currently used is the one in the Determination in force at the latest work on the item, scaled proportionally. Is that right?
3. **Recurring aids:** should recurring aids use annual ÷ 52.14 × multiplier × 0.95 like future medical (currently they are lump sums)?
4. **Centrelink preclusion:** does the period run from the injury date or from when weekly payments stopped? Are part weeks dropped?
5. **Release of funds:** should a known but unpaid charge block release of funds, or can it be paid from trust at the same time as the distribution?
6. **Matter number format:** numbers must be letters, digits, `.`, `-` or `_` (no spaces, `/` or ` - `), so they can name Box folders exactly. Does any matter use another format, such as `2024/001`?
7. **Firm-specific values:** the Authority B(j) label defaults to "<firm name> fees" from tenant settings (or is set per authority), and fee-earner categories come from the user list. The document naming convention is still a code profile (`SOUL_LEGAL_PROFILE` in `src/docgen/naming.ts`); a second firm would need its own profile chosen in settings.

## Current state (31 Oct 2026)
- **No open PRs.** Everything is merged into `main` (normiecore/practy#1 to #3).
- **Security review done and fixed:** `docs/SECURITY-REVIEW.md` lists the 14 findings (3 high), all fixed with tests (merged in normiecore/practy#3), plus the behaviour changes and residual risks the firm should know about. The penetration test is still outstanding.
- **Repo is public** (made public so Actions runs free; private runs were blocked by account billing). Keep client data, firm templates and credentials out of it.
- **Old branches:** `pilot/connectors`, `pilot/docgen`, `pilot/damages-costs` and `research/strategy-and-compliance` are merged into `main` and can be deleted (agent sessions are not permitted to delete remote branches).

## Handover notes (keep current)
- **Run locally:** see README → Development. Tests: `npm run check`. Include the Postgres test with `TEST_DATABASE_URL=postgres://…`.
- **How to add a capability:** write a `defineCommand` in the module's `commands.ts`, register it in `src/server/app.ts`, and add a test. It then appears automatically in REST, MCP and the assistant.
- **Branches:** `pilot/connectors`, `pilot/docgen`, `pilot/damages-costs` and `research/strategy-and-compliance` are all merged into `main`.
- **Browser tests:** `npm run test:e2e` (Playwright, `e2e/`) signs in, opens matters, confirms a key date through approvals, checks conflicts, damages, settlement and the dedicated forms, and visits every page; the CI `e2e` job runs it on every push.
- **Phones:** the app shell, sign-out, field sizes (16px, so iOS does not zoom) and key-value lists now fit an iPhone, and an `iphone` Playwright project (`e2e/mobile.spec.ts`) checks that pages do not scroll sideways. Page content: under 640px every table (`.card-table`: key dates, tasks, evidence, documents, chronology, damages heads, parties, diary, email filing, commands and the generic result tables) shows each row as a card with labelled values and its actions on screen; the Matters list is one card per matter with number and title as one link; under 900px a labelled Section picker replaces the matter, compliance and settings tab strips; list links, buttons and the breadcrumb are at least 44px tall; generated forms bring up the email and phone keyboards. `e2e/mobile-content.spec.ts` checks this on an iPhone and `e2e/tables.spec.ts` checks desktop keeps its tables and tabs. Still to do for phones: a bottom tab bar and full-screen dialogs. Shipping to iPhone (installable web app or a TestFlight shell) depends on this; see `docs/IPHONE.md`.
- **Firm settings:** Settings → Firm → Edit settings is a sectioned form (firm, sign-in, privacy officer, letters, documents, email filing, calendar, key date policy, AI, trust). `update_settings` checks the merged result against `tenantSettingsSchema` before approval and again when approved, so a wrong type or misspelt key is refused with the field named.
- **Forms and validation:** the damages form takes the firm's standing parameters from `get_damages_defaults` (blank means the firm default, so a later rule change is not frozen into saved versions). Invalid input comes back with an `issues` list of `{ path, message }`, which the dedicated forms show beside the field or table row concerned.
- **Remaining before go-live:**
  - the web app (#14): review with the firm's staff;
  - an independent security review, with fixes (internal review done: `docs/SECURITY-REVIEW.md`; an external review is still advisable);
  - a real-account trial of each connector (Box CCG, Gmail, Xero sandbox, PracticePanther);
  - verifying the rules on the register (STRATEGY §9);
  - a pen test.
