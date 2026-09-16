import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { briefTest, claim, testBrief } from "@openwork/testkit";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function readRepoFile(...segments: string[]): string {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

function collectManifests(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) collectManifests(abs, found);
    else if (entry.name === "package.json") found.push(abs);
  }
  return found;
}

const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const EE_SCOPE = "@openwork-ee" + "/";

// strip-ee.mjs exempts these paths from its own EE scan; the exemption is only
// honest while the file is there to be scanned.
function readDormantAllowlist(): string[] {
  const block = readRepoFile("scripts", "strip-ee.mjs").match(/const DORMANT_ALLOWLIST = \[([\s\S]*?)\n\];/)?.[1];
  if (block === undefined) {
    throw new Error("scripts/strip-ee.mjs declares no DORMANT_ALLOWLIST array");
  }
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

briefTest(testBrief({
  behavior: "The myai repository boundary stays provably free of OpenWork Enterprise Edition code.",
  claims: {
    noEeTree: claim("no ee/ directory exists in the working tree", {
      never: "an ee/ tree reappears without the guard failing",
    }),
    noEeDependencies: claim("no workspace package.json depends on any EE-scoped package", {
      never: "an EE package enters the dependency graph of shipped code",
    }),
    noEeInHistory: claim("no path under ee/ exists anywhere in git history", {
      never: "EE blobs are reachable from any commit of this repository",
    }),
    workspacePruned: claim("pnpm-workspace.yaml declares no ee workspace globs", {
      never: "the workspace resolves EE packages",
    }),
    noticesPresent: claim("LICENSE keeps the Different AI MIT notice and NOTICE ships attribution", {
      never: "MIT attribution requirements are dropped from the distribution",
    }),
    allowlistHonest: claim("every dormant allow-list entry in strip-ee.mjs names a file that exists", {
      never: "a stale entry keeps a deleted path exempt from the EE scan",
    }),
  },
}), async ({ prove }) => {
  expect(existsSync(join(repoRoot, "ee"))).toBe(false);
  prove.noEeTree(true, `readdir of the repo root shows no ee/ directory (${repoRoot})`);

  const offenders: string[] = [];
  const manifests = [
    join(repoRoot, "package.json"),
    ...["apps", "packages", "evals", "worlds"].flatMap((dir) => collectManifests(join(repoRoot, dir))),
  ];
  for (const manifest of manifests) {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    for (const field of DEP_FIELDS) {
      const deps = parsed[field] as Record<string, string> | undefined;
      for (const name of Object.keys(deps ?? {})) {
        if (name.startsWith(EE_SCOPE)) offenders.push(`${relative(repoRoot, manifest)} ${field} ${name}`);
      }
    }
  }
  expect(offenders).toEqual([]);
  prove.noEeDependencies(offenders.length === 0, `scanned ${manifests.length} workspace package.json dependency fields for the EE scope; none found`);

  const history = execFileSync("git", ["log", "--all", "--pretty=format:", "--name-only"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const eeHistoryPaths = [...new Set(history.split("\n").filter((line) => line.startsWith("ee/")))];
  expect(eeHistoryPaths).toEqual([]);
  prove.noEeInHistory(eeHistoryPaths.length === 0, "git log --all --name-only lists no path under ee/ in any commit");

  const workspace = readRepoFile("pnpm-workspace.yaml");
  expect(workspace).not.toMatch(/ee\/(apps|packages)/);
  prove.workspacePruned(true, "pnpm-workspace.yaml contains no ee/apps or ee/packages globs");

  const license = readRepoFile("LICENSE");
  expect(license).toContain("MIT License");
  expect(license).toContain("Copyright (c) 2026 Different AI");
  expect(license).toContain("Permission is hereby granted, free of charge");
  const notice = readRepoFile("NOTICE");
  expect(notice).toContain("Different AI, Inc.");
  expect(notice).toContain("does not include OpenWork Enterprise Edition");
  prove.noticesPresent(true, "LICENSE reproduces the Different AI MIT notice; NOTICE states EE-free derivation");

  const dormantAllowlist = readDormantAllowlist();
  expect(dormantAllowlist).toContain("evals/specs/myai-ee-free-boundary.test.ts");
  const staleEntries = dormantAllowlist.filter((entry) => !existsSync(join(repoRoot, entry)));
  expect(staleEntries).toEqual([]);
  prove.allowlistHonest(staleEntries.length === 0, `all ${dormantAllowlist.length} dormant allow-list entries name files that exist`);
});
