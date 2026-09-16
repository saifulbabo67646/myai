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

test("role enforcement, workspace isolation, and live grant changes apply on every protected route", async () => {
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
    const runtimeTokenResponse = await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/runtime-token`, { method: "POST", headers: { cookie: memberCookie } });
    const runtimeToken = String(object(await runtimeTokenResponse.json()).token);
    const downgraded = await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/access`, { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ userId: memberId, role: "viewer" }) });
    expect(downgraded.status).toBe(201);
    const staleWrite = await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/runtime/files/content?path=approved.txt`, { method: "PUT", headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json" }, body: JSON.stringify({ content: "not allowed" }) });
    expect(staleWrite.status).toBe(403);
    const revokedGrant = await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/access/${memberId}`, { method: "DELETE", headers: { cookie: fixtureState.ownerCookie } });
    expect(revokedGrant.status).toBe(204);
    const staleRead = await request(fixtureState.app, `/api/v1/workspaces/${workspaceId}/runtime/files/content?path=approved.txt`, { headers: { authorization: `Bearer ${runtimeToken}` } });
    expect(staleRead.status).toBe(401);
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
    const auditSecret = "audit-metadata-secret";
    fixtureState.app.store.audit("metadata_scrub_test", fixtureState.app.store.members()[0]?.userId ?? null, null, null, { authorization: `Bearer ${auditSecret}`, nested: { prompt: auditSecret }, safe: "visible" });
    const scrubbedResponse = await request(fixtureState.app, "/api/v1/audit/events", { headers: { cookie: fixtureState.ownerCookie } });
    expect(JSON.stringify(await scrubbedResponse.json())).not.toContain(auditSecret);
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

test("only owners can change or revoke an existing admin", async () => {
  needs({ placement: "local" });
  const fixtureState = await fixture();
  try {
    const firstInvitation = await request(fixtureState.app, "/api/v1/invitations", { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ email: "first-admin@example.test", role: "admin" }) });
    const firstCode = String(object(await firstInvitation.json()).acceptCode);
    const firstAccepted = await request(fixtureState.app, `/api/v1/invitations/${firstCode}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "First Admin", password: "first-admin-password-123" }) });
    const firstId = String(object(object(await firstAccepted.clone().json()).user).id);
    const secondInvitation = await request(fixtureState.app, "/api/v1/invitations", { method: "POST", headers: { cookie: fixtureState.ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ email: "second-admin@example.test", role: "admin" }) });
    const secondCode = String(object(await secondInvitation.json()).acceptCode);
    const secondAccepted = await request(fixtureState.app, `/api/v1/invitations/${secondCode}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Second Admin", password: "second-admin-password-123" }) });
    const secondId = String(object(object(await secondAccepted.clone().json()).user).id);
    const firstSignIn = await request(fixtureState.app, "/api/v1/auth/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "first-admin@example.test", password: "first-admin-password-123" }) });
    const firstCookie = cookie(firstSignIn);
    expect((await request(fixtureState.app, `/api/v1/members/${secondId}`, { method: "PATCH", headers: { cookie: firstCookie, "content-type": "application/json" }, body: JSON.stringify({ role: "member" }) })).status).toBe(403);
    expect((await request(fixtureState.app, `/api/v1/members/${secondId}`, { method: "DELETE", headers: { cookie: firstCookie } })).status).toBe(403);
    expect(firstId).not.toBe(secondId);
  } finally {
    fixtureState.app.close();
    await rm(fixtureState.root, { recursive: true, force: true });
  }
});
