# 04 · Plaintiff PI workflow and where AI can help

*As at 30 Oct 2026. **[V]** = official or primary source, **[S]** = secondary source (law firm, vendor or press), **[U]** = unverified.*

## 1. The life of a WA PI matter, and the manual work in it

| Stage | What happens | Manual work today |
|---|---|---|
| **1. Enquiry and intake** | Scheme triage: ICWA motor vehicle, WorkCover WA, public liability, Comcare/SRC, medical negligence. Merits and limitation screen. Conflict check across client, driver, employer and insurer | Re-keying details; searching for conflicts; after-hours callbacks; chasing ID and signed authorities |
| **2. Costs agreement** | Conditional agreement under the Uniform Law (uplift ≤25%, no contingency fees). ICWA matters are capped at the LCC scale [V]. Workers' comp costs follow the WorkCover s 405 determination | Choosing the scheme template; estimating costs; re-disclosing when the estimate changes; chasing e-signatures |
| **3. Limitation and key dates** | ICWA: notice as soon as practicable; 3-year limitation [V]. WorkCover: ≥15% WPI plus CL1 election; 15–25% damages band [V]. SRC s 45: irrevocable election, made before any permanent impairment payment; non-economic loss capped at $110k [V] | Hand-kept diaries and spreadsheets. **This is the biggest professional-negligence risk** |
| **4. Evidence** | Police report, ICWA claim form, GP, hospital and specialist records, PBS/MBS history, payslips and tax records, photos, witnesses, insurer file | Request letters with authorities; chasing every 14–21 days; logging; renaming and filing; ordering and de-duplicating pages; paying provider invoices |
| **5. Medico-legal** | WPI assessment by an Approved Permanent Impairment Assessor under the WA Guidelines [V]. District Court rules for PI medical evidence (r 47B/47E); PI medical experts are exempt from the Harmonised Expert Code [V] | Choosing the expert; letter of instruction and brief; booking; chasing the report; paying; summarising into damages; spotting inconsistencies between reports |
| **6. Pre-litigation disputes** | WorkCover: conciliation, certificate of outcome, then arbitration [V]. ICWA: negotiation with a claims officer. No formal WA pre-action protocol [U] | Statements of loss; economic loss calculations; conference preparation; offer letters |
| **7. District Court** | Writ and statement of claim; particulars (r 45C); discovery (Form 17, O 26); affidavits; case management; mediation or pre-trial conference | Forms; indexing annexures; discovery lists; deadlines; removing tracked changes before eCourts filing |
| **8. Settlement** | Authority to Settle. Medicare: NOPB valid 6 months; **MO022 within 28 days**; payer pays Medicare first [V]. Centrelink: preclusion period of 50% ÷ income cut-out [V]. NDIS: recovery plus Compensation Reduction Amount [V]. Court approval for minors | NOPB request and expiry tracking; clearances; preclusion calculation; recalculating the Authority as figures move; advice letters |
| **9. Distribution and closure** | Funds into trust; pay Medicare, Centrelink, health funds and funders; final bill; distribute net amount; reconciliation; closing letter | Drawing the bill (6-minute units); rebuilding timesheets from email; trust statement; closure checklist |

**Hidden cost across every stage:** email. Reading it, filing it into Box, renaming it, and pulling out dates and tasks.

## 2. Overseas AI tools for plaintiff PI firms

| Product | Market | What it does | Funding and scale | Notes |
|---|---|---|---|---|
| **EvenUp** | US | Demand letters, medical chronologies | US$150M Series E at US$2B+ (Oct 2025); 2,000+ firms [S] | Vendor benchmark: 90% accuracy matching service dates to providers, against 68% for GPT-4. Business Insider (2024): heavy human involvement; review caught missed injuries and invented conditions. **Lesson: build the human review step in from the start** |
| **Supio** | US | Linked medical chronologies, mass tort | US$60M Series B (2025) [S] | |
| **Eve** | US | Chronologies, risk flags, damages, intake | US$103M Series B at US$1B (Sep 2025) [S] | |
| **Finch** | US | AI for pre-litigation | Sequoia-backed (Apr 2025) [S] | |
| **Precedent** | US | Case setup, policy checks, demands | | |
| **Painworth** | Canada | Valuation and settlement of simple claims by machine learning | | Nearest example of settlement-value prediction |
| **Filevine MedChron** | US | Page-linked facts that feed DemandsAI | (Jun 2025) | |
| **CaseMark** | US | Medical summaries | About US$0.10/page [U] | |

**Accuracy evidence.**
- Stanford RegLab/HAI (2024) found hallucination rates of 17–33% in legal research tools [V].
- Pulling facts from the firm's own records is a narrower task, and safer when every fact cites its page.
- **Design rule:** every figure links to its source page, and a human signs off.

**Australian adoption.**
- LexisNexis 2025 AU survey: 69% of lawyers use or plan to use generative AI, and about two-thirds of small firms already do [S].
- Law Society WA survey, May 2025.
- No adoption data specific to PI firms.

