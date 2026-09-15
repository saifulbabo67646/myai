import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";
import { createHeadlessWebAdapter } from "../src/headless-adapter.ts";

test("headless snapshots cannot select a runtime manifest path", () => {
  const adapter = createHeadlessWebAdapter(tmpdir());
  const malicious = JSON.stringify({
    version: 1,
    adapter: "headless-web",
    name: "demo",
    createdAt: "2026-08-25T00:00:00.000Z",
    detached: true,
    launchId: "12345678-1234-4123-8123-123456789abc",
    topology: { surface: { kind: "headless-web", state: "isolated" } },
    resolved: { runtimeManifestPath: "/tmp/untrusted.json" },
  });

  assert.throws(
    () => adapter.summarize(malicious),
    /invalid structure/,
  );
});
