import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { needs, test } from "@openwork/testkit";
import { createMyaiApp, type MyaiApplication } from "../../apps/myai-server/src/app.ts";

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

async function fixture(): Promise<{ app: MyaiApplication; root: string; ownerCookie: string }> {
  const root = await mkdtemp(join(tmpdir(), "myai-behavior-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const app = createMyaiApp({ dataDir: root, databasePath: join(root, "control.sqlite"), workspaceRoots: [root], runtimeBaseUrl: "http://127.0.0.1:1", sessionSecret: "test-session-secret-that-is-long-enough", environment: "test" });
  const setup = await request(app, "/api/v1/setup/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.test", password: "owner-password-123", name: "Owner" }) });
  expect(setup.status).toBe(201);
  return { app, root, ownerCookie: cookie(setup) };
}

test("role enforcement and workspace isolation apply on every protected route", async () => {
  needs({ placement: "local" });
  const fixtureState = await fixture();
  try {
    const invitation = await request(fixtureState.app, "/api/v1/invitations", { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ email: "member@example.test", role: "member" }) });
    const acceptCode = String(object(await invitation.json()).acceptCode);
    const accepted = await request(fixtureState.app, `/api/v1/invitations/${acceptCode}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Member", password: "member-password-123" }) });
    const memberCookie = cookie(accepted);
    const memberId = String(object(object(await accepted.clone().json()).user).id);
    const workspacePath = join(fixtureState.root, "workspace");
    const workspaceResponse = await request(fixtureState.app, "/api/v1/workspaces", { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Workspace", path: workspacePath }) });
    const workspaceId = String(object(object(await workspaceResponse.json()).workspace).id);
    expect((await request(fixtureState.app, "/api/v1/members", { headers: { cookie: memberCookie } })).status).toBe(403);
    const beforeGrant = object(await (await request(fixtureState.app, "/api/v1/workspaces", { headers: { cookie: memberCookie } })).json());
    expect(beforeGrant.workspaces).toEqual([]);
    const grant = await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/access`, { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ userId: memberId, role: "member" }) });
    expect(grant.status).toBe(201);
    const afterGrant = object(await (await request(fixtureState.app, "/api/v1/workspaces", { headers: { cookie: memberCookie } })).json());
    expect(afterGrant.workspaces).toHaveLength(1);
  } finally {
    fixtureState.app.close();
    await rm(fixtureState.root, { recursive: true, force: true });
  }
});

test("viewer credentials cannot perform a write action", async () => {
  needs({ placement: "local" });
  const fixtureState = await fixture();
  try {
    const invitation = await request(fixtureState.app, "/api/v1/invitations", { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ email: "viewer@example.test", role: "viewer" }) });
    const acceptCode = String(object(await invitation.json()).acceptCode);
    const accepted = await request(fixtureState.app, `/api/v1/invitations/${acceptCode}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Viewer", password: "viewer-password-123" }) });
    const viewerCookie = cookie(accepted);
    const viewerId = String(object(object(await accepted.clone().json()).user).id);
    const workspaceResponse = await request(fixtureState.app, "/api/v1/workspaces", { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Workspace", path: join(fixtureState.root, "workspace") }) });
    const workspaceId = String(object(object(await workspaceResponse.json()).workspace).id);
    expect((await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/access`, { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ userId: viewerId, role: "viewer" }) })).status).toBe(201);
    const runtimeTokenResponse = await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/runtime-token`, { method: "POST", headers: { cookie: viewerCookie } });
    expect(runtimeTokenResponse.status).toBe(201);
    const runtimeTokenPayload = object(await runtimeTokenResponse.json());
    expect(runtimeTokenPayload.scopes).toEqual(["file:read"]);
    const write = await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/runtime/files/content?path=approved.txt`, { method: "PUT", headers: { authorization: `Bearer ${String(runtimeTokenPayload.token)}`, "content-type": "application/json" }, body: JSON.stringify({ content: "not allowed" }) });
    expect(write.status).toBe(403);
  } finally {
    fixtureState.app.close();
    await rm(fixtureState.root, { recursive: true, force: true });
  }
});

test("Better Auth session expiry is enforced by the control API", async () => {
  needs({ placement: "local" });
  const fixtureState = await fixture();
  try {
    expect((await request(fixtureState.app, "/api/v1/me", { headers: { cookie: fixtureState.ownerCookie } })).status).toBe(200);
    fixtureState.app.store.database.prepare("UPDATE session SET expires_at = 0").run();
    expect((await request(fixtureState.app, "/api/v1/me", { headers: { cookie: fixtureState.ownerCookie } })).status).toBe(401);
  } finally {
    fixtureState.app.close();
    await rm(fixtureState.root, { recursive: true, force: true });
  }
});

test("audit events are queryable without returning secret values", async () => {
  needs({ placement: "local" });
  const fixtureState = await fixture();
  try {
    const invitation = await request(fixtureState.app, "/api/v1/invitations", { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ email: "member@example.test", role: "member" }) });
    const acceptCode = String(object(await invitation.json()).acceptCode);
    const eventsResponse = await request(fixtureState.app, "/api/v1/audit/events", { headers: { cookie: fixtureState.ownerCookie } });
    expect(eventsResponse.status).toBe(200);
    const events = object(await eventsResponse.json());
    const raw = JSON.stringify(events);
    expect(raw).toContain("owner_bootstrapped");
    expect(raw).toContain("invitation_created");
    expect(raw).not.toContain(acceptCode);
  } finally {
    fixtureState.app.close();
    await rm(fixtureState.root, { recursive: true, force: true });
  }
});

test("runtime connection failures are mapped to the stable unavailable error", async () => {
  needs({ placement: "local" });
  const fixtureState = await fixture();
  try {
    const workspaceResponse = await request(fixtureState.app, "/api/v1/workspaces", { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Workspace", path: join(fixtureState.root, "workspace") }) });
    const workspaceId = String(object(object(await workspaceResponse.json()).workspace).id);
    const tokenResponse = await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/runtime-token`, { method: "POST", headers: { cookie: fixtureState.ownerCookie } });
    const token = String(object(await tokenResponse.json()).token);
    const runtime = await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/runtime/opencode/session`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Unavailable" }) });
    expect(runtime.status).toBe(502);
    expect(object(await runtime.json()).error).toMatchObject({ code: "runtime_unavailable" });
  } finally {
    fixtureState.app.close();
    await rm(fixtureState.root, { recursive: true, force: true });
  }
});
