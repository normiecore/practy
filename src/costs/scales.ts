import type { IsoDate } from "../core/calendar.js";
import type { Cents } from "../damages/money.js";

/**
 * WA costs scales, effective-dated by the date the work was done (not the bill date).
 * All rates are hourly, GST inclusive, in cents.
 */

export const FEE_CATEGORIES = ["SP", "JP", "CPL", "counsel"] as const;
/** SP senior practitioner, JP junior practitioner, CPL clerk/paralegal. */
export type FeeCategory = (typeof FEE_CATEGORIES)[number];

export const FORUMS = ["court", "workcover"] as const;
/** court: Supreme and District Courts (LCC determinations); workcover: WC forum work (Magistrates Court rates). */
export type Forum = (typeof FORUMS)[number];

const FIRM_COSTS_RULES = "Soul Legal bill-of-costs rules (firm standing rules)";

export type ItemMax =
  | { kind: "hours"; hours: number; category: FeeCategory; per?: string }
  | { kind: "reasonable" }
  | { kind: "per_hour" }
  | { kind: "not_party_party" }
  | { kind: "unknown" };

export interface TableBItem {
  /** Stable key across determinations (item numbers move, e.g. 27 -> 28 in 2026). */
  key: string;
  item: string;
  description: string;
  max: ItemMax;
  verified: boolean;
}

export interface Determination {
  id: string;
  forum: Forum;
  title: string;
  from: IsoDate;
  /** Inclusive; undefined means open-ended. */
  to?: IsoDate;
  rates: Partial<Record<FeeCategory, Cents>>;
  items: TableBItem[];
  source: string;
  verified: boolean;
  notes: string[];
}

const VERIFY_ITEMS = "Firm rule: verify Table B items against the Determination PDF before quoting.";

/** Key Table B items. All unverified: the firm's own rules say to check the PDF before quoting. */
function tableB(year: 2020 | 2022 | 2024 | 2026): TableBItem[] {
  const i = (key: string, item: string, description: string, max: ItemMax): TableBItem => ({ key, item, description, max, verified: false });
  const sp = (hours: number, per?: string): ItemMax => ({ kind: "hours", hours, category: "SP", ...(per ? { per } : {}) });
  return [
    i("writ", "1(a)", "Writ", sp(1.5)),
    i("statement_of_claim", "1(c)", "Statement of claim", sp(year === 2026 ? 20 : year === 2020 ? 10 : 12)),
    i("discovery", "7(b)", "Discovery", { kind: "reasonable" }),
    i("inspection", "8", "Inspection of discovered and subpoenaed documents", { kind: "reasonable" }),
    i("consent_orders", "10(c)", "Consent orders", { kind: "hours", hours: 1.5, category: "JP", per: "set" }),
    i("offer_of_compromise", "16(b)", "Offer of compromise / Calderbank offer", sp(year === 2026 ? 6 : 4)),
    i("entry_for_trial", "18(a)", "Entry for trial", sp(2)),
    i("r45c_schedules", "18(b)", "r 45C schedules", sp(12)),
    i("preparation", "19", "Preparation of case, including pre-commencement work (cap applied across Determinations by SP-equivalent hours)", sp(year === 2020 ? 120 : 130)),
    i("conferences", year === 2026 ? "28" : "27", "PTC, mediation and conferences", { kind: "per_hour" }),
    i("drawing_bill", "33", "Drawing bill", { kind: "unknown" }),
    i("other_work", year === 2026 ? "38" : "35", "Other work (solicitor/client only, not party/party)", { kind: "not_party_party" }),
    i("copying", "copying", "Copying, per page", { kind: "unknown" }),
  ];
}

const LCC = "Legal Profession (Supreme and District Courts) (Contentious Business) Determination";
const WC_2018 = "Workers' Compensation (Legal Profession and Registered Agents) Costs Determination 2018 (1981 Act); Magistrates Court (Civil) rates";
const WC_2024 = "Workers' Compensation Legal Profession and Authorised Agents Costs Determination 2024; Magistrates Court (Civil) rates";
const wcItems = (): TableBItem[] => [
  { key: "wc_instructions", item: "1", description: "Instructions and negotiation before any proceeding", max: { kind: "hours", hours: 4, category: "SP" }, verified: false },
];

