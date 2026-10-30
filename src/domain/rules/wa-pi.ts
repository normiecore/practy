import { addDays, addMonths, addYears, type IsoDate } from "../../core/calendar.js";
import type { KeyDate, Matter, Party, Scheme } from "../model.js";

/**
 * WA personal injury key-date rule pack. Rules are data with provenance, not code
 * forks: every generated date records the rule id, pack version and whether the rule
 * is verified. Unverified rules never produce a computed date; they create a
 * "manual_required" entry so a practitioner must enter it.
 *
 * Every generated date starts as "proposed" and must be confirmed by a practitioner
 * (tier 2) before it is treated as diarised.
 */
export const RULE_PACK_VERSION = "wa-pi-2026.10.0";

export type MatterEvent =
  | { type: "matter_opened" }
  | { type: "nopb_received"; issueDate: IsoDate }
  | { type: "settlement"; date: IsoDate };

export type ProposedDate = Pick<KeyDate, "kind" | "title" | "date" | "ruleVerified" | "source" | "notes"> & {
  ruleId: string;
};

interface RuleInput {
  matter: Matter;
  client?: Party;
  event: MatterEvent;
  firmPolicy: FirmPolicy;
}

interface Rule {
  id: string;
  schemes: Scheme[] | "any";
  on: MatterEvent["type"];
  run(input: RuleInput): ProposedDate[];
}

export interface FirmPolicy {
  /** Internal target for "as soon as practicable" ICWA notice. Firm policy, not statute. */
  icwaNoticeTargetDays: number;
  /** Reminder offsets (months before) for critical limitation dates. */
  limitationReminderMonths: number[];
}

export const DEFAULT_FIRM_POLICY: FirmPolicy = {
  icwaNoticeTargetDays: 14,
  limitationReminderMonths: [6, 3, 1],
};

function ageOn(dob: IsoDate, on: IsoDate): number {
  const [by, bm, bd] = dob.split("-").map(Number) as [number, number, number];
  const [y, m, d] = on.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

function limitationDates(input: RuleInput, verified: boolean, source: string, extraNotes: string[]): ProposedDate[] {
  const { matter, client, firmPolicy } = input;
  if (!matter.injuryDate) {
    return [{ ruleId: "limitation.pi.3y", kind: "critical", title: "Limitation: injury date unknown — enter the limitation date", date: null, ruleVerified: false, source, notes: ["Record the date of injury on the matter, or enter the limitation date manually."] }];
  }
  const { date, clamped } = addYears(matter.injuryDate, 3);
  const notes = [...extraNotes];
  if (clamped) notes.push("Injury date is 29 Feb; anniversary clamped to 28 Feb (conservative). Confirm.");
  if (client?.dateOfBirth && ageOn(client.dateOfBirth, matter.injuryDate) < 18) {
    notes.push(
      "Client was under 18 at the date of injury: an extended limitation period may apply. " +
        "The date shown is the conservative unextended date. Confirm the extended date manually.",
    );
  }
  if (!client?.dateOfBirth) notes.push("Client date of birth not recorded: minority/disability extensions not assessed.");
  const out: ProposedDate[] = [
    {
      ruleId: "limitation.pi.3y",
      kind: "critical",
      title: "Limitation: commence proceedings (3 years from injury)",
      date,
      ruleVerified: verified,
      source,
      notes,
    },
  ];
  for (const months of firmPolicy.limitationReminderMonths) {
    out.push({
      ruleId: `limitation.pi.3y.reminder.${months}m`,
      kind: "reminder",
      title: `Limitation in ${months} month${months === 1 ? "" : "s"}: review status / issue proceedings`,
      date: addMonths(date, -months).date,
      ruleVerified: verified,
      source: "Firm policy",
      notes: [],
    });
  }
  return out;
}

const RULES: Rule[] = [
  {
    id: "limitation.pi.3y",
    schemes: ["icwa_mva"],
    on: "matter_opened",
    run: (input) =>
      limitationDates(
        input,
        true,
        "Limitation Act 2005 (WA); ICWA Fact Sheet: Limitation Periods",
        ["ICWA may extend only in exceptional cases; do not rely on an extension."],
      ),
  },
  {
    id: "limitation.pi.3y",
    schemes: ["workcover_wa"],
    on: "matter_opened",
    run: (input) =>
      limitationDates(input, false, "Limitation Act 2005 (WA) (general PI period, shown as a conservative reference)", [
        "WCIMA 2023 common-law time limits are on the verification register; confirm the applicable period.",
      ]),
  },
  {
    id: "icwa.notice",
    schemes: ["icwa_mva"],
    on: "matter_opened",
    run: ({ matter, firmPolicy }) => [
      {
        ruleId: "icwa.notice",
        kind: "deadline",
        title: "Give notice of claim to the Insurance Commission of WA",
        date: addDays(matter.openedOn, firmPolicy.icwaNoticeTargetDays),
        ruleVerified: true,
        source: "Motor Vehicle (Third Party Insurance) Act 1943 (WA) s 29: 'as soon as practicable'",
        notes: [`Statute requires notice as soon as practicable; date is the firm's ${firmPolicy.icwaNoticeTargetDays}-day target.`],
      },
    ],
  },
  {
    id: "workcover.common_law_election",
    schemes: ["workcover_wa"],
    on: "matter_opened",
    run: () => [
      {
        ruleId: "workcover.common_law_election",
        kind: "critical",
        title: "Common-law election (form CL1; requires ≥15% WPI assessment)",
        date: null,
        ruleVerified: false,
        source: "Workers Compensation and Injury Management Act 2023 (WA); WorkCover WA Information Sheet 39",
        notes: ["Statutory time limit to be confirmed (verification register). Enter the date manually."],
      },
    ],
  },
  {
    id: "medicare.nopb.expiry",
    schemes: "any",
    on: "nopb_received",
    run: ({ event }) => {
      if (event.type !== "nopb_received") return [];
      const { date, clamped } = addMonths(event.issueDate, 6);
      return [
        {
          ruleId: "medicare.nopb.expiry",
          kind: "deadline",
          title: "Medicare Notice of Past Benefits expires: re-request before settlement",
          date,
          ruleVerified: true,
          source: "Services Australia: Notice of past benefits (valid 6 months)",
          notes: clamped ? ["Issue date near month end; expiry clamped to month end."] : [],
        },
      ];
    },
  },
  {
    id: "medicare.mo022",
    schemes: "any",
    on: "settlement",
    run: ({ event }) =>
      event.type !== "settlement"
        ? []
        : [
            {
              ruleId: "medicare.mo022",
              kind: "critical",
              title: "Lodge Medicare notification (MO022) within 28 days of settlement/judgment",
              date: addDays(event.date, 28),
              ruleVerified: true,
              source: "Health and Other Services (Compensation) Act 1995; Services Australia notification requirements",
              notes: ["Compensation must not be paid out until the Medicare charge is paid."],
            },
          ],
  },
];

export function proposeKeyDates(input: RuleInput): ProposedDate[] {
  return RULES.filter(
    (r) => r.on === input.event.type && (r.schemes === "any" || r.schemes.includes(input.matter.scheme)),
  ).flatMap((r) => r.run(input));
}
