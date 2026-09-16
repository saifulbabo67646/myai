import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { briefTest, claim, testBrief } from "@openwork/testkit";

// WP-7 deployment proof: the packaging in packaging/docker/ plus the real server
// artifact (apps/myai-server/dist/index.js) on a disposable "volume", with the
// real MIT runtime answering on loopback. Nothing here needs Docker: the
// container build and `docker compose config` are run as commands and pasted
// into the PR, because the pr lane has no Docker daemon.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const serverEntry = join(repoRoot, "apps", "myai-server", "dist", "index.js");
const serverManifest = join(repoRoot, "apps", "myai-server", "package.json");
const runtimeEntry = join(repoRoot, "apps", "server", "src", "cli.ts");
const composePath = join(repoRoot, "packaging", "docker", "docker-compose.myai.yml");
const dockerfilePath = join(repoRoot, "packaging", "docker", "Dockerfile.myai-server");
const envTemplatePath = join(repoRoot, "packaging", "docker", ".env.example");
const deploymentDocPath = join(repoRoot, "docs", "deployment.md");

const SESSION_SECRET = "wp7-deployment-proof-session-secret-0123456789abcdef";
const BOOTSTRAP_SECRET = "wp7-deployment-proof-bootstrap-secret";
const OWNER = { email: "owner@myai.test", password: "correct-horse-battery", name: "Owner" };
const START_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 5_000;

// docs/myai-plan.md §9.1 puts Bun at ~/.bun/bin; make that reachable for the
// runtime process without assuming the caller exported it.
const pathWithBun = `${join(process.env.HOME ?? "", ".bun", "bin")}:${process.env.PATH ?? ""}`;

interface RunningServer {
  port: number;
  child: ChildProcess;
  stderr: () => string;
  stop: () => Promise<void>;
}

interface RunningRuntime {
  port: number;
  stop: () => Promise<void>;
}

function disposableRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `myai-wp7-${label}-`));
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not allocate a loopback port."));
        return;
      }
      const { port } = address;
      probe.close(() => resolvePort(port));
    });
  });
}

async function get(url: string, init: RequestInit = {}): Promise<{ status: number; body: string; setCookie: string | null }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  return { status: response.status, body: await response.text(), setCookie: response.headers.get("set-cookie") };
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return false;
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveStop();
      return;
    }
    const force = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(force);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}

/** The deployment's runtime dependency: the MIT runtime, loopback only. */
async function startRuntime(port: number, workspaceRoot: string): Promise<RunningRuntime> {
  const child = spawn("bun", ["--conditions=development", runtimeEntry, "--host", "127.0.0.1", "--port", String(port), "--workspace", workspaceRoot, "--no-log-requests"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: pathWithBun },
  });
  if (!(await waitForHttp(`http://127.0.0.1:${port}/health`, START_TIMEOUT_MS))) {
    const stop = stopChild(child);
    await stop;
    throw new Error(`The MIT runtime did not answer /health on 127.0.0.1:${port}.`);
  }
  return { port, stop: () => stopChild(child) };
}

function serverEnvironment(input: { dataDir: string; databasePath: string; workspaceRoots: string; runtimePort: number; port: number; logFile?: string; overrides?: Record<string, string> }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MYAI_ENV: "production",
    MYAI_HOST: "127.0.0.1",
    MYAI_PORT: String(input.port),
    MYAI_DATA_DIR: input.dataDir,
    MYAI_DATABASE_PATH: input.databasePath,
    MYAI_WORKSPACE_ROOTS: input.workspaceRoots,
    MYAI_RUNTIME_BASE_URL: `http://127.0.0.1:${input.runtimePort}`,
    MYAI_SESSION_SECRET: SESSION_SECRET,
    MYAI_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET,
    MYAI_PUBLIC_BASE_URL: `http://127.0.0.1:${input.port}`,
    ...(input.logFile ? { MYAI_LOG_FILE: input.logFile } : {}),
    ...input.overrides,
  };
}

