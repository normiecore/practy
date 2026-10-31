import { z } from "zod";
import type { Store } from "../domain/store.js";
import type { Scheme } from "../domain/model.js";
import { DEFAULT_FIRM_POLICY, type FirmPolicy } from "../domain/rules/wa-pi.js";

/**
 * Per-firm configuration. Secrets (OAuth tokens, API keys) are NOT here; they live in
 * the encrypted SecretStore. Options that firms differ on are settings, not code.
 */
export interface TenantSettings {
  id: string;
  tenantId: string;
  firmName: string;
  timezone: string;
  identity: {
    providers: ("google" | "microsoft")[];
    /** Email domains allowed to sign in (users must also exist and be active). */
    allowedDomains: string[];
    /** Reject sign-ins whose token lacks an MFA claim (Entra ID supports this). */
    requireMfaClaim: boolean;
  };
  ai: {
    enabled: boolean;
    provider: "anthropic" | "bedrock";
    /** Model id for the chosen provider; set at deployment (PRACTY_AI_MODEL) or in settings. */
    model: string;
    /** Allow the firm's own Claude (claude.ai/Desktop/Code) to connect over MCP. Off by default (APP 8). */
    externalMcpClients: boolean;
    /** Highest tier external MCP clients may request (they can never decide approvals). */
    externalClientMaxTier: 0 | 1 | 2 | 3;
    /** Hosts an external MCP client may receive an authorization code at (loopback is always allowed). */
    externalClientRedirectHosts: string[];
  };
  documents: {
    store: "box" | "local";
    mattersRootFolderId?: string;
    schemeLabels: Record<Scheme, string>;
    emailsSubfolder: string;
    /** Subfolder of the matter folder for documents Practy generates. */
    generatedSubfolder: string;
  };
  mail: {
    provider: "gmail" | "graph" | "none";
    /**
     * practy: Practy files mail into the document store itself.
     * label_bridge: Practy applies `refileLabelPrefix<number>` and the firm's existing automation files it.
     */
    filingMode: "practy" | "label_bridge" | "off";
    refileLabelPrefix: string;
    /** File automatically on strong evidence; otherwise everything goes to the review queue. */
    autoFile: boolean;
    /** Per-run cap on automatic filing (the firm's sweep uses 60). */
    autoFileCap: number;
  };
  calendar: { provider: "google" | "graph" | "none"; calendarId: string };
  firmPolicy: FirmPolicy;
  trust: {
    source: "xero" | "addon_csv" | "none";
    xeroTenantId?: string;
    trustBankAccountId?: string;
    trackingCategoryName?: string;
    /** Regex source; first capture group is the matter number. */
    referencePattern?: string;
    accountName: string;
    opening?: { asAt: string; cashbook: number; clientLedgers: Record<string, number> };
    statementMapping: { date: string; amount?: string; credit?: string; debit?: string; description: string };
    /** Column mapping for a trust add-on's cashbook export (when source is addon_csv). */
    cashbookMapping?: { date: string; matter: string; party: string; reference?: string; amount?: string; receipt?: string; payment?: string; type?: string; transferPattern?: string };
  };
  letter: {
    senderName: string;
    senderTitle: string;
    senderEmail: string;
    senderPhone: string;
    signoff: string;
    signoffFont: string;
    signoffSizePt: number;
    signoffColor: string;
    accentColor: string;
    closing: string;
  };
  /** Address printed on court documents (e.g. Form 17 inspection address). */
  firmAddress: string;
  privacy: {
    /** Privacy officer contact for APP 1 policy text and breach notifications. */
    officerName: string;
    officerEmail: string;
  };
  updatedAt: string;
}

export function defaultSettings(tenantId: string): TenantSettings {
  return {
    id: tenantId,
    tenantId,
    firmName: "Firm",
    timezone: "Australia/Perth",
    identity: { providers: ["google"], allowedDomains: [], requireMfaClaim: false },
    ai: { enabled: true, provider: "anthropic", model: process.env.PRACTY_AI_MODEL ?? "", externalMcpClients: false, externalClientMaxTier: 1, externalClientRedirectHosts: ["claude.ai", "claude.com"] },
    documents: { store: "local", schemeLabels: { icwa_mva: "MVA", workcover_wa: "WC", other: "PI" }, emailsSubfolder: "Emails", generatedSubfolder: "Drafts" },
    mail: { provider: "none", filingMode: "off", refileLabelPrefix: "Box Filed/Refile/", autoFile: true, autoFileCap: 60 },
    calendar: { provider: "none", calendarId: "primary" },
    firmPolicy: DEFAULT_FIRM_POLICY,
    trust: {
      source: "none",
      accountName: "Law Practice Trust Account",
      statementMapping: { date: "Date", amount: "Amount", description: "Description" },
    },
    letter: { senderName: "", senderTitle: "", senderEmail: "", senderPhone: "", signoff: "", signoffFont: "Times New Roman", signoffSizePt: 20, signoffColor: "000000", accentColor: "000000", closing: "Yours faithfully" },
    firmAddress: "",
    privacy: { officerName: "", officerEmail: "" },
    updatedAt: new Date(0).toISOString(),
  };
}

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep merge where arrays and scalars replace; used for defaults and partial updates. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : patch) as T;
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge((base as Plain)[k], v);
  return out as T;
}

