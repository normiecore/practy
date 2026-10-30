# 02 · Australian / WA compliance obligations for a law practice platform

*Researched 30 Oct 2026. **[V]** = verified against a primary source, or several consistent professional sources. **[U]** = unverified or status may have changed; confirm before encoding it as a hard rule. Check rule numbers in the Uniform General Rules against the current consolidated text on legislation.wa.gov.au.*

Each obligation is followed by its source and commencement, then what the software must do.

---

## 1. Legal Profession Uniform Law (WA)

**Source:** Legal Profession Uniform Law Application Act 2022 (WA). In force since **1 July 2022** [V].
- Amendments that Victoria makes to the Uniform Law flow into WA automatically [V].
- Latest WA instrument found: SL 2025/176 (15 Oct 2025).
- <https://www.legislation.wa.gov.au/legislation/statutes.nsf/legalprofession.html>

**Software:** keep a versioned table of rules and thresholds.

### 1.1 Trust accounting (LPUL Part 4.2; Uniform General Rules Part 4.2)

**Obligations**
- **General trust account** at an authorised deposit-taking institution. Deposit "as soon as practicable" (s 137).
- **Controlled money** under a written direction (s 138).
- **Transit money** (s 139).
- **Withdrawals** only as authorised. Costs may be withdrawn only under the costs-withdrawal rules, generally after a bill is given (s 144) [U on rule numbers].
- **No cash withdrawals.**
- **Irregularities** must be reported to the LPBWA (s 154).

**Timing** (LPBWA External Examiner Report form) [V]:
- Receipts and payments recorded within **5 working days** (rr 44, 45, 47).
- Month-end reports and **trust reconciliation within 15 working days** of month end (rr 38, 48).
- Examination year runs **1 Apr – 31 Mar**.
- Examiner criteria: r 65. Final report on closure of the account: r 68.
- <https://lpbwa.org.au/external-examiners>

**Retention:** 7 years [U on cite].

**Software must:**
- Run an immutable double-entry trust ledger, separated from office money, covering:
  - general trust, with a client ledger per matter
  - controlled money accounts
  - a transit register
  - investments
- Hard-block:
  - a client ledger going into overdraft
  - a trust-to-office transfer without a bill or authority
  - cash withdrawals
  - edits to closed periods (corrections by reversal only)
- Issue sequential receipts and payments with all mandatory fields.
- Alert on any bank-feed item left unposted for more than 5 working days.
- Produce the month-end three-way reconciliation, locked, with a 15-working-day countdown.
- Produce the client trust statement.
- Provide an examiner export pack and an s 154 notice template.
- Lock trust records for 7 years.
- Verify any change to bank details: call-back plus dual authorisation (payment-redirection fraud) [U, insurer risk theme].

### 1.2 Costs disclosure and billing (LPUL Part 4.3)

| Topic | Rule | Section |
|---|---|---|
| Disclosure | Disclose the basis of costs and an estimate at or near engagement; update on significant change; take reasonable steps so the client understands and consents | s 174, s 174(3) |
| Small matters | Under **$750**: no obligation. Under **$3,000**: Uniform Standard Disclosure Form allowed | r 72A |
| Third-party payers | Separate disclosure duties | s 175 |
| Failure to disclose | Agreement voidable; costs reduced | s 178 |
| Fair and reasonable | Costs must be fair and reasonable | s 172 |
| Costs agreements | Must be written or evidenced in writing | s 180 |
| Conditional ("no win no fee") | Plain-language statement, independent-advice right, **cooling-off of at least 5 clear business days** [U cite] | s 181 |
| **Uplift** | **≤ 25%** of legal costs, excluding disbursements | s 182 |
| **Contingency fees** | **Prohibited** (fee as a percentage of the recovery). Victorian group costs orders (s 33ZDA) have **no WA equivalent** | s 183 |
| Bills | Must carry a rights notice; may be electronic | ss 186–187 |
| Interest | Only if the agreement provides | s 195 |
| Assessment | Application within **12 months** | s 198 |

Status: [V for structure, U for rule numbers].

