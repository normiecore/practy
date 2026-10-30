import type { WriteQueue } from "./persistence.js";

export interface Entity {
  id: string;
  tenantId: string;
}

/**
 * In-memory, tenant-keyed collection with write-through persistence.
 * Mutating a record in place is not persisted: call `set` with the changed record.
 */
export class Collection<T extends Entity> {
  private readonly items = new Map<string, T>();

  constructor(
    readonly kind: string,
    private readonly queue?: WriteQueue,
  ) {}

  hydrate(records: unknown[]): void {
    for (const r of records as T[]) this.items.set(r.id, r);
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  /** Tenant-checked lookup. */
  find(tenantId: string, id: string): T | undefined {
    const item = this.items.get(id);
    return item && item.tenantId === tenantId ? item : undefined;
  }

  set(item: T): T {
    this.items.set(item.id, item);
    const snapshot = structuredClone(item);
    this.queue?.enqueue(() => this.queue!.persistence.put(this.kind, item.tenantId, item.id, snapshot));
    return item;
  }

  /** Apply a change and persist it. */
  update(id: string, change: (item: T) => void): T | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;
    change(item);
    return this.set(item);
  }

  list(tenantId: string, filter?: (item: T) => boolean): T[] {
    const out: T[] = [];
    for (const item of this.items.values()) {
      if (item.tenantId === tenantId && (!filter || filter(item))) out.push(item);
    }
    return out;
  }

  values(): IterableIterator<T> {
    return this.items.values();
  }
}
