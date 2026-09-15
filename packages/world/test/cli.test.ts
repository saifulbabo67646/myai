import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main, parseWorldArgs } from "../src/cli.ts";
import type { WorldRuntimeAdapter } from "../src/cli.ts";

test("world arguments accept path sources and compatibility lifecycle flags", () => {
  assert.deepEqual(parseWorldArgs(["up", "./worlds/dev-headless.ts"]), {
    kind: "up",
    source: "./worlds/dev-headless.ts",
  });
  assert.deepEqual(parseWorldArgs(["up", "solo", "--name", "demo", "--keep"]), {
    kind: "up",
    source: "solo",
    name: "demo",
    keep: true,
  });
  assert.deepEqual(parseWorldArgs(["up", "headless-prod-live", "--allow-shared-state", "--replace"]), {
    kind: "up",
    source: "headless-prod-live",
    allowSharedState: true,
    replace: true,
  });
});

test("path worlds use the filename name and their detached default", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-world-cli-"));
  try {
    const worldsDirectory = join(root, "worlds");
    await mkdir(worldsDirectory);
    const worldPath = join(worldsDirectory, "fixture-world.ts");
    await writeFile(worldPath, `export default {
      adapter: "fixture",
      detached: true,
      requiresSharedState: false,
      topology: { value: "loaded" },
    };\n`, "utf8");
    let receivedName: string | undefined;
    let detached = false;
    let waited = false;
    const adapter: WorldRuntimeAdapter = {
      id: "fixture",
      snapshotDirectory: join(root, "state"),
      async start(received) {
        receivedName = received.name;
        return {
          name: received.name ?? "missing",
          lines: ["fixture up"],
          async detach() { detached = true; },
          async dispose() { throw new Error("detached worlds must not dispose"); },
        };
      },
      async rebuild() { throw new Error("unused"); },
      async resume() { throw new Error("unused"); },
      summarize() { throw new Error("unused"); },
    };
    const lines: string[] = [];
    const result = await main(["up", worldPath], {
      cwd: root,
      worldsDirectory,
      adapters: [adapter],
      print: (line) => lines.push(line),
      onExit: async () => { waited = true; },
    });

    assert.equal(result, 0);
    assert.equal(receivedName, "fixture-world");
    assert.equal(detached, true);
    assert.equal(waited, false);
    assert.ok(lines.includes('World "fixture-world" is up (world file ' + worldPath + ').'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the shared shell persists, lists, resumes, and forgets adapter snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-world-lifecycle-"));
  try {
    const stateDirectory = join(root, "state");
    const snapshot = '{"adapter":"fixture","name":"demo"}\n';
    let disposed = false;
    let tornDown = false;
    const adapter: WorldRuntimeAdapter = {
      id: "fixture",
      snapshotDirectory: stateDirectory,
      async start(request) {
        return {
          name: request.name ?? "missing",
          lines: ["fixture up"],
          snapshotText: snapshot,
          async detach() {},
          async dispose() { disposed = true; },
        };
      },
      async rebuild() { throw new Error("unused"); },
      async resume(text, options) {
        assert.equal(text, snapshot);
        assert.equal(options.teardown, true);
        return {
          name: "demo",
          lines: ["fixture resumed"],
          async detach() {},
          async teardown() {
            tornDown = true;
            return ["fixture stopped"];
          },
        };
      },
      summarize(text) {
        if (text !== snapshot) throw new Error("not a fixture snapshot");
        return {
          name: "demo",
          createdAt: "2026-08-25T00:00:00.000Z",
          line: "demo  fixture",
        };
      },
    };
    const options = {
      cwd: root,
      worldsDirectory: join(root, "worlds"),
      presets: {
        fixture: {
          adapter: "fixture",
          detached: false,
          requiresSharedState: false,
          topology: {},
        },
      },
      adapters: [adapter],
      print: (_line: string) => {},
      onExit: async () => {},
    };

    assert.equal(await main(["up", "fixture", "--name", "demo"], options), 0);
    assert.equal(disposed, true);
    assert.equal(await readFile(join(stateDirectory, "demo.json"), "utf8"), snapshot);

    const listed: string[] = [];
    assert.equal(await main(["list"], { ...options, print: (line) => listed.push(line) }), 0);
    assert.ok(listed.includes("demo  fixture"));

    assert.equal(await main(["resume", "demo", "--teardown"], options), 0);
    assert.equal(tornDown, true);
    assert.equal(await main(["forget", "demo"], options), 0);
    await assert.rejects(readFile(join(stateDirectory, "demo.json"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shared-state definitions are refused before their adapter runs", async () => {
  let started = false;
  const lines: string[] = [];
  const result = await main(["up", "danger"], {
    cwd: tmpdir(),
    worldsDirectory: join(tmpdir(), "missing-worlds"),
    presets: {
      danger: {
        adapter: "fixture",
        detached: true,
        requiresSharedState: true,
        topology: {},
      },
    },
    adapters: [{
      id: "fixture",
      snapshotDirectory: join(tmpdir(), "fixture-world-state"),
      async start() { started = true; throw new Error("must not run"); },
      async rebuild() { throw new Error("unused"); },
      async resume() { throw new Error("unused"); },
      summarize() { throw new Error("unused"); },
    }],
    print: (line) => lines.push(line),
  });
  assert.equal(result, 1);
  assert.equal(started, false);
  assert.match(lines[0] ?? "", /without explicit --allow-shared-state/);
});

test("world names are validated before adapter side effects", async () => {
  let started = false;
  const result = await main(["up", "fixture", "--name", "../escape"], {
    cwd: tmpdir(),
    worldsDirectory: join(tmpdir(), "missing-worlds"),
    presets: {
      fixture: {
        adapter: "fixture",
        detached: true,
        requiresSharedState: false,
        topology: {},
      },
    },
    adapters: [{
      id: "fixture",
      snapshotDirectory: join(tmpdir(), "fixture-world-state"),
      async start() { started = true; throw new Error("must not run"); },
      async rebuild() { throw new Error("unused"); },
      async resume() { throw new Error("unused"); },
      summarize() { throw new Error("unused"); },
    }],
    print: () => {},
  });

  assert.equal(result, 1);
  assert.equal(started, false);
});

test("same-name snapshots across adapters are refused instead of guessed or deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-world-ambiguous-"));
  try {
    const firstDirectory = join(root, "first");
    const secondDirectory = join(root, "second");
    await mkdir(firstDirectory);
    await mkdir(secondDirectory);
    await writeFile(join(firstDirectory, "demo.json"), '{"adapter":"first"}\n', "utf8");
    await writeFile(join(secondDirectory, "demo.json"), '{"adapter":"second"}\n', "utf8");
    const adapter = (id: string, snapshotDirectory: string): WorldRuntimeAdapter => ({
      id,
      snapshotDirectory,
      async start() { throw new Error("unused"); },
      async rebuild() { throw new Error("unused"); },
      async resume() { throw new Error("must not choose an adapter"); },
      summarize(text) {
        const value: unknown = JSON.parse(text);
        if (typeof value !== "object" || value === null || !("adapter" in value) || value.adapter !== id) {
          throw new Error("wrong adapter");
        }
        return { name: "demo", createdAt: "2026-08-25T00:00:00.000Z", line: id };
      },
    });
    const lines: string[] = [];
    const options = {
      cwd: root,
      worldsDirectory: join(root, "worlds"),
      adapters: [adapter("first", firstDirectory), adapter("second", secondDirectory)],
      print: (line: string) => lines.push(line),
    };

    assert.equal(await main(["resume", "demo"], options), 1);
    assert.match(lines.at(-1) ?? "", /ambiguous across adapters/);
    assert.equal(await main(["forget", "demo"], options), 1);
    assert.equal(await readFile(join(firstDirectory, "demo.json"), "utf8"), '{"adapter":"first"}\n');
    assert.equal(await readFile(join(secondDirectory, "demo.json"), "utf8"), '{"adapter":"second"}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