**Software must:**
- Generate the disclosure, branching at $750 and $3k.
- Store versioned disclosures and capture acknowledgements.
- Monitor estimates: alert when work in progress plus disbursements approaches the estimate.
- Provide conditional costs agreement and uplift templates, enforce the 25% cap, and run a cooling-off countdown.
- Block any fee calculated as a percentage of the recovery.
- Support the s 175 third-party payer workflow.
- Put the rights notice on bills and track the 12-month assessment window.
- Include a settlement calculator tied back to the trust ledger.

### 1.3 Costs scales

| Scale | Status | Source |
|---|---|---|
| **LCC Legal Profession (Supreme and District Courts) (Contentious Business) Determination 2026** | [V]. Commencement [U], possibly 21 Sep 2026 | <https://www.wa.gov.au/government/publications/scales-supreme-court-and-district-court-contentious-business-legal-costs-committee> |
| Magistrates Court 2026 determination | [V] | |
| **WorkCover: Workers Compensation Legal Profession and Authorised Agents Costs Determination 2024** (s 405 WCIMA) | In force from **1 Jul 2024** [V]. Final rates [U] | <https://www.workcover.wa.gov.au/news/workcover-wa-costs-determination/> |
| **ICWA motor vehicle claims** | Clients cannot be charged above the LCC scale [V] | <https://www.icwa.wa.gov.au/__data/assets/pdf_file/0009/100305/Engaging-a-Lawyer.pdf> |

**Software:** scale tables dated by when the work was done, selected per matter and stage; 6-minute units; a variance report comparing party/party with solicitor/client costs.

### 1.4 Conduct: conflicts, confidentiality, files

**Source:** Australian Solicitors' Conduct Rules 2015 (WA from 1 Jul 2022):
- r 9: confidentiality
- rr 10–11: conflicts
- r 14: client documents
- r 36: advertising

**File retention:** no statutory period. Practice is 7 years after completion, longer for minors and people under a disability [U].

**Software must:**
- Run a conflict search across all parties with fuzzy matching, and log the results.
- Enforce information barriers.
- Compute a "destroy-not-before" date per matter (for minors, e.g. the later of 7 years and age 25 [U]).
- Support legal hold, destruction certificates, and liens on file transfer.

## 2. AML/CTF Tranche 2 (AML/CTF Amendment Act 2024)

**Commencement**
- Professional services in Table 6 apply to lawyers from **1 Jul 2026** [V].
- Enrolment with AUSTRAC is required **within 28 days** of the first designated service.
- The Law Council's request for deferral was not adopted.
- <https://www.austrac.gov.au/new-austrac/designated-services-newly-regulated-entities/professional-designated-services>

**Scope for PI.** Law Council Guidance Note 4 (Jun 2026), read in full [V]:
- "Personal injury advice and litigation services are not designated services … in and of themselves."
- Item 3 (handling client money) **excludes** money:
  - for fees and disbursements
  - received or paid under a court or tribunal order
  - received from or paid to a **licensed insurer, government body or court**. The note expressly mentions an insurer paying a PI practitioner to pass on to the client.
- Result: "a personal injury practice, which does no other designated services, will be outside the Regime" even when settlements pass through trust.
- **Drift risk:** doing *any* designated service (conveyancing, trust or company formation, investing settlement funds) makes the firm a reporting entity. It also loses the "reasonably incidental" exclusion for private, non-insurer settlements.
- <https://www.alpma.com.au/wp-content/uploads/2026/07/AMLCTF-Guidance-Note-4-_-Legal-profession-designated-services.pdf>

**If the firm is a reporting entity:**
- enrolment
- an AML/CTF compliance officer
- an AML/CTF program (risk assessment, policies, senior-management approval)
- customer due diligence (KYC, beneficial owners, politically exposed persons, sanctions)
- ongoing due diligence
- suspicious matter reports within **3 business days** (24 hours for terrorism financing)
- threshold transaction reports for cash of **$10,000 or more**
- no tipping-off
- **7-year** record keeping
- an annual compliance report
- it also becomes covered by the Privacy Act for that activity

**Software must:**
1. Screen for designated services at intake and whenever the matter type changes. Hold a firm-level reporting-entity flag.
2. Classify each trust receipt by exclusion basis. Alert on private, non-insurer money.
3. Warn when a PI matter generates trust-formation, conveyancing or investment work.
4. Provide a dormant customer due diligence and suspicious-matter-report module that can be switched on.
5. Prevent the trust account being used as a bank account.

## 3. Privacy

### 3.1 Privacy Act 1988, as amended by POLA 2024 (Royal Assent 10 Dec 2024)

