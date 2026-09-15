import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect } from "vitest";
import { denFetch } from "@openwork/behaviors";
import {
  defineWorld,
  ensureKubeStack,
  eventually,
  KUBE_CLUSTER_NAME,
  KUBE_CONTEXT,
  needs,
  onKind,
  readDenClientState,
  startWorld,
  test,
} from "@openwork/testkit";

const execFileAsync = promisify(execFile);
const stateDir = fileURLToPath(new URL("../results/.kube-stack/", import.meta.url));
const apiPidPath = fileURLToPath(new URL("../results/.kube-stack/api-port-forward.pid", import.meta.url));
const webPidPath = fileURLToPath(new URL("../results/.kube-stack/web-port-forward.pid", import.meta.url));

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function portCanBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

function endpointPort(url: string): number {
  const port = Number(new URL(url).port);
  if (!Number.isInteger(port) || port < 1) throw new Error(`Kind endpoint has no explicit port: ${url}`);
  return port;
}

test("a kind world serves its seeded admin and disposes only its port-forwards", { timeout: 900_000 }, async ({ evidence }) => {
  needs({
    optIn: ["OPENWORK_EVAL_KIND_E2E"],
    commands: ["kind", "kubectl", "helm", "docker"],
  });

  await ensureKubeStack({
    cdpCandidates: [],
    skipApp: true,
    images: "published",
    stateDir,
    log: (message) => console.error(`[openwork/testkit] ${message}`),
  });

  const definition = onKind(defineWorld({
    den: {
      orgs: {
        "Acme Robotics": {
          admin: {
            email: "alex@acme.test",
            name: "Alex Chen",
            password: "OpenWorkDemo123!",
          },
        },
      },
    },
    apps: {
      main: { signedInTo: { org: "Acme Robotics", as: "admin" } },
    },
  }));

  const world = await startWorld(definition, { name: `kind-den-${Date.now().toString(36)}` });
  const apiPort = endpointPort(world.den.ref.apiUrl);
  const webPort = endpointPort(world.den.ref.webUrl);
  try {
    const health = await fetch(`${world.den.ref.apiUrl}/health`);
    expect(health.status).toBe(200);

    const organizations = await denFetch(world.den.admin, "/v1/me/orgs", {
      headers: auth(world.den.admin.token),
    });
    expect(organizations.response.status).toBe(200);
    expect(organizations.body).toMatchObject({
      orgs: [{ name: "Acme Robotics", role: "owner" }],
    });
    evidence.recordAssertionEvidence(
      "The kind Den answers health and an authenticated seeded-admin route",
      `GET /health returned ${health.status}; GET /v1/me/orgs returned ${organizations.response.status} for ${world.den.admin.email}.`,
      true,
    );

    const clientState = await eventually(() => readDenClientState(world.app("main")), {
      within: 30_000,
      label: "Electron app signed in to the kind Den",
      until: (state) => state.authTokenPresent && state.activeOrgName === "Acme Robotics",
    });
    expect(clientState).toMatchObject({ authTokenPresent: true, activeOrgName: "Acme Robotics" });
    evidence.recordAssertionEvidence(
      "A local Electron app signs in to the port-forwarded kind Den",
      `The desktop stored an auth token and selected ${clientState.activeOrgName}.`,
      true,
    );

    const snapshot: unknown = JSON.parse(await readFile(world.snapshotPath, "utf8"));
    expect(snapshot).toMatchObject({
      topology: { den: { substrate: "kind" } },
      resolved: { den: { substrate: "kind" } },
    });
    evidence.recordAssertionEvidence(
      "The world snapshot records the kind substrate",
      "Both topology.den.substrate and resolved.den.substrate equal kind.",
      true,
    );

    expect(Number(await readFile(apiPidPath, "utf8"))).toBeGreaterThan(0);
    expect(Number(await readFile(webPidPath, "utf8"))).toBeGreaterThan(0);
  } finally {
    await world[Symbol.asyncDispose]();
  }

  await expect(access(apiPidPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(webPidPath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await portCanBind(apiPort)).toBe(true);
  expect(await portCanBind(webPort)).toBe(true);

  const namespaces = await execFileAsync("kubectl", ["--context", KUBE_CONTEXT, "get", "namespaces", "-o", "name"]);
  expect(namespaces.stdout).toContain("namespace/default");
  const clusters = await execFileAsync("kind", ["get", "clusters"]);
  expect(clusters.stdout.split(/\r?\n/)).toContain(KUBE_CLUSTER_NAME);
  evidence.recordAssertionEvidence(
    "Disposal stops the world port-forwards but leaves the kind cluster running",
    `Both pid files were removed, ports ${apiPort}/${webPort} can bind, and kubectl still listed namespace/default in ${KUBE_CONTEXT}.`,
    true,
  );
});
