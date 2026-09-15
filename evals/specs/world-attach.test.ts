import { readFile } from "node:fs/promises";
import { expect } from "vitest";
import { denFetch } from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import {
  defaultReuseAdmin,
  defineWorld,
  localMysqlIsRunning,
  localRedisIsRunning,
  needs,
  server,
  SkipError,
  startWorld,
  test,
} from "@openwork/testkit";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} was not an object`);
  return value;
}

async function organizations(session: DenSession): Promise<Map<string, string>> {
  const result = await denFetch(session, "/v1/me/orgs", {
    headers: { authorization: `Bearer ${session.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!result.response.ok || !isRecord(result.body) || !Array.isArray(result.body.orgs)) {
    throw new Error(`Organization list failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  const listed = new Map<string, string>();
  for (const organization of result.body.orgs) {
    if (!isRecord(organization) || typeof organization.name !== "string" || typeof organization.id !== "string") continue;
    listed.set(organization.name, organization.id);
  }
  return listed;
}

function restoreEnvironment(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test("a world attaches to an existing Den without owning it or snapshotting resolved secrets", { timeout: 300_000 }, async ({ evidence, place }) => {
  needs({ placement: "local" });
  if (!await localMysqlIsRunning()) {
    throw new SkipError("local MySQL on 127.0.0.1:3306");
  }
  if (!await localRedisIsRunning()) {
    throw new SkipError("local Redis on 127.0.0.1:6379");
  }

  const nonce = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
  const preexistingOrgName = `Attach Outer ${nonce}`;
  const attachedOrgName = `Attach World ${nonce}`;
  const secretRef = `OPENWORK_EVAL_SECRET_WORLD_ATTACH_${Date.now()}_${process.pid}`;
  const emailVariable = `${secretRef}_EMAIL`;
  const passwordVariable = `${secretRef}_PASSWORD`;
  const resolvedEmail = `attach-member+${nonce}@openwork.test`;
  const resolvedPassword = `AttachSecret-${nonce}!`;
  const previousEmail = process.env[emailVariable];
  const previousPassword = process.env[passwordVariable];
  process.env[emailVariable] = resolvedEmail;
  process.env[passwordVariable] = resolvedPassword;

  try {
    await using outer = await server({
      place,
      web: false,
      org: { name: preexistingOrgName, admin: defaultReuseAdmin() },
    });
    const before = await organizations(outer.admin);
    const preexistingOrgId = before.get(preexistingOrgName);
    expect(preexistingOrgId).toBeTruthy();

    const world = await startWorld(defineWorld({
      den: {
        attach: { apiUrl: outer.ref.apiUrl, tier: "staging" },
        orgs: {
          [attachedOrgName]: {
            members: { jordan: { secretRef } },
          },
        },
      },
    }), { place, name: `world-attach-${nonce}` });

    try {
      const attachedOrganizations = await organizations(world.den.admin);
      expect(attachedOrganizations.has(attachedOrgName)).toBe(true);
      expect(world.den.members.jordan?.email).toBe(resolvedEmail);

      const rawSnapshot = await readFile(world.snapshotPath, "utf8");
      const parsedSnapshot: unknown = JSON.parse(rawSnapshot);
      const snapshot = requireRecord(parsedSnapshot, "world snapshot");
      const resolved = requireRecord(snapshot.resolved, "world snapshot resolved");
      const resolvedDen = requireRecord(resolved.den, "world snapshot resolved Den");
      expect(resolvedDen.origin).toBe("attached");
      const topology = requireRecord(snapshot.topology, "world snapshot topology");
      const topologyDen = requireRecord(topology.den, "world snapshot topology Den");
      const snapshotOrgs = requireRecord(topologyDen.orgs, "world snapshot organizations");
      const snapshotOrg = requireRecord(snapshotOrgs[attachedOrgName], "world snapshot organization");
      const snapshotMembers = requireRecord(snapshotOrg.members, "world snapshot members");
      expect(snapshotMembers.jordan).toEqual({ secretRef });
      expect(rawSnapshot).toContain(secretRef);
      expect(rawSnapshot).not.toContain(resolvedEmail);
      expect(rawSnapshot).not.toContain(resolvedPassword);
      evidence.recordAssertionEvidence(
        "The world used an authenticated admin session on the attached Den",
        [...attachedOrganizations.keys()].join(", "),
        attachedOrganizations.has(attachedOrgName),
      );
      evidence.recordAssertionEvidence(
        "The attached snapshot retained only the member secret reference",
        JSON.stringify(snapshotMembers.jordan),
        !rawSnapshot.includes(resolvedEmail) && !rawSnapshot.includes(resolvedPassword),
      );
    } finally {
      await world[Symbol.asyncDispose]();
    }

    const health = await fetch(`${outer.ref.apiUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    expect(health.ok).toBe(true);
    const after = await organizations(outer.admin);
    expect(after.get(preexistingOrgName)).toBe(preexistingOrgId);
    expect(after.has(attachedOrgName)).toBe(false);
    evidence.recordAssertionEvidence(
      "Disposing the attached world left the outer Den healthy",
      `HTTP ${health.status}`,
      health.ok,
    );
    evidence.recordAssertionEvidence(
      "Disposal deleted only the world-created organization",
      [...after.keys()].join(", "),
      after.get(preexistingOrgName) === preexistingOrgId && !after.has(attachedOrgName),
    );
  } finally {
    restoreEnvironment(emailVariable, previousEmail);
    restoreEnvironment(passwordVariable, previousPassword);
  }
});
