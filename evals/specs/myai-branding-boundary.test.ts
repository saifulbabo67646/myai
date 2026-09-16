import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { briefTest, claim, testBrief } from "@openwork/testkit";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// The upstream brand matched as a word. Internal identifiers we keep on purpose
// (OpenWorkExtensionManifest, X-OpenWork-Host-Token, @openwork/*, OPENWORK_*,
// openwork-server) do not match, and neither do lowercase host spellings. No
// leading word boundary on purpose: a mention right after an escape sequence
// ("…\n\nOpenWork could not…") is still user-visible, and a \b-anchored scan
// misses it.
const BRAND = /OpenWork(?![A-Za-z0-9_-])/g;

// Nominative origin attribution is required (LICENSE/NOTICE, plan §1.4), so the
// front door may name the upstream project only on lines like these.
const ATTRIBUTION: RegExp[] = [
  /derived from\s+OpenWork/i,
  /different-ai\/openwork/i,
  /Different AI/i,
  /OpenWork Enterprise Edition/,
  /trademark/i,
  /upstream/i,
];

// myai-owned prose a reader meets before any code.
const FRONT_DOOR = ["README.md", "SUPPORT.md", "translated_readmes"];

// Frozen branding debt: counts may shrink, never grow (plan §6 — the Phase 0
// guard stops branding regressions on every upstream sync). Each area is
// recorded with the work that removes it; the number is the brand-as-word
// count on the WP-5 base commit.
const BRAND_DEBT: Array<{ area: string; baseline: number; removal: string }> = [
  {
    area: "apps/app/src/i18n/locales",
    baseline: 248,
    removal: "cloud/Den strings go with the WP-3 surface removal; the server-name strings need a naming pass",
  },
  {
    area: "apps/app/src/react-app",
    baseline: 172,
    removal: "cloud, connections, and settings surfaces owned by WP-3/WP-6",
  },
  { area: "apps/app/src/components", baseline: 10, removal: "chat/tool surfaces owned by WP-3" },
  { area: "apps/app/src/app", baseline: 18, removal: "den/workspace-endpoint surfaces owned by WP-3" },
  { area: "apps/server/src", baseline: 345, removal: "cloud probe and capability plugins owned by WP-3" },
  { area: "apps/desktop/electron", baseline: 25, removal: "shell surfaces owned by WP-3/WP-6" },
  { area: "packages", baseline: 228, removal: "unassigned; naming pass across shared packages" },
  {
    area: "docs",
    baseline: 394,
    removal: "upstream engineering/EE design notes; a trim decision under DEC-3, not a rename",
  },
  { area: "changelog", baseline: 95, removal: "upstream release history; keep or archive as history" },
  {
    area: "packages/docs",
    baseline: 1023,
    removal: "published upstream docs site; not in WP-5's ownership list",
  },
  {
    area: ".",
    baseline: 15,
    removal: "root governance files (AGENTS.md, CONTRIBUTING.md, SECURITY.md, …); not in WP-5's ownership list",
  },
];

// Generated output is never a user-visible surface (mirrors strip-ee.mjs's scan).
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".turbo",
  "results",
  "test-runs",
  "tmp",
]);

function walk(directory: string, predicate: (name: string) => boolean, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, predicate, found);
    else if (predicate(entry.name)) found.push(absolute);
  }
  return found;
}

function countBrand(text: string): number {
  return text.match(BRAND)?.length ?? 0;
}

function brandLines(file: string): Array<{ line: number; text: string }> {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((text, index) => (countBrand(text) > 0 ? [{ line: index + 1, text: text.trim() }] : []));
}