| Item | Status | What applies |
|---|---|---|
| **Statutory tort** for serious invasions of privacy | In force **10 Jun 2025** [V] | Applies to everyone, including small businesses |
| Penalties | In force [V structure / U amounts] | Tiered: for serious interference, the greater of $50m, 3× the benefit, or 30% of turnover. OAIC infringement notices. APP 11 now covers "technical and organisational measures" |
| **ADM transparency (APP 1)** | From **10 Dec 2026** [V] | Privacy policy must disclose decisions made or substantially assisted by computer that significantly affect individuals. <https://hamiltonlocke.com.au/transparency-in-automated-decision-making-what-regulated-entities-need-to-know-and-do-before-december-2026/> |
| Children's Online Privacy Code | Due for registration by 10 Dec 2026. Exposure draft 31 Mar 2026 | Low relevance, but minors are PI clients |
| **Tranche 2** (Privacy Amendment (Personal Data Protection) Bill 2026) | Exposure draft **31 Aug 2026**, submissions closed 18 Sep 2026. Not yet introduced [U] | About 41 reforms: direct right of action, fair-and-reasonable test, small business exemption. <https://www.hsfkramer.com/insights/2026-09/the-draft-tranche-2-privacy-act-reforms-whats-there-whats-new-and-whats-missing> |

**ADM transparency, software:** an ADM register (for example intake triage, automated limitation dates), a generated policy clause, and human-review flags.

**Small business exemption (turnover of $3m or less).** Still in force.
- The exemption is lost by entities that **provide a health service**, trade in personal information, or are AML/CTF reporting entities.
- A law firm that merely **holds** medical reports probably does not provide a health service. So Soul Legal *may* be exempt [U, needs firm-specific advice].
- **Build to full APP compliance anyway.** Health information is sensitive information (s 6) and its collection requires consent (APP 3.3).

**Notifiable Data Breaches:**
- assess a suspected breach within 30 days
- notify the OAIC and affected individuals as soon as practicable

**APP 8:** the firm remains accountable for overseas recipients (s 16C).

**Software must provide:**
- APP 1 and APP 5 templates
- consent capture
- an APP 12/13 request workflow with a clock
- sensitive-data tagging
- a breach register with a 30-day timer and OAIC form data
- a data-location and subprocessor register
- field and document access control, encryption, MFA and access logging
- destruction or de-identification when retention ends (APP 11.2)

### 3.2 WA Privacy and Responsible Information Sharing Act 2024

- Applies to the WA public sector, including ICWA, WorkCover WA and the courts [U on coverage].
- IPPs from **1 Jul 2026**; breach notification from **1 Jan 2027** [V, secondary].
- It does not bind the firm directly, but data handling with these public-sector counterparties will change.

## 4. Cybersecurity

**Cyber Security Act 2024, Part 3: ransomware payment reporting**
- In force **30 May 2025**.
- Applies to turnover **above $3m**.
- Report to the ASD within **72 hours** of payment.
- Enforcement since 1 Jan 2026 [V, secondary].
- <https://www.minterellison.com/articles/mandatory-ransomware-payment-reporting-obligations-in-force>

**Essential Eight, ISM and IRAP**
- Not mandatory for private firms.
- Essential Eight Maturity Level 2 is the de facto benchmark for insurers.
- IRAP is needed only for government work.

**Software must:**
- include an incident module with a 72-hour ransomware timer
- map controls to the Essential Eight: phishing-resistant MFA for administrators, least privilege, immutable backups with tested restores, patching SLAs, logging
- provide exportable audit logs for insurers

## 5. AI: regulation and courts

**Commonwealth**
- The **National AI Plan (2 Dec 2025)** brings no standalone AI Act; the mandatory guardrails were shelved.
- An AI Safety Institute launched in early 2026.
- The voluntary standards remain voluntary.
- <https://www.minterellison.com/articles/australia-introduces-a-national-ai-plan-four-things-leaders-need-to-know>

**Court and regulator rules**