export function settingsFor(store: Store, tenantId: string): TenantSettings {
  const saved = store.collection<TenantSettings>("tenant_settings").get(tenantId);
  return deepMerge(defaultSettings(tenantId), saved ?? {});
}

const text = z.string();
const cents = z.number().int();
const validRegex = (v: string) => {
  try {
    new RegExp(v);
    return true;
  } catch {
    return false;
  }
};

/**
 * The whole settings record, checked after a patch is merged so a typo or a wrong type is refused
 * before it is saved (or sent for approval). Objects are strict, so a misspelt key is an error too.
 */
export const tenantSettingsSchema = z
  .object({
    id: text,
    tenantId: text,
    firmName: text.trim().min(1, "Enter the firm's name"),
    timezone: text.refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-AU", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Not a known time zone (e.g. Australia/Perth)"),
    identity: z
      .object({
        providers: z.array(z.enum(["google", "microsoft"])).min(1, "Choose at least one sign-in provider"),
        allowedDomains: z.array(text.regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Enter a domain such as firm.com.au")),
        requireMfaClaim: z.boolean(),
      })
      .strict(),
    ai: z
      .object({
        enabled: z.boolean(),
        provider: z.enum(["anthropic", "bedrock"]),
        model: text,
        externalMcpClients: z.boolean(),
        externalClientMaxTier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        externalClientRedirectHosts: z.array(text.regex(/^[a-z0-9.-]+$/i, "Enter a host name only, such as claude.ai")),
      })
      .strict(),
    documents: z
      .object({
        store: z.enum(["box", "local"]),
        mattersRootFolderId: text.optional(),
        schemeLabels: z.object({ icwa_mva: text, workcover_wa: text, other: text }).strict(),
        emailsSubfolder: text.min(1),
        generatedSubfolder: text.min(1),
      })
      .strict(),
    mail: z
      .object({
        provider: z.enum(["gmail", "graph", "none"]),
        filingMode: z.enum(["practy", "label_bridge", "off"]),
        refileLabelPrefix: text,
        autoFile: z.boolean(),
        autoFileCap: z.number().int().min(0).max(2000),
      })
      .strict(),
    calendar: z.object({ provider: z.enum(["google", "graph", "none"]), calendarId: text.min(1) }).strict(),
    firmPolicy: z
      .object({
        icwaNoticeTargetDays: z.number().int().positive(),
        limitationReminderMonths: z.array(z.number().int().positive()),
      })
      .strict(),
    trust: z
      .object({
        source: z.enum(["xero", "addon_csv", "none"]),
        xeroTenantId: text.optional(),
        trustBankAccountId: text.optional(),
        trackingCategoryName: text.optional(),
        referencePattern: text.refine(validRegex, "Not a valid pattern").optional(),
        accountName: text,
        opening: z.object({ asAt: z.iso.date(), cashbook: cents, clientLedgers: z.record(text, cents) }).strict().optional(),
        statementMapping: z.object({ date: text, amount: text.optional(), credit: text.optional(), debit: text.optional(), description: text }).strict(),
        cashbookMapping: z
          .object({
            date: text,
            matter: text,
            party: text,
            reference: text.optional(),
            amount: text.optional(),
            receipt: text.optional(),
            payment: text.optional(),
            type: text.optional(),
            transferPattern: text.refine(validRegex, "Not a valid pattern").optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    letter: z
      .object({
        senderName: text,
        senderTitle: text,
        senderEmail: text,
        senderPhone: text,
        signoff: text,
        signoffFont: text,
        signoffSizePt: z.number().positive().max(72),
        signoffColor: text.regex(/^[0-9a-f]{6}$/i, "Use a six-digit hex colour such as 1F3864"),
        accentColor: text.regex(/^[0-9a-f]{6}$/i, "Use a six-digit hex colour such as 1F3864"),
        closing: text,
      })
      .strict(),
    firmAddress: text,
    privacy: z.object({ officerName: text, officerEmail: text }).strict(),
    updatedAt: text,
  })
  .strict();
