import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { spec } from "@openwork/testkit";
import { createMyaiApp, type MyaiApplication } from "../../apps/myai-server/src/app.ts";
import { attachSurface } from "@openwork/cdp";
import { localHost } from "@openwork/hosts";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }
  return Object.fromEntries(Object.entries(value));
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${label}.`);
  return value;
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!value) throw new Error("Response did not set a session cookie.");
  return value;
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function requestHeaders(input: IncomingHttpHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === "string") headers[name] = value;
    else if (Array.isArray(value)) headers[name] = value.join(", ");
  }
  return headers;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function serveMyai(application: MyaiApplication): Promise<{ server: Server; url: string }> {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const method = incoming.method ?? "GET";
      const rawBody = method === "GET" || method === "HEAD" ? undefined : await body(incoming);
      const request = new Request(`http://127.0.0.1${incoming.url ?? "/"}`, {
        method,
        headers: requestHeaders(incoming.headers),
        ...(rawBody === undefined ? {} : { body: rawBody }),
      });
      const response = await application.fetch(request);
      outgoing.statusCode = response.status;
      response.headers.forEach((value, name) => outgoing.setHeader(name, value));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.statusCode = 500;
      outgoing.end(error instanceof Error ? error.message : "control plane failure");
    }
  });
  return { server, url: await listen(server) };
}

async function controlRequest(url: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}${path}`, { ...init, redirect: "manual" });
}

const teamDesktop = spec.world(async (_seed, { place }) => {
  const root = await mkdtemp(join(tmpdir(), "myai-wp6-desktop-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "approved.txt"), "approved from team server\n");

  const runtime = createServer(async (incoming, outgoing) => {
    if (incoming.url?.endsWith("/opencode/session") && incoming.method === "POST") {
      outgoing.statusCode = 201;
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(JSON.stringify({ id: "team-session-1", status: "created" }));
      return;
    }
    if (incoming.url?.includes("/files/content") && incoming.method === "GET") {
      outgoing.statusCode = 200;
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(JSON.stringify({ path: "approved.txt", content: "approved from team server\n" }));
      return;
    }
    outgoing.statusCode = 404;
    outgoing.end(JSON.stringify({ error: "runtime route unavailable" }));
  });
  const runtimeUrl = await listen(runtime);
  const application = createMyaiApp({
    dataDir: root,
    databasePath: join(root, "control.sqlite"),
    workspaceRoots: [root],
    runtimeBaseUrl: runtimeUrl,
    sessionSecret: "wp6-test-session-secret-that-is-long-enough",
    environment: "test",
  });
  const control = await serveMyai(application);

  const ownerBootstrap = await controlRequest(control.url, "/api/v1/setup/owner", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "owner-password-123", name: "Owner" }),
  });
  const ownerCookie = cookie(ownerBootstrap);
  const invitation = await controlRequest(control.url, "/api/v1/invitations", {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "member@example.test", role: "member" }),
  });
  const invitationPayload = object(await invitation.json());
  const acceptCode = stringValue(invitationPayload.acceptCode, "accept code");
  const accepted = await controlRequest(control.url, `/api/v1/invitations/${encodeURIComponent(acceptCode)}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Member", password: "member-password-123" }),
  });
  const memberId = stringValue(object(object(await accepted.clone().json()).user).id, "member id");
  const registered = await controlRequest(control.url, "/api/v1/workspaces", {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Team workspace", path: workspace }),
  });
  const workspaceId = stringValue(object(object(await registered.json()).workspace).id, "workspace id");
  await controlRequest(control.url, `/api/v1/workspaces/${workspaceId}/access`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ userId: memberId, role: "member" }),
  });

  const host = place.host() ?? localHost();
  const handle = await host.spawnElectron("myai-wp6-team", {
    profile: "fresh",
    bootstrap: { baseUrl: control.url, requireSignin: true },
    env: {
      OPENWORK_DESKTOP_DISTRIBUTION: "team",
      OPENWORK_DEV_MODE: "1",
      OPENWORK_ELECTRON_USE_MOCK_KEYCHAIN: "1",
    },
  });
  const app = await attachSurface(handle, { timeoutMs: 120_000 });

  return {
    app,
    controlUrl: control.url,
    memberId,
    workspaceId,
    memberEmail: "member@example.test",
    memberPassword: "member-password-123",
    ownerCookie,
    async revokeMember() {
      return controlRequest(control.url, `/api/v1/members/${memberId}`, {
        method: "DELETE",
        headers: { cookie: ownerCookie },
      });
    },
    async [Symbol.asyncDispose]() {
      await app[Symbol.asyncDispose]();
      await host.disposeSurface(handle);
      application.close();
      await close(control.server);
      await close(runtime);
      await rm(root, { recursive: true, force: true });
    },
  };
});

const publicDesktop = spec.world(async (seed) => {
  const app = await seed.desktop({
    name: "myai-wp6-public",
    env: {
      OPENWORK_DESKTOP_DISTRIBUTION: "public",
      OPENWORK_DEV_MODE: "1",
      OPENWORK_ELECTRON_USE_MOCK_KEYCHAIN: "1",
    },
  });
  return { app };
});

const test = teamDesktop;

test("team desktop signs in, uses scoped workspace access, and rejects a revoked member", async ({ world, user, probe, evidence }) => {
  await user.see({ testId: "myai-team-signin" }, { timeoutMs: 120_000 });
  await user.type({ role: "textbox", label: "Email" }, world.memberEmail);
  await user.type({ role: "textbox", label: "Password" }, world.memberPassword);
  await user.click({ role: "button", label: "Sign in" });
  await user.see({ testId: "myai-team-workspace" }, { timeoutMs: 120_000 });
  await user.see({ text: "Team workspace" });
  await user.click({ role: "button", label: "Create runtime session" });
  await user.see({ testId: "myai-team-session" });
  await user.click({ role: "button", label: "Read approved file" });
  await user.see({ testId: "myai-team-file" });
  expect(await probe.storage("openwork.den.authToken")).toBeNull();

  expect((await world.revokeMember()).status).toBe(204);
  await user.click({ role: "button", label: "Read approved file" });
  await user.see({ testId: "myai-team-error" });
  evidence.recordAssertionEvidence(
    "Team desktop uses the myai control plane and scoped runtime access",
    "The real Electron UI authenticated a member against the configured myai server, created a runtime session, read an approved file through the scoped proxy, and then displayed rejection after the owner revoked the member.",
    true,
  );
});

publicDesktop("public desktop keeps local startup sign-in free", async ({ user, probe }) => {
  expect(await probe.has("myai-team-signin")).toBe(false);
  await user.notSee({ testId: "myai-team-signin" });
});
