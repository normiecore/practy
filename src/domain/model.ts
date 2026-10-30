import type { IsoDate } from "../core/calendar.js";

/** Pilot schemes with rule packs; "other" holds imported matters (public liability, SRC Act…) without automatic dates. */
export const SCHEMES = ["icwa_mva", "workcover_wa", "other"] as const;
export type Scheme = (typeof SCHEMES)[number];

export const PARTY_ROLES = ["client", "defendant", "insurer", "employer", "driver", "witness", "other"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export interface Party {
  id: string;
  tenantId: string;
  name: string;
  kind: "person" | "organisation";
  dateOfBirth?: IsoDate;
  email?: string;
  phone?: string;
  address?: string;
}

export interface Matter {
  id: string;
  tenantId: string;
  number: string;
  title: string;
  scheme: Scheme;
  status: "open" | "closed";
  injuryDate: IsoDate;
  openedOn: IsoDate;
  parties: { partyId: string; role: PartyRole }[];
  responsibleUserId: string;
  /** Client consent to AI processing. When false the matter is invisible to AI surfaces. */
  aiPermitted: boolean;
  /** Ethical wall: if set, only these users can see the matter. */
  restrictedTo?: string[];
  /** Pointers into connected systems; Practy is the hub (MCP-FIRST.md §1.5). */
  links: { boxFolderId?: string; xeroContactId?: string; xeroTrackingOption?: string; externalId?: string };
  /** Court action numbers, insurer claim numbers etc. Used for email matching. */
  references?: string[];
  /** Legal hold suspends retention-based destruction. */
  legalHold?: { on: boolean; reason: string; setBy: string; setAt: string };
  closedOn?: IsoDate;
  /** AML/CTF designated-service screening result at intake. */
  amlScreening?: { designatedService: boolean; answers: Record<string, boolean>; screenedBy: string; screenedAt: string };
}

export type KeyDateStatus = "proposed" | "confirmed" | "manual_required" | "dismissed";

export interface KeyDate {
  id: string;
  tenantId: string;
  matterId: string;
  ruleId?: string;
  rulePackVersion?: string;
  kind: "critical" | "deadline" | "reminder";
  title: string;
  date: IsoDate | null;
  status: KeyDateStatus;
  /** False when the underlying rule is still on the verification register. */
  ruleVerified: boolean;
  source: string;
  notes: string[];
  confirmedBy?: string;
  confirmedAt?: string;
}
