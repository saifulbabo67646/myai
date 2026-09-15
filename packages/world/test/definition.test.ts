import assert from "node:assert/strict";
import test from "node:test";
import { createWorldDefinition } from "../src/definition.ts";

interface FixtureTopology {
  service: { port: number; env: Record<string, string> };
}

function validateFixture(value: unknown): FixtureTopology {
  if (typeof value !== "object" || value === null || !("service" in value)) {
    throw new Error("service is required");
  }
  const service = value.service;
  if (typeof service !== "object" || service === null || !("port" in service) || !("env" in service)) {
    throw new Error("service fields are required");
  }
  if (typeof service.port !== "number" || typeof service.env !== "object" || service.env === null) {
    throw new Error("service fields are invalid");
  }
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(service.env)) {
    if (typeof entry !== "string") throw new Error("environment values must be strings");
    env[key] = entry;
  }
  return { service: { port: service.port, env } };
}

test("shared definitions deep-patch topology and preserve lifecycle metadata", () => {
  const base = createWorldDefinition({
    service: { port: 3000, env: { FIRST: "one" } },
  }, {
    adapter: "fixture",
    detached: true,
    requiresSharedState: true,
  }, validateFixture);
  const changed = base.with({ service: { port: 4000, env: { SECOND: "two" } } });

  assert.deepEqual(changed.topology, {
    service: { port: 4000, env: { FIRST: "one", SECOND: "two" } },
  });
  assert.equal(changed.adapter, "fixture");
  assert.equal(changed.detached, true);
  assert.equal(changed.requiresSharedState, true);
  assert.equal(base.topology.service.port, 3000);
});

test("shared definitions recompute topology-derived safety metadata after patches", () => {
  const definition = createWorldDefinition({
    service: { port: 3000, env: { MODE: "isolated" } },
  }, (topology) => ({
    adapter: "fixture",
    requiresSharedState: topology.service.env.MODE === "production",
  }), validateFixture);

  assert.equal(definition.requiresSharedState, false);
  assert.equal(
    definition.with({ service: { env: { MODE: "production" } } }).requiresSharedState,
    true,
  );
});
