import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { denFetch } from "@openwork/behaviors";
import {
  defineWorld,
  fromSnapshot,
  localMysqlIsRunning,
  localRedisIsRunning,
  SkipError,
  startWorld,
  test,
} from "@openwork/testkit";
import type { World } from "@openwork/testkit";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PLUGIN_NAME = "Customer Research";
const CONNECTION_NAME = "notion";
const POLICY_NAME = "Customer briefing prompts";

async function visibleOrganizationNames(world: World): Promise<string[]> {
  const result = await denFetch(world.den.admin, "/v1/me/orgs", {
    headers: { authorization: `Bearer ${world.den.admin.token}` },
  });
  if (!result.response.ok) {
    throw new Error(`Admin organization list failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  if (!isRecord(result.body) || !Array.isArray(result.body.orgs)) {
    throw new Error(`Admin organization list had an invalid body: ${result.text.slice(0, 500)}`);
  }
  return result.body.orgs.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string") return [];
    return [entry.name];
  }).sort();
}

async function organizationId(world: World, name: string): Promise<string> {
  const route = "/v1/me/orgs";
  const result = await denFetch(world.den.admin, route, {
    headers: { authorization: `Bearer ${world.den.admin.token}` },
  });
  const organizations = isRecord(result.body) && Array.isArray(result.body.orgs)
    ? result.body.orgs.filter(isRecord)
    : [];
  const organization = organizations.find((entry) => entry.name === name);
  const id = organization && typeof organization.id === "string" ? organization.id : "";
  if (!result.response.ok || !id) {
    throw new Error(`GET ${route} did not return organization ${JSON.stringify(name)}: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  return id;
}

async function listedNames(world: World, route: string, collection: string): Promise<string[]> {
  const result = await denFetch(world.den.admin, route, {
    headers: { authorization: `Bearer ${world.den.admin.token}` },
  });
  if (!result.response.ok) {
    throw new Error(`GET ${route} failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  const entries = isRecord(result.body) && Array.isArray(result.body[collection])
    ? result.body[collection].filter(isRecord)
    : [];
  return entries.flatMap((entry) => typeof entry.name === "string"
    ? [entry.name]
    : typeof entry.policyName === "string"
      ? [entry.policyName]
      : []);
}

async function assertWorldContent(world: World): Promise<void> {
  const orgId = await organizationId(world, "acme");
  const capabilitiesRoute = `/v1/admin/organizations/${orgId}/capabilities`;
  const capabilities = await denFetch(world.den.admin, capabilitiesRoute, {
    headers: { authorization: `Bearer ${world.den.admin.token}` },
  });
  if (!capabilities.response.ok) {
    throw new Error(`GET ${capabilitiesRoute} failed: HTTP ${capabilities.response.status} ${capabilities.text.slice(0, 500)}`);
  }
  assert.equal(
    isRecord(capabilities.body)
      && isRecord(capabilities.body.capabilities)
      && capabilities.body.capabilities.mcpConnections,
    true,
  );
  assert.ok((await listedNames(world, "/v1/plugins", "items")).includes(PLUGIN_NAME));
  assert.ok((await listedNames(world, "/v1/mcp-connections", "connections")).includes(CONNECTION_NAME));
  assert.ok((await listedNames(world, "/v1/desktop-policies", "desktopPolicies")).includes(POLICY_NAME));
}

test("a declarative multi-org world boots again from its snapshot", { timeout: 300_000 }, async () => {
  if (!await localMysqlIsRunning() || !await localRedisIsRunning()) {
    throw new SkipError("local MySQL and Redis");
  }

  const topology = defineWorld({
    den: {
      orgs: {
        acme: {
          admin: { name: "Alex" },
          members: { jordan: { name: "Jordan" } },
          capabilities: { mcpConnections: true },
          plugins: [{
            name: PLUGIN_NAME,
            description: "Prepare for sales calls with a structured company brief.",
            skill: {
              name: "customer-research",
              description: "Research a company and summarize key facts before a sales call.",
              body: "# Instructions\n\nResearch the customer and prepare a concise call briefing.",
            },
          }],
          connections: [{ name: CONNECTION_NAME, witness: "notion" }],
          desktopPolicies: [{
            name: POLICY_NAME,
            members: ["jordan"],
            promptCards: [{
              title: "Prepare a customer briefing",
              prompt: "Review this workspace and prepare a briefing with customer goals, recent decisions, risks, and next steps.",
            }, {
              title: "Plan the follow-up",
              prompt: "Turn the customer briefing into follow-up actions with owners and deadlines.",
            }],
          }],
        },
        globex: { admin: { name: "Gwen" } },
      },
      web: false,
    },
    witnesses: { notion: { kind: "mcp" } },
  }).topology;
  const expectedOrganizations = Object.keys(topology.den.orgs).sort();
  let snapshotJson = "";

  {
    await using first = await startWorld(topology, { name: `world-round-trip-a-${Date.now().toString(36)}` });
    assert.deepEqual(await visibleOrganizationNames(first), expectedOrganizations);
    await assertWorldContent(first);
    snapshotJson = await readFile(first.snapshotPath, "utf8");
  }

  const restored = fromSnapshot(snapshotJson);
  assert.deepEqual(restored.topology, topology);

  {
    await using second = await startWorld(restored.topology, { name: `${restored.name}-restored` });
    assert.deepEqual(await visibleOrganizationNames(second), expectedOrganizations);
    await assertWorldContent(second);
  }
});
