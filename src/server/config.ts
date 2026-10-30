import { resolve } from "node:path";
import { DevOidcProvider, DiscoveryOidcProvider, GOOGLE_ISSUER, microsoftIssuer, type OidcProvider } from "../auth/oidc.js";

/** Runtime configuration from the environment. See docs/DEPLOY.md for every variable. */
export interface Config {
  port: number;
  baseUrl: string;
  databaseUrl?: string;
  tenantId: string;
  firmName: string;
  bootstrapAdminEmail?: string;
  secretKey?: string;
  devLogin: boolean;
  production: boolean;
  webDir: string;
  providers: Map<string, OidcProvider>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const devLogin = env.PRACTY_DEV_LOGIN === "1";
  if (production && devLogin) throw new Error("PRACTY_DEV_LOGIN cannot be enabled in production");
  const providers = new Map<string, OidcProvider>();
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.set(
      "google",
      new DiscoveryOidcProvider({
        id: "google",
        label: "Google",
        issuer: GOOGLE_ISSUER,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        hostedDomain: env.GOOGLE_HOSTED_DOMAIN,
      }),
    );
  }
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.MICROSOFT_TENANT_ID) {
    providers.set(
      "microsoft",
      new DiscoveryOidcProvider({
        id: "microsoft",
        label: "Microsoft",
        issuer: microsoftIssuer(env.MICROSOFT_TENANT_ID),
        clientId: env.MICROSOFT_CLIENT_ID,
        clientSecret: env.MICROSOFT_CLIENT_SECRET,
      }),
    );
  }
  if (devLogin) providers.set("dev", new DevOidcProvider());
  if (production && !env.PRACTY_SECRET_KEY) throw new Error("PRACTY_SECRET_KEY is required in production");
  if (production && !env.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
  const port = Number(env.PORT ?? 3000);
  return {
    port,
    baseUrl: (env.PRACTY_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
    databaseUrl: env.DATABASE_URL,
    tenantId: env.PRACTY_TENANT_ID ?? "default",
    firmName: env.PRACTY_FIRM_NAME ?? "Practy",
    bootstrapAdminEmail: env.PRACTY_BOOTSTRAP_ADMIN_EMAIL?.toLowerCase(),
    secretKey: env.PRACTY_SECRET_KEY,
    devLogin,
    production,
    webDir: resolve(env.PRACTY_WEB_DIR ?? "dist/web"),
    providers,
  };
}
