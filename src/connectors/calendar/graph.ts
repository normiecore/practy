import { addDays } from "../../core/calendar.js";
import { createHttp, odataString, type HttpClient } from "../http.js";
import type { CalendarEvent, CalendarSink, ConnectorDeps } from "../types.js";

/**
 * Outlook calendar sink (Microsoft Graph v1.0) for key dates as all-day events.
 *
 * Idempotency: the Practy id is stored in a single-value extended property in Practy's
 * own property-set GUID and found with Graph's documented
 * `singleValueExtendedProperties/Any(ep: ep/id eq … and ep/value eq …)` filter. Unlike
 * `transactionId` (only de-duplicates retried creates, and is not filterable) or a marker
 * in the subject/body (users edit those), the property is invisible and survives edits.
 */
export interface GraphCalendarSinkOptions extends ConnectorDeps {
  /** Defaults to the user's default calendar. */
  calendarId?: string;
  /** Windows or IANA time zone for the all-day boundaries; Soul Legal is in Perth. */
  timeZone?: string;
  baseUrl?: string;
}

/** Fixed property-set GUID for Practy; changing it orphans every synced event. */
export const PRACTY_ID_PROPERTY = "String {6f2c8f4e-5d1b-4a7e-9c3a-2b8e1d7f4a60} Name practyId";

export class GraphCalendarSink implements CalendarSink {
  readonly kind = "graph" as const;
  private readonly http: HttpClient;
  private readonly events: string;
  private readonly timeZone: string;

  constructor(opts: GraphCalendarSinkOptions) {
    this.http = createHttp({
      service: "Microsoft Graph",
      baseUrl: opts.baseUrl ?? "https://graph.microsoft.com/v1.0/me",
      getAccessToken: opts.getAccessToken,
      fetch: opts.fetch,
      headers: { Prefer: 'IdType="ImmutableId"' },
    });
    this.events = opts.calendarId ? `/calendars/${encodeURIComponent(opts.calendarId)}/events` : "/events";
    this.timeZone = opts.timeZone ?? "W. Australia Standard Time";
  }

  async upsert(event: CalendarEvent): Promise<string> {
    const body = this.toGraph(event);
    const [existing] = await this.find(event.practyId);
    if (existing) {
      await this.http.raw(`/events/${encodeURIComponent(existing)}`, { method: "PATCH", json: body });
      return existing;
    }
    return (await this.http.json<{ id: string }>(this.events, { method: "POST", json: body })).id;
  }

  async remove(practyId: string): Promise<void> {
    for (const id of await this.find(practyId)) {
      await this.http.raw(`/events/${encodeURIComponent(id)}`, { method: "DELETE", allow: [404] });
    }
  }

  private async find(practyId: string): Promise<string[]> {
    const params = new URLSearchParams({
      $filter: `singleValueExtendedProperties/Any(ep: ep/id eq ${odataString(PRACTY_ID_PROPERTY)} and ep/value eq ${odataString(practyId)})`,
      $select: "id",
    });
    const res = await this.http.json<{ value: { id: string }[] }>(`${this.events}?${params}`);
    return res.value.map((e) => e.id);
  }

  /** Outlook keeps one reminder per event, so the earliest requested one is used. */
  private toGraph(e: CalendarEvent) {
    const reminder = e.reminders?.length ? Math.max(...e.reminders) : undefined;
    return {
      subject: e.title,
      body: { contentType: "text", content: e.description },
      isAllDay: true,
      start: { dateTime: `${e.date}T00:00:00`, timeZone: this.timeZone },
      end: { dateTime: `${addDays(e.date, 1)}T00:00:00`, timeZone: this.timeZone },
      showAs: "free",
      ...(e.reminders
        ? reminder === undefined
          ? { isReminderOn: false }
          : { isReminderOn: true, reminderMinutesBeforeStart: reminder }
        : {}),
      singleValueExtendedProperties: [{ id: PRACTY_ID_PROPERTY, value: e.practyId }],
    };
  }
}
