import type { KeyDate, Matter, Party } from "./model.js";

/**
 * In-memory repository. The Postgres implementation (row-level security per tenant,
 * region-pinned) replaces this behind the same interface; Phase 0 keeps the domain
 * and policy logic testable without infrastructure.
 */
export class Store {
  readonly matters = new Map<string, Matter>();
  readonly parties = new Map<string, Party>();
  readonly keyDates = new Map<string, KeyDate>();

  mattersFor(tenantId: string): Matter[] {
    return [...this.matters.values()].filter((m) => m.tenantId === tenantId);
  }

  keyDatesFor(tenantId: string, matterId?: string): KeyDate[] {
    return [...this.keyDates.values()].filter(
      (k) => k.tenantId === tenantId && (!matterId || k.matterId === matterId),
    );
  }
}
