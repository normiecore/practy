# Practy: Product Strategy, Compliance and Architecture

*Research date: 30 October 2026. Pilot firm: Soul Legal (plaintiff personal injury, Perth / Baldivis, WA).*

This is the summary document. The detailed, sourced research is in [`docs/research/`](research/):

| # | Note | Covers |
|---|------|--------|
| 01 | [Market landscape](research/01-market-landscape.md) | Incumbent practice management systems, frontier legal AI, what leading firms are doing, gaps |
| 02 | [Australia / WA compliance](research/02-compliance-australia-wa.md) | Uniform Law, trust accounting, costs, AML/CTF Tranche 2, Privacy Act, cyber, AI practice notes, PI statutory schemes |
| 03 | [Global compliance](research/03-compliance-global.md) | GDPR/UK, EU AI Act, US/UK/NZ/SG regulators on AI, trust-accounting variants, certifications, accessibility |
| 04 | [PI workflow and AI opportunity](research/04-pi-workflows.md) | Lifecycle of a WA PI matter, where the manual work is, US PI-AI tools, ranked features, pilot scope |

> **Read this first.** This is research, not legal advice. Every item marked **[verify]** has to be checked against the primary source by a practitioner before it becomes a hard rule in the product. The full list is in §9.

---

## 1. Summary

1. **The market split in 2025–26.** One group is AI-first platforms in the US PI market: EvenUp (US$2B+), Eve (US$1B+, now pitching an "EveOS" for plaintiff firms), Supio, Filevine LOIS and Litify. The other is general practice management systems adding AI: Clio (Manage AI, Clio Work, and "Agentic Workflows" announced 26 Oct 2026), LEAP (Matter AI, LawY), Smokeball (agentic Archie, 2026) and Actionstep Intelligence (Aug 2026). Big-law AI (Harvey, Legora, CoCounsel) is used by Gilbert + Tobin, MinterEllison, HWL Ebsworth and Maddocks, but none of it targets plaintiff PI.
2. **No Australian PI-native platform exists.** Every serious PI AI product is US-only. They are built around US demand letters, US medical billing codes and liens, and US e-filing. No product handles Medicare, Centrelink or NDIS clearances, WA schemes (ICWA, WorkCover WA under the 2023 Act, SRC/Comcare), District Court r 45C particulars, LCC and WorkCover costs scales, or Uniform Law trust accounting as a joined-up flow. That is our opening.
3. **The AI layer is becoming a commodity.** Anthropic's "Claude for Legal" (May 2026) shipped more than 20 MCP connectors. CoCounsel is being rebuilt on the Claude Agent SDK, and Smokeball lets users pick GPT, Claude or Gemini. The lasting advantage is not the model. It is **(a) a structured, source-linked matter data model, (b) encoded jurisdiction and scheme rules, (c) a compliant system of record (especially trust), and (d) workflow ownership with approval gates.**
4. **Australia has no AI Act.** The National AI Plan of 2 Dec 2025 shelved mandatory guardrails. The binding constraints are instead professional duties (confidentiality, supervision, fair costs), court rules (WA Supreme Court GenAI Guidelines, Federal Court GPN-AI of 16 Apr 2026, NSW SC Gen 23), and the Privacy Act. The Privacy Act **automated decision-making (ADM) transparency duty starts 10 Dec 2026, six weeks from now.**
5. **AML/CTF Tranche 2 went live for lawyers on 1 Jul 2026.** On the Law Council's Guidance Note 4, a **PI-only practice is outside the regime**, even when settlement money goes through trust from insurers, government bodies or courts. That exemption is lost if the firm does *any* designated service (conveyancing, trust or company formation, investing settlement funds). The product needs designated-service screening at intake and alerts when a matter drifts into scope.
6. **Strategy:** be the **Australian PI operating system**. We should not try to beat Clio or LEAP on breadth in year one. Win on PI depth (scheme rules, clearances, settlement-to-trust, medico-legal pipeline, AU damages). Run on top of the firm's existing Box and Gmail rather than replacing them. Make compliance and auditability the selling point. Build a global-ready core (region cells, rule packs, model gateway) so the UK, NZ and others are configuration, not rewrites.