async function startServer(env: NodeJS.ProcessEnv, port: number): Promise<RunningServer> {
  const child = spawn(process.execPath, [serverEntry], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], env });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  // A configuration error exits immediately; stop waiting as soon as it does.
  const exitedEarly = new Promise<boolean>((resolveExit) => child.once("exit", () => resolveExit(false)));
  const ready = await Promise.race([waitForHttp(`http://127.0.0.1:${port}/healthz`, START_TIMEOUT_MS), exitedEarly]);
  if (!ready) {
    await stopChild(child);
    throw new Error(`myai server did not answer /healthz on 127.0.0.1:${port}. stderr: ${stderr.trim()}`);
  }
  return { port, child, stderr: () => stderr, stop: () => stopChild(child) };
}

function topLevelBlock(yaml: string, key: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1) throw new Error(`docker-compose.myai.yml has no top-level ${key}: section.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function serviceBlock(compose: string, name: string): string {
  const lines = compose.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) throw new Error(`docker-compose.myai.yml has no service named ${name}.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^( {2}\S|\S)/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function buildServerIfMissing(): void {
  if (existsSync(serverEntry)) return;
  const result = spawnSync("pnpm", ["--filter", "@myai/server", "build"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`pnpm --filter @myai/server build failed: ${result.stderr || result.stdout}`);
  }
}

function assertBunAvailable(): string {
  const probe = spawnSync("bun", ["--version"], { encoding: "utf8", env: { ...process.env, PATH: pathWithBun } });
  const version = probe.stdout.trim();
  expect(probe.status, "bun must be on PATH (docs/myai-plan.md §9.1)").toBe(0);
  return version;
}

briefTest(testBrief({
  behavior: "The packaged deployment ships one myai server image, one control-data volume, and one loopback runtime that is never published.",
  claims: {
    singleServerImage: claim("one Dockerfile builds the myai server and its runtime from this repository's sources", {
      never: "the image build pulls a prebuilt control plane or uses npm/yarn",
    }),
    onePublishedPort: claim("exactly one service publishes one port, and the runtime publishes none", {
      never: "the MIT runtime becomes a directly reachable endpoint",
    }),
    persistentState: claim("the control plane keeps its database and log on a named volume and shares documented workspace storage with the runtime", {
      never: "control data or workspace files land in the container filesystem",
    }),
    healthChecks: claim("the image and the compose service both define health checks, readiness hits /readyz", {
      never: "a deployment reports healthy without a usable runtime",
    }),
    templateIsSafe: claim("the env template carries placeholders for every required value and no secret", {
      never: "a real secret is committed with the packaging",
    }),
    runbookComplete: claim("docs/deployment.md documents install, upgrade, rollback, backup, restore, owner recovery, logs, and uninstall", {
      never: "an operator has to guess a recovery path",
    }),
  },
}), async ({ prove }) => {
  const dockerfile = readFileSync(dockerfilePath, "utf8");
  const manifest: unknown = JSON.parse(readFileSync(serverManifest, "utf8"));
  expect(dockerfile).toContain("node:24-bookworm-slim");
  expect(dockerfile).toContain("oven/bun:1.3.10");
  expect(dockerfile).toContain("corepack prepare pnpm@11.4.0 --activate");
  expect(dockerfile).toContain("pnpm install --frozen-lockfile");
  expect(dockerfile).toContain("--filter @myai/server...");
  expect(dockerfile).toContain("--filter openwork-server...");
  const packageManagerUsage = dockerfile
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .filter((line) => /\b(npm|yarn)\s+(install|ci|i|add|run|exec)\b/.test(line));
  expect(packageManagerUsage).toEqual([]);
  const targets = [...dockerfile.matchAll(/^FROM .+ AS ([a-z-]+)$/gm)].map((match) => match[1]);
  expect(targets).toContain("control-plane");
  expect(targets).toContain("runtime");
  expect(manifest).toMatchObject({ name: "@myai/server" });
  prove.singleServerImage(true, `Dockerfile.myai-server builds targets ${JSON.stringify(targets)} from Node 24 + pnpm 11.4.0 + Bun 1.3.10 with no npm/yarn command`);

  const compose = readFileSync(composePath, "utf8");
  const services = [...topLevelBlock(compose, "services").matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((match) => match[1]);
  expect(services).toEqual(["myai-server", "openwork-runtime", "tls-proxy"]);
  const serverBlock = serviceBlock(compose, "myai-server");
  const runtimeBlock = serviceBlock(compose, "openwork-runtime");
  const proxyBlock = serviceBlock(compose, "tls-proxy");
  const published = [...compose.matchAll(/^ {6}- "\$\{[A-Z_]+:-[^}]*\}:\$\{[A-Z_]+:-[^}]*\}:(\d+)"$/gm)];
  expect(published).toHaveLength(1);
  expect(published[0][1]).toBe("8443");
  expect(serverBlock).toContain("ports:");
  expect(runtimeBlock).not.toContain("ports:");
  expect(proxyBlock).not.toContain("ports:");
  expect(runtimeBlock).toContain('network_mode: "service:myai-server"');
  expect(proxyBlock).toContain('network_mode: "service:myai-server"');
  expect(proxyBlock).toContain('profiles: ["tls"]');
  expect(runtimeBlock).toContain("--host");
  expect(runtimeBlock).toContain("127.0.0.1");
  const cloudTokens = ["kubernetes", "daytona", "terraform", "helm", "billing", "stripe", "saml", "scim", "ghcr.io", "openworklabs"];
  const cloudMentions = cloudTokens.filter((token) => compose.toLowerCase().includes(token));
  expect(cloudMentions).toEqual([]);
  prove.onePublishedPort(published.length === 1 && !runtimeBlock.includes("ports:"), `services ${JSON.stringify(services)}; the single published mapping targets container port ${published[0][1]}; the runtime joins the server namespace and publishes nothing`);

  expect(serverBlock).toContain("myai-control-data:/var/lib/myai/data");
  expect(topLevelBlock(compose, "volumes")).toContain("  myai-control-data:");
  expect(serverBlock).toContain("MYAI_DATA_DIR: /var/lib/myai/data");
  expect(serverBlock).toContain("MYAI_DATABASE_PATH: /var/lib/myai/data/control.sqlite");
  expect(serverBlock).toContain("MYAI_LOG_FILE: /var/lib/myai/data/myai-server.log");
  expect(serverBlock).toContain("MYAI_WORKSPACE_ROOTS: /srv/myai/workspaces");
  expect(serverBlock).toContain(":/srv/myai/workspaces");
  expect(runtimeBlock).toContain(":/srv/myai/workspaces");
  expect(runtimeBlock).toContain("--workspace");
  prove.persistentState(true, "myai-control-data is a named volume mounted at /var/lib/myai/data for the database and log file; both containers bind the workspace directory at /srv/myai/workspaces");

  expect(dockerfile).toContain("HEALTHCHECK");
  expect(dockerfile).toContain("/healthz");
  expect(serverBlock).toContain("healthcheck:");
  expect(serverBlock).toContain("/readyz");
  expect(dockerfile).toContain("USER myai");
  prove.healthChecks(true, "the image health-checks /healthz, the compose service health-checks /readyz (config + database + runtime), and both images run as the unprivileged user myai");

  const template = readFileSync(envTemplatePath, "utf8");
  const requiredKeys = ["MYAI_PUBLIC_BASE_URL", "MYAI_SESSION_SECRET", "MYAI_BOOTSTRAP_SECRET", "MYAI_WORKSPACE_HOST_PATH", "MYAI_EDGE_BIND", "MYAI_EDGE_PORT", "MYAI_TLS_CERT_DIR"];
  const missingKeys = requiredKeys.filter((key) => !new RegExp(`^${key}=`, "m").test(template));
  expect(missingKeys).toEqual([]);
  const secretLines = template.split("\n").filter((line) => /^(MYAI_SESSION_SECRET|MYAI_BOOTSTRAP_SECRET)=/.test(line));
  expect(secretLines).toHaveLength(2);
  const liveLookingSecrets = secretLines.filter((line) => /=[A-Za-z0-9+/]{32,}={0,2}$/.test(line));
  expect(liveLookingSecrets).toEqual([]);
  expect(template).toContain("replace-me");
  expect(template).not.toContain(SESSION_SECRET);
  expect(template).not.toContain(BOOTSTRAP_SECRET);
  const packagingIgnore = readFileSync(join(repoRoot, "packaging", "docker", ".gitignore"), "utf8").split("\n");
  const unignored = [".env", "tls/"].filter((entry) => !packagingIgnore.includes(entry));
  expect(unignored).toEqual([]);
  prove.templateIsSafe(true, `${requiredKeys.length} required keys are present; both secret values are placeholder text, no value matches a generated secret, and packaging/docker/.gitignore keeps a filled-in .env and tls/ out of git`);

  const doc = readFileSync(deploymentDocPath, "utf8");
  const requiredTopics: Array<[string, RegExp]> = [
    ["fresh install", /## 5\. Fresh install/],
    ["upgrade", /## 8\. Upgrade/],
    ["rollback", /## 9\. Rollback/],
    ["backup", /## 10\. Backup/],
    ["restore", /## 11\. Restore/],
    ["fail-closed behaviour", /## 12\. Fail-closed behaviour/],
    ["owner recovery", /## 13\. Owner recovery/],
    ["log collection", /## 14\. Log collection/],
    ["safe uninstall", /## 15\. Safe uninstall/],
    ["data directory", /MYAI_DATA_DIR/],
    ["database path", /MYAI_DATABASE_PATH/],
    ["workspace roots", /MYAI_WORKSPACE_ROOTS/],
    ["runtime base URL", /MYAI_RUNTIME_BASE_URL/],
    ["session secret", /MYAI_SESSION_SECRET/],
    ["bootstrap secret", /MYAI_BOOTSTRAP_SECRET/],
    ["public base URL", /MYAI_PUBLIC_BASE_URL/],
    ["host", /MYAI_HOST/],
    ["port", /MYAI_PORT/],
    ["log file", /MYAI_LOG_FILE/],
    ["topology constraint", /production server must bind to loopback/],
  ];
  const undocumented = requiredTopics.filter(([, pattern]) => !pattern.test(doc)).map(([topic]) => topic);
  expect(undocumented).toEqual([]);
  prove.runbookComplete(true, `docs/deployment.md covers all ${requiredTopics.length} required topics and settings`);
});

briefTest(testBrief({
  behavior: "A clean install and an in-place upgrade on a disposable volume work end to end against the real server artifact.",
  claims: {
    cleanInstall: claim("a fresh volume boots in production, reports ready with the loopback runtime, and accepts exactly one owner bootstrap", {
      never: "a second bootstrap or an unauthenticated request succeeds",
    }),
    upgrade: claim("restarting the same volume keeps identity, membership, and the workspace registry", {
      never: "an upgrade silently resets the installation",
    }),
  },
}), async ({ prove }) => {
  buildServerIfMissing();
  const bunVersion = assertBunAvailable();
  const root = disposableRoot("install");
  const dataDir = join(root, "data");
  const workspaceRoot = join(root, "workspaces");
  const workspacePath = join(workspaceRoot, "team-files");
  mkdirSync(workspacePath, { recursive: true });
  // Production requires the data directory to exist already; a Docker named
  // volume provides exactly that on first use.
  mkdirSync(dataDir, { recursive: true });
  // The registry stores the canonical path, and tmpdir() is a symlink on macOS.
  const canonicalWorkspacePath = realpathSync(workspacePath);
  const runtimePort = await freePort();
  const serverPort = await freePort();
  const logFile = join(dataDir, "myai-server.log");
  const runtime = await startRuntime(runtimePort, workspaceRoot);
  let server: RunningServer | null = null;
  try {
    server = await startServer(serverEnvironment({ dataDir, databasePath: join(dataDir, "control.sqlite"), workspaceRoots: workspaceRoot, runtimePort, port: serverPort, logFile }), serverPort);
    const base = `http://127.0.0.1:${serverPort}`;

    const health = await get(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ status: "ok", service: "myai-server" });
    const ready = await get(`${base}/readyz`);
    expect(ready.status).toBe(200);
    expect(JSON.parse(ready.body)).toMatchObject({ status: "ready", checks: { config: "ok", database: "ok", runtime: "ok" } });

    const unauthorized = await get(`${base}/api/v1/me`);
    expect(unauthorized.status).toBe(401);

    const bootstrap = await get(`${base}/api/v1/setup/owner`, { method: "POST", headers: { "content-type": "application/json", "x-myai-bootstrap-secret": BOOTSTRAP_SECRET }, body: JSON.stringify(OWNER) });
    expect(bootstrap.status).toBe(201);
    const bootstrapped = JSON.parse(bootstrap.body) as { user: { id: string }; membership: { role: string } };
    expect(bootstrapped.membership.role).toBe("owner");

    const withoutSecret = await get(`${base}/api/v1/setup/owner`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "intruder@myai.test", password: OWNER.password, name: "Intruder" }) });
    expect(withoutSecret.status).toBe(409);

    const signIn = await get(`${base}/api/v1/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: OWNER.email, password: OWNER.password }) });
    expect(signIn.status).toBe(200);
    expect(signIn.setCookie).toBeTruthy();
    const cookie = signIn.setCookie?.split(";", 1)[0] ?? "";

    const registered = await get(`${base}/api/v1/workspaces`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "Team files", path: workspacePath }) });
    expect(registered.status).toBe(201);
    const outsideRoot = await get(`${base}/api/v1/workspaces`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "Escape", path: root }) });
    expect(outsideRoot.status).toBe(422);

    const databaseFile = join(dataDir, "control.sqlite");
    expect(existsSync(databaseFile)).toBe(true);
    expect(existsSync(logFile)).toBe(true);
    const log = readFileSync(logFile, "utf8");
    expect(log).toContain("owner_bootstrapped");
    expect(log).toContain("sign_in_succeeded");
    expect(log).not.toContain(SESSION_SECRET);
    expect(log).not.toContain(BOOTSTRAP_SECRET);
    expect(log).not.toContain(OWNER.password);
    prove.cleanInstall(true, `disposable volume ${dataDir}: /healthz and /readyz 200 with the real runtime (bun ${bunVersion}) on 127.0.0.1:${runtimePort}; bootstrap 201 then 409 for an unauthenticated second attempt; workspace registered inside the configured root and rejected outside it; control.sqlite and a scrubbed log file written into the volume`);

    await server.stop();
    server = await startServer(serverEnvironment({ dataDir, databasePath: databaseFile, workspaceRoots: workspaceRoot, runtimePort, port: serverPort, logFile }), serverPort);

    const afterUpgradeBootstrap = await get(`${base}/api/v1/setup/owner`, { method: "POST", headers: { "content-type": "application/json", "x-myai-bootstrap-secret": BOOTSTRAP_SECRET }, body: JSON.stringify({ email: "second@myai.test", password: OWNER.password, name: "Second" }) });
    expect(afterUpgradeBootstrap.status).toBe(409);

    const upgradeSignIn = await get(`${base}/api/v1/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: OWNER.email, password: OWNER.password }) });
    expect(upgradeSignIn.status).toBe(200);
    const upgradeCookie = upgradeSignIn.setCookie?.split(";", 1)[0] ?? "";
    const me = await get(`${base}/api/v1/me`, { headers: { cookie: upgradeCookie } });
    expect(me.status).toBe(200);
    const principal = JSON.parse(me.body) as { user: { id: string }; membership: { role: string } };
    expect(principal.user.id).toBe(bootstrapped.user.id);
    expect(principal.membership.role).toBe("owner");
    const workspaces = await get(`${base}/api/v1/workspaces`, { headers: { cookie: upgradeCookie } });
    expect(workspaces.status).toBe(200);
    expect(JSON.parse(workspaces.body)).toMatchObject({ workspaces: [{ name: "Team files", path: canonicalWorkspacePath }] });
    prove.upgrade(true, `second process on the same volume: schema creation idempotent, bootstrap stays 409, sign-in 200, user id ${principal.user.id} and the registered workspace both survive the restart`);
  } finally {
    if (server) await server.stop();
    await runtime.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

briefTest(testBrief({
  behavior: "A control-data backup restores a working installation, and a wiped volume behaves as a fresh install.",
  claims: {
    roundTrip: claim("backup then restore of the control-data directory preserves credentials and the workspace registry", {
      never: "a restore silently returns an empty installation",
    }),
  },
}), async ({ prove }) => {
  buildServerIfMissing();
  assertBunAvailable();
  const root = disposableRoot("backup");
  const dataDir = join(root, "data");
  const backupDir = join(root, "backup");
  const workspaceRoot = join(root, "workspaces");
  const workspacePath = join(workspaceRoot, "team-files");
  mkdirSync(workspacePath, { recursive: true });
  // Production requires the data directory to exist already; a Docker named
  // volume provides exactly that on first use.
  mkdirSync(dataDir, { recursive: true });
  // The registry stores the canonical path, and tmpdir() is a symlink on macOS.
  const canonicalWorkspacePath = realpathSync(workspacePath);
  const runtimePort = await freePort();
  const serverPort = await freePort();
  const databasePath = join(dataDir, "control.sqlite");
  const environment = serverEnvironment({ dataDir, databasePath, workspaceRoots: workspaceRoot, runtimePort, port: serverPort });
  const runtime = await startRuntime(runtimePort, workspaceRoot);
  let server: RunningServer | null = null;
  try {
    server = await startServer(environment, serverPort);
    const base = `http://127.0.0.1:${serverPort}`;
    const bootstrap = await get(`${base}/api/v1/setup/owner`, { method: "POST", headers: { "content-type": "application/json", "x-myai-bootstrap-secret": BOOTSTRAP_SECRET }, body: JSON.stringify(OWNER) });
    expect(bootstrap.status).toBe(201);
    const original = JSON.parse(bootstrap.body) as { user: { id: string } };
    const signIn = await get(`${base}/api/v1/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: OWNER.email, password: OWNER.password }) });
    const cookie = signIn.setCookie?.split(";", 1)[0] ?? "";
    expect(signIn.status).toBe(200);
    expect((await get(`${base}/api/v1/workspaces`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "Team files", path: workspacePath }) })).status).toBe(201);

    // Backup: stop the writers, copy the control-data directory.
    await server.stop();
    server = null;
    cpSync(dataDir, backupDir, { recursive: true });

    // Destroy the volume contents and confirm the installation is really gone.
    // A fresh Docker volume mounts an existing, empty directory, which is what
    // the server requires in production.
    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    server = await startServer(environment, serverPort);
    const wipedSignIn = await get(`${base}/api/v1/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: OWNER.email, password: OWNER.password }) });
    expect(wipedSignIn.status).toBe(401);
    await server.stop();
    server = null;

    // Restore the backup and confirm the installation is back.
    cpSync(backupDir, dataDir, { recursive: true });
    server = await startServer(environment, serverPort);
    const restoredSignIn = await get(`${base}/api/v1/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: OWNER.email, password: OWNER.password }) });
    expect(restoredSignIn.status).toBe(200);
    const restoredCookie = restoredSignIn.setCookie?.split(";", 1)[0] ?? "";
    const restoredMe = await get(`${base}/api/v1/me`, { headers: { cookie: restoredCookie } });
    expect(restoredMe.status).toBe(200);
    expect((JSON.parse(restoredMe.body) as { user: { id: string } }).user.id).toBe(original.user.id);
    const restoredWorkspaces = await get(`${base}/api/v1/workspaces`, { headers: { cookie: restoredCookie } });
    expect(JSON.parse(restoredWorkspaces.body)).toMatchObject({ workspaces: [{ name: "Team files", path: canonicalWorkspacePath }] });
    prove.roundTrip(true, `backup/restore of ${dataDir}: after a wipe sign-in is 401 and the volume is empty, after restore sign-in is 200, the user id is unchanged (${original.user.id}), and the workspace registry is intact`);
  } finally {
    if (server) await server.stop();
    await runtime.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

briefTest(testBrief({
  behavior: "Production configuration fails closed on a missing secret, a missing data path, a missing workspace root, or a non-loopback runtime.",
  claims: {
    failClosed: claim("every invalid production configuration exits non-zero with its reason and never binds a port", {
      never: "the server starts with an unusable or unsafe configuration",
    }),
  },
}), async ({ prove }) => {
  buildServerIfMissing();
  const root = disposableRoot("failclosed");
  const dataDir = join(root, "data");
  const workspaceRoot = join(root, "workspaces");
  mkdirSync(join(workspaceRoot, "team-files"), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const runtimePort = await freePort();
  const cases: Array<{ label: string; expected: string; overrides: Record<string, string> }> = [
    { label: "session secret too short", expected: "session secret is too short", overrides: { MYAI_SESSION_SECRET: "too-short" } },
    { label: "data directory missing", expected: "data directory and workspace roots must exist", overrides: { MYAI_DATA_DIR: join(root, "absent") } },
    { label: "workspace root missing", expected: "data directory and workspace roots must exist", overrides: { MYAI_WORKSPACE_ROOTS: join(root, "absent-workspaces") } },
    { label: "relative data directory", expected: "paths must be absolute", overrides: { MYAI_DATA_DIR: "relative/data" } },
    { label: "runtime on a container hostname", expected: "runtime must be internal", overrides: { MYAI_RUNTIME_BASE_URL: "http://openwork-runtime:8787" } },
    { label: "runtime outside loopback", expected: "runtime must be internal", overrides: { MYAI_RUNTIME_BASE_URL: "https://runtime.example.test" } },
    { label: "production bound to all interfaces", expected: "production server must bind to loopback", overrides: { MYAI_HOST: "0.0.0.0", MYAI_PUBLIC_BASE_URL: "https://myai.example.test" } },
  ];
  const observed: string[] = [];
  try {
    for (const testCase of cases) {
      const port = await freePort();
      const environment = serverEnvironment({ dataDir, databasePath: join(dataDir, "control.sqlite"), workspaceRoots: workspaceRoot, runtimePort, port, overrides: testCase.overrides });
      const child = spawn(process.execPath, [serverEntry], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], env: environment });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      const exitCode = await new Promise<number | null>((resolveExit) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolveExit(code);
        });
      });
      expect(exitCode, `${testCase.label} must exit non-zero`).not.toBe(0);
      expect(stderr, `${testCase.label} must state its reason`).toContain(testCase.expected);
      const reachable = await waitForHttp(`http://127.0.0.1:${port}/healthz`, 1_500);
      expect(reachable, `${testCase.label} must not bind a port`).toBe(false);
      observed.push(`${testCase.label} -> ${testCase.expected}`);
    }
    prove.failClosed(true, `${cases.length} invalid production configurations exited non-zero with their documented reason and never answered /healthz: ${observed.join("; ")}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
