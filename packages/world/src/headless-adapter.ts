import { join, relative, resolve } from "node:path";
import {
  headlessRuntimeIsHealthy,
  launchHeadlessWeb,
  readHeadlessRuntimeManifest,
  resolveHeadlessWorldRuntimePaths,
  stopHeadlessRuntime,
} from "./headless-web.ts";
import { parseHeadlessWebTopology } from "./headless-definition.ts";
import { assertWorldName } from "./store.ts";
import type { HeadlessWebTopology } from "./headless-definition.ts";
import type {
  ResumedWorldRuntime,
  StartedWorldRuntime,
  WorldRuntimeAdapter,
  WorldSnapshotSummary,
  WorldStartRequest,
} from "./cli.ts";

interface HeadlessWorldSnapshot {
  version: 1;
  adapter: "headless-web";
  name: string;
  createdAt: string;
  detached: boolean;
  launchId: string;
  topology: HeadlessWebTopology;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHeadlessSnapshot(text: string): HeadlessWorldSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Headless world snapshot is not valid JSON.");
  }
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => ![
      "version",
      "adapter",
      "name",
      "createdAt",
      "detached",
      "launchId",
      "topology",
    ].includes(key))
    || value.version !== 1
    || value.adapter !== "headless-web"
    || typeof value.name !== "string"
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.launchId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.launchId)
    || (value.detached !== undefined && typeof value.detached !== "boolean")
  ) {
    throw new Error("Headless world snapshot has an invalid structure.");
  }
  assertWorldName(value.name);
  return {
    version: 1,
    adapter: "headless-web",
    name: value.name,
    createdAt: value.createdAt,
    launchId: value.launchId,
    detached: value.detached === undefined ? true : value.detached,
    topology: parseHeadlessWebTopology(value.topology),
  };
}

function snapshotText(snapshot: HeadlessWorldSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function runtimeLines(
  manifest: Awaited<ReturnType<typeof readHeadlessRuntimeManifest>>,
  repoRoot: string,
  reused: boolean,
): string[] {
  if (!manifest) return [];
  return [
    ...(reused ? ["Already running; reused the healthy headless-web surface."] : []),
    `web  ${manifest.webUrl}`,
    `openwork server  ${manifest.openworkUrl}`,
    `workspace  ${manifest.workspace}`,
    `server config  ${relative(repoRoot, manifest.serverConfigPath)}`,
    `agent runtime  ${relative(repoRoot, manifest.runtimeManifestPath)}`,
    ...(manifest.denApiUrl && manifest.denTarget
      ? [`den same-origin  ${manifest.denApiUrl} -> ${manifest.denTarget}`]
      : ["den  disabled"]),
    `web logs  ${relative(repoRoot, manifest.webLogPath)}`,
    `headless logs  ${relative(repoRoot, manifest.headlessLogPath)}`,
  ];
}

function summary(snapshot: HeadlessWorldSnapshot): WorldSnapshotSummary {
  const shared = snapshot.topology.surface.state === "installed-production";
  return {
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    line: `${snapshot.name}  ${snapshot.createdAt}  local  headless-web ${snapshot.topology.surface.state}${shared ? "  LIVE SHARED PRODUCTION STATE" : ""}`,
    ...(shared ? { sharedState: true } : {}),
  };
}

export function createHeadlessWebAdapter(repoRootInput: string): WorldRuntimeAdapter {
  const repoRoot = resolve(repoRootInput);
  const snapshotDirectory = join(repoRoot, "tmp", "worlds");

  const start = async (request: WorldStartRequest): Promise<StartedWorldRuntime> => {
    const topology = parseHeadlessWebTopology(request.definition.topology);
    const name = request.name;
    const handle = await launchHeadlessWeb({
      repoRoot,
      name,
      state: topology.surface.state,
      workspace: topology.surface.workspace,
      allowSharedState: request.allowSharedState,
      replace: request.replace,
      keepTokens: request.keepTokens,
      rotateTokens: request.rotateTokens,
    });
    const launchId = handle.manifest.world?.launchId;
    if (!launchId) {
      await handle.stop();
      throw new Error("Headless runtime did not publish its launch ownership identity.");
    }
    const snapshot: HeadlessWorldSnapshot = {
      version: 1,
      adapter: "headless-web",
      name,
      createdAt: new Date().toISOString(),
      launchId,
      topology,
      detached: request.definition.detached,
    };
    return {
      name,
      lines: runtimeLines(handle.manifest, repoRoot, handle.reused),
      detachedDefault: request.definition.detached,
      ...(topology.surface.state === "installed-production" ? { sharedState: true } : {}),
      snapshotText: snapshotText(snapshot),
      waitForExit: handle.waitForExit,
      detach: handle.detach,
      dispose: handle.stop,
    };
  };

  return {
    id: "headless-web",
    snapshotDirectory,
    start,
    async rebuild(text, options) {
      const snapshot = parseHeadlessSnapshot(text);
      return start({
        definition: {
          adapter: "headless-web",
          detached: snapshot.detached,
          requiresSharedState: snapshot.topology.surface.state === "installed-production",
          topology: snapshot.topology,
        },
        name: snapshot.name,
        ...options,
      });
    },
    async resume(text, options): Promise<ResumedWorldRuntime> {
      const snapshot = parseHeadlessSnapshot(text);
      const runtimePath = resolveHeadlessWorldRuntimePaths(repoRoot, snapshot.name).runtimeManifestPath;
      const manifest = await readHeadlessRuntimeManifest(runtimePath);
      if (!manifest || !await headlessRuntimeIsHealthy(manifest)) {
        throw new Error(`Headless world ${JSON.stringify(snapshot.name)} is not running.`);
      }
      const runningWorld = manifest.world;
      if (
        !runningWorld
        || runningWorld.name !== snapshot.name
        || runningWorld.state !== snapshot.topology.surface.state
        || runningWorld.launchId !== snapshot.launchId
      ) {
        throw new Error(
          `Headless world ${JSON.stringify(snapshot.name)} snapshot does not own the running surface; rebuild it instead of attaching to a different launch.`,
        );
      }
      return {
        name: snapshot.name,
        lines: runtimeLines(manifest, repoRoot, true),
        ...(snapshot.topology.surface.state === "installed-production" ? { sharedState: true } : {}),
        async detach() {},
        async teardown() {
          if (!options.teardown) return [];
          await stopHeadlessRuntime(manifest);
          return [`Stopped world ${JSON.stringify(snapshot.name)}: headless-web surface.`];
        },
      };
    },
    summarize(text) {
      return summary(parseHeadlessSnapshot(text));
    },
  };
}
