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
  return value as JsonObject;
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

test("passwords are delegated to the maintained auth library and never stored in plaintext", async () => {
  needs({ placement: "local" });
  const root = await newRoot("myai-password-security-");
  let app: MyaiApplication | undefined;
  try {
    app = createMyaiApp({ dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "test-session-secret-that-is-long-enough", environment: "test" });
    const response = await request(app, "/api/v1/setup/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.test", password: "plain-password-never-stored", name: "Owner" }) });
    expect(response.status).toBe(201);
    const database = (await readFile(join(root, "control.sqlite"))).toString("utf8");
    expect(database).not.toContain("plain-password-never-stored");
    expect(database).toMatch(/[0-9a-f]{32}:[0-9a-f]{128}/);
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

test("production configuration fails closed when its secret, data directory, or roots are invalid", async () => {
  needs({ placement: "local" });
  const root = await newRoot("myai-config-security-");
  try {
    expect(() => resolveMyaiConfig({ environment: "production", dataDir: join(root, "missing"), databasePath: join(root, "missing", "control.sqlite"), workspaceRoots: [], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "short" })).toThrow(/configuration/i);
    expect(() => resolveMyaiConfig({ environment: "production", dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [join(root, "missing-root")], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "production-session-secret-that-is-long-enough" })).toThrow(/configuration/i);
    expect(() => resolveMyaiConfig({ environment: "production", dataDir: ".", databasePath: "./control.sqlite", workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "production-session-secret-that-is-long-enough" })).toThrow(/configuration/i);
    expect(() => resolveMyaiConfig({ environment: "production", dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "production-session-secret-that-is-long-enough", host: "0.0.0.0", publicBaseUrl: "http://0.0.0.0" })).toThrow(/HTTPS/i);
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
