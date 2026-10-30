import type { Scheme } from "../../domain/model.js";
import type { ImportedMatter } from "../types.js";

/**
 * Recognises a pilot scheme from free-text matter type, practice area, tag or folder
 * suffix ("MVA", "Motor Vehicle Accident", "ICWA", "WorkCover", "Workers Comp", "WC").
 * Anything else stays unclassified for a person to set.
 */
export function schemeFromMatterType(text: string | undefined): Scheme | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  const workcover = /\b(wc|workcover|workers'?\s*comp(ensation)?|work(place)?\s+injur(y|ies))\b/.test(t);
  const mva = /\b(mva|mvi|motor|vehicle|icwa|ctp|car accident|road accident)\b/.test(t);
  if (workcover === mva) return undefined;
  return workcover ? "workcover_wa" : "icwa_mva";
}

/** The firm's short label used in Box folder names. */
export const SCHEME_LABELS: Record<Scheme, string> = { icwa_mva: "MVA", workcover_wa: "WC" };

/** Source-system status text → open/closed. Unknown statuses (Pending, Active, …) are open. */
export function statusFromText(text: string | undefined): ImportedMatter["status"] {
  return /^\s*(closed|archived|finali[sz]ed|inactive|completed|concluded)\s*$/i.test(text ?? "") ? "closed" : "open";
}
