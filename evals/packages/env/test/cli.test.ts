import assert from "node:assert/strict";
import test from "node:test";
import { parseWorldArgs, presetCatalog } from "../src/cli.ts";
import { createEvalWorldAdapter } from "../src/world-adapter.ts";
import { buildSnapshot } from "../src/world.ts";
import { supportOrg } from "../src/presets.ts";

test("eval preset names remain available through the shared world shell", () => {
  assert.deepEqual(Object.keys(presetCatalog).sort(), [
    "acme-demo",
    "acme-docs",
    "desktop-prod-live",
    "solo",
    "support-org",
  ]);
  assert.equal(presetCatalog.solo.adapter, "eval");
  assert.deepEqual(parseWorldArgs(["up", "support-org"]), {
    kind: "up",
    source: "support-org",
  });
  assert.deepEqual(parseWorldArgs(["resume", "demo", "--teardown"]), {
    kind: "resume",
    nameOrSnapshotPath: "demo",
    teardown: true,
  });
});

test("the eval adapter recognizes existing version-1 world snapshots", () => {
  const snapshot = buildSnapshot({
    name: "support-demo",
    createdAt: "2026-08-22T12:00:00.000Z",
    place: "daytona",
    topology: supportOrg.topology,
    resolved: {
      den: { apiUrl: "http://api.test", webUrl: "http://web.test", origin: "launched" },
      apps: {},
    },
  });
  const summary = createEvalWorldAdapter().summarize(JSON.stringify(snapshot));
  assert.equal(summary.name, "support-demo");
  assert.equal(summary.line, "support-demo  2026-08-22T12:00:00.000Z  daytona  orgs acme,globex  apps alice,bob");
});