---

## 2. What leading firms are doing

| Who | What | Lesson for Practy |
|---|---|---|
| A&O Shearman + Harvey | Co-built agentic tools (antitrust, fund formation, loan review), sold to others with revenue share | Firms become product co-creators. Soul Legal's existing skills (Authority to Settle, particulars, Form 17, bill of costs) are exactly this kind of IP |
| Gilbert + Tobin, MinterEllison, HWL Ebsworth, Maddocks | Firm-wide Harvey or Legora rollouts; Harvey runs in Azure AU regions since Jul 2025 | Australian data residency **and Australian inference** are now expected |
| Maurice Blackburn | "Morry" 24/7 AI intake assistant (Jun 2026); Mary Technology pilot; earlier Azure AI cut TPD (total and permanent disability) entitlement assessment from months to the first call | AI intake and triage is where PI is heading. Small firms have no equivalent |
| Shine | Automated onboarding, client app, Emerging Technology Centre | Client expectations: status visibility, e-sign, fast answers |
| Filevine LOIS Console (Jun 2026), Smokeball Archie, Clio Agentic Workflows | Agents that **read and write the system of record** behind approval gates, and flag what's *missing* from a file | The product unit is a supervised agent inside the matter, not a chatbot |
| Garfield.Law (SRA-approved AI firm, UK, 2025) | Client approves every step; may not propose case law; named solicitors accountable | Regulator-endorsed template for human-in-the-loop design |
| Lawhive (UK) | AI platform that bought a traditional law firm | Platform-plus-firm models are emerging. Soul Legal as a design partner is a lighter version of this |
| EvenUp (and the Business Insider exposé) | Demands and chronologies at scale; former staff say humans did much of the work and errors were caught in review | Accuracy needs **source citations and human review by design**. Don't claim autonomy |

## 3. What no one has done yet (our opportunity)

1. **Clearances engine.** Tracks Medicare (NOPB: valid 6 months, MO022 within 28 days of settlement), Centrelink preclusion (50% rule) and NDIS (CRA, recovery), plus DVA, health funds and WorkCover refunds. Covers request → receipt → expiry → re-request. Feeds the settlement calculation directly, and blocks release until clearances are in.
2. **Settlement-to-trust in one flow.** Offer → Authority to Settle (gross, deductions, net in hand) → client e-sign → receipt into trust tagged by AML exclusion basis → payments to Medicare and others → final bill under the uplift cap and scale → distribution → trust statement. Today this is spread across spreadsheets, Word and a separate trust package.
3. **WA scheme rule packs.** These are effective-dated, versioned data, not hard-coded logic:
   - ICWA (notice "as soon as practicable", 3-year limitation, minors, catastrophic-injury scheme)
   - WorkCover WA under the 2023 Act (≥15% WPI common-law gate, CL1 election, 15–25% band cap, conciliation and arbitration)
   - SRC Act s 45 election
   - Civil Liability Act thresholds (indexed every 1 July)
   - Limitation Act 2005
   - District Court timetables
4. **Australian damages builder.** r 45C schedule; past and future economic loss from payslips and ATO data; Griffiths v Kerkemeyer care; discount tables; special damages from invoices and the Medicare history. The same data model feeds particulars, conference briefs and the Authority to Settle.
5. **Medico-legal pipeline.** Expert selection → letter of instruction and brief → booking and client confirmation → chasing → invoice → disbursement funder → report summary into damages → inconsistency detection across reports. No AU funder (MA Legal Funding, Lex Medicus, etc.) integrates with any practice management system.
6. **Works with Google Workspace and Box.** Incumbents assume Outlook and their own document management. Soul Legal runs on Gmail and Box. Meet firms where they are. Clio's auto-filing inbox (Oct 2026) is US-first.
7. **Open by default.** LEAP has no public API, and its reviews complain of lock-in and difficulty getting data out. Practy ships a public API, **an MCP server so firms' own AI tools can operate on Practy safely**, and full export in open formats.
8. **Compliance as a feature.** Uniform Law trust controls, costs-disclosure thresholds, an AI-use log for court practice notes, the ADM register, the AML drift detector, and examiner and insurer export packs. Professional indemnity insurers and the LPBWA care about these things. Competitors treat them as afterthoughts.

