import { join } from "node:path";
import { settingsFor } from "../admin/settings.js";
import { GoogleCalendarSink } from "../connectors/calendar/google.js";
import { GraphCalendarSink } from "../connectors/calendar/graph.js";
import { BoxDocumentStore, boxClientCredentialsToken } from "../connectors/documents/box.js";
import { LocalDocumentStore } from "../connectors/documents/local.js";
import { cachedToken } from "../connectors/http.js";
import { GmailMailSource } from "../connectors/mail/gmail.js";
import { GraphMailSource } from "../connectors/mail/graph.js";
import { tokenProvider, type SecretStore } from "../core/secrets.js";
import type { Store } from "../domain/store.js";
import type { TrustService } from "../trust/commands.js";
import { AddOnCsvTrustSource } from "../trust/sources/addon-csv.js";
import { XeroTrustSource } from "../trust/sources/xero.js";
import type { IntegrationHub } from "./hub.js";
import { connectionSecretName, refreshToken, type ConnectProvider } from "./oauth.js";

export interface BoxCredentials {
  clientId: string;
  clientSecret: string;
  enterpriseId?: string;
  userId?: string;
}

export interface TrustExport {
  id: string;
  tenantId: string;
  csv: string;
  uploadedAt: string;
  uploadedBy: string;
}

/**
 * Builds each firm's connectors from settings plus encrypted credentials. Connector
 * instances are cached per firm/user and rebuilt when settings change.
 */
export function wireIntegrations(args: {
  store: Store;
  secrets: SecretStore;
  hub: IntegrationHub;
  trust: TrustService;
  providers: Map<string, ConnectProvider>;
  localDocumentsRoot?: string;
}): void {
  const { store, secrets, hub, trust, providers } = args;
  const cache = new Map<string, { stamp: string; value: unknown }>();
  const memo = <T>(key: string, stamp: string, build: () => T): T => {
    const hit = cache.get(key);
    if (hit && hit.stamp === stamp) return hit.value as T;
    const value = build();
    cache.set(key, { stamp, value });
    return value;
  };
  const userToken = (tenantId: string, providerId: string, userId: string) => {
    const p = providers.get(providerId);
    if (!p) return null;
    const name = connectionSecretName(p, userId);
    if (!secrets.has(tenantId, name)) return null;
    return tokenProvider(secrets, tenantId, name, (rt) => refreshToken(p, rt));
  };

  hub.setDocuments((tenantId) => {
    const s = settingsFor(store, tenantId);
    return memo(`docs:${tenantId}`, s.updatedAt, () => {
      if (s.documents.store === "local") {
        return new LocalDocumentStore({ root: join(args.localDocumentsRoot ?? "data/documents", tenantId) });
      }
      const creds = secrets.get<BoxCredentials>(tenantId, "box");
      if (!creds || !s.documents.mattersRootFolderId) return null;
      const getAccessToken = cachedToken(() =>
        boxClientCredentialsToken({ clientId: creds.clientId, clientSecret: creds.clientSecret, ...(creds.userId ? { userId: creds.userId } : { enterpriseId: creds.enterpriseId! }) }),
      );
      return new BoxDocumentStore({ getAccessToken, mattersRootFolderId: s.documents.mattersRootFolderId });
    });
  });

  hub.setMail((tenantId, userId) => {
    const s = settingsFor(store, tenantId);
    if (s.mail.provider === "none") return null;
    const providerId = s.mail.provider === "gmail" ? "google" : "microsoft";
    const getAccessToken = userToken(tenantId, providerId, userId);
    if (!getAccessToken) return null;
    return s.mail.provider === "gmail" ? new GmailMailSource({ getAccessToken }) : new GraphMailSource({ getAccessToken });
  });

  hub.setCalendar((tenantId, userId) => {
    const s = settingsFor(store, tenantId);
    if (s.calendar.provider === "none") return null;
    const getAccessToken = userToken(tenantId, s.calendar.provider === "google" ? "google" : "microsoft", userId);
    if (!getAccessToken) return null;
    return s.calendar.provider === "google"
      ? new GoogleCalendarSink({ getAccessToken, calendarId: s.calendar.calendarId })
      : new GraphCalendarSink({ getAccessToken });
  });

  trust.resolver = (tenantId) => {
    const s = settingsFor(store, tenantId);
    const t = s.trust;
    if (t.source === "none" || !t.opening) return undefined;
    const common = { opening: t.opening, statementMapping: t.statementMapping, accountName: t.accountName };
    if (t.source === "xero") {
      const p = providers.get("xero");
      if (!p || !t.xeroTenantId || !t.trustBankAccountId || !secrets.has(tenantId, "xero")) return undefined;
      return {
        ...common,
        source: new XeroTrustSource({
          xeroTenantId: t.xeroTenantId,
          trustBankAccountId: t.trustBankAccountId,
          trackingCategoryName: t.trackingCategoryName,
          referencePattern: t.referencePattern ? new RegExp(t.referencePattern) : undefined,
          getAccessToken: tokenProvider(secrets, tenantId, "xero", (rt) => refreshToken(p, rt)),
        }),
      };
    }
    const latest = store
      .collection<TrustExport>("trust_export")
      .list(tenantId)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
    if (!latest) return undefined;
    const mapping = s.trust.cashbookMapping;
    if (!mapping) return undefined;
    return { ...common, source: new AddOnCsvTrustSource(async () => latest.csv, { ...mapping, transferPattern: mapping.transferPattern ? new RegExp(mapping.transferPattern, "i") : undefined }) };
  };
}
