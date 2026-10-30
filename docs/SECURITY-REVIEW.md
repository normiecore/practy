# Security review (30 Oct 2026)

Internal code review before go-live. Four areas were reviewed: authentication and sessions, authorisation and tenancy, input handling and data exposure, and the AI assistant and web client. A second reviewer checked each finding against the code. This is not a substitute for the independent penetration test listed in `docs/PILOT-BUILD.md`.

Attack details are deliberately left out of this file because the repository is public.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | A matter's Box folder link can be pointed at any folder the firm's Box account can reach, exposing walled matters' documents | Fixed |
| 2 | High | Matter numbers are not normalised, so a near-duplicate number can bind to another matter's folder | Fixed |
| 3 | High | AML status lists every open matter, ignoring ethical walls and AI consent | Fixed |
| 4 | Medium | Compliance lists (retention report, privacy requests) ignore ethical walls | Fixed |
| 5 | Medium | Mail sweep matches against and files into matters the mailbox owner is walled from | Fixed |
| 6 | Medium | Key date confirmation approval is not bound to the date that was reviewed | Fixed |
| 7 | Medium | Documents derived from AI-excluded documents lose the exclusion | Fixed |
| 8 | Medium | Chronology events from a document excluded after extraction stay visible to AI | Fixed |
| 9 | Medium | The MCP consent screen does not show where the token will be sent | Fixed |
| 10 | Low | Sign-in return path accepts a backslash form that leads off-site | Fixed |
| 11 | Low | Assistant conversations replay earlier matter content after a wall or consent change | Fixed |
| 12 | Low | Some unscoped read tools include data from matters without AI consent | Fixed |
| 13 | Low | The send_email recipient allowlist can be widened by an inbound email; approvers see attachment ids, not names | Fixed |
| 14 | Low | ADM register upsert does not check the record's tenant (only matters with several firms in one deployment) | Fixed |

Some rows merge closely related findings: 16 confirmed findings, plus the ADM tenant check, which was real but cannot be exploited with one firm per deployment.

Each fix has a test that fails without it. A second reviewer re-ran the original attack against each fix. Where that check found a remaining path, it was closed and tested too:
- filing or dismissing an email tied to a hidden matter;
- re-filing excluded email content to another matter;
- the assistant vouching for a sender by filing their email;
- matters that reach an assistant conversation through list results;
- closing a privacy request on a hidden matter.

## Behaviour changes to know about
- **Matter numbers** are trimmed and must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$`. Numbers with spaces, `/` or ` - ` are refused on creation and skipped on import. PracticePanther numbers such as `1998` and the `SL-2001` style are unaffected. If a firm uses a format like `2024/001`, the pattern needs widening (not the folder matching, which must stay exact).
- **Box folder links** are accepted only for the matter's own folder directly under `documents.mattersRootFolderId`. Its name must start with the matter number and ` - `, and no other matter may already link it. Stored links are re-checked on every use.
- **External MCP clients** can only receive a code at loopback or at a host in `ai.externalClientRedirectHosts` (default `claude.ai`, `claude.com`). A principal changes the list through `update_settings` (practitioner approval). Native clients with custom URL schemes cannot register.
- **Key date confirmation** approvals record the date under review. If the date changes before approval, the approval fails and confirmation must be requested again.
- **AML status, the retention report and privacy requests** show only matters the caller can see. AI surfaces see only matters with AI consent.

## Known residual risks (accepted for the pilot, revisit before wider release)
- A party added by the assistant (`add_party` from an AI surface) becomes an allowed `send_email` recipient. Sending still needs practitioner approval, and the approval card shows the recipients.
- The Box checks use the folder's current name and parent. Someone with write access to the firm's Box could rename or move folders. That is outside Practy's control.
- Matters created before this fix with a look-alike number are not migrated. Check existing matter numbers at onboarding.
- The independent penetration test is still required before go-live.