---

## 4. Product pillars

| Pillar | Contents |
|---|---|
| **A. Matter core** | Matters, parties, conflict index (fuzzy, all parties, logged), scheme type, key-dates engine, tasks, ethical walls, retention and legal hold |
| **B. Inbox and documents** | Gmail/Outlook ingestion → matter matching (confidence plus review queue) → naming convention → Box (or native) filing → date, task and fact extraction. Generalises the existing `email-filing-sweep`, `file-matter-emails` and `naming-convention` skills |
| **C. Evidence and medical** | Records requests with authorities, auto-chasers, medical chronology with **page-level citations**, WPI and diagnosis extraction, pre-existing-condition flags, report comparison |
| **D. Damages and settlement** | Damages model → particulars (r 45C), letters of claim, conference briefs → Authority to Settle → clearances engine → settlement statement |
| **E. Court and document assembly** | Form 17 List of Documents, affidavits with indexed and paginated annexures, letterhead letters, tracked-changes-to-markup for eCourts. Productises the existing skills |
| **F. Money** | Uniform Law trust ledger, office ledger, costs-disclosure engine, conditional costs and uplift controls, LCC and WorkCover scale billing, 6-minute time capture, bills with the rights notice, disbursement and funder tracking |
| **G. Client and intake** | Intake web chat and after-hours voice (scheme triage, limitation screen, conflict data, no advice, ASCR r 36 compliant), client portal (status, uploads, e-sign, settlement explainer) |
| **H. Trust, risk and compliance** | AI-use log, ADM register, AML screening, privacy requests and breach register, ransomware 72-hour timer, audit export packs, rule-pack versions |

---

## 5. Compliance by design: Australia / WA (pilot-critical)

Detail and sources are in [research/02](research/02-compliance-australia-wa.md). The core requirements:

