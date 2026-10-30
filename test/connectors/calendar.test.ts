import { describe, expect, it } from "vitest";
import { GoogleCalendarSink } from "../../src/connectors/calendar/google.js";
import { GraphCalendarSink, PRACTY_ID_PROPERTY } from "../../src/connectors/calendar/graph.js";
import type { CalendarEvent } from "../../src/connectors/types.js";
import { empty, fakeFetch, json, token } from "./fake-fetch.js";

const EVENT: CalendarEvent = {
  practyId: "kd_1998_limitation",
  title: "1998 Priestley – limitation (3 years from injury)",
  date: "2026-12-31",
  description: "Writ must be filed by this date. Confirmed by KW.",
  reminders: [10080, 1440, 1440, 50000, 60, 30, 0],
};

describe("GoogleCalendarSink", () => {
  const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/diary%40soullegal.com.au/events";
  const sink = (f: ReturnType<typeof fakeFetch>) =>
    new GoogleCalendarSink({ getAccessToken: token, fetch: f.fetch, calendarId: "diary@soullegal.com.au" });

  it("creates an all-day event carrying practyId when none exists", async () => {
    const f = fakeFetch();
    f.on("GET", `${EVENTS}?`, { kind: "calendar#events", items: [] });
    f.on("POST", EVENTS, json({ kind: "calendar#event", id: "evt123", status: "confirmed" }));
    expect(await sink(f).upsert(EVENT)).toBe("evt123");

    const q = new URL(f.calls[0]!.url).searchParams;
    expect(q.get("privateExtendedProperty")).toBe("practyId=kd_1998_limitation");
    expect(f.calls[0]!.url).toContain("privateExtendedProperty=practyId%3Dkd_1998_limitation");
    expect(f.calls[1]!.json).toEqual({
      summary: EVENT.title,
      description: EVENT.description,
      start: { date: "2026-12-31" },
      end: { date: "2027-01-01" },
      transparency: "transparent",
      extendedProperties: { private: { practyId: "kd_1998_limitation" } },
      reminders: {
        useDefault: false,
        overrides: [40320, 10080, 1440, 60, 30].map((minutes) => ({ method: "popup", minutes })),
      },
    });
    expect(f.calls[1]!.headers.Authorization).toBe("Bearer test-token");
  });

  it("patches the existing event on re-sync, ignoring cancelled copies", async () => {
    const f = fakeFetch();
    f.on("GET", `${EVENTS}?`, { items: [{ id: "gone", status: "cancelled" }, { id: "evt123", status: "confirmed" }] });
    f.on("PATCH", `${EVENTS}/evt123`, { id: "evt123" });
    expect(await sink(f).upsert({ ...EVENT, reminders: undefined })).toBe("evt123");
    expect(f.calls[1]!.json.reminders).toEqual({ useDefault: true });
  });

  it("removes every matching event and tolerates already-deleted ones", async () => {
    const f = fakeFetch();
    f.on("GET", `${EVENTS}?`, { items: [{ id: "a" }, { id: "b" }] });
    f.once("DELETE", `${EVENTS}/a`, empty(204));
    f.once("DELETE", `${EVENTS}/b`, json({ error: { code: 410, message: "Resource has been deleted" } }, 410));
    await sink(f).remove("kd_1998_limitation");
    expect(f.calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
  });
});

describe("GraphCalendarSink", () => {
  const ME = "https://graph.microsoft.com/v1.0/me";

  it("finds by single-value extended property and creates an all-day event in Perth time", async () => {
    const f = fakeFetch();
    f.on("GET", `${ME}/events?`, { value: [] });
    f.on("POST", `${ME}/events`, json({ id: "AAMkEvt=" }, 201));
    const id = await new GraphCalendarSink({ getAccessToken: token, fetch: f.fetch }).upsert(EVENT);
    expect(id).toBe("AAMkEvt=");

    const filter = new URL(f.calls[0]!.url).searchParams.get("$filter");
    expect(filter).toBe(
      `singleValueExtendedProperties/Any(ep: ep/id eq '${PRACTY_ID_PROPERTY}' and ep/value eq 'kd_1998_limitation')`,
    );
    expect(f.calls[1]!.json).toEqual({
      subject: EVENT.title,
      body: { contentType: "text", content: EVENT.description },
      isAllDay: true,
      start: { dateTime: "2026-12-31T00:00:00", timeZone: "W. Australia Standard Time" },
      end: { dateTime: "2027-01-01T00:00:00", timeZone: "W. Australia Standard Time" },
      showAs: "free",
      isReminderOn: true,
      reminderMinutesBeforeStart: 50000,
      singleValueExtendedProperties: [{ id: PRACTY_ID_PROPERTY, value: "kd_1998_limitation" }],
    });
    expect(f.calls[1]!.headers.Prefer).toBe('IdType="ImmutableId"');
  });

  it("patches an existing event in a named calendar; empty reminders turn the reminder off", async () => {
    const f = fakeFetch();
    f.on("GET", `${ME}/calendars/cal1/events?`, { value: [{ id: "evt1" }] });
    f.on("PATCH", `${ME}/events/evt1`, { id: "evt1" });
    const sink = new GraphCalendarSink({ getAccessToken: token, fetch: f.fetch, calendarId: "cal1", timeZone: "Australia/Perth" });
    expect(await sink.upsert({ ...EVENT, practyId: "it's", reminders: [] })).toBe("evt1");
    expect(new URL(f.calls[0]!.url).searchParams.get("$filter")).toContain("ep/value eq 'it''s'");
    expect(f.calls[1]!.json).toMatchObject({ isReminderOn: false, start: { timeZone: "Australia/Perth" } });
    expect(f.calls[1]!.json).not.toHaveProperty("reminderMinutesBeforeStart");
  });

  it("removes matching events, tolerating 404", async () => {
    const f = fakeFetch();
    f.on("GET", `${ME}/events?`, { value: [{ id: "evt1" }] });
    f.on("DELETE", `${ME}/events/evt1`, json({ error: { code: "ErrorItemNotFound" } }, 404));
    await new GraphCalendarSink({ getAccessToken: token, fetch: f.fetch }).remove("kd_1");
    expect(f.calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
  });
});
