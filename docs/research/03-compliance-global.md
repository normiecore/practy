# 03 · Designing for global compliance

*As at 30 Oct 2026. Practy pilots in WA and is meant to sell into the UK, NZ, the US, the EU, Canada and Singapore later. **[V]** = confirmed in current sources. **[U]** = unverified or from background knowledge only.*

## 1. Data protection

### UK and EU

- **UK adequacy:** the EU renewed its UK adequacy decisions on 19 Dec 2025, running to **27 Dec 2031** [V]. <https://www.hunton.com/privacy-and-cybersecurity-law-blog/european-commission-renews-uk-data-adequacy-decisions>
- **UK Data (Use and Access) Act 2025:** Royal Assent 19 Jun 2025 [V]. The main changes started on **5 Feb 2026** [V]:
  - "recognised legitimate interests" as a lawful basis
  - looser rules on automated decision-making
  - a new "data protection test" for international transfers
  - subject access request searches limited to what is reasonable and proportionate
  - a complaints procedure required from about Jun 2026
  - <https://www.kennedyslaw.com/en/thought-leadership/article/2026/the-data-use-and-access-act-2025-commencement-dates-and-planned-guidance-for-2026>
- **EU Digital Omnibus (GDPR part):** proposed Nov 2025; adoption unconfirmed [U]. Design to the current GDPR.

### EU–US transfers

- **EU–US Data Privacy Framework:** the General Court upheld it in *Latombe* (3 Sep 2025). An appeal (C-703/25 P) is pending at the CJEU [V].
- Keep standard contractual clauses plus a transfer impact assessment as a fallback. Pinning EU tenants to an EU region removes most of the exposure.

### United States

- **State privacy laws:** around 20 comprehensive laws. Practy acts as processor or service provider, so it needs data processing agreement (DPA) terms.
- **CCPA regulations:** in effect 1 Jan 2026 [V]. Automated decision-making compliance from **1 Jan 2027**; risk assessments due 31 Dec 2027.
- **HIPAA** [U, legal analysis]:
  - A plaintiff PI firm receiving records from or for its client is normally **not** a business associate.
  - A defence or insurer-side firm can be one, which makes its SaaS vendor a subcontractor business associate. Offer a business associate agreement (BAA) on request, and keep the hosting and LLM providers under BAAs.

### Other jurisdictions

- **New Zealand:** Privacy Act 2020 **IPP3A** applies from **1 May 2026** [V]. Individuals must be told when their information is collected indirectly, with exceptions for legal proceedings.
  - Software: record the source on every person record, and provide a notice workflow with "exception claimed" and a reason field.
  - <https://www.privacy.org.nz/resources-and-learning/a-z-topics/ipp3a/>
- **Canada:** PIPEDA still applies. Bill C-36 was tabled 15 Jun 2026 [V]. Quebec's Law 25 requires a privacy impact assessment before transfers outside Quebec [U].
- **Singapore:** PDPA breach notification within **3 days**; penalties up to 10% of turnover [V].

### Data residency pattern

- Pin each tenant to one region: AU, EU, UK, US, CA or SG.
- Everything stays in that region: primary data, backups, search and vector indexes, logs and **LLM inference**.
- Keep a subprocessor list for each region.
- Run multiple breach clocks at once: GDPR 72 hours, Singapore 3 days, AU 30-day assessment, NZ as soon as practicable, US states vary.

## 2. AI regulation

### EU AI Act

- **Already applying:**
  - Prohibitions and the AI-literacy duty since 2 Feb 2025.
  - Duties for general-purpose AI models since 2 Aug 2025.
- **Digital Omnibus** (Reg (EU) 2026/1744, in force 27 Jul 2026) [V]:
  - High-risk duties for Annex III systems delayed to **2 Dec 2027**.
  - Annex I (product-embedded) systems delayed to **2 Aug 2028**.
  - Article 50(2) watermarking has a grace period to 2 Dec 2026 for existing systems.
  - <https://www.garrigues.com/en_GB/garrigues-digital/ai-digital-omnibus-regulation-has-been-published-redefining-deadlines-and>
- **Is legal practice management high-risk?**
  - Annex III 8(a) covers AI used **by or on behalf of judicial authorities**, or in ADR, to apply the law to facts.
  - The Commission service desk excludes administrative tools, search and transcription [V]. <https://ai-act-service-desk.ec.europa.eu/fr/node/468>
  - **Practice management sold to law firms is most likely not high-risk** [U, counsel to confirm].
  - It would become high-risk if:
    - it is sold to courts or ADR bodies
    - it is used for employment decisions about staff (Annex III point 4)
    - it is used to decide eligibility for credit or legal aid (Annex III point 5)
- **Duties that apply regardless:**
  - Article 4 AI literacy (support customers through the product)
  - Article 50 transparency (label AI chat and AI-generated content)
  - Choose model providers that have signed the general-purpose AI Code of Practice.

### United States