| Obligation | Status | What the software must do |
|---|---|---|
| **Uniform Law trust accounting** (LPUL Pt 4.2, Uniform General Rules; WA since 1 Jul 2022) | In force | Immutable double-entry trust ledger separated from office money. General trust, controlled money and transit money. Hard blocks: no client ledger overdraft, no trust-to-office transfer without a bill or authority, no cash withdrawals, no edits (reversals only). Unposted-transaction alert at **5 working days**. Month-end three-way reconciliation locked within **15 working days**. Examiner export pack (year runs 1 Apr–31 Mar). s 154 irregularity notice. **7-year** retention lock [verify rule cites] |
| **Costs disclosure and agreements** (LPUL ss 172–198) | In force | Disclosure generator branching at **<$750 / $750–$3k (standard form) / >$3k**. Estimate-exceeded monitor. Conditional costs agreements with cooling-off. **Uplift ≤25%** of legal costs enforced. **Contingency (percentage) fees blocked**. Bills carry the rights notice. 12-month assessment tracker |
| **Costs scales** (LCC 2026 Supreme/District Determination; WorkCover 2024 Costs Determination; ICWA's LCC cap) | In force | Effective-dated scale tables chosen per matter and per date of work. Party/party vs solicitor/client variance |
| **AML/CTF Tranche 2** (lawyers from 1 Jul 2026; enrolment within 28 days) | In force | Designated-service screening at intake and on matter-type change. Firm-level reporting-entity flag. Trust receipts tagged by exclusion basis (insurer, government, court order, fees). **Drift alerts** (trust or company formation, conveyancing, investing settlement funds). Dormant KYC/CDD/SMR module (7-year retention) |
| **Privacy Act / POLA 2024** | Tort in force 10 Jun 2025; **ADM disclosure from 10 Dec 2026**; Tranche 2 exposure draft (31 Aug 2026) | Build to full APP compliance whether or not the small-business exemption applies. Health information tagged as sensitive. Consent capture. APP 12/13 request workflow. NDB breach register (30-day assessment timer). APP 8 data-location register. **ADM register plus generated privacy-policy clause before 10 Dec 2026** |
| **Cyber Security Act 2024** | Ransomware payment reporting (turnover >$3m) within **72 h** | Incident module with ransomware timer and ASD report capture. Controls mapped to Essential Eight ML2 |
| **Court AI rules**: WA Supreme Court GenAI Guidelines; Federal Court GPN-AI (16 Apr 2026); NSW SC Gen 23 | In force | Per-matter AI-use log (tool, model, prompt, output, user) that can be exported. **"Evidence document" flag** on affidavits, witness statements and expert briefs that blocks generative drafting of a witness's evidence and prompts disclosure. Citation verification. Suppression, privilege and implied-undertaking flags block AI ingestion |
| **LPBWA / Law Society joint AI statement (Dec 2024)** | In force | No confidential data to public models (zero-retention, no-training contracts, AU region). Supervision gates. AI-saved time is not billed as manual time |
| **PI schemes**: HOS(C) Act 1995 (Medicare), Social Security Act Pt 3.14, NDIS Act, MV(TPI) Act 1943, WCIMA 2023, CLA 2002, Limitation Act 2005, SRC Act | In force | Clearances engine. Limitation calculator with partner sign-off on changes. Scheme templates. CLA thresholds re-indexed each 1 July |
| **Witnessing and e-sign** | WA affidavits and statutory declarations still need an in-person authorised witness [verify] | E-sign for engagement documents and authorities only. In-person witness checklist for WA affidavits. myID path for Commonwealth statutory declarations |
| **Marketing**: ASCR r 36, ACL, Spam Act, DNCR; possible WA PI advertising limits | In force | Consent records, unsubscribe handling, advertising review flag. **[verify] whether CLA (WA) Pt 3 PI-advertising and touting restrictions still apply**. The research gave conflicting answers |
| **Payments** | RBA surcharge removal 1 Oct 2026 | No surcharge logic in client payment flows |
| **WA PRIS Act 2024** (public sector) | IPPs 1 Jul 2026; breach notification 1 Jan 2027 | No direct obligation on the firm. Expect ICWA and WorkCover data-handling terms to change |

**Coming up:** 10 Dec 2026 (ADM, Children's Privacy Code registered) → 1 Jan 2027 (PRIS breach notification) → 2027 (Privacy Tranche 2 bill: small-business exemption, direct right of action, fair-and-reasonable test) → each 1 July (CLA indexation, scale updates) → Victorian amendments flow automatically into the WA Uniform Law.

## 6. Compliance by design: global

Detail is in [research/03](research/03-compliance-global.md). These are the decisions that must be made **now** so later markets need configuration only:

1. **Region cells.** Each tenant is pinned at creation to a region (AU first; then UK, EU, US, CA, SG). Primary database, object store, backups, search and **vector indexes, logs and LLM inference** all stay in that region. The global control plane holds only tenant ID, region, billing and SSO.
2. **Jurisdiction rule packs.** Trust accounting (AU Uniform Law, US IOLTA and three-way reconciliation, SRA Accounts Rules, Canadian by-laws, NZ regulations), costs and billing, limitation and court calendars, privacy timers (GDPR 72 h, SG 3 days, AU 30-day assessment), data-subject-request deadlines, e-signature levels, AML/KYC, retention. Every transaction records the rule-pack version it ran under.
3. **Model gateway.** Approved providers and models per region; zero data retention; no training; BAAs where needed. Per-tenant AI policy. **Per-client and per-matter "no AI" consent flag enforced at the gateway**.
4. **Human in the loop (the Garfield model).** AI output is always a draft. Nothing is sent, filed, billed or posted to trust without a named approver. No autonomous external actions.
5. **Provenance.** Every extracted fact and figure links to its source document and page. The AI interaction log records prompt, context IDs, model and version, output and approver. AI content is labelled (EU AI Act Art 50).
6. **Billing integrity.** AI-assisted time is tagged; AI costs are separate disbursements; billing time saved by AI is blocked where rules prohibit it (ABA 512, NC, PA, and the LPBWA statement).
7. **EU AI Act position.** Practice management for law firms is most likely **not** high-risk. Annex III 8(a) covers AI used by or for judicial authorities, and high-risk duties are now deferred to 2 Dec 2027 by the Digital Omnibus. To keep it that way: no HR scoring of staff, no court- or ADR-facing adjudication features, an AI-system register with documented reasons why each feature is not high-risk, and Article 4 AI-literacy support.
8. **Security and records.** Per-tenant envelope encryption, BYOK/CMK (key revocation acts as crypto-shredding), field-level encryption for medical, ID and bank data. SSO/SCIM, enforced MFA and passkeys, ABAC (attribute-based access control) plus ethical walls. Just-in-time vendor access with customer approval. A hash-chained, WORM-stored audit log. Legal hold that overrides **every** deletion path. Certified offboarding export.
9. **Assurance roadmap.** Year 1: ISO 27001:2022, SOC 2 Type I then Type II, Essential Eight ML2, annual CREST pen test. Before UK launch: Cyber Essentials Plus. Year 2: ISO 27701 and ISO 42001. IRAP only if government work requires it. Publish a trust centre and a VPAT.
10. **Accessibility.** WCAG 2.2 AA from the first component, with axe in CI. EAA exposure is mainly through the client portal.

---

## 7. Proposed architecture (recommendation, open to change)

```
┌───────────────────── Global control plane (no client data) ─────────────────────┐
│  tenant registry · region routing · billing · SSO metadata · rule-pack registry │
└──────────────────────────────────────────────────────────────────────────────────┘
        │ pinned per tenant
┌───────▼──────────── Region cell: AU (ap-southeast-2, Sydney) ───────────────────┐
│ Web app (Next.js/React, WCAG 2.2 AA)        Public API + MCP server (scoped)    │
│ ───────────────────────────────────────────────────────────────────────────── │
│ Domain services (TypeScript):                                                    │
│   Matter · Parties/Conflicts · Key-dates · Documents · Evidence/Medical ·        │
│   Damages · Settlement/Clearances · Trust ledger (event-sourced, append-only) ·  │
│   Billing/Costs · Intake · Portal · Compliance (AI log, ADM, AML, privacy)       │
│ Rule engine: versioned, effective-dated jurisdiction/scheme packs                │
│ Workflow engine: durable jobs, approval gates, chasers, deadlines                │
│ AI layer: model gateway (AU inference, zero-retention) → extraction, chronology, │
│           drafting agents; every output = draft + citations + approver           │
│ ───────────────────────────────────────────────────────────────────────────── │
│ Postgres (row-level security per tenant) · object store (WORM for audit/trust) │
│ per-tenant/matter vector namespaces · KMS (per-tenant keys, BYOK)              │
│ ───────────────────────────────────────────────────────────────────────────── │
│ Connectors: Gmail/Google Calendar, Outlook/M365, Box (first DMS), DocuSign,      │
│   bank feeds, Xero (office), Services Australia forms, eCourts PDF/A bundles     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Key choices and why:

- **Event-sourced trust ledger.** Immutability, reversal-only correction, three-way reconciliation and examiner exports come built in.
- **Rules as data.** Thresholds and scales change every 1 July, the Uniform Law changes flow in from Victoria, and new countries can be added without code forks.
- **Structured "fact objects" with provenance.** Each fact links to its document and page (the approach used by Mary Technology and Filevine). This is what makes AI output checkable and reusable across particulars, briefs and settlement.
- **Connector-first document strategy.** Keep Box and Gmail for the pilot so there is no migration risk. Offer native storage later.
- **AI inference in Australia.** Use an AU-region hosted model endpoint, for example Claude via a Sydney-region cloud deployment [verify model availability per region]. A provider-agnostic gateway allows switching.

---

## 8. Roadmap

| Phase | When | Scope | Exit criteria |
|---|---|---|---|
| **0. Foundations** | Nov–Dec 2026 | Tenancy, auth/MFA/SSO, audit log, rule-pack engine, model gateway, Box and Gmail connectors. **ADM register and privacy-policy clause for Soul Legal before 10 Dec 2026** | Security baseline. Data residency evidenced |
| **1. Pilot MVP** (~12 weeks) | Jan–Mar 2027 | Matter core plus conflict index; email filing and naming with review queue; key-dates engine (ICWA, WorkCover, SRC, District Court, NOPB) with Calendar sync and daily digest; medical chronology with citations; damages model → particulars and **Authority to Settle with clearances**; document assembly (Form 17, affidavits, letterhead). Time capture runs passively from day 1 | ≥95% filing accuracy after review; zero missed key dates; measured hours saved per stage |
| **2. Money** | Q2 2027 | Uniform Law trust ledger (or integration with the incumbent ledger first, then replacement); costs-disclosure engine; scale billing; bill of costs and timesheet reconstruction; AML screening | Clean external examination on parallel run |
| **3. Client** | Q3 2027 | Client portal, e-sign, intake assistant (web, then voice), medico-legal pipeline with funder tracking | Fewer status calls; intake conversion up |
| **4. Scale** | 2028 | Second and third AU PI firms; other states' rule packs (NSW, Vic, Qld, including Qld PIPA advertising rules); NZ, then UK cells; ISO 27001 and SOC 2 | Multi-tenant production |

---

## 9. Verification register (check before building as hard rules)

- Uniform General Rules numbering: 5-day posting (rr 44–47), 15-day reconciliation (rr 38, 48), 7-year trust record retention, s 181 cooling-off period.
- Commencement date of the LCC 2026 Supreme/District determination, and the final rates in the WorkCover 2024 Costs Determination.
- WCIMA 2023: section numbers and time limits for the common-law election and proceedings.
- ICWA s 29 notice timing; Motor Vehicle (Catastrophic Injuries) Act details.
- **Whether the WA PI advertising and touting restrictions (CLA 2002 Pt 3) are still in force.**
- Issue date of the WA Supreme Court GenAI Guidelines; whether the District Court of WA has an AI direction.
- WA electronic or remote witnessing of affidavits and statutory declarations.
- Medicare small-claim threshold; current Centrelink income test figures (always take live figures at calculation time).
- **Whether Soul Legal is covered by the Privacy Act** (turnover; "health service" test). Build to full APP regardless.
- **Whether Soul Legal does any non-PI designated services** (conveyancing, trusts, companies) that would bring it into AML/CTF.
- Availability of the chosen LLM in the AU region; whether Clio's advanced AI runs offshore (competitive claim).
- Unverified market figures (Harvey's late-2026 round, Legora Series E, EveOS date, Finch and Precedent funding).

## 10. Decisions needed from Soul Legal

1. **Trust accounting:** which package is used today? Integrate with it for the pilot, or build ours to run in parallel?
2. **Document store:** Box stays the system of record for the pilot (recommended)?
3. **Pilot users and matters:** who are the fee earners, and which matter types go first (recommended: ICWA motor vehicle and WorkCover)?
4. **Baseline metrics:** a sample of timesheets so we can measure hours saved per stage.
5. **AI consent:** wording in the costs agreement and client disclosure about AI use (we can draft it).
6. **Commercial model:** design-partner terms (for example, Soul Legal's skills and templates become product IP in exchange for free or discounted use and a revenue share, similar to the A&O Shearman–Harvey arrangement).
