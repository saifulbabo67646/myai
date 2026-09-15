import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  electronProfilePaths,
  electronSurfaceEnv,
  liveSharedProductionStateEnv,
  removeOwnedSurfaceFiles,
  resolveInstalledProductionDesktopState,
} from "@openwork/hosts";
import {
  buildSnapshot,
  desktopProductionLive,
  resolvePlace,
  startWorld,
  test,
} from "@openwork/testkit";

test("live shared production desktop state is explicit, local, symbolic, and cleanup-safe", async ({ evidence }) => {
  await assert.rejects(
    () => startWorld(desktopProductionLive, {
      place: resolvePlace({}),
      name: "shared-state-refused",
    }),
    /without explicit --allow-shared-state opt-in/,
  );
  await assert.rejects(
    () => startWorld(desktopProductionLive, {
      place: resolvePlace({ OPENWORK_EVAL_DAYTONA: "1" }),
      name: "shared-state-remote-refused",
      allowSharedState: true,
    }),
    /requires local placement/,
  );

  const fixtureRoot = await mkdtemp(join(tmpdir(), "openwork-prod-live-state-"));
  try {
    const homeDir = join(fixtureRoot, "home");
    const dataDir = join(homeDir, ".openwork", "openwork-server");
    const configDir = join(homeDir, ".config", "openwork");
    const opencodeConfigDir = join(homeDir, ".config", "opencode");
    const userDataDir = join(homeDir, "Library", "Application Support", "com.differentai.openwork");
    const opencodeDb = join(homeDir, "Library", "Application Support", "opencode", "opencode.db");
    await mkdir(dataDir, { recursive: true });
    await mkdir(configDir, { recursive: true });
    await mkdir(opencodeConfigDir, { recursive: true });
    await mkdir(userDataDir, { recursive: true });
    await mkdir(dirname(opencodeDb), { recursive: true });
    await writeFile(opencodeDb, "fixture", "utf8");
    for (const path of [
      join(configDir, "desktop-bootstrap.json"),
      join(configDir, "env.json"),
      join(configDir, "server.json"),
      join(userDataDir, "openwork-server-state.json"),
      join(userDataDir, "openwork-server-tokens.json"),
      join(userDataDir, "openwork-workspaces.json"),
    ]) {
      await writeFile(path, "{}\n", "utf8");
    }

    const resolved = await resolveInstalledProductionDesktopState({
      env: {},
      homeDir,
      platform: "darwin",
    });
    assert.deepEqual(resolved, {
      bootstrapPath: join(configDir, "desktop-bootstrap.json"),
      dataDir,
      envStorePath: join(configDir, "env.json"),
      homeDir,
      opencodeDb,
      opencodeConfigDir,
      serverConfigPath: join(configDir, "server.json"),
      serverStatePath: join(userDataDir, "openwork-server-state.json"),
      serverTokenStorePath: join(userDataDir, "openwork-server-tokens.json"),
      workspaceStatePath: join(userDataDir, "openwork-workspaces.json"),
    });

    const isolatedProfile = join(fixtureRoot, "isolated-eval-profile");
    const profilePaths = electronProfilePaths(isolatedProfile);
    await mkdir(profilePaths.userDataDir, { recursive: true });
    const launchEnv = electronSurfaceEnv(
      profilePaths,
      {
        appName: "OpenWork Eval production-live",
        appIdentifier: "com.differentai.openwork.eval.production-live",
        port: 31_001,
        cdpPort: 31_002,
      },
      liveSharedProductionStateEnv(resolved),
    );
    assert.equal(launchEnv.OPENWORK_DATA_DIR, dataDir);
    assert.equal(launchEnv.OPENCODE_DB, opencodeDb);
    assert.equal(launchEnv.OPENWORK_DESKTOP_WORKSPACE_STATE_PATH, join(userDataDir, "openwork-workspaces.json"));
    assert.equal(launchEnv.OPENWORK_SERVER_TOKEN_STORE_PATH, join(userDataDir, "openwork-server-tokens.json"));
    assert.equal(launchEnv.OPENWORK_SERVER_STATE_PATH, join(userDataDir, "openwork-server-state.json"));
    assert.equal(launchEnv.OPENWORK_ENV_STORE, join(configDir, "env.json"));
    assert.equal(launchEnv.OPENWORK_SERVER_CONFIG, join(configDir, "server.json"));
    assert.equal(launchEnv.OPENWORK_DEV_SHARED_STATE, "1");
    assert.equal(launchEnv.OPENWORK_ELECTRON_USERDATA, profilePaths.userDataDir);
    assert.notEqual(launchEnv.OPENWORK_ELECTRON_USERDATA, dataDir);
    assert.equal(launchEnv.OPENWORK_ELECTRON_APP_IDENTIFIER, "com.differentai.openwork.eval.production-live");
    assert.equal(launchEnv.OPENWORK_ELECTRON_REMOTE_DEBUG_PORT, "31002");

    const snapshot = buildSnapshot({
      name: "prod-live-fixture",
      createdAt: "2026-08-25T12:00:00.000Z",
      place: "local",
      topology: desktopProductionLive.topology,
      resolved: {
        den: { origin: "none" },
        apps: {
          main: {
            cdpUrl: "http://127.0.0.1:31002",
            workspaceId: null,
            sessions: [],
          },
        },
      },
    });
    const serialized = JSON.stringify(snapshot);
    assert.match(serialized, /"source":"installed-production"/);
    assert.match(serialized, /"mode":"live-shared"/);
    assert.doesNotMatch(serialized, new RegExp(fixtureRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(serialized, /OPENCODE_DB|OPENWORK_DATA_DIR/);

    await removeOwnedSurfaceFiles({
      name: "production-live",
      kind: "electron",
      hostKind: "local",
      cdpUrl: "http://127.0.0.1:31002",
      profileDir: isolatedProfile,
      meta: { profileOwner: "host" },
    });
    await assert.rejects(() => access(isolatedProfile));
    await access(dataDir);
    await access(opencodeDb);

    evidence.recordAssertionEvidence(
      "Live production state requires explicit local opt-in",
      "Launch was refused without --allow-shared-state and under remote Daytona placement.",
      true,
    );
    evidence.recordAssertionEvidence(
      "Dev Electron points at installed production stores from an isolated profile",
      "The launch environment selected production OpenWork, OpenCode, workspace, config, and token paths while retaining an isolated Electron userData directory.",
      true,
    );
    evidence.recordAssertionEvidence(
      "World snapshots do not persist production paths or credentials",
      "The snapshot retained only the symbolic installed-production/live-shared selector and omitted resolved production paths and environment names.",
      true,
    );
    evidence.recordAssertionEvidence(
      "Cleanup owns only the isolated dev profile",
      "Cleanup removed the eval profile while the production OpenWork directory and OpenCode database remained present.",
      true,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