- **Colorado:** SB 24-205 was repealed and replaced by **SB 26-189** (signed 14 May 2026, effective **1 Jan 2027**) [V]. It is narrower and notice-focused.
- **Texas TRAIGA:** in force 1 Jan 2026.
- **Federal:** an executive order of 11 Dec 2025 set up a DOJ task force to challenge state AI laws.

### Frameworks

- NIST AI RMF plus the generative AI profile (NIST AI 600-1).
- ISO/IEC 42001, which is certifiable and an increasing differentiator.

## 3. Professional regulators on AI

### United States

**ABA Formal Opinion 512 (Jul 2024)** sets out these duties:

| Duty | Rule | What it requires |
|---|---|---|
| Competence | 1.1 | Understand the tool |
| Confidentiality | 1.6 | **Informed consent** before using self-learning tools; boilerplate is not enough |
| Communication | 1.4 | |
| Candour | 3.3 | |
| Supervision | 5.1, 5.3 | Extends to vendors |
| Fees | 1.5 | No billing for time saved; disclose any AI costs passed on |

- Relevant state opinions: Texas 705, PA/Philadelphia 2024-200, NC 2024 FEO 1, Florida 24-1, California guidance, DC 388.
- Many courts have standing orders requiring certification of AI use.

### England and Wales

- The SRA approved **Garfield.Law** (May 2025). Its conditions:
  - no proposing case law
  - client approval at each step
  - named solicitors remain accountable
  - <https://www.sra.org.uk/garfield-ai>
- *Ayinde v Haringey* (Jun 2025) concerned fake citations. The Law Society's GenAI guidance was updated afterwards.
- **SRA client money reforms:** after Axiom Ince, rules are expected in early 2027. Changes to third-party managed accounts and interest were deferred [U].

### Elsewhere

- **New Zealand:** NZLS generative AI guidance (Mar 2024, updated Dec 2025) and a citation-checking service [V].
- **Singapore:** MinLaw *Guide for Using Generative AI in the Legal Sector* (6 Mar 2026). It is addressed to legal-tech developers as well as lawyers [V]. <https://www.mlaw.gov.sg/launch-of-guide-for-using-generative-artificial-intelligence-in-the-legal-sector/>
- **Australia:** joint LPBWA / NSW / Victorian statement (6 Dec 2024). See note 02.

### Duties the product should build in, in every market

| Duty | Product feature |
|---|---|
| Competence | Explain model limits and provide training |
| Confidentiality | No training on client data, zero retention, tenant isolation |
| Supervision | Approval gates with a record of who approved |
| Candour | Citation verification |
| Billing | Tag AI time; keep AI costs as separate lines; block billing of time saved |
| Consent | AI-use flag on each client and matter |

## 4. Trust and client-money accounting variants

| Jurisdiction | Key features |
|---|---|
| **WA** | Uniform Law. General trust, controlled money and transit money. Monthly reconciliation within 15 working days. Annual external examination. 7-year retention. Records must be tamper-evident |
| **US** | Rule 1.15 plus state variations. IOLTA, with interest going to bar foundations. Three-way reconciliation monthly or quarterly. Overdraft notification. Escheat of unclaimed funds |
| **England and Wales** | SRA Accounts Rules 2019. Reconcile every 5 weeks with COFA sign-off. Return residual balances promptly. No banking facility. Accountant's report. Third-party managed accounts allowed |
| **Canada** | Provincial rules, e.g. Ontario By-Law 9. Monthly reconciliation. Cash limits (Ontario $7,500). Client identification rules |
| **NZ** | Trust Account Regulations 2008. Monthly certificate. Inspectors |
| **Singapore** | Solicitors' Accounts Rules. Client and conveyancing accounts. Accountant's report |

**Ledger engine requirements:**
- an immutable double-entry core
- trust and office money separated at the schema level
- a rule pack for each jurisdiction covering account types, reconciliation cadence and sign-off role, interest model, cash and AML thresholds, timers for residual and unclaimed funds, retention, and report templates
- hard controls: no negative client ledger, no fees without a bill, dual authorisation, bank-feed matching
- corrections only by reversal
- regulator export packs
- a single currency per trust account

## 5. Security assurance

- **SOC 2 Type II:** expected by US and global buyers. Start the observation window early.
- **ISO 27001:2022:** preferred in the UK, EU, AU, NZ and SG.
- **ISO 27701** (privacy) and **ISO 42001** (AI management).
- **UK Cyber Essentials Plus.**
- **AU Essential Eight ML2.** IRAP only for government buyers.
- **FedRAMP:** not needed.
- **Penetration testing:** an annual CREST test.
- **Outside counsel guidelines** from bank and insurer clients flow down to vendors. They typically require:
  - encryption
  - MFA
  - a stated data location
  - breach notice within 24–72 hours
  - no AI training on client data
  - right to audit
  - deletion at matter end
- **Questionnaires:** be ready for SIG and CAIQ. Publish a trust centre.
- **Also expected:** SSO/SCIM, enforced MFA, audit export to the customer's SIEM, published RTO/RPO, and a business continuity plan.

