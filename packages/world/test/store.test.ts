import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorldStateStore } from "../src/store.ts";

test("local world state is owner-only and addressable by world name", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-world-store-"));
  try {
    const store = new WorldStateStore(join(root, "worlds"));
    const path = await store.save("demo", '{"name":"demo"}');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(await store.read("demo"), '{"name":"demo"}\n');
    assert.deepEqual(await store.list(), [path]);
    assert.equal(await store.forget("demo"), true);
    assert.equal(await store.forget("demo"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
