# MCP-first architecture: chat as a main way to use Practy

*Decision (30 Oct 2026): Practy is built so a lawyer can run a matter through Claude, or Practy's own chat, as fully as through the web UI. Box stays the document store. Xero stays the accounting system for now.*

## 1. Principles

1. **One command layer, three surfaces.** Every capability is a typed domain command, defined once with a schema, permissions and an approval policy. That one definition produces:
   - the **web UI** action,
   - the **REST API** endpoint,
   - the **MCP tool**.

   A CI parity test fails if a command is missing from any surface. Nothing can be done only in the UI.
2. **Claude acts as the user, never as a super-user.** Each MCP session is authorised with OAuth 2.1 as one named person. Role permissions, ethical walls, "no-AI" matter flags and region policy are all enforced **on Practy's server**, not by the model.
3. **AI proposes; a named person approves.** This is the Garfield model and matches the LPBWA AI statement. Anything outward-facing, financial or risk-bearing goes through an approval gate (see §3).
4. **Every call is audited.** Each MCP or chat tool call is written to the hash-chained audit log and the per-matter AI-use log. The log records the client, user, tool, an argument hash, the records touched and the approval outcome. That log can be exported to answer a court direction under the Federal Court GPN-AI or the WA Supreme Court guidelines.
5. **Practy is the hub that links records across systems.** It owns the matter and stores pointers out: the Box folder ID, Xero contact and tracking category, Gmail thread IDs and Calendar event IDs. Claude can therefore combine Practy + Box + Gmail + Xero connectors and always land on the right matter.

## 2. Practy MCP server

| Aspect | Design |
|---|---|
| Transport | Remote MCP over Streamable HTTP, e.g. `https://mcp.au.practy.app` (one per region cell) |
| Auth | OAuth 2.1 + PKCE; firm SSO; short-lived tokens; per-tenant admin allow-list of MCP clients (e.g. Claude Team/Enterprise org only) |
| Tools | Generated from the command registry. Each carries MCP annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` |
| Resources | `practy://matter/{id}`, `practy://matter/{id}/chronology`, `practy://matter/{id}/settlement`, `practy://matter/{id}/key-dates`, with links to Box files |
| Prompts | Firm workflows packaged as server-side prompts that any Claude client receives. Soul Legal's current skills migrate here: Authority to Settle, particulars, Form 17, affidavit book, bill of costs, email filing, naming convention |
| Elicitation | Used to confirm low-risk writes inside the chat, and to collect missing fields such as date of birth for the limitation calculation |
| Rate and scope limits | Per user and per tool. Bulk export tools are off by default |

### First tool set (pilot: ICWA motor vehicle and WorkCover)

**Read**
- `search_matters`, `get_matter`, `list_key_dates`
- `get_chronology`, `get_damages_model`, `get_settlement_statement`
- `get_clearance_status`, `conflict_search`
- `get_trust_balance` (mirrored from Xero during the pilot)

**Propose (draft only)**
- `propose_file_email` (matter, name, Box folder)
- `propose_key_date`
- `draft_letter`, `draft_particulars`, `draft_authority_to_settle`
- `propose_time_entry`
- `request_medicare_nopb` (prepares the MO026 pack)

**Commit (behind approval gates)**
- `approve`, `reject`
- `send_correspondence`
- `confirm_key_date`
- `record_clearance`

## 3. Approval tiers

| Tier | Examples | How it is approved |
|---|---|---|
| **0: Read** | Search, summaries, chronologies, balances | No approval needed. Logged |
| **1: Internal draft** | File an email, create a task, draft a letter, record a time entry | In-chat confirmation (elicitation) by the acting user |
| **2: Outward or legal-risk** | Send correspondence, change a limitation or critical date, finalise particulars or an Authority to Settle, any filing | Approved by a practitioner with the right role **in the Practy UI or approval inbox**, not by a chat confirmation alone |
| **3: Money** | Trust receipts, payments or transfers; bills; settlement distribution | Two-person approval in Practy, plus the trust rule pack's hard blocks. **Never executable through MCP.** MCP can only prepare these |