briefTest(testBrief({
  behavior: "myai's user-visible surfaces name myai, and the upstream project stays visible only where attribution requires it.",
  claims: {
    frontDoorAttributed: claim("README, SUPPORT, and the translated readmes name the upstream project only in attribution",
      { never: "the front door markets the upstream product again" }),
    identityClean: claim("installer permission strings, app names, and the welcome title carry the myai name",
      { never: "a shipped identity surface reintroduces the upstream brand" }),
    assetsRemoved: claim("the upstream demo gif and logo are gone and unreferenced",
      { never: "removed upstream marketing assets return" }),
    debtOnlyShrinks: claim("recorded branding debt per area never grows",
      { never: "an upstream sync or a new file adds user-visible upstream naming" }),
    attributionIntact: claim("LICENSE, NOTICE, and README keep the Different AI attribution",
      { never: "required MIT attribution is dropped while renaming" }),
  },
}), async ({ prove }) => {
  // 1. Front door: strict, attribution-only.
  const frontDoorOffenders: string[] = [];
  const frontDoorFiles = FRONT_DOOR.flatMap((entry) => {
    const absolute = join(repoRoot, entry);
    return absolute.endsWith(".md") ? [absolute] : walk(absolute, (name) => name.endsWith(".md"));
  });
  for (const file of frontDoorFiles) {
    for (const { line, text } of brandLines(file)) {
      if (!ATTRIBUTION.some((pattern) => pattern.test(text))) {
        frontDoorOffenders.push(`${relative(repoRoot, file)}:${line}: ${text.slice(0, 100)}`);
      }
    }
  }
  expect(frontDoorOffenders).toEqual([]);
  prove.frontDoorAttributed(true, `scanned ${frontDoorFiles.length} front-door files; every upstream mention is attribution`);

  // 2. Shipped identity surfaces.
  const identityOffenders: string[] = [];
  const installerFiles = walk(join(repoRoot, "apps/desktop"), (name) => /^electron-builder.*\.yml$/.test(name));
  for (const file of installerFiles) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (/^\s*(NS\w*UsageDescription|productName|artifactName|executableName|publisherName|copyright):/.test(line) && countBrand(line) > 0) {
        identityOffenders.push(`${relative(repoRoot, file)}: ${line.trim()}`);
      }
    }
  }
  const distribution = readFileSync(join(repoRoot, "apps/desktop/electron/desktop-distribution.mjs"), "utf8");
  for (const line of distribution.split("\n")) {
    if (/^\s*appName:/.test(line) && countBrand(line) > 0) identityOffenders.push(`desktop-distribution.mjs: ${line.trim()}`);
  }
  const welcomeTitle = readFileSync(join(repoRoot, "apps/app/src/i18n/locales/en.ts"), "utf8")
    .split("\n")
    .find((line) => line.includes('"welcome.title"'));
  expect(welcomeTitle).toBeDefined();
  if (welcomeTitle && countBrand(welcomeTitle) > 0) identityOffenders.push(`en.ts: ${welcomeTitle.trim()}`);
  expect(identityOffenders).toEqual([]);
  prove.identityClean(true, `checked ${installerFiles.length} installer manifests, distribution app names, and the welcome title`);

  // 3. Upstream marketing assets are gone and unreferenced.
  const removedAssets = ["app-demo.gif", "openwork-logo-transparent.svg"];
  const stillPresent = removedAssets.filter((asset) => existsSync(join(repoRoot, asset)));
  expect(stillPresent).toEqual([]);
  const references = walk(repoRoot, (name) => /\.(md|mdx|json|ts|tsx|mjs|yml|yaml)$/.test(name))
    .filter((file) => !["docs/myai-plan.md", "evals/specs/myai-branding-boundary.test.ts"].includes(relative(repoRoot, file)))
    .filter((file) => removedAssets.some((asset) => readFileSync(file, "utf8").includes(asset)))
    .map((file) => relative(repoRoot, file));
  expect(references).toEqual([]);
  prove.assetsRemoved(true, `neither ${removedAssets.join(" nor ")} exists or is referenced outside the plan`);

  // 4. Frozen debt: every recorded area stays at or under its baseline.
  // Test files are excluded (they assert on the brand, they do not present it),
  // and packages/docs is counted by its own entry rather than inside packages/.
  const grew: string[] = [];
  for (const { area, baseline } of BRAND_DEBT) {
    const files = (area === "."
      // Root governance markdown only: README.md and SUPPORT.md are held to the
      // stricter attribution rule above, so they are not counted here.
      ? readdirSync(repoRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !["README.md", "SUPPORT.md"].includes(entry.name))
        .map((entry) => join(repoRoot, entry.name))
      : walk(join(repoRoot, area), (name) => /\.(ts|tsx|mjs|js|cjs|md|mdx|json)$/.test(name) && !/\.test\./.test(name))
    ).filter((file) => !(area === "packages" && relative(repoRoot, file).startsWith("packages/docs/")));
    const total = files.reduce((sum, file) => sum + countBrand(readFileSync(file, "utf8")), 0);
    if (total > baseline) grew.push(`${area}: ${baseline} → ${total}`);
  }
  expect(grew).toEqual([]);
  prove.debtOnlyShrinks(true, `${BRAND_DEBT.length} recorded areas are at or under baseline (${BRAND_DEBT.reduce((sum, entry) => sum + entry.baseline, 0)} brand mentions)`);

  // 5. Attribution survives the rename.
  const license = readFileSync(join(repoRoot, "LICENSE"), "utf8");
  const notice = readFileSync(join(repoRoot, "NOTICE"), "utf8");
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  expect(license).toContain("derived from OpenWork");
  expect(license).toContain("Different AI");
  expect(notice).toContain("different-ai/openwork");
  expect(notice).toContain("Different AI, Inc.");
  expect(readme).toMatch(/derived from\s+OpenWork/i);
  prove.attributionIntact(true, "LICENSE and NOTICE keep the Different AI MIT notice; README states the origin");
});
