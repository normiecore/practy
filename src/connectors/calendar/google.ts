import { addDays } from "../../core/calendar.js";
import { createHttp, type HttpClient } from "../http.js";
import type { CalendarEvent, CalendarSink, ConnectorDeps } from "../types.js";

/**
 * Google Calendar v3 sink for key dates as all-day events.
 *
 * Idempotency: the Practy id lives in `extendedProperties.private.practyId` (private to
 * this OAuth client's project, invisible to attendees) and events are found again with
 * the `privateExtendedProperty` filter, so a re-sync updates rather than duplicates.
 */
export interface GoogleCalendarSinkOptions extends ConnectorDeps {
  /** Defaults to the user's primary calendar. */
  calendarId?: string;
  baseUrl?: string;
}

interface GoogleEvent {
  id: string;
  status?: string;
}

/** Google allows at most 5 reminder overrides, each up to four weeks before. */
const MAX_OVERRIDES = 5;
const MAX_REMINDER_MINUTES = 40_320;

export class GoogleCalendarSink implements CalendarSink {
  readonly kind = "google" as const;
  private readonly http: HttpClient;
  private readonly events: string;

  constructor(opts: GoogleCalendarSinkOptions) {
    this.http = createHttp({
      service: "Google Calendar",
      baseUrl: opts.baseUrl ?? "https://www.googleapis.com/calendar/v3",
      getAccessToken: opts.getAccessToken,
      fetch: opts.fetch,
    });
    this.events = `/calendars/${encodeURIComponent(opts.calendarId ?? "primary")}/events`;
  }

  async upsert(event: CalendarEvent): Promise<string> {
    const body = toGoogle(event);
    const [existing] = await this.find(event.practyId);
    if (existing) {
      await this.http.json(`${this.events}/${encodeURIComponent(existing.id)}`, { method: "PATCH", json: body });
      return existing.id;
    }
    return (await this.http.json<GoogleEvent>(this.events, { method: "POST", json: body })).id;
  }

  /** Removes every event carrying the id (duplicates from an earlier failed sync included). */
  async remove(practyId: string): Promise<void> {
    for (const e of await this.find(practyId)) {
      await this.http.raw(`${this.events}/${encodeURIComponent(e.id)}`, { method: "DELETE", allow: [404, 410] });
    }
  }

  private async find(practyId: string): Promise<GoogleEvent[]> {
    const params = new URLSearchParams({
      privateExtendedProperty: `practyId=${practyId}`,
      showDeleted: "false",
      maxResults: "50",
    });
    const res = await this.http.json<{ items?: GoogleEvent[] }>(`${this.events}?${params}`);
    return (res.items ?? []).filter((e) => e.status !== "cancelled");
  }
}

function toGoogle(e: CalendarEvent) {
  const overrides = [...new Set(e.reminders ?? [])]
    .filter((m) => m >= 0)
    .map((m) => Math.min(m, MAX_REMINDER_MINUTES))
    .sort((a, b) => b - a)
    .slice(0, MAX_OVERRIDES);
  return {
    summary: e.title,
    description: e.description,
    // All-day: end date is exclusive.
    start: { date: e.date },
    end: { date: addDays(e.date, 1) },
    // Deadlines should not mark the fee earner as busy.
    transparency: "transparent",
    extendedProperties: { private: { practyId: e.practyId } },
    reminders: e.reminders
      ? { useDefault: false, overrides: overrides.map((minutes) => ({ method: "popup", minutes })) }
      : { useDefault: true },
  };
}
