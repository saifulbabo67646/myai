#!/usr/bin/env node
/**
 * strip-ee.mjs — make this repo provably EE-free.
 *
 * Removes every trace of the OpenWork Enterprise Edition (`/ee`, Fair Source /
 * EE License) and Den-only tooling from the working tree: directories, build
 * config entries, root scripts, CI workflows, packaging, and EE-driven eval
 * specs. Idempotent: safe to re-run after every upstream sync (see
 * docs/myai-plan.md §2). Never run this against a tree you did not import.
 *
 * Usage: node scripts/strip-ee.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const actions = [];
const log = (line) => actions.push(line);

function removePath(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return;
  rmSync(abs, { recursive: true, force: true });
  log(`removed ${rel}`);
}

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function writeText(rel, content) {
  writeFileSync(join(ROOT, rel), content);
}

/** Drop lines matching any pattern; returns count removed. */
function filterLines(rel, patterns, description) {
  if (!existsSync(join(ROOT, rel))) return 0;
  const before = readText(rel);
  const lines = before.split("\n");
  const kept = lines.filter((line) => !patterns.some((p) => p.test(line)));
  const removed = lines.length - kept.length;
  if (removed > 0) {
    writeText(rel, kept.join("\n"));
    log(`${rel}: dropped ${removed} line(s) — ${description}`);
  }
  return removed;
}

/** Apply exact-string replacements; tolerant of already-applied state. */
function replaceOnce(rel, replacements) {
  if (!existsSync(join(ROOT, rel))) return;
  let text = readText(rel);
  for (const [from, to, label] of replacements) {
    if (!text.includes(from)) {
      // Deletions (empty `to`) are re-checked by the final EE scan, so a
      // missing pattern just means "already stripped".
      if (!to || text.includes(to)) {
        log(`${rel}: already applied (${label})`);
        continue;
      }
      log(`WARNING ${rel}: pattern not found (${label}) — inspect manually`);
      continue;
    }
    text = text.replace(from, to);
    log(`${rel}: ${label}`);
  }
  writeText(rel, text);
}

// ---------------------------------------------------------------------------
// 1. EE directories and Den-only files
// ---------------------------------------------------------------------------
removePath("ee");
removePath("packaging/helm/openwork-ee");
if (existsSync(join(ROOT, "packaging/helm")) && readdirSync(join(ROOT, "packaging/helm")).length === 0) {
  removePath("packaging/helm");
}
for (const rel of [
  "packaging/docker/Dockerfile.den",
  "packaging/docker/Dockerfile.den-gateway",
  "packaging/docker/Dockerfile.den-web",
  "packaging/docker/Dockerfile.inference",
  "packaging/docker/den-dev-up.sh",
  "packaging/docker/docker-compose.den-dev.yml",
  "packaging/docker/docker-compose.web-local.yml",
  "packaging/docker/docker-compose.dev.yml",
  "packaging/docker/docker-compose.eval.yml",
  "packaging/docker/otel-hono-live-validate.mjs",
  "packaging/docker/otel-hono-live-validate.sh",
  "scripts/dev-local.mjs",
  "scripts/dev-web-local.sh",
  "scripts/dev-den-local.sh",
  "scripts/check-connect-installer-parity.mjs",
  "scripts/create-daytona-openwork-snapshot.sh",
  "scripts/release/generate-desktop-versions.mjs",
  "scripts/release/generate-desktop-versions.test.mjs",
  ".env.dev",
  ".github/workflows/publish-ee-images.yml",
  ".github/workflows/den-db-check.yml",
  ".github/workflows/den-db-migrate.yml",
  ".github/workflows/dev-daytona-snapshot.yml",
  ".github/workflows/release-daytona-snapshot.yml",
  ".github/workflows/update-models.yml",
  "evals/scripts/dev-den.ts",
  // Patch consumed only by EE den-db; pnpm errors on unused patches.
  "patches/@better-auth__drizzle-adapter@1.7.0-beta.10.patch",
  // spec-impact tool test uses ee fixture paths; port with MIT fixtures later.
  "evals/specs/spec-impact.test.ts",
  "LICENSES/LicenseRef-OpenWork-EE.txt",
  // Superseded planning docs (kept out of re-imports on future syncs).
  "docs/myai-pilot-plan.md",
  "docs/superpowers",
]) {
  removePath(rel);
}

