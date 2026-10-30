import { usersOf } from "../admin/commands.js";
import { settingsFor } from "../admin/settings.js";
import { actorFor } from "../auth/service.js";
import type { App } from "./app.js";

/**
 * Background work, run as each user on the "job" surface so it is audited like
 * anything else: the email sweep every 15 minutes, and a daily calendar sync.
 * A single deployment per firm runs one scheduler; failures are logged, not fatal.
 */
export function startJobs(app: App, opts: { sweepMinutes?: number; calendarHourLocal?: number } = {}): () => void {
  const timers: NodeJS.Timeout[] = [];
  const everyUser = async (command: string, eligible: (tenantId: string, userId: string) => boolean) => {
    for (const user of usersOf(app.store).values()) {
      if (!user.active || !eligible(user.tenantId, user.id)) continue;
      try {
        await app.bus.execute(command, {}, { actor: actorFor(user), surface: "job" });
      } catch (err) {
        console.error(`[jobs] ${command} for ${user.email}: ${(err as Error).message}`);
      }
    }
  };

  const sweep = () =>
    everyUser("run_mail_sweep", (t, u) => settingsFor(app.store, t).mail.filingMode !== "off" && !!app.hub.mail(t, u));
  timers.push(setInterval(sweep, (opts.sweepMinutes ?? 15) * 60_000));

  let lastCalendarDay = "";
  timers.push(
    setInterval(() => {
      const perth = new Date(Date.now() + 8 * 3_600_000); // Australia/Perth has no daylight saving
      const day = perth.toISOString().slice(0, 10);
      if (perth.getUTCHours() >= (opts.calendarHourLocal ?? 6) && day !== lastCalendarDay) {
        lastCalendarDay = day;
        void everyUser("sync_calendar", (t, u) => !!app.hub.calendar(t, u));
      }
    }, 5 * 60_000),
  );
  return () => timers.forEach(clearInterval);
}
