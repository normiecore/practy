import { z } from "zod";
import { usersOf } from "../admin/commands.js";
import { invalid, notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import type { InvocationContext } from "../core/types.js";
import type { Store } from "../domain/store.js";
import type { Session } from "./model.js";
import { activeSessionsOf, endSession, endSessionsOf, revokeUserAccess, sessionRef } from "./sessions.js";

/** What a person sees of one of their sessions. Never the token, its hash or the CSRF value. */
export interface SessionView {
  /** Opaque reference for end_session. */
  id: string;
  /** Browser and platform, such as "Safari on iPhone". */
  device: string;
  /** Approximate location: the network the session signed in from (IPv4 /24 or IPv6 /48). */
  location: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** The session making this request ("This device"). */
  current: boolean;
}

const view = (s: Session, ctx: InvocationContext): SessionView => ({
  id: sessionRef(s),
  device: s.device ?? "Unknown device",
  location: s.network ?? null,
  createdAt: s.createdAt,
  lastSeenAt: s.lastSeenAt ?? s.createdAt,
  expiresAt: s.expiresAt,
  current: !!ctx.sessionId && s.id === ctx.sessionId,
});

/**
 * Sign-in sessions: see where you are signed in and end sessions on a lost or shared device.
 * All are human-only: an assistant, or an external AI client, cannot read device lists or sign
 * anyone out, whatever a document or email tells it. Sessions are the caller's own, except that
 * a principal can sign another user in the same firm out everywhere.
 */
export function sessionCommands(store: Store) {
  return [
    defineCommand({
      name: "list_my_sessions",
      title: "My sign-in sessions",
      description: "Where you are signed in: each browser or device, its approximate location (network), when it signed in and was last used, and which one is this device.",
      tier: 0,
      humanOnly: true,
      input: z.object({}),
      handler: (_i, ctx) => activeSessionsOf(store, ctx.actor.tenantId, ctx.actor.userId).map((s) => view(s, ctx)),
    }),

    defineCommand({
      name: "end_session",
      title: "End a sign-in session",
      description: "Sign out one of your own sessions, such as a lost phone. It is signed out on its next request.",
      tier: 1,
      humanOnly: true,
      input: z.object({ sessionId: z.string().min(1).describe("The id from list_my_sessions") }),
      handler: ({ sessionId }, ctx) => {
        const s = activeSessionsOf(store, ctx.actor.tenantId, ctx.actor.userId).find((x) => sessionRef(x) === sessionId);
        if (!s) throw notFound("Session");
        endSession(store, s, "ended_by_user");
        return { ended: 1, device: s.device ?? "Unknown device", current: !!ctx.sessionId && s.id === ctx.sessionId };
      },
    }),

    defineCommand({
      name: "end_other_sessions",
      title: "Sign out all other devices",
      description: "Sign out every one of your sessions except the one making this request. Only from a signed-in browser: an API key has no session to keep, so use end_session there.",
      tier: 1,
      humanOnly: true,
      input: z.object({}),
      handler: (_i, ctx) => {
        // From an API key this would end every browser session, which a script should not do by accident.
        if (!ctx.sessionId) throw invalid("Sign out all other devices works from a signed-in browser. With an API key, end sessions one at a time with end_session.");
        return { ended: endSessionsOf(store, ctx.actor.tenantId, ctx.actor.userId, "ended_by_user", ctx.sessionId) };
      },
    }),

    defineCommand({
      name: "end_user_sessions",
      title: "Sign a user out everywhere",
      description:
        "Principal only. For a lost phone or someone leaving: ends every sign-in session of another user in the firm, disconnects the AI clients they connected (revokes their access and refresh tokens) and revokes their API keys. They can sign in again unless also deactivated.",
      tier: 1,
      humanOnly: true,
      roles: ["principal"],
      input: z.object({ userId: z.string().min(1) }),
      handler: ({ userId }, ctx) => {
        const user = usersOf(store).find(ctx.actor.tenantId, userId);
        if (!user) throw notFound("User");
        if (user.id === ctx.actor.userId) throw invalid("To sign yourself out elsewhere, use Sign out all other devices (Settings, Sign-in sessions)");
        return { userId: user.id, displayName: user.displayName, ...revokeUserAccess(store, ctx.actor.tenantId, user.id, "ended_by_principal") };
      },
    }),
  ];
}
