# Pilot onboarding runbook: Soul Legal

Order matters: each step relies on the one before it. Allow about two working days, plus a two-week parallel run.

## 0. Before day 1 (Practy team plus a Soul Legal principal)
1. Deploy to AWS Sydney (`docs/DEPLOY.md`) with `PRACTY_TENANT_ID=soul-legal`, `PRACTY_FIRM_NAME=Soul Legal` and `PRACTY_BOOTSTRAP_ADMIN_EMAIL=<principal>`.
2. In Google Workspace, create the OAuth client and register the redirect URIs.
3. In Box, create the CCG app and have a Box admin authorise it.
4. In Xero, create the app (read-only scopes). Confirm whether the trust account is in Xero itself or in an add-on.
5. Choose the AI provider. **Bedrock in Sydney is recommended**, because inference then stays in Australia. Set the model id.

## 1. Firm set-up (principal, about 1 hour)
1. Sign in with Google.
2. **Settings → Firm:**
   - firm name and address (used on Form 17);
   - identity provider and allowed domain (`soullegal.com.au`);
   - privacy officer;
   - letter profile: sender, title, sign-off (the firm sign-off text, font, size and colours from the letterhead house style).
3. **Settings → Users:** add each staff member with their roles and fee-earner category (SP / JP / C/PL, per the bill of costs categories).
4. **Settings → Integrations:**
   - Box credentials, plus the matters root folder id (the PracticePanther root);
   - connect Xero;
   - connect PracticePanther, if using API import.
5. **Settings → Templates:** upload the **Authority to Settle** form and the **Letterhead** (the firm's own `.docx` files).
6. **Settings → Firm → Email:**
   - Provider: Gmail.
   - Filing mode: `label_bridge` for the first two weeks. Practy labels the mail and the firm's existing Apps Script files it, so nothing changes for Box. Then switch to `practy`.
   - Auto-file cap: 60.
7. **Settings → Firm → AI:** enabled. Keep external clients off for now.

## 2. Matters (principal, about 1 hour)
1. **Settings → Import matters:** run a dry run from PracticePanther (or a CSV export), check the preview, then import.
   - Matters without an injury date get a "manual" limitation entry.
2. For each pilot matter (ICWA and WorkCover):
   - check the injury date, client date of birth, references (claim number, CIV number) and party emails;
   - run **Documents → Index existing files** to pull in the Box folder.
3. **Key dates:** review every proposed date and request confirmation. A practitioner approves each one in Approvals.
   - Fill in the WorkCover election dates, which are manual until the rule is verified.
4. Each fee earner connects their Gmail and Calendar (**Settings → Integrations → Connect Google**), then runs **Diary → Sync calendar**.

## 3. Trust shadow ledger (accounts, about 30 minutes)
1. Settings → Firm → Trust, then either:
   - **Xero:** source `xero`, the trust bank account id, tracking category "Matter", and a reference pattern such as `\b(\d{3,5})\b`; or
   - **Add-on:** source `addon_csv`, the column mapping, then **Trust → Upload cashbook export**.
2. Enter the opening balances as at the start date: the cashbook total and each client ledger, from the last signed reconciliation.
3. At month end: **Trust → Prepare reconciliation** with the bank statement CSV and its closing balance. Compare the result with the existing reconciliation. **Run three clean months in parallel and get the external examiner's review before switching the trust record of truth to Practy.**

## 4. Compliance (principal, about 30 minutes)
1. **Compliance → ADM register:** review the entries, copy the clause into the privacy policy, and publish **before 10 December 2026**.
2. Add the AI-use wording to the costs agreement (client consent). Record any client who declines with **Matter → AI consent off**.
3. **Compliance → AML:** screen each open matter. PI-only work should come out as not designated.

## 5. Training (all staff, 1 hour)
- Daily: Dashboard, then Email review, then Diary.
- Matter workspace tabs. Chronology review (verify every event, using the page and the quote).
- Damages, then particulars. Settlement, then Authority to Settle.
- The Approvals inbox: what needs approval and why.
- The assistant: ask it for anything you would ask a paralegal. It drafts; you approve.

## Success measures (from the strategy)
Collect a baseline (sample timesheets) before go-live, then measure weekly:
- hours per matter stage;
- email filing accuracy: at least 95% after review (Email review → filed versus later re-filed);
- zero missed key dates;
- chronology error rate (rejected events as a share of all events);
- time from settlement acceptance to the Authority to Settle being sent.
