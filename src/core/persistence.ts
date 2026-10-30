import pg from "pg";
import type { AuditEntry } from "./audit.js";

/**
 * Durable storage behind the in-memory collections.
 *
 * The pilot runs one deployment per firm (a single-tenant cell in the AU region), so
 * the working set is loaded into memory at start-up and every change is written
 * through before a command returns. Records stay keyed by tenant so the same schema
 * serves a pooled multi-tenant cell later (with row-level security).
 */
export interface Persistence {
  loadAll(): Promise<Map<string, unknown[]>>;
  loadAudit(): Promise<AuditEntry[]>;
  put(kind: string, tenantId: string, id: string, data: unknown): Promise<void>;
  appendAudit(entry: AuditEntry): Promise<void>;
  close(): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  async loadAll() {
    return new Map<string, unknown[]>();
  }
  async loadAudit() {
    return [];
  }
  async put() {}
  async appendAudit() {}
  async close() {}
}

export const SCHEMA_SQL = `
create table if not exists records (
  kind text not null,
  id text not null,
  tenant_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);
create index if not exists records_tenant_kind on records (tenant_id, kind);

create table if not exists audit_log (
  seq bigint primary key,
  tenant_id text not null,
  hash text not null unique,
  data jsonb not null,
  written_at timestamptz not null default now()
);

create or replace function practy_audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists audit_log_append_only on audit_log;
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function practy_audit_append_only();
`;

export class PostgresPersistence implements Persistence {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async loadAll() {
    const { rows } = await this.pool.query<{ kind: string; data: unknown }>("select kind, data from records");
    const out = new Map<string, unknown[]>();
    for (const r of rows) {
      const list = out.get(r.kind) ?? [];
      list.push(r.data);
      out.set(r.kind, list);
    }
    return out;
  }

  async loadAudit() {
    const { rows } = await this.pool.query<{ data: AuditEntry }>("select data from audit_log order by seq");
    return rows.map((r) => r.data);
  }

  async put(kind: string, tenantId: string, id: string, data: unknown) {
    await this.pool.query(
      `insert into records (kind, id, tenant_id, data, updated_at) values ($1, $2, $3, $4, now())
       on conflict (kind, id) do update set data = excluded.data, updated_at = now()`,
      [kind, id, tenantId, JSON.stringify(data)],
    );
  }

  async appendAudit(entry: AuditEntry) {
    await this.pool.query("insert into audit_log (seq, tenant_id, hash, data) values ($1, $2, $3, $4)", [
      entry.seq,
      entry.tenantId,
      entry.hash,
      JSON.stringify(entry),
    ]);
  }

  async close() {
    await this.pool.end();
  }
}

/**
 * Serialises writes in order and surfaces failures. The command bus awaits `flush()`
 * after every command so a response is only sent once its changes are durable.
 */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private failure: unknown;

  constructor(readonly persistence: Persistence) {}

  enqueue(write: () => Promise<void>): void {
    this.tail = this.tail.then(write).catch((err) => {
      this.failure ??= err;
    });
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) {
      const err = this.failure;
      this.failure = undefined;
      throw err;
    }
  }
}