// ---------------------------------------------------------------------------
// 2. Workspace, task runner, and package script pruning
// ---------------------------------------------------------------------------
filterLines("pnpm-workspace.yaml", [/"ee\/(apps|packages)\/\*"/], "ee workspace globs");
filterLines(
  "pnpm-workspace.yaml",
  [/@better-auth\/drizzle-adapter@1\.7\.0-beta\.10/],
  "EE-only patchedDependencies entry",
);

function pruneScripts(rel, extraDenyList = []) {
  if (!existsSync(join(ROOT, rel))) return;
  const manifest = JSON.parse(readText(rel));
  const scripts = manifest.scripts ?? {};
  const eeValue = /@openwork-ee|\bdev:den\b|dev:den:|den-dev-up|docker-compose\.web-local|scripts\/dev-local\.mjs|scripts\/dev-den\.ts|enterprise-mock-lab|@openwork-ee\/diagnostics/;
  let removed = 0;
  for (const name of Object.keys(scripts)) {
    if (extraDenyList.includes(name) || eeValue.test(name) || eeValue.test(scripts[name])) {
      delete scripts[name];
      removed += 1;
    }
  }
  if (removed > 0) {
    writeText(rel, JSON.stringify(manifest, null, 2) + "\n");
    log(`${rel}: pruned ${removed} script entr(ies)`);
  }
}
pruneScripts("package.json", ["dev:web", "dev:web-local", "build:web"]);
pruneScripts("evals/package.json", ["dev:den"]);

// turbo.json: keep only OPENWORK_* global env (the rest is Den/EE-only).
if (existsSync(join(ROOT, "turbo.json"))) {
  const turbo = JSON.parse(readText("turbo.json"));
  const before = turbo.globalEnv?.length ?? 0;
  turbo.globalEnv = (turbo.globalEnv ?? []).filter((name) => name.startsWith("OPENWORK_"));
  if (turbo.globalEnv.length !== before) {
    writeText("turbo.json", JSON.stringify(turbo, null, 2) + "\n");
    log(`turbo.json: globalEnv ${before} -> ${turbo.globalEnv.length} (Den/EE vars dropped)`);
  }
}

// ---------------------------------------------------------------------------
// 3. Licensing metadata (REUSE)
// ---------------------------------------------------------------------------
replaceOnce("REUSE.toml", [
  [
    `# Mirrors the human-readable statement in /LICENSE: everything is MIT except
# the ee/ directory, which is under the OpenWork EE License (see ee/LICENSE
# and LICENSES/LicenseRef-OpenWork-EE.txt). Third-party components keep their
# original licenses per their own notices.`,
    `# Mirrors the human-readable statement in /LICENSE: everything is MIT.
# This repo contains no OpenWork EE-licensed code (see docs/myai-plan.md).
# Third-party components keep their original licenses per their own notices.`,
    "REUSE header comment",
  ],
  [
    `

[[annotations]]
path = "ee/**"
precedence = "closest"
SPDX-FileCopyrightText = "2026-present Different AI, Inc."
SPDX-License-Identifier = "LicenseRef-OpenWork-EE"`,
    "",
    "drop ee annotation block",
  ],
]);

// ---------------------------------------------------------------------------
// 4. CI workflow trims (keep MIT-only CI intact)
// ---------------------------------------------------------------------------
filterLines(
  ".github/workflows/ci-enterprise-mcp-mock.yml",
  [/enterprise-mock-lab/, /Check standalone mock lab/],
  "EE mock-lab paths, filters, and step",
);

