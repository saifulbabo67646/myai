import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eventually, test } from "@openwork/testkit";
import {
  createHeadlessWebAdapter,
  main,
  readHeadlessRuntimeManifest,
  resolveHeadlessWorldRuntimePaths,
  stopHeadlessRuntime,
  WorldStateStore,
} from "@openwork/world";
import { expect, onTestFinished } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORLDS_DIRECTORY = join(REPO_ROOT, "worlds");

test("a world owns and supervises the real headless web and backend lifecycle", { timeout: 180_000 }, async ({ evidence }) => {
  const adapter = createHeadlessWebAdapter(REPO_ROOT);
  const firstName = `headless-world-e2e-${process.pid}`;
  const supervisedName = `headless-supervisor-e2e-${process.pid}`;
  const names = [firstName, supervisedName];

  const cleanup = async (): Promise<void> => {
    for (const name of names) {
      const paths = resolveHeadlessWorldRuntimePaths(REPO_ROOT, name);
      const manifest = await readHeadlessRuntimeManifest(paths.runtimeManifestPath);
      if (manifest) await stopHeadlessRuntime(manifest);
      await new WorldStateStore(adapter.snapshotDirectory).forget(name);
    }
  };
  onTestFinished(cleanup);
  await cleanup();

  const cliOptions = {
    cwd: REPO_ROOT,
    worldsDirectory: WORLDS_DIRECTORY,
    adapters: [adapter],
    print: () => {},
  };
  const worldPath = join(WORLDS_DIRECTORY, "dev-headless.ts");
  expect(await main(["up", worldPath, "--name", firstName, "--replace"], cliOptions)).toBe(0);

  const firstPaths = resolveHeadlessWorldRuntimePaths(REPO_ROOT, firstName);
  const firstManifest = await readHeadlessRuntimeManifest(firstPaths.runtimeManifestPath);
  if (!firstManifest) throw new Error("The launched headless world did not publish its runtime manifest.");
  expect(firstManifest.world?.name).toBe(firstName);
  expect(firstManifest.world?.launchId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(firstManifest.runtimeManifestPath).toBe(firstPaths.runtimeManifestPath);
  expect(firstManifest.supervisorPid).toBeGreaterThan(0);
  const health = await fetch(firstManifest.healthUrl);
  const web = await fetch(firstManifest.webUrl);
  expect(health.ok).toBe(true);
  expect(web.ok).toBe(true);

  expect(await main(["resume", firstName, "--teardown"], cliOptions)).toBe(0);
  await eventually(
    async () => await readHeadlessRuntimeManifest(firstPaths.runtimeManifestPath) === null,
    { within: 10_000, intervalMs: 100, label: "owned runtime manifest removed after teardown" },
  );
  await expect(fetch(firstManifest.healthUrl)).rejects.toThrow();

  expect(await main(["up", worldPath, "--name", supervisedName, "--replace"], cliOptions)).toBe(0);
  const supervisedPaths = resolveHeadlessWorldRuntimePaths(REPO_ROOT, supervisedName);
  const supervisedManifest = await readHeadlessRuntimeManifest(supervisedPaths.runtimeManifestPath);
  const webPid = supervisedManifest?.pids.web;
  if (!supervisedManifest || !webPid) {
    throw new Error("The supervised headless world did not publish its owned web process.");
  }
  expect(webPid).toBeGreaterThan(0);
  process.kill(webPid, "SIGTERM");

  await eventually(async () => {
    const manifestGone = await readHeadlessRuntimeManifest(supervisedPaths.runtimeManifestPath) === null;
    const serverStopped = await fetch(supervisedManifest.healthUrl)
      .then(() => false)
      .catch(() => true);
    return manifestGone && serverStopped;
  }, {
    within: 15_000,
    intervalMs: 200,
    label: "detached supervisor stopped the backend after the web process exited",
  });

  evidence.recordAssertionEvidence(
    "The shared world engine owns the real headless surface lifecycle",
    "A named world launched healthy Vite and openwork-server processes, published a launch-bound snapshot, and removed its runtime manifest and listeners on teardown.",
    true,
  );
  evidence.recordAssertionEvidence(
    "Detached headless siblings remain supervised",
    "After the spec terminated the owned Vite process, the detached supervisor stopped openwork-server and removed the owned runtime manifest within the bound.",
    true,
  );
});

test("the dev:headless-web alias remains foreground and Ctrl-C owns teardown", { timeout: 180_000 }, async ({ evidence }) => {
  const paths = resolveHeadlessWorldRuntimePaths(REPO_ROOT, "dev-headless");
  const existing = await readHeadlessRuntimeManifest(paths.runtimeManifestPath);
  if (existing) await stopHeadlessRuntime(existing);

  const output: string[] = [];
  const adjacentCorepack = join(
    dirname(process.execPath),
    process.platform === "win32" ? "corepack.cmd" : "corepack",
  );
  const npmExecPath = process.env.npm_execpath?.trim();
  const hasAdjacentCorepack = await access(adjacentCorepack).then(() => true, () => false);
  const launcherCommand = npmExecPath
    ? process.execPath
    : hasAdjacentCorepack
      ? adjacentCorepack
      : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const launcherArgs = npmExecPath
    ? [npmExecPath, "dev:headless-web", "--replace"]
    : hasAdjacentCorepack
      ? ["pnpm", "dev:headless-web", "--replace"]
      : ["dev:headless-web", "--replace"];
  const launcher = spawn(launcherCommand, launcherArgs, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  launcher.stdout.on("data", (chunk) => output.push(String(chunk)));
  launcher.stderr.on("data", (chunk) => output.push(String(chunk)));
  let launcherError: Error | null = null;
  launcher.once("error", (error) => { launcherError = error; });
  onTestFinished(async () => {
    const manifest = await readHeadlessRuntimeManifest(paths.runtimeManifestPath);
    if (manifest) await stopHeadlessRuntime(manifest);
    if (launcher.exitCode === null) launcher.kill("SIGTERM");
    await new WorldStateStore(join(REPO_ROOT, "tmp", "worlds")).forget("dev-headless");
  });

  const manifest = await eventually(async () => {
    if (launcherError) throw launcherError;
    const candidate = await readHeadlessRuntimeManifest(paths.runtimeManifestPath);
    if (launcher.exitCode !== null) {
      throw new Error(`dev:headless-web exited before health with ${launcher.exitCode}:\n${output.join("")}`);
    }
    if (!candidate) return null;
    return await fetch(candidate.healthUrl).then((response) => response.ok).catch(() => false)
      ? candidate
      : null;
  }, {
    within: 60_000,
    intervalMs: 200,
    label: `foreground compatibility launch\n${output.join("")}`,
  });
  expect(launcher.exitCode).toBeNull();
  await eventually(
    () => output.join("").includes("Stays up until Ctrl-C; Ctrl-C tears everything down."),
    {
      within: 15_000,
      intervalMs: 100,
      label: `foreground compatibility readiness\n${output.join("")}`,
    },
  );

  process.kill(manifest.pids.launcher, "SIGINT");
  await eventually(
    async () => await readHeadlessRuntimeManifest(paths.runtimeManifestPath) === null,
    {
      within: 15_000,
      intervalMs: 100,
      label: `foreground compatibility manifest cleanup\n${output.join("")}`,
    },
  );
  await eventually(
    () => fetch(manifest.healthUrl).then(() => false).catch(() => true),
    {
      within: 15_000,
      intervalMs: 100,
      label: `foreground compatibility server teardown\n${output.join("")}`,
    },
  );
  await eventually(
    () => launcher.exitCode === null ? false : { exitCode: launcher.exitCode },
    {
    within: 15_000,
    intervalMs: 100,
    label: `foreground compatibility launcher exit\n${output.join("")}`,
    },
  );

  expect(launcher.exitCode).toBe(0);
  evidence.recordAssertionEvidence(
    "The legacy headless command remains foreground by default",
    "The real pnpm dev:headless-web command remained alive after both services reached health, then exited cleanly only after SIGINT reached its launcher.",
    true,
  );
  evidence.recordAssertionEvidence(
    "Foreground Ctrl-C tears down both owned services",
    "After SIGINT, the compatibility command removed its owner manifest and its openwork-server health endpoint stopped responding within the bound.",
    true,
  );
});
