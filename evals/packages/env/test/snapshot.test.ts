import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { defineWorld } from "../src/topology.ts";
import { buildSnapshot, fromSnapshot, parseUntrustedSnapshot, resumeWorld } from "../src/world.ts";

function safeSnapshot() {
  return buildSnapshot({
    name: "safe-snapshot",
    createdAt: "2026-08-22T12:00:00.000Z",
    place: "local",
    topology: defineWorld({
      den: { orgs: { acme: {} } },
      apps: { main: { workspacePath: "/tmp/openwork-safe-snapshot", model: "openai/gpt-5.1" } },
    }).topology,
    resolved: {
      den: {
        apiUrl: "http://127.0.0.1:8790",
        webUrl: "http://127.0.0.1:3005",
        origin: "launched",
        database: "openwork_eval_safe_snapshot",
        ports: { api: 8790, web: 3005 },
      },
      apps: {
        main: {
          cdpUrl: "http://127.0.0.1:9222",
          workspaceId: "workspace-1",
          sessions: [],
        },
      },
    },
  });
}

function attachedSnapshot(apiUrl: string) {
  return buildSnapshot({
    name: "attached-snapshot",
    createdAt: "2026-08-23T12:00:00.000Z",
    place: "local",
    topology: defineWorld({
      den: {
        attach: { apiUrl, tier: "staging" },
        orgs: { acme: {} },
      },
    }).topology,
    resolved: {
      den: { apiUrl, webUrl: apiUrl, origin: "attached" },
      apps: {},
    },
  });
}

function secretRefSnapshot() {
  return buildSnapshot({
    name: "secret-ref-snapshot",
    createdAt: "2026-08-23T12:00:00.000Z",
    place: "local",
    topology: defineWorld({
      den: {
        orgs: {
          acme: { admin: { secretRef: "OPENWORK_EVAL_SECRET_SNAPSHOT_ADMIN" } },
        },
      },
    }).topology,
    resolved: {
      den: {
        apiUrl: "http://127.0.0.1:8790",
        webUrl: "http://127.0.0.1:3005",
        origin: "launched",
      },
      apps: {},
    },
  });
}

test("buildSnapshot output round-trips through untrusted boot-shape validation", () => {
  const topology = defineWorld({
    den: {
      orgs: { acme: { admin: { name: "Alex" } } },
      env: { DEN_ORG_MODE: "multi_org", OPENWORK_DEV_MODE: "1" },
      web: false,
    },
    apps: {
      main: {
        workspacePath: "/tmp/openwork-round-trip",
        model: "openai/gpt-5.1",
        sessions: ["Q3 report", "Invoice cleanup"],
      },
    },
  }).topology;
  const snapshot = buildSnapshot({
    name: "round-trip",
    createdAt: "2026-08-22T12:00:00.000Z",
    place: "local",
    topology,
    resolved: {
      den: {
        apiUrl: "http://127.0.0.1:8790",
        webUrl: "http://127.0.0.1:3005",
        origin: "launched",
        database: "openwork_eval_round_trip",
        ports: { api: 8790, web: 3005 },
      },
      apps: {
        main: {
          cdpUrl: "http://127.0.0.1:9222",
          workspaceId: "workspace-1",
          sessions: ["Q3 report", "Invoice cleanup"],
        },
      },
    },
  });

  assert.deepEqual(fromSnapshot(JSON.stringify(snapshot)), {
    topology,
    name: "round-trip",
  });
  assert.deepEqual(snapshot.resolved.apps.main?.sessions, ["Q3 report", "Invoice cleanup"]);
  assert.deepEqual(snapshot.resolved.den, {
    apiUrl: "http://127.0.0.1:8790",
    webUrl: "http://127.0.0.1:3005",
    origin: "launched",
    database: "openwork_eval_round_trip",
    ports: { api: 8790, web: 3005 },
  });
});

test("attached snapshots remain parseable for listing but cannot rebuild or resume", async () => {
  for (const apiUrl of ["https://den.example.test", "http://127.0.0.1:8790"]) {
    const json = JSON.stringify(attachedSnapshot(apiUrl));
    assert.doesNotThrow(() => parseUntrustedSnapshot(json));
    assert.throws(
      () => fromSnapshot(json),
      /Attached worlds cannot be resumed or rebuilt from snapshots/,
    );
    await assert.rejects(
      () => resumeWorld(json),
      /Attached worlds cannot be resumed or rebuilt from snapshots/,
    );
  }

  const attached = attachedSnapshot("http://127.0.0.1:8790");
  const originOnly = {
    ...attached,
    topology: {
      ...attached.topology,
      den: { orgs: attached.topology.den.orgs },
    },
  };
  const originOnlyJson = JSON.stringify(originOnly);
  assert.doesNotThrow(() => parseUntrustedSnapshot(originOnlyJson));
  assert.throws(
    () => fromSnapshot(originOnlyJson),
    /Attached worlds cannot be resumed or rebuilt from snapshots/,
  );
});

