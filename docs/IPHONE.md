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

**Status (31 Oct 2026): route A is built,** apart from hosting Practy at its HTTPS address and the checks on real phones below. See "Route A: what is built" and "How staff install it".

Phone layout work, needed by every route: tables as stacked cards (key dates, documents, matters, diary), a bottom tab bar, a section picker for matter tabs and full-screen dialogs. Done on 31 Oct 2026 and covered by `e2e/mobile*.spec.ts`.

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

## Route A: what is built

- **Manifest** (`web/public/manifest.webmanifest`): name and short name "Practy", start at `/#/` (Today), scope `/`, standalone display, background and theme colours from `web/styles.css`, and 192 and 512 pixel icons plus a 512 pixel maskable icon for Android.
- **Icons:** a generic Practy mark (a white P on the app's blue), never a firm's branding. `web/public/favicon.svg` is the source. `node scripts/make-icons.mjs` renders the PNGs, the 180 pixel opaque `apple-touch-icon.png` and `favicon.ico` from it with Playwright's Chromium; commit what it writes.
- **Head tags** on the app (`web/index.html`) and on the sign-in page (`INSTALL_HEAD` in `src/server/http.ts`): manifest, icons, light and dark theme colours, and the Apple title and status bar style. Staff who are signed out see the sign-in page, so installing from there still installs Practy, not the sign-in address.
- **Public without sign-in:** only the manifest, icons and favicon (plus the script bundle, as before). Every other page still sends a signed-out visitor to sign in, and `/api` still answers 401.
- **No service worker.** None is needed to install, and the firm's privacy rules forbid keeping `/api` answers or documents on devices.
- **Tests:** `test/install.test.ts` and `e2e/install.spec.ts` (files served signed out with the right types and caching, icon sizes and opacity, the tags on both pages, Chromium reading the manifest without errors, `/api` still behind sign-in).

## How staff install it

Practy must first be at its HTTPS address (`docs/DEPLOY.md`).

- **iPhone (Safari):** open the Practy address, tap **Share**, then **Add to Home Screen**. If **Open as Web App** is shown, leave it on. Tap **Add**.
- **Android (Chrome):** open the Practy address, tap the **⋮** menu, then **Install app**. On some phones it reads **Add to Home screen**, then **Install**.
- Open Practy from its new icon and sign in. On iPhone the Home Screen app keeps its own sign-in, separate from Safari, so this is needed even if Safari is already signed in.
- Firm-managed phones can get Practy as a full-screen Web Clip from the firm's device management instead.

## What to test on a real phone

Before staff rely on it, on at least one iPhone and one Android phone:

- [ ] Install from the sign-in page (signed out) and from inside the app. Both show the Practy icon and the name "Practy", and open full screen on Today (after sign-in), not on the sign-in address.
- [ ] Sign in inside the installed app with Google, then Microsoft, with MFA. Close the app fully and reopen it, then restart the phone: still signed in until the session ends (WebKit bug 272325).
- [ ] Status bar and top bar in light and dark mode: readable, and the top bar, bottom tab bar and dialogs keep clear of the notch and home indicator.
- [ ] Approve something in Approvals from the installed app.
- [ ] Download a document, then return to Practy. Follow a link to another site, then return.
- [ ] Android: the icon fills the launcher's shape cleanly (the maskable icon) and the splash screen matches the app.
- [ ] Sign out, close and reopen: the app opens on the sign-in page.

## Privacy

- **Phones get lost.** Do not let a service worker cache `/api` responses or documents. Practy has no service worker, and every `/api` answer (documents included) is sent with `Cache-Control: no-store`, so the browser does not keep it either.
- **Signing out a lost device:** there is no "sign out this device" feature yet. Add one before staff use personal phones for client matters (APP 11).
