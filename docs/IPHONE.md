# Practy on iPhone: options

Researched 31 Oct 2026 from Apple, Google, Microsoft, WebKit and Capacitor primary sources, then cross-checked by a second reviewer. Recheck before acting: Apple's terms changed as recently as 29 Oct 2026.

Every option needs the Practy server hosted at an HTTPS address (`docs/DEPLOY.md`). A phone app is a window onto that server, not a copy of it.

## The three routes

| | A. Installable web app | B. TestFlight app (shell loading the hosted site) | C. TestFlight app (bundled pages) |
|---|---|---|---|
| What staff do | Open Practy in Safari, Share → Add to Home Screen (or the firm's device management pushes it) | Install from TestFlight | Install from TestFlight |
| Apple account, Mac, review | None | Developer Program, a Mac or macOS CI for every build | Same as B |
| Sign-in | Works as in Safari; verify Google, Microsoft and MFA on a real iPhone | Needs a new sign-in handoff: Google blocks sign-in inside app web views | Same as B, plus a new bearer credential |
| Approvals | Unchanged (cookie session) | Unchanged (cookie session) | Needs a new token type that can approve trust payments: security review required |
| Notifications | Web Push, iOS 16.4+, once added to the Home Screen | Apple push (APNs) | Apple push (APNs) |
| Effort on top of the phone layout work | 1.5 to 2 days (3 to 4 more for push) | 7 to 10 days | 14 to 20 days |
| Ongoing | Nothing extra | New build at least every 90 days, yearly Xcode updates | Same as B, plus app and server versions kept in step |

**Recommendation:** finish the phone layout work, then ship route A for the pilot. Use route B only if the firm specifically wants an App Store-installed app, and treat it as a pilot, not production (see below). Avoid route C.

Phone layout work, needed by every route: tables as stacked cards (key dates, documents, matters, diary), a bottom tab bar, a section picker for matter tabs and full-screen dialogs. About 4 to 6 days. The app shell, sign-out, field sizes and key-value lists were fixed on 31 Oct 2026 and are covered by `e2e/mobile.spec.ts`.

## Apple facts that decide it

- **TestFlight is for testing, not production.** The Developer Program License Agreement limits internal TestFlight use to "testing, evaluating and/or developing", and every build stops opening 90 days after upload. ([DPLA](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/) s7.4, [TestFlight](https://developer.apple.com/testflight/))
- **Who counts as an internal tester decides whether review applies.** Up to 100 internal testers, who must be App Store Connect users of the account holder's organisation. Their builds need no review. ([TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview))
  - If the firm enrols its own organisation account, staff are internal testers.
  - If the developer holds the account, firm staff are external testers. External builds go through App Review (the first build of each version), which checks Guideline 4.2: an app must be "beyond a repackaged website". ([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/))
- **The long-term Apple route is a Custom App.** It is privately distributed to the firm through Apple Business (free; it replaced Apple Business Manager in April 2026), and gets full App Review, including 4.2, for every version. ([Apple Business guide](https://support.apple.com/en-au/guide/business/axm402206497/web))
- **Enrolment.** The fee is 99 USD a year, or the local price shown at enrolment; Apple publishes no AUD figure (about A$150 is commonly quoted). An organisation needs a D-U-N-S number and must enrol as its legal entity; Apple does not accept trade names. Allow about a week for the D-U-N-S number. ([Enrol](https://developer.apple.com/programs/enroll/), [D-U-N-S](https://developer.apple.com/support/D-U-N-S/))
- **Builds need macOS.** Xcode Cloud includes 25 hours a month, but its first-time setup needs a Mac once. GitHub Actions macOS runners are the other option. ([Xcode Cloud](https://developer.apple.com/xcode-cloud/))
- **Reviewer access.** Any review needs a working demo login. Production Practy allows only Google or Microsoft sign-in, so a reviewer account or a staging firm with sample data would be needed. Never use real client data.

## Sign-in inside an app

- **Google blocks sign-in inside embedded web views,** including iOS app web views (error `disallowed_useragent`). Apps must use the system browser. ([Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies), [native apps](https://developers.google.com/identity/protocols/oauth2/native-app))
- **Microsoft** advises the system browser too, because single sign-on, Conditional Access and passkeys depend on it. ([MSAL web views](https://learn.microsoft.com/en-us/entra/msal/objc/customize-webviews))
- **What route B needs:**
  1. The app opens sign-in in the system browser (ASWebAuthenticationSession).
  2. The server hands back a short-lived, single-use code through a universal link or the app's URL scheme.
  3. The app exchanges the code for its normal session cookie.

  That code must be bound to the request (PKCE), last about a minute, and never pass through `safeReturnTo` or the MCP OAuth server.
- **Capacitor's own docs say pointing the app at a remote site (`server.url`) is "not intended for use in production"** ([config](https://capacitorjs.com/docs/config)). Route B is fine for a pilot, but it is the shape most likely to be called a repackaged website at review.

## Installable web app details

- **Home Screen web apps** open full screen without browser controls. iOS 26 and later do this by default, and a manifest and icons improve the result.
- **Web Push** works only once the app is on the Home Screen (iOS 16.4+). The subscription must start from a tap, and every push must show a notification. No Apple Developer account is needed. ([Apple: web push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers))
- **A firm-managed rollout** can push it to staff phones as a full-screen Web Clip through device management, Intune included. ([Web Clips payload](https://support.apple.com/guide/deployment/web-clips-payload-settings-depbc7c7808/web))
- **Home Screen apps keep their own cookies, separate from Safari.** There is an open WebKit report of sessions resetting on iOS 17 ([bug 272325](https://bugs.webkit.org/show_bug.cgi?id=272325)). Test sign-in with Google, Microsoft and MFA on real iPhones before relying on it.
- **None of the EU-only browser or app-distribution changes apply in Australia.**

## Privacy

- **Phones get lost.** Do not let a service worker cache `/api` responses or documents.
- **Signing out a lost device:** there is no "sign out this device" feature yet. Add one before staff use personal phones for client matters (APP 11).
