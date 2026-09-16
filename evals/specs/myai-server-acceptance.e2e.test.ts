import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${label}`);
  return value;
}

function sessionCookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!value) throw new Error("Response did not set a session cookie");
  return value;
}

async function listen(runtime: Server): Promise<string> {
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  const address = runtime.address();
  if (!address || typeof address === "string") throw new Error("Runtime did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: JsonObject): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function request(app: MyaiApplication, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(new Request(`http://myai.test${path}`, init));
}

test("fresh installation completes bootstrap, invitation, scoped file access, and revocation", async ({ evidence }) => {
  needs({ commands: ["pnpm"], optIn: ["OPENWORK_EVAL_E2E_TESTS"], placement: "local" });
  const root = await mkdtemp(join(tmpdir(), "myai-server-acceptance-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "approved.txt"), "approved content\n");
  const runtime = createServer(async (incoming, outgoing) => {
    if (incoming.url === "/opencode/session" && incoming.method === "POST") {
      await body(incoming);
      json(outgoing, 201, { id: "runtime-session-1", status: "created" });
      return;
    }
    if (incoming.url?.startsWith("/files/content") && incoming.method === "GET") {
      json(outgoing, 200, { path: new URL(incoming.url, "http://runtime.test").searchParams.get("path"), content: "approved content\n" });
      return;
    }
    if (incoming.url?.startsWith("/files/content") && incoming.method === "PUT") {
      const parsed: unknown = JSON.parse(await body(incoming));
      const payload = object(parsed);
      json(outgoing, 200, { path: new URL(incoming.url, "http://runtime.test").searchParams.get("path"), content: payload.content });
      return;
    }
    json(outgoing, 404, { error: "runtime route not found" });
  });
  const runtimeBaseUrl = await listen(runtime);
  let application: MyaiApplication | undefined;
  try {
    application = createMyaiApp({
      dataDir: root,
      databasePath: join(root, "control.sqlite"),
      workspaceRoots: [root],
      runtimeBaseUrl,
      sessionSecret: "test-session-secret-that-is-long-enough",
      environment: "test",
    });

    expect((await request(application, "/healthz")).status).toBe(200);
    expect((await request(application, "/readyz")).status).toBe(200);

    const bootstrap = await request(application, "/api/v1/setup/owner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.test", password: "owner-password-123", name: "Owner" }),
    });
    expect(bootstrap.status).toBe(201);
    const ownerCookie = sessionCookie(bootstrap);
    const owner = object(await bootstrap.json());
    const ownerUser = object(owner.user);
    const ownerId = stringValue(ownerUser.id, "owner id");
    expect(object(owner.membership).role).toBe("owner");

    const invitation = await request(application, "/api/v1/invitations", {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ email: "member@example.test", role: "member" }),
    });
    expect(invitation.status).toBe(201);
    const invitationPayload = object(await invitation.json());
    const acceptCode = stringValue(invitationPayload.acceptCode, "invitation accept code");
    const invitationInfo = object(invitationPayload.invitation);
    expect(invitationInfo.role).toBe("member");

    const accepted = await request(application, `/api/v1/invitations/${encodeURIComponent(acceptCode)}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Member", password: "member-password-123" }),
    });
    expect(accepted.status).toBe(201);
    const memberCookie = sessionCookie(accepted);
    const acceptedPayload = object(await accepted.json());
    const memberId = stringValue(object(acceptedPayload.user).id, "member id");
    expect(object(acceptedPayload.membership).role).toBe("member");

    const signedIn = await request(application, "/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "member@example.test", password: "member-password-123" }),
    });
    expect(signedIn.status).toBe(200);
    const signedInCookie = sessionCookie(signedIn);

    const workspaceResponse = await request(application, "/api/v1/workspaces", {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Team workspace", path: workspace }),
    });
    expect(workspaceResponse.status).toBe(201);
    const registered = object(await workspaceResponse.json());
    const workspaceId = stringValue(object(registered.workspace).id, "workspace id");

    const grant = await request(application, `/api/v1/workspaces/${workspaceId}/access`, {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ userId: memberId, role: "member" }),
    });
    expect(grant.status).toBe(201);
    expect(object(await grant.json()).role).toBe("member");

    const session = await request(application, `/api/v1/workspaces/${workspaceId}/runtime-token`, {
      method: "POST",
      headers: { cookie: signedInCookie },
    });
    expect(session.status).toBe(201);
    const runtimeToken = stringValue(object(await session.json()).token, "runtime token");

    const createdSession = await request(application, `/api/v1/workspaces/${workspaceId}/runtime/opencode/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "Acceptance session" }),
    });
    expect(createdSession.status).toBe(201);
    expect(object(await createdSession.json()).id).toBe("runtime-session-1");

    const fileAction = await request(application, `/api/v1/workspaces/${workspaceId}/runtime/files/content?path=${encodeURIComponent("approved.txt")}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json" },
      body: JSON.stringify({ content: "approved content\n" }),
    });
    expect(fileAction.status).toBe(200);
    expect(object(await fileAction.json()).content).toBe("approved content\n");

    const revoke = await request(application, `/api/v1/members/${memberId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    });
    expect(revoke.status).toBe(204);
    expect((await request(application, "/api/v1/me", { headers: { cookie: signedInCookie } })).status).toBe(401);
    expect((await request(application, `/api/v1/workspaces/${workspaceId}/runtime/files/content?path=approved.txt`, {
      headers: { authorization: `Bearer ${runtimeToken}` },
    })).status).toBe(401);

    expect(ownerId).not.toBe(memberId);
    const rawDatabase = await readFile(join(root, "control.sqlite"));
    expect(rawDatabase.toString("utf8")).not.toContain("owner-password-123");
    expect(rawDatabase.toString("utf8")).not.toContain(runtimeToken);
    evidence.recordAssertionEvidence(
      "Phase 1 acceptance path",
      "Fresh control data bootstrapped an owner, created and accepted an invitation, signed in the member, registered and granted a workspace, issued scoped runtime access, proxied a session and file action, then rejected both the revoked control session and runtime token.",
      true,
    );
  } finally {
    application?.close();
    await close(runtime);
    await rm(root, { recursive: true, force: true });
  }
});
