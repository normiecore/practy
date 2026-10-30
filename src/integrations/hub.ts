import type { CalendarSink, DocumentStore, MailSource } from "../connectors/types.js";

/**
 * Resolves each firm's connected systems. Factories are registered at start-up from
 * settings and encrypted credentials; tests register fakes. Mail is per mailbox
 * (each fee earner connects their own), documents and calendar are per firm.
 */
export class IntegrationHub {
  private documentsFactory?: (tenantId: string) => DocumentStore | null;
  private mailFactory?: (tenantId: string, userId: string) => MailSource | null;
  private calendarFactory?: (tenantId: string, userId: string) => CalendarSink | null;

  setDocuments(f: (tenantId: string) => DocumentStore | null): this {
    this.documentsFactory = f;
    return this;
  }
  setMail(f: (tenantId: string, userId: string) => MailSource | null): this {
    this.mailFactory = f;
    return this;
  }
  setCalendar(f: (tenantId: string, userId: string) => CalendarSink | null): this {
    this.calendarFactory = f;
    return this;
  }

  documents(tenantId: string): DocumentStore | null {
    return this.documentsFactory?.(tenantId) ?? null;
  }
  mail(tenantId: string, userId: string): MailSource | null {
    return this.mailFactory?.(tenantId, userId) ?? null;
  }
  calendar(tenantId: string, userId: string): CalendarSink | null {
    return this.calendarFactory?.(tenantId, userId) ?? null;
  }

  requireDocuments(tenantId: string): DocumentStore {
    const d = this.documents(tenantId);
    if (!d) throw new Error("No document store is connected (Settings → Integrations)");
    return d;
  }
}
