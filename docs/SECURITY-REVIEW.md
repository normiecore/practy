# Security review (30 Oct 2026)

Internal code review before go-live. Four areas were reviewed: authentication and sessions, authorisation and tenancy, input handling and data exposure, and the AI assistant and web client. A second reviewer checked each finding against the code. This is not a substitute for the independent penetration test listed in `docs/PILOT-BUILD.md`.

Attack details are deliberately left out of this file because the repository is public.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | A matter's Box folder link can be pointed at any folder the firm's Box account can reach, exposing walled matters' documents | Fix in progress |
| 2 | High | Matter numbers are not normalised, so a near-duplicate number can bind to another matter's folder | Fix in progress |
| 3 | High | AML status lists every open matter, ignoring ethical walls and AI consent | Fix in progress |
| 4 | Medium | Compliance lists (retention report, privacy requests) ignore ethical walls | Fix in progress |
| 5 | Medium | Mail sweep matches against and files into matters the mailbox owner is walled from | Fix in progress |
| 6 | Medium | Key date confirmation approval is not bound to the date that was reviewed | Fix in progress |
| 7 | Medium | Documents derived from AI-excluded documents lose the exclusion | Fix in progress |
| 8 | Medium | Chronology events from a document excluded after extraction stay visible to AI | Fix in progress |
| 9 | Medium | The MCP consent screen does not show where the token will be sent | Fix in progress |
| 10 | Low | Sign-in return path accepts a backslash form that leads off-site | Fix in progress |
| 11 | Low | Assistant conversations replay earlier matter content after a wall or consent change | Fix in progress |
| 12 | Low | Some unscoped read tools include data from matters without AI consent | Fix in progress |
| 13 | Low | The send_email recipient allowlist can be widened by an inbound email; approvers see attachment ids, not names | Fix in progress |
| 14 | Low | ADM register upsert does not check the record's tenant (only matters with several firms in one deployment) | Fix in progress |

Some rows merge closely related findings: 16 confirmed findings, plus the ADM tenant check, which was real but cannot be exploited with one firm per deployment.
