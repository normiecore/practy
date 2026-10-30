# Pilot build: scope, status and handover

*This is the living plan. Update the status column in the same commit as the work, so anyone picking up (another account, another session) can continue from GitHub alone.*

**Working branch:** `research/strategy-and-compliance`
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
| 5 | Auth: Google and Microsoft sign-in (OIDC), dev login, sessions; OAuth 2.1 for MCP clients | ⏳ | |
| 6 | Secrets store (encrypted connector tokens), tenant settings, users and roles | ⏳ | |
| 7 | Connectors: Box and local document stores; Gmail and Microsoft 365 mail; Google and Outlook calendars; PracticePanther and CSV matter import | ⏳ | `src/connectors` |
| 8 | Document generation: naming convention, Authority to Settle (firm-template filler and tagged templates), letterhead letters, Form 17, affidavit/master book PDF, email-to-PDF, particulars docx | ⏳ | `src/docgen` |
| 9 | Damages and settlement engine: particulars heads, settlement and Authority figures, clearances (Medicare, Centrelink, NDIS), Centrelink preclusion estimate | ⏳ | `src/damages` |
| 10 | Costs: scales by determination and date, 6-minute time capture, timesheet, costs disclosure thresholds, uplift cap | ⏳ | `src/costs` |
| 11 | Email filing pipeline: matching rules (matter number plus surname, thread history, party addresses), review queue, misc archive; a mode that drives the existing Apps Script through labels | ⏳ | |
| 12 | AI: model gateway (Anthropic API and Bedrock Sydney), in-app chat agent over the command registry, medical chronology with verified page citations, AI policy and consent | ⏳ | |
| 13 | Compliance: privacy requests (APP 12/13), breach register (NDB 30-day and ransomware 72-hour timers), ADM register and privacy-policy clause, AML intake screening, evidence-document flag, retention and legal hold, AI-use log export | ⏳ | |
| 14 | Web app (React): matters, matter workspace, approvals inbox, diary, filing review, documents, chronology, damages, settlement, trust, compliance, settings, chat | ⏳ | `web/` |
| 15 | Deploy: Dockerfile, docker-compose, AWS ap-southeast-2 guide, backups, onboarding runbook | ⏳ | |

## Pilot onboarding inputs needed from Soul Legal (not in repo)
- The Authority to Settle `.docx` and letterhead `.docx` (uploaded in Settings → Templates).
- Staff list with fee-earner categories (SP / JP / C/PL) and roles.
- Box: the enterprise app (Client Credentials Grant) and the PracticePanther root folder id.
- Google Workspace: OAuth client (Gmail and Calendar scopes, domain-wide or per user).
- Xero app credentials, the trust bank account id and the tracking category name. Or, if trust sits in an add-on: a cashbook export.
- Opening trust balances for the shadow ledger, as at the start date.
- An Anthropic API key, or AWS Bedrock in ap-southeast-2.
