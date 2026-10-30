import { createHttp, type HttpClient } from "../http.js";
import type { ConnectorDeps, ImportedMatter, MatterImporter } from "../types.js";
import { schemeFromMatterType, statusFromText } from "./matter-type.js";

/**
 * PracticePanther REST API v2 matter import.
 * Reference: https://app.practicepanther.com/content/apidocs/index.html (API v2, "KISS Api").
 *
 * Per the reference: OAuth 2.0 authorization-code bearer tokens (24 h access, 14-day
 * refresh via POST /oauth/token); list endpoints return a flat JSON array of every
 * matching record with no paging (invoices excepted); related records are `*_ref`
 * objects with `id` and `display_name`.
 *
 * Four list calls (matters, accounts, contacts, relationships) are joined in memory
 * rather than one detail call per matter, which suits a one-off import of ~2,000 matters.
 *
 * [verify] The v2 reference shows list responses with `custom_field_values` and the
 * account's embedded `primary_contact`, but the older help article says lists return a
 * "standard" (reduced) format. Contacts are fetched separately so client details survive
 * either way; if matter custom fields are absent from the list, injury date and a
 * custom-field matter type will be blank and need GET /matters/{id} per matter.
 */
export interface PracticePantherImporterOptions extends ConnectorDeps {
  baseUrl?: string;
  /** Limit to one PracticePanther status; default imports all. */
  status?: "Open" | "Pending" | "Closed";
  /**
   * Labels of the firm's custom fields (case-insensitive). Firm-specific: confirm the
   * labels in PracticePanther Settings → Custom Fields at onboarding.
   */
  customFields?: {
    /** Matter custom field holding the matter type / scheme, e.g. "Matter Type". */
    matterType?: string;
    /** Matter custom field, e.g. "Date of Injury". */
    injuryDate?: string;
    /** Contact custom field, e.g. "Date of Birth". */
    clientDateOfBirth?: string;
  };
}

interface Ref {
  id: string;
  display_name?: string;
}

export interface PpCustomFieldValue {
  custom_field_ref: { id: string; label: string; value_type?: string };
  value_boolean?: boolean | null;
  value_date_time?: string | null;
  value_number?: number | null;
  value_string?: string | null;
  contact_ref?: Ref | null;
}

export interface PpMatter {
  id: string;
  account_ref?: Ref | null;
  number?: number | null;
  display_name?: string | null;
  name?: string | null;
  notes?: string | null;
  open_date?: string | null;
  close_date?: string | null;
  statute_of_limitation_date?: string | null;
  tags?: string[] | null;
  status?: "Open" | "Pending" | "Closed" | string | null;
  assigned_to_users?: { id: string; display_name?: string; email_address?: string }[] | null;
  custom_field_values?: PpCustomFieldValue[] | null;
}

export interface PpContact {
  id: string;
  account_ref?: Ref | null;
  is_primary_contact?: boolean | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_mobile?: string | null;
  phone_home?: string | null;
  phone_work?: string | null;
  email?: string | null;
  custom_field_values?: PpCustomFieldValue[] | null;
}

export interface PpAccount {
  id: string;
  display_name?: string | null;
  company_name?: string | null;
  address_street_1?: string | null;
  address_street_2?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip_code?: string | null;
  address_country?: string | null;
  primary_contact?: PpContact | null;
}

export interface PpRelationship {
  id: string;
  contact_ref?: (Ref & { account_ref?: Ref }) | null;
  matter_ref?: Ref | null;
  /** Free-text relationship, e.g. "Insurer", "Employer", "Driver". */
  name?: string | null;
  notes?: string | null;
}

export class PracticePantherImporter implements MatterImporter {
  readonly kind = "practicepanther" as const;
  private readonly http: HttpClient;

  constructor(private readonly opts: PracticePantherImporterOptions) {
    this.http = createHttp({
      service: "PracticePanther",
      baseUrl: opts.baseUrl ?? "https://app.practicepanther.com/api/v2",
      getAccessToken: opts.getAccessToken,
      fetch: opts.fetch,
    });
  }

  async listMatters(): Promise<ImportedMatter[]> {
    const matterQuery = this.opts.status ? `?${new URLSearchParams({ status: this.opts.status })}` : "";
    const [matters, accounts, contacts, relationships] = await Promise.all([
      this.http.json<PpMatter[]>(`/matters${matterQuery}`),
      this.http.json<PpAccount[]>("/accounts"),
      this.http.json<PpContact[]>("/contacts"),
      this.http.json<PpRelationship[]>("/relationships"),
    ]);
    return mapPracticePanther({ matters, accounts, contacts, relationships }, this.opts.customFields);
  }
}

