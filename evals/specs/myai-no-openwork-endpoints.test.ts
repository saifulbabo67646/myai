import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { briefTest, claim, testBrief } from "@openwork/testkit";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The surfaces a myai release build is actually made of: the renderer bundle
 * (`apps/app/src`), the Electron shell plus its electron-builder release config
 * (`apps/desktop`), the bundled runtime (`apps/server/src`), the launch-world
 * den-target defaults (`worlds/`, `packages/world`), and the engine MCP catalog
 * the shell writes to disk (`.opencode/opencode.json`).
 *
 * Documentation prose (`packages/docs`, `docs/`) and separately published
 * packages (`packages/email`, `packages/openwork-bootstrap`, `integrations/`)
 * are outside this release build; their OpenWork *naming* is WP-5's branding
 * surface, not an endpoint this build can contact.
 */
const SHIPPED_ROOTS = [
  "apps/app/src",
  "apps/desktop/electron",
  "apps/desktop/package.json",
  ...["base", "cloud", "demo-a", "demo-b", "enterprise", ""].map((flavor) =>
    flavor ? `apps/desktop/electron-builder.${flavor}.yml` : "apps/desktop/electron-builder.yml",
  ),
  "apps/server/src",
  "apps/server/package.json",
  "packages/world/src",
  "worlds",
  ".opencode/opencode.json",
];

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".json", ".yml", ".yaml"]);
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "dist-electron", "coverage", "fixtures", "__fixtures__"]);

/** Files that only exercise the code under test never ship in a release build. */
function isTestFile(name: string): boolean {
  return /\.(test|spec)\./.test(name) || /\.e2e\./.test(name);
}

function collectShippedFiles(root: string, found: string[] = []): string[] {
  if (!existsSync(root)) return found;
  if (!statSync(root).isDirectory()) {
    if (!isTestFile(root)) found.push(root);
    return found;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      collectShippedFiles(abs, found);
      continue;
    }
    if (isTestFile(entry.name)) continue;
    const dot = entry.name.lastIndexOf(".");
    if (dot < 0 || !SCANNED_EXTENSIONS.has(entry.name.slice(dot))) continue;
    found.push(abs);
  }
  return found;
}

const shippedFiles = SHIPPED_ROOTS.flatMap((root) => collectShippedFiles(join(repoRoot, root)));

function readShipped(...segments: string[]): string {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

function offendersFor(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of shippedFiles) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      hits.push(`${relative(repoRoot, file)}:${line} ${match[0]}`);
    }
  }
  return hits;
}

const OPENWORKLABS_HOST = /(?:[a-z0-9-]+\.)*openworklabs\.com/gi;
/**
 * Upstream telemetry identifiers: the OpenWork PostHog project key (`phc_…`),
 * a hardcoded Sentry DSN (`https://<key>@<host>/<project>`), and the retired
 * `diagnostic.openworklabs.com` collector (also caught by the host pattern).
 */
const UPSTREAM_TELEMETRY_IDS = [
  /\bphc_[A-Za-z0-9]{24,}\b/g,
  /https:\/\/[0-9a-f]{16,}@[a-z0-9.-]*sentry\.io\/\d+/gi,
];

