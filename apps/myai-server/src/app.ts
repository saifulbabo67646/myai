import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { Hono } from "hono";
import { z } from "zod";
import { createAuth, authJson, authSignOut, type MyaiAuth } from "./auth.js";
import { resolveMyaiConfig, type MyaiConfig, type MyaiConfigInput } from "./config.js";
import { openDatabase } from "./database.js";
import { createLogger, type MyaiLogger } from "./logger.js";
import { validateWorkspaceFilePath, validateWorkspacePath, InvalidWorkspacePathError } from "./paths.js";
import { createLocalExecutionBackend, type ExecutionBackend } from "./runtime.js";
import { ControlStore, createOpaqueToken, hashOpaqueToken, type Membership, type Role, type UserSummary } from "./store.js";

type Variables = { requestId: string };
type App = Hono<{ Variables: Variables }>;

export interface MyaiApplication {
  readonly app: App;
  readonly fetch: App["fetch"];
  readonly store: ControlStore;
  readonly logger: MyaiLogger;
  readonly config: MyaiConfig;
  close(): void;
}

type ErrorCode = "invalid_request" | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid_path" | "runtime_unavailable" | "not_ready" | "internal_error";

interface Principal {
  user: UserSummary;
  membership: Membership;
}

interface AuthPayload {
  user: UserSummary;
  cookie: string | null;
  session: { id: string; expiresAt: string };
}

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z.string().min(8).max(256);
const setupSchema = z.object({ email: emailSchema, password: passwordSchema, name: z.string().trim().min(1).max(120) }).strict();
const signInSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();
const invitationSchema = z.object({ email: emailSchema, role: z.enum(["admin", "member", "viewer"]) }).strict();
const acceptSchema = z.object({ name: z.string().trim().min(1).max(120), password: passwordSchema }).strict();
const roleSchema = z.object({ role: z.enum(["admin", "member", "viewer"]) }).strict();
const workspaceSchema = z.object({ name: z.string().trim().min(1).max(120), path: z.string().trim().min(1).max(4_096) }).strict();
const accessSchema = z.object({ userId: z.string().trim().min(1).max(200), role: z.enum(["member", "viewer"]) }).strict();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Auth response missing ${field}`);
  return value;
}

function responseJson(requestId: string, status: number, payload: unknown, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers({ "content-type": "application/json", "x-request-id": requestId, ...extraHeaders });
  return new Response(JSON.stringify(payload), { status, headers });
}

function emptyResponse(requestId: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: new Headers({ "x-request-id": requestId, ...extraHeaders }) });
}

function failure(requestId: string, status: number, code: ErrorCode, message: string, details?: Record<string, unknown>): Response {
  return responseJson(requestId, status, { error: { code, message, requestId, ...(details ? { details } : {}) } });
}

function cookieFrom(response: Response): string | null {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
}

function userFrom(value: unknown): UserSummary {
  const user = record(value);
  if (!user) throw new Error("Auth response missing user");
  return { id: text(user.id, "user id"), email: text(user.email, "user email"), name: text(user.name, "user name") };
}

async function authPayload(auth: MyaiAuth, response: Response): Promise<AuthPayload> {
  const parsed: unknown = await response.json();
  const data = record(parsed);
  if (!data) throw new Error("Auth response was not an object");
  const user = userFrom(data.user);
  const cookie = cookieFrom(response);
  const session = cookie ? await auth.api.getSession({ headers: new Headers({ cookie }) }) : null;
  return {
    user,
    cookie,
    session: session?.session
      ? { id: session.session.id, expiresAt: new Date(session.session.expiresAt).toISOString() }
      : { id: "session-managed", expiresAt: new Date(Date.now() + 2_592_000_000).toISOString() },
  };
}

function copyCookie(response: Response, requestId: string, payload: unknown, status: number): Response {
  const cookie = response.headers.get("set-cookie");
  return responseJson(requestId, status, payload, cookie ? { "set-cookie": cookie } : {});
}

function roleAllows(role: Role, required: "admin" | "owner"): boolean {
  if (required === "owner") return role === "owner";
  return role === "owner" || role === "admin";
}

function secretMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

async function principal(request: Request, auth: MyaiAuth, store: ControlStore): Promise<Principal | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  const membership = store.activeMembership(session.user.id);
  if (!membership) return null;
  return {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    membership,
  };
}

async function jsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const parsed: unknown = await request.json();
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function runtimeScope(runtimePath: string, method: string): string | null {
  if (runtimePath === "/opencode/session" && method === "POST") return "runtime:session";
  if (runtimePath === "/files/content" && method === "GET") return "file:read";
  if (runtimePath === "/files/content" && method === "PUT") return "file:write";
  return null;
}

export function createMyaiApp(input: MyaiConfigInput): MyaiApplication {
  const config = resolveMyaiConfig(input);
  mkdirSync(config.dataDir, { recursive: true });
  const database = openDatabase(config);
  const store = new ControlStore(database);
  const logger = createLogger(config.logFile);
  const auth = createAuth(database, config);
  const backend = createLocalExecutionBackend(config, logger);
  const app: App = new Hono<{ Variables: Variables }>();

  app.use("*", async (context, next) => {
    const requestId = `req_${randomUUID()}`;
    context.set("requestId", requestId);
    context.header("x-request-id", requestId);
    await next();
  });

  app.get("/healthz", (context) => responseJson(context.get("requestId"), 200, { status: "ok", service: "myai-server", version: "1.0" }));
  app.get("/readyz", async (context) => {
    const requestId = context.get("requestId");
    const configReady = config.workspaceRoots.length > 0 && Boolean(config.runtimeBaseUrl) && Boolean(config.sessionSecret);
    const runtimeReady = config.environment === "test" ? true : await backend.ready();
    if (!configReady || !runtimeReady) return failure(requestId, 503, "not_ready", "The server is not ready.", { config: configReady ? "ok" : "failed", runtime: runtimeReady ? "ok" : "failed" });
    return responseJson(requestId, 200, { status: "ready", checks: { config: "ok", database: "ok", runtime: "ok" } });
  });

  app.post("/api/v1/setup/owner", async (context) => {
    const requestId = context.get("requestId");
    if (store.ownerExists()) return failure(requestId, 409, "conflict", "The installation already has an owner.");
    if (config.bootstrapSecret && !secretMatches(config.bootstrapSecret, context.req.header("x-myai-bootstrap-secret"))) return failure(requestId, 401, "unauthenticated", "Bootstrap authentication is required.");
    const payload = await jsonBody(context.req.raw, setupSchema);
    if (!payload) return failure(requestId, 400, "invalid_request", "The request payload is invalid.");
    const authResponse = await authJson(auth, config, "/sign-up/email", payload);
    if (!authResponse.ok) return failure(requestId, authResponse.status === 422 ? 409 : 400, authResponse.status === 422 ? "conflict" : "invalid_request", "The owner could not be created.");
    const created = await authPayload(auth, authResponse);
    try {
      store.addMembership(created.user, "owner");
    } catch {
      return failure(requestId, 409, "conflict", "The installation already has an owner.");
    }
    store.audit("owner_bootstrapped", created.user.id, created.user.id, null);
    logger.write({ event: "owner_bootstrapped", actorUserId: created.user.id });
    return copyCookie(authResponse, requestId, { user: created.user, team: { id: "team_local", name: "myai team" }, membership: { userId: created.user.id, role: "owner" }, session: created.session }, 201);
  });

  app.post("/api/v1/auth/sign-in", async (context) => {
    const requestId = context.get("requestId");
    const payload = await jsonBody(context.req.raw, signInSchema);
    if (!payload) return failure(requestId, 400, "invalid_request", "The request payload is invalid.");
    const authResponse = await authJson(auth, config, "/sign-in/email", payload);
    if (!authResponse.ok) {
      store.audit("sign_in_failed", null, null, null);
      logger.write({ event: "sign_in_failed" });
      return failure(requestId, 401, "unauthenticated", "Authentication failed.");
    }
    const signedIn = await authPayload(auth, authResponse);
    if (!store.activeMembership(signedIn.user.id)) return failure(requestId, 401, "unauthenticated", "Authentication failed.");
    store.audit("sign_in_succeeded", signedIn.user.id, signedIn.user.id, null);
    logger.write({ event: "sign_in_succeeded", actorUserId: signedIn.user.id });
    const membership = store.activeMembership(signedIn.user.id);
    if (!membership) return failure(requestId, 401, "unauthenticated", "Authentication failed.");
    return copyCookie(authResponse, requestId, { user: signedIn.user, team: { id: "team_local", name: "myai team" }, membership: { userId: signedIn.user.id, role: membership.role }, session: signedIn.session }, 200);
  });

  app.post("/api/v1/auth/sign-out", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    const response = await authSignOut(auth, config, context.req.raw.headers);
    if (current) store.audit("sign_out", current.user.id, current.user.id, null);
    return emptyResponse(requestId, 204, response.headers.get("set-cookie") ? { "set-cookie": response.headers.get("set-cookie") ?? "" } : {});
  });

  app.get("/api/v1/me", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    return responseJson(requestId, 200, { user: current.user, team: { id: "team_local", name: "myai team" }, membership: { userId: current.user.id, role: current.membership.role, status: current.membership.status } });
  });

  app.post("/api/v1/invitations", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    if (!roleAllows(current.membership.role, "admin")) return failure(requestId, 403, "forbidden", "The current role cannot manage invitations.");
    const payload = await jsonBody(context.req.raw, invitationSchema);
    if (!payload) return failure(requestId, 400, "invalid_request", "The request payload is invalid.");
    const code = createOpaqueToken("invite");
    const invitation = store.createInvitation(payload.email, payload.role, hashOpaqueToken(code), Date.now() + 7 * 24 * 60 * 60 * 1000);
    store.audit("invitation_created", current.user.id, invitation.id, null, { role: invitation.role });
    logger.write({ event: "invitation_created", actorUserId: current.user.id, invitationId: invitation.id });
    return responseJson(requestId, 201, { invitation, acceptCode: code });
  });

  app.post("/api/v1/invitations/:acceptCode/accept", async (context) => {
    const requestId = context.get("requestId");
    const code = context.req.param("acceptCode");
    const invitation = store.invitationByHash(hashOpaqueToken(code));
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || Date.parse(invitation.expiresAt) <= Date.now()) return failure(requestId, 404, "not_found", "The invitation is not available.");
    const payload = await jsonBody(context.req.raw, acceptSchema);
    if (!payload) return failure(requestId, 400, "invalid_request", "The request payload is invalid.");
    const authResponse = await authJson(auth, config, "/sign-up/email", { email: invitation.email, name: payload.name, password: payload.password });
    if (!authResponse.ok) return failure(requestId, 409, "conflict", "The invitation could not create an account.");
    const accepted = await authPayload(auth, authResponse);
    store.addMembership(accepted.user, invitation.role);
    store.acceptInvitation(invitation.id);
    store.audit("invitation_accepted", accepted.user.id, accepted.user.id, null);
    logger.write({ event: "invitation_accepted", actorUserId: accepted.user.id });
    return copyCookie(authResponse, requestId, { user: accepted.user, team: { id: "team_local", name: "myai team" }, membership: { userId: accepted.user.id, role: invitation.role }, session: accepted.session }, 201);
  });

  app.get("/api/v1/members", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    if (!roleAllows(current.membership.role, "admin")) return failure(requestId, 403, "forbidden", "The current role cannot list members.");
    return responseJson(requestId, 200, { members: store.members() });
  });

  app.patch("/api/v1/members/:userId", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    if (!roleAllows(current.membership.role, "admin")) return failure(requestId, 403, "forbidden", "The current role cannot change members.");
    const payload = await jsonBody(context.req.raw, roleSchema);
    if (!payload) return failure(requestId, 400, "invalid_request", "The request payload is invalid.");
    const target = store.membership(context.req.param("userId"));
    if (!target) return failure(requestId, 404, "not_found", "The member was not found.");
    if (target.role === "owner") return failure(requestId, 403, "forbidden", "Ownership changes are not supported.");
    if (current.membership.role !== "owner" && target.role === "admin") return failure(requestId, 403, "forbidden", "Only the owner can change an admin.");
    const updated = store.changeRole(target.userId, payload.role);
    if (!updated) return failure(requestId, 404, "not_found", "The member was not found.");
    store.audit("member_role_changed", current.user.id, updated.userId, null, { role: updated.role });
    return responseJson(requestId, 200, updated);
  });

  app.delete("/api/v1/members/:userId", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    const userId = context.req.param("userId");
    if (!roleAllows(current.membership.role, "admin")) return failure(requestId, 403, "forbidden", "The current role cannot revoke members.");
    const target = store.membership(userId);
    if (!target) return failure(requestId, 404, "not_found", "The member was not found.");
    if (target.role === "owner") return failure(requestId, 403, "forbidden", "The owner cannot be revoked.");
    if (current.membership.role !== "owner" && target.role === "admin") return failure(requestId, 403, "forbidden", "Only the owner can revoke an admin.");
    if (!store.revokeMember(userId)) return failure(requestId, 404, "not_found", "The member was not found.");
    store.audit("member_revoked", current.user.id, userId, null);
    logger.write({ event: "member_revoked", actorUserId: current.user.id, subjectId: userId });
    return emptyResponse(requestId, 204);
  });

  app.post("/api/v1/workspaces", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    if (!roleAllows(current.membership.role, "admin")) return failure(requestId, 403, "forbidden", "The current role cannot register workspaces.");
    const payload = await jsonBody(context.req.raw, workspaceSchema);
    if (!payload) return failure(requestId, 400, "invalid_request", "The request payload is invalid.");
    let canonicalPath: string;
    try {
      canonicalPath = validateWorkspacePath(payload.path, config.workspaceRoots);
    } catch (error) {
      if (error instanceof InvalidWorkspacePathError) return failure(requestId, 422, "invalid_path", "The workspace path is not allowed.");
      throw error;
    }
    try {
      const workspace = store.createWorkspace(payload.name, canonicalPath);
      store.audit("workspace_registered", current.user.id, workspace.id, workspace.id);
      return responseJson(requestId, 201, { workspace });
    } catch {
      return failure(requestId, 409, "conflict", "The workspace is already registered.");
    }
  });

  app.get("/api/v1/workspaces", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    return responseJson(requestId, 200, { workspaces: store.workspacesFor(current.user.id, roleAllows(current.membership.role, "admin")) });
  });

  app.post("/api/v1/workspaces/:workspaceId/access", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    if (!roleAllows(current.membership.role, "admin")) return failure(requestId, 403, "forbidden", "The current role cannot grant workspace access.");
    const payload = await jsonBody(context.req.raw, accessSchema);
    if (!payload) return failure(requestId, 400, "invalid_request", "The request payload is invalid.");
    const workspaceId = context.req.param("workspaceId");
    if (!store.workspace(workspaceId)) return failure(requestId, 404, "not_found", "The workspace was not found.");
    const member = store.activeMembership(payload.userId);
    if (!member || member.role === "owner") return failure(requestId, 404, "not_found", "The member was not found.");
    const grant = store.grantWorkspace(workspaceId, payload.userId, payload.role);
    store.audit("workspace_access_changed", current.user.id, payload.userId, workspaceId, { role: payload.role, action: "grant" });
    return responseJson(requestId, 201, grant);
  });

  app.delete("/api/v1/workspaces/:workspaceId/access/:userId", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    if (!roleAllows(current.membership.role, "admin")) return failure(requestId, 403, "forbidden", "The current role cannot revoke workspace access.");
    const workspaceId = context.req.param("workspaceId");
    const userId = context.req.param("userId");
    if (!store.revokeWorkspace(workspaceId, userId)) return failure(requestId, 404, "not_found", "The workspace grant was not found.");
    store.audit("workspace_access_changed", current.user.id, userId, workspaceId, { action: "revoke" });
    return emptyResponse(requestId, 204);
  });

  app.post("/api/v1/workspaces/:workspaceId/runtime-token", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    const workspaceId = context.req.param("workspaceId");
    if (!store.workspace(workspaceId)) return failure(requestId, 404, "not_found", "The workspace was not found.");
    const access = store.workspaceAccess(workspaceId, current.user.id);
    const elevated = roleAllows(current.membership.role, "admin");
    if (!access && !elevated) return failure(requestId, 403, "forbidden", "The current user has no workspace access.");
    const scopes = access === "viewer" ? ["file:read"] : ["runtime:session", "file:read", "file:write"];
    const token = createOpaqueToken("rt");
    const expiresAt = Date.now() + 15 * 60 * 1000;
    store.createRuntimeCredential(workspaceId, current.user.id, hashOpaqueToken(token), scopes, expiresAt);
    store.audit("runtime_token_created", current.user.id, current.user.id, workspaceId, { scopes });
    logger.write({ event: "runtime_token_created", actorUserId: current.user.id, workspaceId });
    return responseJson(requestId, 201, { token, workspaceId, scopes, expiresAt: new Date(expiresAt).toISOString() });
  });

  app.all("/api/v1/workspaces/:workspaceId/runtime/*", async (context) => {
    const requestId = context.get("requestId");
    const workspaceId = context.req.param("workspaceId");
    const workspace = store.workspace(workspaceId);
    if (!workspace) return failure(requestId, 404, "not_found", "The workspace was not found.");
    const authorization = context.req.header("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const credential = token ? store.runtimeCredential(hashOpaqueToken(token)) : null;
    const membership = credential ? store.activeMembership(credential.userId) : null;
    const access = credential && membership ? store.workspaceAccess(workspaceId, credential.userId) : null;
    if (!credential || !membership || (!access && !roleAllows(membership.role, "admin")) || credential.workspaceId !== workspaceId || credential.revokedAt !== null || credential.expiresAt <= Date.now()) {
      store.audit("authorization_failed", membership?.userId ?? null, credential?.userId ?? null, workspaceId, { surface: "runtime" });
      return failure(requestId, 401, "unauthenticated", "The runtime credential is invalid.");
    }
    const prefix = `/api/v1/workspaces/${workspaceId}/runtime`;
    const runtimePath = context.req.path.slice(prefix.length) || "/";
    const requiredScope = runtimeScope(runtimePath, context.req.method);
    if (!requiredScope || !credential.scopes.includes(requiredScope)) return failure(requestId, 403, "forbidden", "The runtime credential lacks the required scope.");
    if (runtimePath === "/files/content") {
      const filePath = context.req.query("path") ?? "";
      try {
        validateWorkspaceFilePath(workspace.path, filePath);
      } catch (error) {
        if (error instanceof InvalidWorkspacePathError) return failure(requestId, 422, "invalid_path", "The file path is not allowed.");
        throw error;
      }
    }
    try {
      const liveScopes = access === "viewer" ? ["file:read"] : access === "member" || roleAllows(membership.role, "admin") ? ["runtime:session", "file:read", "file:write"] : [];
      if (!liveScopes.includes(requiredScope)) {
        store.audit("authorization_failed", credential.userId, credential.userId, workspaceId, { surface: "runtime", reason: "grant_scope" });
        return failure(requestId, 403, "forbidden", "The runtime credential lacks the required scope.");
      }
      const response = await backend.proxy(context.req.raw, workspaceId, `${runtimePath}${context.req.url.includes("?") ? `?${context.req.url.split("?", 2)[1]}` : ""}`);
      store.audit("workspace_accessed", credential.userId, credential.userId, workspaceId, { method: context.req.method, path: runtimePath });
      return response;
    } catch {
      logger.write({ event: "runtime_unavailable", workspaceId });
      return failure(requestId, 502, "runtime_unavailable", "The local runtime is unavailable.");
    }
  });

  app.get("/api/v1/audit/events", async (context) => {
    const requestId = context.get("requestId");
    const current = await principal(context.req.raw, auth, store);
    if (!current) return failure(requestId, 401, "unauthenticated", "Authentication is required.");
    if (!roleAllows(current.membership.role, "admin")) return failure(requestId, 403, "forbidden", "The current role cannot list audit events.");
    const parsedLimit = Number(context.req.query("limit") ?? "50");
    const limit = Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 100 ? parsedLimit : 50;
    const cursor = context.req.query("cursor");
    if (cursor && cursor.length > 200) return failure(requestId, 400, "invalid_request", "The request query is invalid.");
    const events = store.auditEvents(limit, cursor);
    return responseJson(requestId, 200, events);
  });

  app.notFound((context) => failure(context.get("requestId"), 404, "not_found", "The resource was not found."));
  app.onError((error, context) => {
    logger.write({ event: "internal_error", requestId: context.get("requestId") });
    return failure(context.get("requestId"), 500, "internal_error", "The server could not complete the request.");
  });

  return { app, fetch: app.fetch, store, logger, config, close: () => database.close() };
}

export { configFromEnvironment, resolveMyaiConfig } from "./config.js";
export type { MyaiConfig, MyaiConfigInput } from "./config.js";