test("secretRef snapshots remain parseable for listing but cannot rebuild or resume", async () => {
  const json = JSON.stringify(secretRefSnapshot());
  assert.doesNotThrow(() => parseUntrustedSnapshot(json));
  assert.throws(
    () => fromSnapshot(json),
    /Snapshots naming secretRef people cannot be resumed or rebuilt/,
  );
  await assert.rejects(
    () => resumeWorld(json),
    /Snapshots naming secretRef people cannot be resumed or rebuilt/,
  );
});

test("Warden VLA-BHM: fromSnapshot rejects NODE_OPTIONS import execution", () => {
  const snapshot = safeSnapshot();
  const hostile = {
    ...snapshot,
    topology: {
      ...snapshot.topology,
      den: {
        ...snapshot.topology.den,
        env: {
          NODE_OPTIONS: "--import=data:text/javascript,process.exit(97)",
        },
      },
    },
  };

  assert.throws(
    () => fromSnapshot(JSON.stringify(hostile)),
    /topology\.den\.env\.NODE_OPTIONS=.*--import.*environment keys must match/,
  );
});

test("fromSnapshot rejects native loader environment variables", () => {
  for (const key of ["LD_PRELOAD", "DYLD_INSERT_LIBRARIES"]) {
    const snapshot = safeSnapshot();
    const hostile = {
      ...snapshot,
      topology: {
        ...snapshot.topology,
        den: {
          ...snapshot.topology.den,
          env: { [key]: "/tmp/hostile-loader.so" },
        },
      },
    };
    assert.throws(
      () => fromSnapshot(JSON.stringify(hostile)),
      new RegExp(`topology\\.den\\.env\\.${key}=.*environment keys must match`),
    );
  }
});

test("fromSnapshot rejects non-loopback resolved app CDP URLs", () => {
  const snapshot = safeSnapshot();
  const hostile = {
    ...snapshot,
    resolved: {
      ...snapshot.resolved,
      apps: {
        ...snapshot.resolved.apps,
        main: {
          ...snapshot.resolved.apps.main,
          cdpUrl: "http://attacker.example:9222",
        },
      },
    },
  };

  assert.throws(
    () => fromSnapshot(JSON.stringify(hostile)),
    /resolved\.apps\.main\.cdpUrl="http:\/\/attacker\.example:9222".*hostname is 127\.0\.0\.1 or localhost/,
  );
});

test("fromSnapshot rejects injected and non-eval database names", () => {
  for (const database of ["openwork_eval_safe`; DROP DATABASE production; --", "production"]) {
    const snapshot = safeSnapshot();
    const hostile = {
      ...snapshot,
      resolved: {
        ...snapshot.resolved,
        den: { ...snapshot.resolved.den, database },
      },
    };
    assert.throws(
      () => fromSnapshot(JSON.stringify(hostile)),
      /resolved\.den\.database=.*(?:valid ephemeral database name|only generated openwork_eval_\* databases)/,
    );
  }
});

