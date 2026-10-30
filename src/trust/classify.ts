import type { AmlBasis, CashbookEntry } from "./model.js";

/**
 * Configurable classification of who a receipt came from. ICWA and licensed
 * workers' compensation insurers fall under the insurer/government exclusion.
 */
export interface ClassifierConfig {
  insurerOrGovernment: RegExp[];
  courtOrder: RegExp[];
}

export const WA_PI_CLASSIFIER: ClassifierConfig = {
  insurerOrGovernment: [
    /insurance commission/i,
    /\bicwa\b/i,
    /workcover/i,
    /services australia/i,
    /\bcomcare\b/i,
    /insurance/i,
    /\binsurer\b/i,
    /\bQBE\b/i,
    /\bAllianz\b/i,
    /\bGIO\b/i,
    /\bSuncorp\b/i,
    /\bCGU\b/i,
    /\bZurich\b/i,
  ],
  courtOrder: [/court/i, /tribunal/i, /judgment/i],
};

export function classifyAml(
  e: Pick<CashbookEntry, "amount" | "payerOrPayee" | "reference" | "kind">,
  cfg: ClassifierConfig = WA_PI_CLASSIFIER,
): AmlBasis {
  // Only receipts matter for the item 3 exclusions; payments out are not classified.
  if (e.amount < 0) return e.kind === "transfer_out" ? "fees_disbursements" : "unknown";
  if (e.kind === "transfer_in") return "unknown";
  const text = `${e.payerOrPayee} ${e.reference}`;
  if (cfg.courtOrder.some((r) => r.test(text))) return "court_order";
  if (cfg.insurerOrGovernment.some((r) => r.test(text))) return "insurer_or_government";
  return "private";
}
