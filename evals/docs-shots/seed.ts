import { denFetch } from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import { acmeDocs, resolvePlace, startWorld } from "@openwork/testkit/stack";
import type { Den, Place, World } from "@openwork/testkit/stack";
import { provider } from "./ctx.ts";

const docsOrganization = Object.entries(acmeDocs.topology.den.orgs)[0];
if (!docsOrganization) throw new Error("The acmeDocs preset must define an organization.");
export const DOCS_ORGANIZATION_NAME = docsOrganization[0];
const docsOrganizationDefinition = docsOrganization[1];
const docsPolicy = docsOrganizationDefinition.desktopPolicies?.[0];
if (!docsPolicy) throw new Error("The acmeDocs preset must define a desktop policy.");
export const DOCS_PROMPT_CARDS = docsPolicy.promptCards ?? [];
if (DOCS_PROMPT_CARDS.length < 2) throw new Error("The acmeDocs preset must define at least two prompt cards.");
const docsMember = docsPolicy.members?.[0];
if (!docsMember) throw new Error("The acmeDocs desktop policy must target a member.");
export const DOCS_MEMBER = docsMember;
const docsApp = Object.entries(acmeDocs.topology.apps ?? {})
  .find((entry) => entry[1].signedInTo?.as === DOCS_MEMBER);
if (!docsApp) throw new Error("The acmeDocs preset must define an app signed in as its desktop policy member.");
export const DOCS_APP = docsApp[0];

export interface SeededOrg {
  world: World;
  den: Den;
  place: Place;
  orgId: string;
  /** Plugin ids in the order of the fixture's plugins. */
  pluginIds: string[];
  mcpToken: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOrganizationId(admin: DenSession): Promise<string> {
  const { response, body, text } = await denFetch(admin, "/v1/me/orgs", {
    headers: { authorization: `Bearer ${admin.token}` },
  });
  const orgs = isRecord(body) && Array.isArray(body.orgs) ? body.orgs.filter(isRecord) : [];
  const organization = orgs.find((entry) => entry.name === DOCS_ORGANIZATION_NAME);
  const id = organization && typeof organization.id === "string" ? organization.id : "";
  if (!response.ok || !id) throw new Error(`Resolving the organization failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  return id;
}

async function mintMcpToken(admin: DenSession, orgId: string): Promise<string> {
  const { response, body, text } = await denFetch(admin, "/v1/mcp/token", {
    method: "POST",
    headers: { authorization: `Bearer ${admin.token}`, "x-openwork-org-id": orgId },
    body: JSON.stringify({ scopes: ["mcp:read", "mcp:write"] }),
  });
  const token = isRecord(body) && typeof body.token === "string" ? body.token : "";
  if (!response.ok || !token) throw new Error(`Minting an MCP token failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  return token;
}

async function readPluginIds(den: Den, orgId: string): Promise<string[]> {
  const pluginIds: string[] = [];
  for (const plugin of docsOrganizationDefinition.plugins ?? []) {
    const { response, body, text } = await denFetch(
      den.admin,
      `/v1/plugins?q=${encodeURIComponent(plugin.name)}&limit=20`,
      {
        headers: {
          authorization: `Bearer ${den.admin.token}`,
          "x-openwork-org-id": orgId,
        },
      },
    );
    const items = isRecord(body) && Array.isArray(body.items) ? body.items.filter(isRecord) : [];
    const item = items.find((entry) => entry.name === plugin.name);
    const id = item && typeof item.id === "string" ? item.id : "";
    if (!response.ok || !id) {
      throw new Error(`Resolving plugin ${JSON.stringify(plugin.name)} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
    }
    pluginIds.push(id);
  }
  return pluginIds;
}

export const org = provider(async (ctx) => {
  const place = resolvePlace(process.env);
  const world = await startWorld(acmeDocs, { place });
  ctx.onDispose(() => world[Symbol.asyncDispose]());
  const orgId = await readOrganizationId(world.den.admin);
  return {
    world,
    den: world.den,
    place,
    orgId,
    pluginIds: await readPluginIds(world.den, orgId),
    mcpToken: await mintMcpToken(world.den.admin, orgId),
  };
});