// ---------------------------------------------------------------------------
// 5. Devcontainer: drop Den services from the local service bootstrap
// ---------------------------------------------------------------------------
filterLines(
  ".devcontainer/start-services.sh",
  [/@openwork-ee|dev:den:|den-db/],
  "den service bootstrap lines",
);

filterLines("scripts/find-unused.sh", [/^\s*"ee\//], "ee path allowlist entries");

// ---------------------------------------------------------------------------
// 5b. Shipped-code comment rewrites (no `ee/` pointers in artifacts)
// ---------------------------------------------------------------------------
replaceOnce("apps/desktop/electron/main.mjs", [
  [
    "// Keep in sync with ee/apps/den-api/src/brand-icon-validation.ts so logo CDNs",
    "// Keep in sync with the hosted control plane's brand-icon validation so logo CDNs",
    "brand-icon comment",
  ],
]);
replaceOnce("apps/server/src/cloud-provider-sync.ts", [
  [
    `// Ported from ee/apps/den-api/src/llm/cloud-provider-materialization.ts.
// Keep local: the open-source server must never depend on ee modules.`,
    `// Ported from the hosted control plane's cloud-provider materialization.
// Keep local: the open-source server must never depend on control-plane modules.`,
    "ported-from comment",
  ],
]);
replaceOnce("packages/openwork-bootstrap/bin/openwork.mjs", [
  [
    "    // port on the same host (see ee/apps/den-web's /api/den proxy). Callers",
    "    // port on the same host (see the hosted web app's /api/den proxy). Callers",
    "den-web proxy comment",
  ],
]);

// ---------------------------------------------------------------------------
// 6. Evals: surgical EE removal in shared runner, then EE spec sweep
// ---------------------------------------------------------------------------
replaceOnce("evals/runner/prepare-stack.ts", [
  [
    'console.error("[openwork/evals] preparing shared local Den and Electron runtime once...");',
    'console.error("[openwork/evals] preparing shared local Electron runtime once...");',
    "banner text",
  ],
  [
    `  await run("pnpm", ["--filter", "@openwork-ee/den-db", "build"]);\n`,
    "",
    "drop den-db build",
  ],
  [
    `    run("pnpm", ["--filter", "@openwork-ee/utils", "build"]),\n`,
    "",
    "drop ee utils build",
  ],
  [
    `  const nextEnvPath = join(REPO_ROOT, "ee/apps/den-web/next-env.d.ts");
  const hadNextEnv = await readable(nextEnvPath);
  const nextEnv = hadNextEnv ? await readFile(nextEnvPath) : null;
  try {
    await run("pnpm", ["--filter", "@openwork-ee/den-web", "build"]);
  } finally {
    if (nextEnv) await writeFile(nextEnvPath, nextEnv);
    else if (!hadNextEnv) await rm(nextEnvPath, { force: true });
  }
  await rm(join(REPO_ROOT, "ee/apps/den-web/.next/dev"), { recursive: true, force: true });
`,
    "",
    "drop den-web build block",
  ],
]);

const specEEPattern = /@openwork-ee|ee\/apps|ee\/packages|selfHost|den-stack/;
// The boundary guard quotes EE identifiers on purpose; never sweep it.
const SPEC_SWEEP_EXEMPT = new Set(["myai-ee-free-boundary.test.ts"]);
function sweepSpecs(dir) {
  if (!existsSync(dir)) return [];
  const removed = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      removed.push(...sweepSpecs(abs));
    } else if (
      entry.name.endsWith(".test.ts")
      && !SPEC_SWEEP_EXEMPT.has(entry.name)
      && specEEPattern.test(readFileSync(abs, "utf8"))
    ) {
      rmSync(abs);
      removed.push(relative(ROOT, abs));
    }
  }
  return removed;
}
const removedSpecs = sweepSpecs(join(ROOT, "evals", "specs"));
if (removedSpecs.length > 0) {
  log(`removed ${removedSpecs.length} EE-dependent eval spec(s)`);
  for (const spec of removedSpecs) log(`  - ${spec}`);
}

