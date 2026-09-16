import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { needs, test } from "@openwork/testkit";
import {
  createMyaiApp,
  resolveMyaiConfig,
  type MyaiApplication,
} from "../../apps/myai-server/src/app.ts";

interface JsonObject {
  [key: string]: unknown;
}

function object(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected JSON object");
  return Object.fromEntries(Object.entries(value));
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!value) throw new Error("Missing session cookie");
  return value;
}

async function request(app: MyaiApplication, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(new Request(`http://myai.test${path}`, init));
}

async function newRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function listenRuntime(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Runtime did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function closeRuntime(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function runtimeJson(response: ServerResponse, status: number): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ ok: true }));
}

async function consume(request: IncomingMessage): Promise<void> {
  for await (const _chunk of request) {
    // Drain the request body before closing the fake runtime response.
  }
}

test("passwords are delegated to the maintained auth library and never stored in plaintext", async () => {
  needs({ placement: "local" });
  const root = await newRoot("myai-password-security-");
  let app: MyaiApplication | undefined;
  try {
    app = createMyaiApp({ dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "test-session-secret-that-is-long-enough", environment: "test" });
    const response = await request(app, "/api/v1/setup/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.test", password: "plain-password-never-stored", name: "Owner" }) });
    expect(response.status).toBe(201);
    const sessionCredential = cookie(response).split("=", 2)[1];
    const database = (await readFile(join(root, "control.sqlite"))).toString("utf8");
    expect(database).not.toContain("plain-password-never-stored");
    expect(database).not.toContain(sessionCredential ?? "");
    expect(database).toMatch(/[0-9a-f]{32}:[0-9a-f]{128}/);
  } finally {
    app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("owner bootstrap is an atomic one-time claim", async () => {
  needs({ placement: "local" });
  const root = await newRoot("myai-owner-race-security-");
  let app: MyaiApplication | undefined;
  try {
    app = createMyaiApp({ dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "test-session-secret-that-is-long-enough", environment: "test" });
    const responses = await Promise.all([
      request(app, "/api/v1/setup/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "first-owner@example.test", password: "first-owner-password-123", name: "First Owner" }) }),
      request(app, "/api/v1/setup/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "second-owner@example.test", password: "second-owner-password-123", name: "Second Owner" }) }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(app.store.members().filter((member) => member.role === "owner")).toHaveLength(1);
  } finally {
    app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime token values are hashed at rest and never returned after revocation", async () => {
  needs({ placement: "local" });
  const root = await newRoot("myai-token-security-");
  let app: MyaiApplication | undefined;
  try {
    app = createMyaiApp({ dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "test-session-secret-that-is-long-enough", environment: "test" });
    const setup = await request(app, "/api/v1/setup/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.test", password: "owner-password-123", name: "Owner" }) });
    const ownerCookie = cookie(setup);
    const workspaceRoot = join(root, "workspace");
    await mkdir(workspaceRoot);
    const created = await request(app, "/api/v1/workspaces", { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Workspace", path: workspaceRoot }) });
    const workspaceId = String(object(object(await created.json()).workspace).id);
    const tokenResponse = await request(app, `/api/v1/workspaces/${workspaceId}/runtime-token`, { method: "POST", headers: { cookie: ownerCookie } });
    const token = String(object(await tokenResponse.json()).token);
    const database = (await readFile(join(root, "control.sqlite"))).toString("utf8");
    expect(database).not.toContain(token);
    expect(token).toMatch(/^rt_/);
  } finally {
    app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace registration rejects traversal and symlink escape", async () => {
  needs({ placement: "local" });
  const root = await newRoot("myai-path-security-");
  let app: MyaiApplication | undefined;
  try {
    const allowed = join(root, "allowed");
    const outside = join(root, "outside");
    await mkdir(allowed);
    await mkdir(outside);
    await symlink(outside, join(allowed, "escape"));
    app = createMyaiApp({ dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [allowed], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "test-session-secret-that-is-long-enough", environment: "test" });
    const setup = await request(app, "/api/v1/setup/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.test", password: "owner-password-123", name: "Owner" }) });
    const ownerCookie = cookie(setup);
    const traversal = await request(app, "/api/v1/workspaces", { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Traversal", path: join(allowed, "..", "outside") }) });
    expect(traversal.status).toBe(422);
    expect(object(await traversal.json()).error).toMatchObject({ code: "invalid_path" });
    const escaped = await request(app, "/api/v1/workspaces", { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Symlink", path: join(allowed, "escape") }) });
    expect(escaped.status).toBe(422);
    expect(object(await escaped.json()).error).toMatchObject({ code: "invalid_path" });
  } finally {
    app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime proxy binds each workspace route and strips control credentials", async () => {
  needs({ placement: "local" });
  const root = await newRoot("myai-runtime-boundary-security-");
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(join(workspaceRoot, "approved.txt"), "approved content\n");
  const observed: Array<{ url: string | undefined; authorization: string | null; cookie: string | null }> = [];
  const runtime = createServer(async (incoming, outgoing) => {
    observed.push({ url: incoming.url, authorization: incoming.headers.authorization ?? null, cookie: incoming.headers.cookie ?? null });
    await consume(incoming);
    runtimeJson(outgoing, 200);
  });
  const runtimeBaseUrl = await listenRuntime(runtime);
  let app: MyaiApplication | undefined;
  try {
    app = createMyaiApp({ dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl, sessionSecret: "test-session-secret-that-is-long-enough", environment: "test" });
    const setup = await request(app, "/api/v1/setup/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.test", password: "owner-password-123", name: "Owner" }) });
    const ownerCookie = cookie(setup);
    const workspaceResponse = await request(app, "/api/v1/workspaces", { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Workspace", path: workspaceRoot }) });
    const workspaceId = String(object(object(await workspaceResponse.json()).workspace).id);
    const tokenResponse = await request(app, `/api/v1/workspaces/${workspaceId}/runtime-token`, { method: "POST", headers: { cookie: ownerCookie } });
    const runtimeToken = String(object(await tokenResponse.json()).token);
    const proxied = await request(app, `/api/v1/workspaces/${workspaceId}/runtime/files/content?path=approved.txt`, { headers: { authorization: `Bearer ${runtimeToken}`, cookie: "control-secret" } });
    expect(proxied.status).toBe(200);
    expect(observed[0]).toEqual({ url: `/workspace/${workspaceId}/files/content?path=approved.txt`, authorization: null, cookie: null });
  } finally {
    app?.close();
    await closeRuntime(runtime);
    await rm(root, { recursive: true, force: true });
  }
});

test("production configuration fails closed when its secret, data directory, or roots are invalid", async () => {
  needs({ placement: "local" });
  const root = await newRoot("myai-config-security-");
  try {
    expect(() => resolveMyaiConfig({ environment: "production", dataDir: join(root, "missing"), databasePath: join(root, "missing", "control.sqlite"), workspaceRoots: [], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "short" })).toThrow(/configuration/i);
    expect(() => resolveMyaiConfig({ environment: "production", dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [join(root, "missing-root")], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "production-session-secret-that-is-long-enough" })).toThrow(/configuration/i);
    expect(() => resolveMyaiConfig({ environment: "production", dataDir: ".", databasePath: "./control.sqlite", workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "production-session-secret-that-is-long-enough" })).toThrow(/configuration/i);
    expect(() => resolveMyaiConfig({ environment: "production", dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "production-session-secret-that-is-long-enough", host: "0.0.0.0", publicBaseUrl: "http://0.0.0.0" })).toThrow(/HTTPS/i);
    expect(() => resolveMyaiConfig({ environment: "production", dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "production-session-secret-that-is-long-enough", host: "0.0.0.0", publicBaseUrl: "https://example.test" })).toThrow(/loopback/i);
    expect(() => resolveMyaiConfig({ environment: "test", dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl: "http://runtime.example.test", sessionSecret: "test-session-secret-that-is-long-enough" })).toThrow(/internal/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit and request logs scrub passwords, bearer tokens, file content, and prompts", async () => {
  needs({ placement: "local" });
  const root = await newRoot("myai-log-security-");
  let app: MyaiApplication | undefined;
  try {
    app = createMyaiApp({ dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "test-session-secret-that-is-long-enough", environment: "test", logFile: join(root, "server.log") });
    const password = "log-password-must-not-appear";
    const response = await request(app, "/api/v1/setup/owner", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer log-token-must-not-appear" }, body: JSON.stringify({ email: "owner@example.test", password, name: "prompt secret content" }) });
    expect(response.status).toBe(201);
    app.logger.write({ event: "runtime.request", authorization: "Bearer log-token-must-not-appear", prompt: "prompt secret content", content: "file secret content" });
    const log = (await readFile(join(root, "server.log"))).toString("utf8");
    expect(log).not.toContain(password);
    expect(log).not.toContain("log-token-must-not-appear");
    expect(log).not.toContain("prompt secret content");
    expect(log).not.toContain("file secret content");
  } finally {
    app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