| Body | Instrument | Key requirements |
|---|---|---|
| **Supreme Court of WA** | *Guidelines for the Use of Generative AI*. Guidelines, not a practice direction. Consultation Feb 2025; the Law Society WA made a submission in Apr 2025 | Verify all output. Disclose when directed, or "where otherwise necessary or appropriate". Issue date [U]. <https://www.supremecourt.wa.gov.au/_files/Guidelines%20for%20the%20Use%20of%20Generative%20Artificial%20Intelligence.pdf> |
| **District Court of WA** | No AI direction found [U] | |
| **Federal Court** | **GPN-AI (16 Apr 2026)** [V] | Disclosure is **mandatory for generative AI in affidavits, expert reports and evidence**, at the start of the document. Keep records of tool, prompts and outputs. <https://www.fedcourt.gov.au/law-and-practice/practice-documents/practice-notes/gpn-ai> |
| **NSW Supreme Court** | **SC Gen 23** (from 3 Feb 2025) | Affidavits must state that generative AI was not used to generate their content. Experts need leave. Restricted material may go only into closed systems. Citations must be verified |
| **LPBWA, Law Society of NSW and Victorian Legal Services Board** | Joint statement (6 Dec 2024) | No confidential information in public tools. Lawyers remain responsible. Supervision. Do not bill time that AI saved. Enforcement example: *Dayal* (Vic, practising certificate restricted over fake citations). <https://www.lpbwa.org.au/ai-guidance-to-safeguard-consumers-of-legal-services> |

**Software must:**
- run in a closed, contractually confidential AI environment: no training on the data, AU region
- keep a per-matter AI-use log that can be exported
- put an **"evidence document" flag** on affidavits, witness statements and expert briefs
- check citations
- set suppression, privilege and implied-undertaking flags that block AI use of the material
- record AI time separately
- maintain an ADM register

## 6. PI statutory schemes

### Medicare: Health and Other Services (Compensation) Act 1995

**Notice of Past Benefits**
- Requested on form MO026, valid **6 months** [V].
- If the notice has expired at settlement, a s 23A statement (MO023) is used.

**At settlement or judgment**
- Lodge **MO022 within 28 days** of settlement or judgment.
- The payer must pay the Medicare charge before releasing the compensation.
- If there is no current NOPB, the payer can pay 10% in advance [V].
- Small-claim threshold about $5,000 [U].

**Sources**
- <https://www.servicesaustralia.gov.au/notice-past-benefits-for-medicare-compensation-recovery>
- <https://www.servicesaustralia.gov.au/medicare-compensation-recovery-notification-requirements>

### Centrelink: Social Security Act 1991, Part 3.14

- **Preclusion period** = 50% of the lump sum ÷ the income cut-out at the settlement date. It usually runs from the injury date.
- The 50% rule applies to agreed settlements.
- <https://www.servicesaustralia.gov.au/how-we-calculate-preclusion-periods-for-centrelink-compensation-recovery>

### NDIS: NDIS Act ss 104–107

- The NDIA can recover past supports.
- A **Compensation Reduction Amount** reduces future plans. It is not a debt, and it applies even where liability is denied.
- <https://ndis.gov.au/participants/compensation-and-your-plan/recovery-compensation-reduction-amounts-and-special-circumstances>

**Other recoveries:** DVA, private health insurers, Comcare.

### ICWA: Motor Vehicle (Third Party Insurance) Act 1943

- Notice under s 29 "as soon as practicable" [U on any fixed deadline].
- **3-year** limitation; ICWA can extend only in exceptional cases [V]. <https://www.icwa.wa.gov.au/__data/assets/pdf_file/0023/100949/Fact-Sheet-Limitation-Periods.pdf>
- Motor Vehicle (Catastrophic Injuries) Act 2016: no-fault catastrophic scheme [U].

### WorkCover: Workers Compensation and Injury Management Act 2023 (WA)

**Commencement and instruments**
- In force from **1 Jul 2024** [V].
- Accompanying instruments: Regulations 2024 and the Conciliation and Arbitration Rules 2024.

**Common-law claims**
- Common law requires **≥15% WPI** plus an election on form **CL1**.
- Damages are capped in the 15–25% band.
- After an election in that band, weekly payments stop after about 6 months.
- <https://workcover.wa.gov.au/wp-content/uploads/2024/06/Information-Sheet-39-Common-Law.pdf>

**Assessment and disputes**
- WPI is assessed by an Approved Permanent Impairment Assessor under the WA Guidelines.
- Disputes go through conciliation, then arbitration.
- Section numbers and time limits [U].

### Civil Liability Act 2002 (WA)

