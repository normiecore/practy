/**
 * Sign-in sessions as people see them: which devices are signed in, and ending them
 * (a lost phone, a shared computer, someone leaving the firm).
 */
import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import type { Store } from "../domain/store.js";
import type { ApiKey, Session, SessionEndReason } from "./model.js";

/** How often use of a session may update its "last seen" time, so a busy session does not write on every request. */
export const LAST_SEEN_EVERY_MS = 5 * 60_000;

/** Collection kinds, shared with the auth service and the MCP OAuth server. */
export const SESSION_KIND = "session";
export const API_KEY_KIND = "api_key";
export const OAUTH_TOKEN_KIND = "oauth_token";

/** The fields of an MCP OAuth token (src/auth/mcp-oauth.ts) needed to revoke a user's tokens. */
interface OAuthTokenRecord {
  id: string;
  tenantId: string;
  userId: string;
  clientId: string;
  expiresAt: number;
  revoked: boolean;
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\b(?:Headless)?Chrome\/|\bCriOS\/|\bChromium\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];
const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b|\biPod\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMacintosh\b|\bMac OS X\b/, "Mac"],
  [/\bLinux\b/, "Linux"],
];

/**
 * A coarse description of the browser and platform from a User-Agent, such as "Safari on iPhone".
 * Only this is stored: the full string carries version and build detail that, with the network,
 * comes close to fingerprinting a device, and nobody needs it to recognise their own phone.
 */
export function describeDevice(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const platform = PLATFORMS.find(([re]) => re.test(ua))?.[1];
  let browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  // Home Screen apps and in-app browsers on iOS are WebKit without Safari's own markers.
  if (!browser && (platform === "iPhone" || platform === "iPad") && /AppleWebKit\//.test(ua)) browser = "Safari";
  if (!browser && !platform) return "Unknown device";
  return `${browser ?? "Unknown browser"} on ${platform ?? "unknown platform"}`;
}

/** The eight 16-bit groups of a valid IPv6 address. */
function ipv6Groups(address: string): number[] {
  let s = address;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  return [...h, ...Array<string>(fill).fill("0"), ...t].map((g) => parseInt(g, 16));
}

/** RFC 5952 text form: lower case, no leading zeros, the longest run of two or more zero groups as "::". */
function formatIpv6(groups: number[]): string {
  let best = { at: -1, len: 1 };
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === 0) j++;
    if (j - i > best.len) best = { at: i, len: j - i };
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best.at < 0) return hex.join(":");
  return `${hex.slice(0, best.at).join(":")}::${hex.slice(best.at + best.len).join(":")}`;
}

/**
 * The client address cut to its network: the first three parts of an IPv4 address (/24) or the
 * first three groups of an IPv6 address (/48). Privacy (APP 11, and APP 3: collect only what is
 * needed): a full address can point to one household or one device, which is more personal
 * information than this feature needs. The network is still enough for someone to tell "the office"
 * or "my mobile carrier" from somewhere they have never been, which is what spotting a lost or
 * stolen device takes. Returns undefined for anything that is not an IP address.
 */
export function truncateIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  let a = ip.trim().replace(/%.*$/, ""); // drop an IPv6 zone such as %eth0
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  if (mapped) a = mapped[1]!;
  if (isIPv4(a)) return `${a.split(".").slice(0, 3).join(".")}.0/24`;
  if (isIPv6(a)) return `${formatIpv6([...ipv6Groups(a).slice(0, 3), 0, 0, 0, 0, 0])}/48`;
  return undefined;
}

/**
 * The id people use for a session. Sessions created before references were recorded get one
 * derived from the record id, which cannot be turned back into the record id or the token.
 */
export const sessionRef = (s: Session): string => s.ref ?? `s-${createHash("sha256").update(`practy-session-ref:${s.id}`).digest("hex").slice(0, 32)}`;

export const sessionIsActive = (s: Session, now = new Date()): boolean => s.expiresAt > now.toISOString();

export const sessionsOf = (store: Store) => store.collection<Session>(SESSION_KIND);

/** Ends one session: it stops authenticating at once (the browser is signed out on its next request). */
export function endSession(store: Store, s: Session, reason: SessionEndReason): Session {
  return sessionsOf(store).set({ ...s, expiresAt: new Date(0).toISOString(), endedAt: new Date().toISOString(), endedReason: reason });
}

/** A user's sessions that still authenticate, most recently used first. */
export function activeSessionsOf(store: Store, tenantId: string, userId: string): Session[] {
  const now = new Date();
  return sessionsOf(store)
    .list(tenantId, (s) => s.userId === userId && sessionIsActive(s, now))
    .sort((a, b) => (b.lastSeenAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.createdAt));
}

/** Ends every active session of a user, except `keep` (a session record id) when given. Returns how many ended. */
export function endSessionsOf(store: Store, tenantId: string, userId: string, reason: SessionEndReason, keep?: string): number {
  const ending = activeSessionsOf(store, tenantId, userId).filter((s) => s.id !== keep);
  for (const s of ending) endSession(store, s, reason);
  return ending.length;
}

export interface AccessRevoked {
  /** Browser sign-in sessions ended. */
  sessionsEnded: number;
  /** External AI clients (MCP OAuth grants) whose access and refresh tokens were revoked. */
  aiClientsDisconnected: number;
  /** REST API keys revoked. */
  apiKeysRevoked: number;
}

/**
 * Cuts a user off everywhere: ends their sign-in sessions, revokes the access and refresh tokens of
 * every AI client they connected, and revokes their API keys. Used when a principal signs someone
 * out everywhere and when a user is deactivated, so reactivating them later revives nothing.
 */
export function revokeUserAccess(store: Store, tenantId: string, userId: string, reason: SessionEndReason): AccessRevoked {
  const sessionsEnded = endSessionsOf(store, tenantId, userId, reason);
  const now = Date.now();
  const clients = new Set<string>();
  const tokens = store.collection<OAuthTokenRecord>(OAUTH_TOKEN_KIND);
  for (const t of tokens.list(tenantId, (t) => t.userId === userId && !t.revoked)) {
    if (t.expiresAt > now) clients.add(t.clientId);
    tokens.set({ ...t, revoked: true });
  }
  const keys = store.collection<ApiKey>(API_KEY_KIND);
  const live = keys.list(tenantId, (k) => k.userId === userId && !k.revokedAt);
  const at = new Date().toISOString();
  for (const k of live) keys.set({ ...k, revokedAt: at });
  return { sessionsEnded, aiClientsDisconnected: clients.size, apiKeysRevoked: live.length };
}
