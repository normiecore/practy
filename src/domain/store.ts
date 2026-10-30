import { Collection, type Entity } from "../core/collection.js";
import { MemoryPersistence, WriteQueue, type Persistence } from "../core/persistence.js";
import type { KeyDate, Matter, Party } from "./model.js";

/**
 * The firm's working set. Modules obtain their own typed collections with
 * `collection(kind)`, so new features don't need to edit this file.
 */
export class Store {
  private readonly cols = new Map<string, Collection<any>>();

  constructor(
    readonly queue: WriteQueue = new WriteQueue(new MemoryPersistence()),
    private readonly loaded = new Map<string, unknown[]>(),
  ) {}

  static async open(persistence: Persistence): Promise<Store> {
    return new Store(new WriteQueue(persistence), await persistence.loadAll());
  }

  collection<T extends Entity>(kind: string): Collection<T> {
    let col = this.cols.get(kind);
    if (!col) {
      col = new Collection<T>(kind, this.queue);
      col.hydrate(this.loaded.get(kind) ?? []);
      this.cols.set(kind, col);
    }
    return col as Collection<T>;
  }

  get matters() {
    return this.collection<Matter>("matter");
  }
  get parties() {
    return this.collection<Party>("party");
  }
  get keyDates() {
    return this.collection<KeyDate>("key_date");
  }

  mattersFor(tenantId: string): Matter[] {
    return this.matters.list(tenantId);
  }

  /** Matter numbers are unique per firm ignoring case and surrounding whitespace. */
  matterByNumber(tenantId: string, number: string): Matter | undefined {
    const n = number.trim().toLowerCase();
    return this.matters.list(tenantId, (m) => m.number.trim().toLowerCase() === n)[0];
  }

  keyDatesFor(tenantId: string, matterId?: string): KeyDate[] {
    return this.keyDates.list(tenantId, (k) => !matterId || k.matterId === matterId);
  }

  flush(): Promise<void> {
    return this.queue.flush();
  }
}