- General-damages thresholds and deductibles are **indexed each 1 July**.
- **The Act's long title refers to restricting PI advertising and touting (Part 3). Whether this is still in force is [U]. Must verify.**
- *Browne* [2006] WASAT 201 found "no compensation = no legal fees" advertising misleading.
- Note: separate research found no PI-specific WA advertising ban beyond ASCR r 36 and the ACL. **The two findings conflict; resolve before building marketing features.**
- Queensland PIPA ss 63–69 restrictions still apply and are enforced (2026 reprimand).

### Limitation Act 2005 (WA)

- Personal injury: generally 3 years.
- Extended for minors and people under a disability; special rules for latent injuries and asbestos [U on sections].
- **Software:** limitation calculator; hard-diarised critical date; escalating reminders; partner sign-off on any change.

### SRC Act 1988 / Comcare

- s 45 election to sue: must be made before any permanent impairment payment is received; it is irrevocable.
- Non-economic loss capped at $110,000 [V]. <https://www.comcare.gov.au/about/forms-pubs/docs/pubs/claims/claims-manual-extractions-redacted/Electing-to-sue-the-Commonwealth.pdf>
- Reviews now go to the Administrative Review Tribunal (from 14 Oct 2024) [U].

### District Court of WA and eCourts

- PI medical evidence rules: rr 47B and 47E.
- Medical experts are exempt from the Harmonised Expert Code unless ordered otherwise [V].
- Filings must not contain tracked changes.
- No public eCourts API, so produce PDF/A bundles for upload [U].

## 7. Other obligations

**Execution and witnessing**
- **E-signing:** the Electronic Transactions Act 2011 (WA) supports e-signing of costs agreements and authorities.
- **WA affidavits and statutory declarations** (Oaths, Affidavits and Statutory Declarations Act 2005): an authorised witness in person is still required [U].
- **Commonwealth statutory declarations** can be digital through myID (from 1 Jan 2024) [U].

**Retention periods**

| Records | Period |
|---|---|
| Trust | 7 years |
| AML (if a reporting entity) | 7 years |
| Tax | 5 years |
| Employee | 7 years |
| Client files | 7 years or more |

**Marketing**
- Spam Act: consent, identify the sender, act on unsubscribes within 5 business days.
- DNCR.
- ACL ss 18 and 29.
- ASCR r 36.

**Payments**
- RBA **card surcharging removed from 1 Oct 2026** [V, secondary].
- Payday super from 1 Jul 2026 [U].

**Tax**
- Distinguish taxable disbursements from agency disbursements for GST.
- Trust money is not income until it is transferred to pay a bill.

**Not applicable**
- Modern Slavery Act: applies only above $100m revenue.
- Corporations obligations: only if the firm is an incorporated legal practice.

**Data sovereignty**
- Not legally mandated.
- In practice, APP 8, privilege, insurers and government counterparties make **AU hosting with no offshore support access** the expected standard.

## 8. What's coming

| Date | Change |
|---|---|
| Already in force | Privacy tort (10 Jun 2025); ransomware reporting (30 May 2025); AML/CTF Tranche 2 (1 Jul 2026); WA PRIS Act IPPs (1 Jul 2026); Federal Court GPN-AI (16 Apr 2026); card surcharge ban (1 Oct 2026) |
| ~21 Sep 2026 [U] | LCC 2026 costs determination |
| **10 Dec 2026** | APP 1 ADM disclosures; Children's Online Privacy Code registered |
| 1 Jan 2027 | WA PRIS Act breach notification |
| 2027 | Privacy Tranche 2 bill |
| Ongoing | Victorian Uniform Law amendments flow into WA; CLA indexation each 1 July; Essential Eight and ISM updates; possible District Court of WA AI direction |

## 9. Pilot priorities

1. Trust ledger with the 5-day and 15-day controls and examiner export.
2. Costs disclosure engine (thresholds, 25% uplift cap, contingency-fee block).
3. Limitation and key-date engine.
4. Medicare, Centrelink and NDIS clearances, linked to the settlement calculator.
5. AML designated-service screening and drift alerts.
6. Privacy, breach and ransomware module, plus the ADM register before 10 Dec 2026.
7. AI-use log and evidence-document safeguard.
8. AU hosting, controls aligned to the Essential Eight, immutable audit log.