**Gap.** None of these tools localise for Australia. None handle:
- ICWA or WorkCover forms
- WPI under the WA Guidelines
- Medicare NOPB or Centrelink preclusion
- Griffiths v Kerkemeyer care claims
- 5% or 3% discount tables
- WA court forms

## 3. The Australian PI market

**Major firms**
- Slater & Gordon: digital and automated UK programme; AU AI unconfirmed.
- Shine: onboarding automation, an app, an AI and innovation role.
- Maurice Blackburn: the "Morry" intake assistant (2026).
- Carter Capner (Qld) and Gerard Malouf & Partners (NSW).

**Perth competitors seen in the research**
- Foyle Legal
- Andersons
- Taylor Smart / TGB
- LHD Lawyers
- Bradford Legal

**Advertising rules**
- ASCR r 36 and the ACL apply everywhere.
- Queensland PIPA ss 63–69 restrictions are actively enforced (2026 reprimand).
- **WA: whether the Civil Liability Act Pt 3 PI-advertising and touting provisions still apply is unresolved. See note 02. Must verify.**
- Any AI intake or marketing content must give no advice and promise no outcomes.

**Disbursement funding**
- Litigation funders avoid individual PI claims.
- Disbursement lenders include MA Legal Funding, Lex Medicus and Ask Funding.
- No WA equivalent of the SA Litigation Assistance Fund [U].
- **Product:** track unbilled disbursements as working capital, and show funder interest and payout on the settlement statement.

## 4. Ranked features for a small to mid-size AU PI firm

Time savings are estimates [U]. Validate them against Soul Legal timesheets.

| Rank | Feature | Why | Est. saving |
|---|---|---|---|
| 1 | **Email and document intake to the matter.** Auto-match the matter, apply the naming convention, file to Box, extract dates, tasks and facts | Largest volume of work; Soul Legal already has skills for this | 30–60 min per fee earner per day |
| 2 | **Limitation and key-date engine.** ICWA, WorkCover CL1, SRC s 45, NOPB 6 months, MO022 28 days, court timetables | Biggest risk reduction | Avoided negligence risk |
| 3 | **Medical chronology with page citations.** WPI and diagnosis extraction, pre-existing-condition flags | Core value of the US tools | 3–10 h per 500–1,000 pages |
| 4 | **Damages and particulars builder.** r 45C schedule, economic loss, Griffiths v Kerkemeyer, special damages | Turns medical facts into money | 2–5 h per matter |
| 5 | **Settlement and clearances.** Authority to Settle, Medicare, Centrelink, NDIS, funder, costs | High cost of errors; it's what the client cares about | 1–3 h per settlement |
| 6 | **Correspondence and chasing agent.** Requests, 14- and 28-day follow-ups, expert bookings | | 1–2 h per matter per month |
| 7 | **Court document assembly.** Form 17, affidavits and annexures, tracked-changes removal | Soul Legal already has skills for this | 2–6 h per document set |
| 8 | **Bill of costs and timesheet rebuild.** 6-minute units from email, documents and calendar; LCC, ICWA and WorkCover caps | Captures time that currently goes unrecorded | 3–8 h per bill |
| 9 | **Intake assistant.** Web, then voice; triage; limitation screen; e-signed costs agreement | Converts more enquiries | 15–30 min per enquiry |
| 10 | **Client portal and updates** | Fewer "where's my claim" calls | |
| 11 | **Matter analytics and settlement-value range** | Needs data; record outcomes in structured form from day one | |

## 5. Proposed pilot MVP (~12 weeks, Soul Legal)

**Build on Box, Gmail, Google Calendar and the existing Word templates.** The pilot does not replace the document store.

**In scope**
- (a) Matter record and conflict index.
- (b) Email filing and naming, with confidence scores and a review queue.
- (c) Key-date engine with Calendar sync and a daily digest. A lawyer confirms each date the rules generate.
- (d) Medical chronology with page citations, plus WPI and diagnosis extraction.
- (e) Particulars and Authority to Settle on one damages and deductions model, including NOPB tracking and a Centrelink estimate.
- (f) Document generation: Form 17, affidavit with annexures, letterhead letters.

**Out of scope for the MVP**
- Voice intake
- Client portal
- Trust accounting (integrate with the existing package instead)
- Value prediction
- Bill of costs (phase 2; passive time capture starts now)

**Success measures**
- Hours per stage, before and after.
- Filing accuracy ≥95% after review.
- Zero missed dates.
- Error rate in chronology fact checks.
- Time from acceptance of an offer to sending the Authority to Settle.

**Guardrails**
- AU data residency.
- No training on client data.
- Every AI output cites its source and needs human sign-off.
- Comply with the court AI practice notes (see note 02).

## Items to verify

- WorkCover election and proceedings time limits; the final rates in the 2024 Costs Determination.
- LCC scale items for ICWA matters.
- District Court rule numbers (r 45C, rr 39–47E).
- Scope of the 2022 WA conditional costs agreements rule.
- WA PI advertising restrictions.
- AI deployments at the major firms.
- Funding for Finch and Precedent; CaseMark pricing.
- Live Medicare and Centrelink figures, taken at the time of each calculation.