briefTest(testBrief({
  behavior:
    "A myai release build carries no OpenWork/Den host and no upstream telemetry identifier, "
    + "and its server base URL is build-configurable with no baked-in default host.",
  claims: {
    noShippedOpenWorkHosts: claim(
      "no shipped source or release-config file references an *.openworklabs.com host",
      { never: "a release build can resolve or advertise an OpenWork endpoint" },
    ),
    noUpstreamTelemetryIds: claim(
      "no shipped source carries an upstream PostHog project key, Sentry DSN, or diagnostics collector",
      { never: "a release build phones home to OpenWork's analytics or error collector" },
    ),
    denTargetsHostFree: claim(
      "every shipped den/control-plane default resolves to no host until build or distribution config supplies one",
      { never: "an unconfigured build silently talks to a host nobody chose" },
    ),
    buildConfigurableBaseUrl: claim(
      "the renderer and shell still read their server base URL from build config",
      { never: "the config-only redirect seam (VITE_DEN_BASE_URL, VITE_DEN_API_BASE_URL) is lost" },
    ),
    marketingBundlesUnreachable: claim(
      "no shipped entry point imports the marketing components that still hardcode OpenWork hosts",
      { never: "an unused upstream marketing URL is pulled into the release bundle" },
    ),
  },
}), async ({ prove }) => {
  expect(shippedFiles.length).toBeGreaterThan(50);

  const hosts = offendersFor(OPENWORKLABS_HOST);
  expect(hosts).toEqual([]);
  prove.noShippedOpenWorkHosts(
    hosts.length === 0,
    `scanned ${shippedFiles.length} shipped source/release-config files for openworklabs.com hosts; none found`,
  );

  const telemetry = UPSTREAM_TELEMETRY_IDS.flatMap((pattern) => offendersFor(pattern));
  expect(telemetry).toEqual([]);
  expect(readShipped("apps/app/src/app/lib/analytics-key.ts")).not.toMatch(/\bphc_[A-Za-z0-9]{24,}\b/);
  expect(readShipped("apps/app/src/app/lib/analytics-key.ts")).toContain('""');
  prove.noUpstreamTelemetryIds(
    telemetry.length === 0,
    "shipped sources carry no phc_ PostHog key, no sentry.io DSN, and no diagnostics collector host",
  );

  // Every shipped den/control-plane default must be *config-derived*, never a
  // literal host: the renderer build default, the Electron shell fallback, the
  // workspace store's hosted-candidate classification, and the headless-world
  // den target all resolve to nothing until configuration supplies an origin.
  const denSource = readShipped("apps/app/src/app/lib/den.ts");
  expect(denSource).toMatch(/VITE_DEN_BASE_URL/);
  const desktopMain = readShipped("apps/desktop/electron/main.mjs");
  expect(desktopMain).toMatch(/const DEFAULT_DEN_BASE_URL = \(process\.env\.OPENWORK_DESKTOP_DEN_BASE_URL \?\? ""\)\.trim\(\)/);
  const workspaceStore = readShipped("apps/desktop/electron/workspace-store.mjs");
  expect(workspaceStore).toMatch(/function configuredHostedDesktopOrigins\(\)/);
  expect(workspaceStore).toMatch(/process\.env\.OPENWORK_DESKTOP_HOSTED_BASE_URL/);
  expect(workspaceStore).toMatch(/process\.env\.OPENWORK_DESKTOP_HOSTED_API_URL/);
  const headlessHelpers = readShipped("packages/world/src/headless-web-helpers.ts");
  expect(headlessHelpers).toMatch(/export function normalizeDenTarget\(value: string \| undefined\): string \| null/);
  expect(headlessHelpers).toMatch(/const raw = \(value \?\? ""\)\.trim\(\);\n  if \(!raw\) return null;/);
  // No built-in borrowed origin may be trusted by the server-side probes: each
  // list is either empty or populated from administrator configuration.
  expect(readShipped("apps/server/src/agent-context-cloud-probe.ts")).toMatch(/const origins = new Set<string>\(\)/);
  expect(readShipped("apps/server/src/connect-mcp-server-catalog.ts")).toMatch(/const BUILTIN_APP_HOST_CLOUD_ORIGINS = new Set<string>\(\)/);
  expect(readShipped("apps/server/src/connect-mcp-server-catalog.ts")).toMatch(/const BUILTIN_APP_HOST_GATEWAY_PROXY_ORIGINS = new Map<string, string>\(\)/);
  const modelsUrl = readShipped("apps/server/src/opencode-models-url.ts");
  expect(modelsUrl).toMatch(/const DEFAULT_MODELS_URL = ""/);
  const feedback = readShipped("apps/app/src/app/lib/feedback.ts");
  expect(feedback).toMatch(/export const DEFAULT_FEEDBACK_URL = ENV_FEEDBACK_URL/);
  prove.denTargetsHostFree(
    true,
    "den.ts, main.mjs, workspace-store.mjs, headless-web-helpers.ts, the server trust lists and the models/feedback defaults all resolve to no host until configuration supplies one",
  );

  prove.buildConfigurableBaseUrl(
    /VITE_DEN_BASE_URL/.test(denSource) && /VITE_DEN_API_BASE_URL/.test(denSource),
    "apps/app/src/app/lib/den.ts still reads VITE_DEN_BASE_URL and VITE_DEN_API_BASE_URL, so a myai server only needs build config",
  );

  // packages/ui still ships two OpenWork marketing components with literal
  // hosts. They are owned by no WP-3 surface, so this guard's job is to keep
  // them out of the release bundle until the branding lane removes the hosts.
  const marketingSymbols = ["OpenWorkRoadmap", "roadmapSections", "DownloadOpenWorkCard", "DownloadPlatformGrid"];
  const reachable = shippedFiles.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return marketingSymbols
      .filter((symbol) => new RegExp(`\\b${symbol}\\b`).test(text))
      .map((symbol) => `${relative(repoRoot, file)} imports ${symbol}`);
  });
  expect(reachable).toEqual([]);
  prove.marketingBundlesUnreachable(
    reachable.length === 0,
    "no file under apps/app/src imports the @openwork/ui marketing components that still hardcode OpenWork hosts",
  );
});