/** Pure join/mapping step, exported for tests and for imports from a saved API dump. */
export function mapPracticePanther(
  data: { matters: PpMatter[]; accounts: PpAccount[]; contacts: PpContact[]; relationships: PpRelationship[] },
  fields: PracticePantherImporterOptions["customFields"] = {},
): ImportedMatter[] {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const contactsByAccount = groupBy(data.contacts, (c) => c.account_ref?.id);
  const relsByMatter = groupBy(data.relationships, (r) => r.matter_ref?.id);

  return data.matters.map((m) => {
    const account = m.account_ref ? accounts.get(m.account_ref.id) : undefined;
    const contact = primaryContact(account, contactsByAccount.get(m.account_ref?.id ?? "") ?? []);
    const number = matterNumber(m);

    const typeField = customValue(m.custom_field_values, fields.matterType);
    const matterType =
      (typeof typeField === "string" ? typeField : undefined) ??
      (m.tags ?? []).find((t) => schemeFromMatterType(t)) ??
      folderSuffix(m.display_name);
    const scheme = schemeFromMatterType(matterType);

    const client: ImportedMatter["client"] = {
      name: account?.display_name || m.account_ref?.display_name || contact?.display_name || "",
    };
    if (contact?.email) client.email = contact.email;
    const phone = contact?.phone_mobile || contact?.phone_home || contact?.phone_work;
    if (phone) client.phone = phone;
    const dob = dateOnly(customValue(contact?.custom_field_values, fields.clientDateOfBirth));
    if (dob) client.dateOfBirth = dob;
    const address = account && formatAddress(account);
    if (address) client.address = address;

    const out: ImportedMatter = {
      externalId: m.id,
      number,
      title: m.display_name || m.name || `${number} - ${client.name}`,
      status: statusFromText(m.status ?? undefined),
      client,
      otherParties: (relsByMatter.get(m.id) ?? []).flatMap((r) =>
        r.contact_ref?.display_name ? [{ name: r.contact_ref.display_name, role: r.name || "other" }] : [],
      ),
    };
    if (matterType) out.matterType = matterType;
    if (scheme) out.scheme = scheme;
    const openedOn = dateOnly(m.open_date);
    if (openedOn) out.openedOn = openedOn;
    const injuryDate = dateOnly(customValue(m.custom_field_values, fields.injuryDate));
    if (injuryDate) out.injuryDate = injuryDate;
    const staff = m.assigned_to_users?.[0]?.display_name;
    if (staff) out.responsibleStaff = staff;
    if (m.notes) out.notes = m.notes;
    return out;
  });
}

/**
 * [verify] PracticePanther's own matter `number` is assumed to be the firm's matter
 * number (1998), as the Box folders and the firm's skills use it. When it is
 * absent, a leading number in the display name ("1998 - Priestley, Toni") is used.
 */
function matterNumber(m: PpMatter): string {
  if (m.number != null && m.number > 0) return String(m.number);
  return /^\s*(\d+)\b/.exec(m.display_name ?? m.name ?? "")?.[1] ?? "";
}

/** "1998 - Priestley, Toni - MVA" → "MVA" when the suffix names a scheme. */
function folderSuffix(displayName: string | null | undefined): string | undefined {
  const last = displayName?.split(" - ").at(-1)?.trim();
  return last && displayName!.includes(" - ") && schemeFromMatterType(last) ? last : undefined;
}

/** Account's embedded primary contact, else the contact flagged primary, else the first. */
function primaryContact(account: PpAccount | undefined, contacts: PpContact[]): PpContact | undefined {
  return account?.primary_contact ?? contacts.find((c) => c.is_primary_contact) ?? contacts[0];
}

function customValue(values: PpCustomFieldValue[] | null | undefined, label: string | undefined) {
  if (!label || !values) return undefined;
  const v = values.find((x) => x.custom_field_ref.label.trim().toLowerCase() === label.trim().toLowerCase());
  if (!v) return undefined;
  return v.value_date_time ?? v.value_string ?? v.value_number ?? v.contact_ref?.display_name ?? undefined;
}

/** PracticePanther dates are ISO 8601 at midnight ("2018-03-12T00:00:00+00:00"); keep the calendar date. */
function dateOnly(v: unknown): string | undefined {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined;
}

function formatAddress(a: PpAccount): string | undefined {
  const line = [a.address_street_1, a.address_street_2, a.address_city, [a.address_state, a.address_zip_code].filter(Boolean).join(" "), a.address_country]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");
  return line || undefined;
}

function groupBy<T>(items: T[], key: (t: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}