## 6. Records, e-discovery and e-signature

- **Legal hold:** overrides every deletion path (retention jobs, user deletes, version pruning, offboarding). Holds carry a reason, an issuer and a release workflow.
- **Retention:** configurable for each jurisdiction and record class. Disposition requires review and a destruction certificate.
- **E-discovery export:** native files plus metadata, hashes and chain of custody (EDRM XML or load file).
- **E-signature laws:**
  - US: ESIGN and UETA
  - EU: eIDAS / eIDAS 2.0 (simple, advanced, qualified signatures)
  - UK: UK eIDAS plus the Electronic Communications Act 2000
  - AU: Electronic Transactions Acts
  - NZ: Contract and Commercial Law Act 2017, Part 4
  - Singapore: Electronic Transactions Act, which excludes wills
- **E-signature design:**
  - pluggable providers
  - signature level set per document type
  - an evidence record (hash, timestamp, identity method)
  - a wet-ink or witnessing fallback
- **Audit log:**
  - append-only and hash-chained
  - stored in WORM storage (S3 Object Lock or equivalent) with RFC 3161 timestamps
  - covers sensitive reads, exports, AI prompts and outputs, permission changes and trust transactions
  - personal data in the log pseudonymised, so erasure requests can be honoured

## 7. Accessibility

- Target **WCAG 2.2 AA**.
- **European Accessibility Act:** applies from 28 Jun 2025 [V]. Pure B2B is a grey area, but consumer-facing client portals are the likely exposure. EN 301 549 v3.2.1 maps to WCAG 2.1.
- **Other markets:** ADA (US), Equality Act (UK), DDA (AU), AODA (Ontario).
- Publish a VPAT/ACR and an accessibility statement.

## 8. Design-for-global-compliance checklist

**Tenancy and residency**
1. Regional cells. Each tenant's region is fixed at creation; any migration is explicit and logged.
2. Everything is region-pinned, including indexes, logs and LLM endpoints. The control plane holds only minimal metadata.
3. A dedicated or VPC deployment option for large firms and government (the route to IRAP).
4. A subprocessor registry for each region, with change notices and an objection window.

**Encryption and keys**

5. TLS 1.3 in transit and AES-256 at rest. Per-tenant data keys using envelope encryption.
6. Customer-managed keys (BYOK/CMK). Revoking a key crypto-shreds the data.
7. Field-level encryption for medical, government ID, bank and AML data.

**Identity and access**

8. SAML/OIDC SSO, SCIM provisioning, enforced MFA, passkeys.
9. RBAC plus ABAC. Ethical walls. Sensitive matters deny access by default.
10. Vendor support access is just-in-time, ticketed and approved by the customer.

**Audit and records**

11. A hash-chained WORM audit log that can be exported to the customer's SIEM.
12. A retention and legal-hold engine. Certified offboarding: deletion plus an export in open formats.
13. Versioned documents with SHA-256 hashes and chain of custody.

**Rule packs** (configuration, not code forks)

14. Packs for trust, privacy timers, data subject requests (GDPR 1 month; CCPA 45 days; NZ 20 working days; AU 30 days), IPP3A notices and Quebec privacy impact assessments.
15. Packs for billing and tax, limitation periods and court calendars, e-signature levels, AML/KYC and retention.
16. Each transaction records the rule-pack version it ran under.

**AI governance**

17. A model gateway: approved models per region, zero data retention, no training, BAAs where needed.
18. A per-tenant AI policy, plus a "no AI" flag per client or matter, enforced at the gateway.
19. Human in the loop: AI output is a draft; no autonomous external actions.
20. Citation verification against authoritative sources.
21. Provenance: content labelling (Art 50), an AI interaction log, chatbot disclosure.
22. Billing integrity: AI time tagged; billing of time saved blocked where rules prohibit it.
23. Model risk management: evals, red-teaming, drift monitoring, model cards. Map to the NIST AI RMF and ISO 42001.
24. Keep high-risk uses out by design: no staff HR scoring, no court-facing adjudication. Keep an AI-system register.
25. Retrieval isolation: separate tenant and matter namespaces, ethical walls applied at retrieval, defences against prompt injection.

**Privacy operations**

26. A data map generated from the schema. DPA (GDPR Art 28, UK addendum, CCPA terms, BAA). SCCs plus transfer impact assessments.
27. Data subject request tooling that respects legal professional privilege. The firm is the controller; Practy is the processor.
28. Data classification tags (privileged, medical, financial, minor, criminal) that drive encryption, access, retention and AI eligibility.

**Assurance roadmap**

29. Year 1: ISO 27001, SOC 2 Type I then Type II, Essential Eight ML2, CREST pen test. Cyber Essentials Plus before the UK launch.
30. Year 2: ISO 27701 and ISO 42001. IRAP only on demand.
31. Trust centre, VPAT, security whitepaper, SIG/CAIQ answers ready.

**Accessibility**

32. WCAG 2.2 AA design system. axe in CI. Manual audits with assistive technology. Accessibility statement.