Tier rules live in the rule pack, so a firm can tighten them but cannot loosen below the regulatory floor.

## 4. Security risks specific to agentic and chat use

- **Prompt injection from untrusted content.** Emails, opponents' documents and medical records are untrusted input. Tool results tag that content as untrusted. Write tools refuse arguments that trace back to instructions found inside it. Tier 2 and 3 actions always need a human outside the chat.
- **No open-ended exfiltration.** No tool sends data to an arbitrary address or URL. Outbound recipients must already be parties or contacts on the matter.
- **Ethical walls and "no-AI" flags** are enforced server-side. A blocked matter simply does not exist for that user or for AI tools.
- **Suppression, privilege and implied-undertaking flags** keep that material out of AI tools.
- **Evidence documents.** Affidavits, witness statements and expert briefs flagged as evidence cannot be produced by generative drafting tools, in line with Federal Court and NSW practice. Claude may format or assemble them but not author them.

## 5. Where the AI runs (data residency)

There are two paths. Both are governed by the tenant's AI policy.

1. **Practy's own chat and background agents.** These run Claude through an **Australian-region endpoint**. AWS Bedrock in Sydney (ap-southeast-2), with cross-region inference kept inside Australia, is the leading option. Data stays in Australia and the cloud provider is the processor. **[verify current model availability in-region]**
2. **The firm's own Claude (claude.ai, Desktop or Code) connected to Practy's MCP server.** Matter data then flows to Anthropic under the firm's Claude plan. Anthropic lists APAC/Australian data residency, but third-party reports say first-party inference may still be US or global. **[verify with Anthropic before relying on AU-only inference]**. Controls:
   - a tenant admin toggle, off until enabled;
   - commercial plans only, with no training on the data;
   - the APP 8 cross-border disclosure recorded in the data-location register and privacy policy;
   - AI-use wording in the costs agreement;
   - an option to limit external clients to Tier 0–1 tools.

## 6. Connectors

| System | Role | Integration |
|---|---|---|
| **Box** | Document system of record | Box API (server-side filing, metadata, retention) + Box remote MCP (`mcp.box.com`) for Claude. Each Practy matter ↔ one Box folder. Practy writes Box metadata (matter no., document type, date, source) so Box search and Box AI line up with Practy |
| **Gmail / Google Calendar** | Correspondence and key-date diary | Gmail API watch → filing pipeline. Calendar sync for confirmed key dates only |
| **Xero** | Office accounting (and trust **mirror** during the pilot; see below) | Xero Accounting API (OAuth 2.0, webhooks): contacts ↔ clients, tracking category ↔ matter, invoices ↔ bills, bills/spend money ↔ disbursements. Xero also has an official MCP server for direct Claude access to the books **[verify scopes]** |
| **DocuSign or similar** | E-signing of costs agreements and authorities | Phase 3 |

### Xero and trust accounting: an important caveat

Xero is **not** on the Law Society of NSW list of certified trust accounting packages. That list is the benchmark WA practitioners and examiners use. General ledgers like Xero allow records to be edited, while the Uniform General Rules expect trust records that are permanent and properly sequenced. The plan is therefore **integrate first, then run in parallel, then switch over**:

1. **Pilot (integrate).** Practy reads Xero (and the trust bank feed) and builds a **shadow trust ledger**: client ledgers per matter, three-way reconciliation, the 5-working-day posting check and the 15-working-day reconciliation check. Discrepancies are flagged. **Nothing is written to Xero's trust records.** Office-side bills and disbursements can be pushed to Xero after approval.
2. **Parallel run.** At least three clean month-end reconciliations, plus a review by Soul Legal's external examiner.
3. **Switch over.** Practy becomes the trust ledger of record: immutable, event-sourced, reversal-only. Xero stays the office ledger and receives summary journals.

**Still to confirm with Soul Legal:** does the trust account currently sit in Xero itself, or in a separate trust add-on such as InTouch? This decides whether step 1 reads Xero or the add-on.
