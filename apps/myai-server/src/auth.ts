import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { MyaiConfig } from "./config.js";
import type { SqliteDatabase } from "./database.js";
import { authSchema } from "./auth-schema.js";

export function createAuth(database: SqliteDatabase, config: MyaiConfig) {
  const orm = drizzle(database);
  return betterAuth({
    database: drizzleAdapter(orm, { provider: "sqlite", schema: authSchema }),
    secret: config.sessionSecret,
    baseURL: config.publicBaseUrl,
    basePath: "/api/auth",
    trustedOrigins: [config.publicBaseUrl],
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    advanced: { useSecureCookies: config.environment === "production" },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    logger: { disabled: true },
  });
}

export type MyaiAuth = ReturnType<typeof createAuth>;

export async function authJson(auth: MyaiAuth, config: MyaiConfig, path: string, payload: Record<string, unknown>): Promise<Response> {
  return auth.handler(new Request(`${config.publicBaseUrl}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: config.publicBaseUrl },
    body: JSON.stringify(payload),
  }));
}

export async function authSignOut(auth: MyaiAuth, config: MyaiConfig, headers: Headers): Promise<Response> {
  const requestHeaders = new Headers({ "content-type": "application/json", origin: config.publicBaseUrl });
  const cookie = headers.get("cookie");
  if (cookie) requestHeaders.set("cookie", cookie);
  return auth.handler(new Request(`${config.publicBaseUrl}/api/auth/sign-out`, { method: "POST", headers: requestHeaders }));
}
