# Deploying Practy

The pilot runs as **one deployment per firm**: a single-tenant cell in **AWS ap-southeast-2 (Sydney)**. All data stays in Australia: the database, documents (in Box, or local storage), backups, logs and AI inference (when using Bedrock).

## Architecture

```
Users ──HTTPS──▶ ALB (ACM cert, WAF) ──▶ ECS Fargate: practy container (Node 22)
                                           │   ├─ Postgres: RDS (Multi-AZ, encrypted with KMS, automated backups 35 days)
                                           │   ├─ Secrets Manager → env (PRACTY_SECRET_KEY, OAuth client secrets, API key)
                                           │   ├─ EFS (only if documents are stored locally rather than in Box)
                                           │   └─ Outbound: Box, Google/Microsoft, Xero, Claude API or Bedrock (Sydney)
                                           └─ CloudWatch Logs (ap-southeast-2, 1-year retention)
```

- Run **one task** for the pilot. The background jobs (email sweep and calendar sync) assume a single scheduler. To scale out, run one job instance with `PRACTY_JOBS=1` and set `PRACTY_JOBS=0` on the others.
- `/healthz` is the health check for both the load balancer and the container.
- Staff can install Practy on their phones from the HTTPS address (`docs/IPHONE.md`). Phones fetch `/manifest.webmanifest`, `/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png` and `/icons/*` without cookies, so do not put them behind an extra sign-in at the load balancer. `/api` answers are sent with `Cache-Control: no-store`: do not add a cache in front of `/api`.

## Build

```bash
npm ci
npm run check        # typecheck + tests (set TEST_DATABASE_URL to include the Postgres test)
npm run build        # web app → dist/web, server bundle → dist/server/main.js
docker build -t practy .
```

CI (`.github/workflows/ci.yml`) runs the checks against Postgres 16 and builds the image on every push.

## Configuration

All configuration is environment variables. `.env.example` lists every one. Required in production:

| Variable | Purpose |
|---|---|
| `NODE_ENV=production` | Turns on production checks: dev login is refused, and a secret key and database are required |
| `PRACTY_BASE_URL` | The public HTTPS URL. Used for OAuth redirects and MCP metadata, and enables secure cookies |
| `DATABASE_URL` | Postgres connection (RDS, with TLS) |
| `PRACTY_SECRET_KEY` | 32-byte base64 key that encrypts connector credentials. **Store it in Secrets Manager. Losing it means reconnecting every integration** |
| `PRACTY_TENANT_ID`, `PRACTY_FIRM_NAME` | The firm's id and display name |
| `PRACTY_BOOTSTRAP_ADMIN_EMAIL` | The first principal. Used only when no users exist yet |
| `GOOGLE_*` and/or `MICROSOFT_*` | Staff sign-in, plus Gmail/Outlook and calendar connections |
| `XERO_*`, `PRACTICEPANTHER_*` | Optional: trust shadow ledger, and matter import |
| `ANTHROPIC_API_KEY` **or** AWS credentials, plus `PRACTY_AWS_REGION=ap-southeast-2` | AI provider. Choose between them in Settings → AI |
| `PRACTY_AI_MODEL` | Model id for the chosen provider. Check that it is available in-region for Bedrock |

## OAuth redirect URIs to register

| Provider | Redirect URI |
|---|---|
| Google (sign-in) | `<BASE_URL>/auth/callback/google` |
| Google (Gmail/Calendar connect) | `<BASE_URL>/integrations/callback/google` |
| Microsoft (sign-in) | `<BASE_URL>/auth/callback/microsoft` |
| Microsoft (Outlook connect) | `<BASE_URL>/integrations/callback/microsoft` |
| Xero | `<BASE_URL>/integrations/callback/xero` |
| PracticePanther | `<BASE_URL>/integrations/callback/practicepanther` |

**Google Workspace:**
- Create an internal OAuth client.
- Scopes: `openid email profile`, plus `gmail.modify`, `gmail.send` and `calendar.events` for the connect flow.
- Set `GOOGLE_HOSTED_DOMAIN` to the firm's domain.

**Box:**
- Create a Custom App with Server Authentication (Client Credentials Grant).
- Have a Box admin authorise it.
- Give its service account access to the matters root folder.
- Enter the credentials in Settings → Integrations, and the root folder id in Settings → Firm → Documents.

## Security checklist (before real client data)

- [ ] `NODE_ENV=production`, HTTPS only (ALB redirects 80 → 443), HSTS at the ALB.
- [ ] RDS encrypted, not publicly accessible, TLS required, automated backups and PITR on, deletion protection on.
- [ ] `PRACTY_SECRET_KEY` and OAuth secrets in Secrets Manager. The IAM task role has the least privilege needed (Bedrock InvokeModel in ap-southeast-2 only, if used).
- [ ] MFA enforced in Google Workspace / Entra ID for every staff account. Turn on Settings → Identity → require MFA claim (Entra) where supported.
- [ ] WAF managed rule set on the ALB. The app also rate-limits sign-in, OAuth and API traffic.
- [ ] CloudWatch alarms: 5xx rate, health check, RDS CPU and storage.
- [ ] Restore test: restore a snapshot into a scratch instance and start Practy against it. Check that the audit chain verifies on start-up (the app refuses a broken chain).
- [ ] Penetration test (CREST-accredited) before go-live.
- [ ] Privacy policy updated with the ADM clause (Compliance → ADM register → copy clause) **before 10 December 2026**.
- [ ] External AI clients (Claude via MCP) stay **off** until the firm decides (Settings → AI) and the APP 8 disclosure is in the privacy policy.

## Operations

- **Logs:** stdout to CloudWatch. Commands are audited in the database (`audit_log`, append-only: a trigger rejects update and delete).
- **Backups:** RDS automated backups, plus a monthly snapshot copied to a second AU region (Melbourne, ap-southeast-4).
- **Upgrades:** build and push the image, then roll the ECS service. Schema changes are additive (the `records` and `audit_log` tables); `migrate()` runs at start-up.
- **Key rotation:** connector tokens are re-encrypted by reconnecting. A rotation command is on the roadmap.