test("fromSnapshot rejects out-of-range topology and resolved ports", () => {
  const topologyPortSnapshot = safeSnapshot();
  const badTopologyPort = {
    ...topologyPortSnapshot,
    topology: {
      ...topologyPortSnapshot.topology,
      den: {
        ...topologyPortSnapshot.topology.den,
        ports: { api: 80, web: 3005 },
      },
    },
  };
  assert.throws(
    () => fromSnapshot(JSON.stringify(badTopologyPort)),
    /topology\.den\.ports\.api=80.*(?:greater than or equal to 1024|1024)/,
  );

  const resolvedPortSnapshot = safeSnapshot();
  const badResolvedPort = {
    ...resolvedPortSnapshot,
    resolved: {
      ...resolvedPortSnapshot.resolved,
      den: {
        ...resolvedPortSnapshot.resolved.den,
        ports: { api: 8790, web: 65_536 },
      },
    },
  };
  assert.throws(
    () => fromSnapshot(JSON.stringify(badResolvedPort)),
    /resolved\.den\.ports\.web=65536.*(?:less than or equal to 65535|65535)/,
  );

  const derivedPortSnapshot = safeSnapshot();
  if (derivedPortSnapshot.resolved.den.origin === "none") throw new Error("safe snapshot unexpectedly had no Den");
  const badDerivedPort = {
    ...derivedPortSnapshot,
    resolved: {
      ...derivedPortSnapshot.resolved,
      den: {
        ...derivedPortSnapshot.resolved.den,
        apiUrl: "http://127.0.0.1:81",
        webUrl: derivedPortSnapshot.resolved.den.webUrl,
      },
    },
  };
  assert.throws(
    () => fromSnapshot(JSON.stringify(badDerivedPort)),
    /resolved\.den\.apiUrl\.port=81.*1024 to 65535/,
  );
});

test("fromSnapshot confines workspace paths and snapshot names", () => {
  const workspaceSnapshot = safeSnapshot();
  const badWorkspace = {
    ...workspaceSnapshot,
    topology: {
      ...workspaceSnapshot.topology,
      apps: {
        main: { ...workspaceSnapshot.topology.apps?.main, workspacePath: "/Users/example/private" },
      },
    },
  };
  assert.throws(
    () => fromSnapshot(JSON.stringify(badWorkspace)),
    /topology\.apps\.main\.workspacePath="\/Users\/example\/private".*expected a path inside/,
  );

  const nameSnapshot = safeSnapshot();
  assert.throws(
    () => fromSnapshot(JSON.stringify({ ...nameSnapshot, name: "../../outside" })),
    /name="\.\.\/\.\.\/outside".*filesystem-safe name/,
  );
});

test("fromSnapshot rejects unknown fields", () => {
  const topology = defineWorld({ den: { orgs: { acme: {} } } }).topology;
  const snapshot = buildSnapshot({
    name: "strict-snapshot",
    createdAt: "2026-08-22T12:00:00.000Z",
    place: "local",
    topology,
    resolved: {
      den: {
        apiUrl: "http://127.0.0.1:8788",
        webUrl: "http://127.0.0.1:3005",
        origin: "launched",
      },
      apps: {},
    },
  });

  assert.throws(
    () => fromSnapshot(JSON.stringify({ ...snapshot, unknownSnapshotField: true })),
    /Unrecognized key.*unknownSnapshotField/,
  );
});

test("kind world snapshots preserve their resolved Den substrate", () => {
  const topology = defineWorld({
    den: {
      substrate: "kind",
      orgs: { "Acme Robotics": {} },
    },
  }).topology;
  const snapshot = buildSnapshot({
    name: "kind-world",
    createdAt: "2026-08-22T12:00:00.000Z",
    place: "local",
    topology,
    resolved: {
      den: {
        apiUrl: "http://127.0.0.1:8790",
        webUrl: "http://127.0.0.1:3005",
        origin: "launched",
        substrate: "kind",
      },
      apps: {},
    },
  });

  if (snapshot.resolved.den.origin === "none") throw new Error("kind snapshot unexpectedly had no Den");
  assert.equal(snapshot.resolved.den.substrate, "kind");
  assert.deepEqual(fromSnapshot(JSON.stringify(snapshot)), { topology, name: "kind-world" });
});

test("live shared production snapshots preserve only symbolic state selection", () => {
  const profileDir = fileURLToPath(new URL("../../../results/.surfaces/production-live-fixture", import.meta.url));
  const topology = defineWorld({
    den: { orgs: {} },
    apps: {
      main: { desktopState: { source: "installed-production", mode: "live-shared" } },
    },
  }).topology;
  const snapshot = buildSnapshot({
    name: "production-live",
    createdAt: "2026-08-25T12:00:00.000Z",
    place: "local",
    topology,
    resolved: {
      den: { origin: "none" },
      apps: {
        main: {
          cdpUrl: "http://127.0.0.1:9222",
          workspaceId: null,
          sessions: [],
          owner: { pid: 4242, profileDir },
        },
      },
    },
  });
  assert.deepEqual(fromSnapshot(JSON.stringify(snapshot)), { topology, name: "production-live" });
  assert.throws(
    () => fromSnapshot(JSON.stringify({ ...snapshot, place: "daytona" })),
    /live-shared installed-production desktop snapshots must use local placement/,
  );
});