export const DETERMINATIONS: readonly Determination[] = [
  {
    id: "lcc-2020", forum: "court", title: `${LCC} 2020`, from: "2020-07-01", to: "2022-06-30",
    rates: { SP: 49_500, JP: 35_200, CPL: 23_100, counsel: 45_100 }, items: tableB(2020),
    source: `${FIRM_COSTS_RULES}; ${LCC} 2020`, verified: true, notes: [VERIFY_ITEMS],
  },
  {
    id: "lcc-2022", forum: "court", title: `${LCC} 2022`, from: "2022-07-01", to: "2024-06-30",
    rates: { SP: 50_600, JP: 37_400, CPL: 24_200, counsel: 47_300 }, items: tableB(2022),
    source: `${FIRM_COSTS_RULES}; ${LCC} 2022`, verified: true, notes: [VERIFY_ITEMS],
  },
  {
    id: "lcc-2024", forum: "court", title: `${LCC} 2024`, from: "2024-07-01", to: "2026-09-20",
    rates: { SP: 57_200, JP: 41_800, CPL: 26_400, counsel: 52_800 }, items: tableB(2024),
    source: `${FIRM_COSTS_RULES}; ${LCC} 2024`, verified: true, notes: [VERIFY_ITEMS],
  },
  {
    id: "lcc-2026", forum: "court", title: `${LCC} 2026`, from: "2026-09-21",
    rates: { SP: 66_000, JP: 48_400, CPL: 30_800, counsel: 66_000 }, items: tableB(2026),
    source: `${FIRM_COSTS_RULES}; ${LCC} 2026`,
    // The commencement date is on the verification register (STRATEGY.md §9).
    verified: false,
    notes: ["Applies from 21/9/2026, not 1 July. Commencement date on the verification register.", VERIFY_ITEMS],
  },
  {
    id: "wc-2020", forum: "workcover", title: "WorkCover forum (from 1/11/2020)", from: "2020-11-01", to: "2022-06-30",
    rates: { SP: 41_800, JP: 31_900, CPL: 15_400 }, items: wcItems(), source: `${FIRM_COSTS_RULES}; ${WC_2018}`, verified: true,
    notes: ["Not recoverable from the defendant in the damages action unless a WorkCover proceeding produced a costs order. Show separately."],
  },
  {
    id: "wc-2022", forum: "workcover", title: "WorkCover forum (from 1/7/2022)", from: "2022-07-01", to: "2024-06-30",
    rates: { SP: 42_900, JP: 34_100, CPL: 16_500 }, items: wcItems(), source: `${FIRM_COSTS_RULES}; ${WC_2018}`, verified: true, notes: [],
  },
  {
    id: "wc-2024", forum: "workcover", title: "WorkCover forum (from 1/7/2024)", from: "2024-07-01", to: "2026-09-20",
    rates: { SP: 48_400, JP: 38_500, CPL: 18_700 }, items: wcItems(), source: `${FIRM_COSTS_RULES}; ${WC_2024}`,
    // Final rates in the WorkCover 2024 Determination are on the verification register.
    verified: false, notes: ["Final 2024 WorkCover rates on the verification register."],
  },
  {
    id: "wc-2026", forum: "workcover", title: "WorkCover forum (from 21/9/2026)", from: "2026-09-21",
    rates: { SP: 56_100, JP: 44_000, CPL: 22_000 }, items: wcItems(), source: `${FIRM_COSTS_RULES}; ${WC_2024} (as varied)`,
    verified: false, notes: ["Rates from 21/9/2026 per the firm's rules; confirm the instrument."],
  },
];

export function determinationFor(workDate: IsoDate, forum: Forum = "court"): Determination | undefined {
  return DETERMINATIONS.find((d) => d.forum === forum && d.from <= workDate && (!d.to || workDate <= d.to));
}

export interface RateLookup {
  rateCents: Cents;
  category: FeeCategory;
  forum: Forum;
  determinationId: string;
  determination: string;
  source: string;
  verified: boolean;
}

/** The hourly rate in force on the date the work was done. */
export function rateFor(category: FeeCategory, workDate: IsoDate, forum: Forum = "court"): RateLookup {
  const d = determinationFor(workDate, forum);
  if (!d) throw new Error(`No ${forum} costs determination covers ${workDate}`);
  const rate = d.rates[category];
  if (rate === undefined) throw new Error(`${d.title} has no ${category} rate`);
  return { rateCents: rate, category, forum, determinationId: d.id, determination: d.title, source: d.source, verified: d.verified };
}

export function itemFor(determinationId: string, key: string): TableBItem | undefined {
  return DETERMINATIONS.find((d) => d.id === determinationId)?.items.find((i) => i.key === key);
}