// Prune the spec-impact contract snapshot: drop `ee/` globs and references to
// spec files that no longer exist. Keeps evals/scripts/spec-impact.mjs (used by
// CI workflows) consistent with the stripped tree.
const snapshotRel = "evals/specs/contracts.snapshot.json";
if (existsSync(join(ROOT, snapshotRel))) {
  const snapshot = JSON.parse(readText(snapshotRel));
  let dropped = 0;
  const walk = (value) => {
    if (!Array.isArray(value)) {
      if (value && typeof value === "object") for (const key of Object.keys(value)) walk(value[key]);
      return;
    }
    for (let index = value.length - 1; index >= 0; index--) {
      const item = value[index];
      if (typeof item === "string") {
        const isEE = item.startsWith("ee/");
        const isMissingSpec =
          item.startsWith("evals/specs/") && item.endsWith(".test.ts") && !existsSync(join(ROOT, item));
        if (isEE || isMissingSpec) {
          value.splice(index, 1);
          dropped += 1;
        }
      } else {
        walk(item);
      }
    }
  };
  walk(snapshot);
  if (dropped > 0) {
    writeText(snapshotRel, JSON.stringify(snapshot, null, 2) + "\n");
    log(`${snapshotRel}: dropped ${dropped} ee glob / missing-spec entr(ies)`);
  }
}

// ---------------------------------------------------------------------------
// 7. Verification report
// ---------------------------------------------------------------------------
if (existsSync(join(ROOT, "ee"))) {
  console.error("FATAL: ee/ still exists after strip.");
  process.exit(1);
}

// Dormant, string-level EE references that compile and never ship. They belong
// to the Daytona eval lane and mock drivers; listed so the guard test can
// allow-list exactly these and nothing else.
const DORMANT_ALLOWLIST = [
  "evals/specs/myai-ee-free-boundary.test.ts",
  "evals/drivers/posthog-capture-mock.mjs",
  "evals/packages/behaviors/src/cloud-plugins.ts",
  "evals/packages/env/src/den.ts",
  "evals/packages/env/src/kind-stack.ts",
  "evals/packages/hosts/src/den-stack.ts",
  "evals/packages/testkit/src/self-host.ts",
  "evals/runner/prepare-stack.ts",
  "evals/scripts/provision-org-connector-two-members.ts",
  ".devcontainer/start-daytona-server.sh",
];
const scanDirs = ["apps", "packages", "scripts", "worlds", "evals", "packaging", ".github", ".devcontainer"];
const leftovers = [];
const SCAN_SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", ".turbo", "results", "test-runs", "tmp",
]);
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SCAN_SKIP_DIRS.has(entry.name)) continue; // generated output; git history guard covers tracked content
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) scan(abs);
    else if (/\.(ts|tsx|mjs|cjs|js|json|yml|yaml|sh|toml)$/.test(entry.name)) {
      const rel = relative(ROOT, abs);
      if (rel === "scripts/strip-ee.mjs") continue; // this script's own patterns
      if (DORMANT_ALLOWLIST.includes(rel)) continue;
      if (/@openwork-ee|(^|[^.\w])ee\/(apps|packages|LICENSE)/m.test(readFileSync(abs, "utf8"))) {
        leftovers.push(rel);
      }
    }
  }
}
for (const dir of scanDirs) {
  const abs = join(ROOT, dir);
  if (existsSync(abs)) scan(abs);
}

console.log(actions.map((line) => `  ${line}`).join("\n"));
console.log(`\nstrip-ee: ${actions.length} action(s).`);
if (leftovers.length > 0) {
  console.log(`\nEE references remaining outside the dormant allowlist (${leftovers.length}):`);
  for (const rel of leftovers) console.log(`  ! ${rel}`);
  process.exitCode = 2;
} else {
  console.log("EE reference scan: clean (only allow-listed dormant eval infra remains).");
}
// Keep execFileSync imported for future history-scan usage without lint noise.
void execFileSync;
