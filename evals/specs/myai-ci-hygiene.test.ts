import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { briefTest, claim, testBrief } from "@openwork/testkit";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const githubDirectory = join(repoRoot, ".github");
const workflowsDirectory = join(githubDirectory, "workflows");

// strip-ee.mjs deletes any eval spec whose text matches its EE patterns, so the
// EE scope is assembled here instead of written literally — this guard must
// survive every upstream sync to keep guarding .github/.
const EE_SCOPE = ["@openwork", "ee"].join("-");

// Upstream-only CI infrastructure: paid runners, upstream hosts and secret
// names, the Daytona eval lane, review-app deploys, and Den services (EE).
const FORBIDDEN_INFRA = [
  "blacksmith",
  "openworklabs",
  "daytona",
  "vercel",
  "den-api",
  "den-web",
  "den-gateway",
  "den-worker",
  EE_SCOPE,
];

const REQUIRED_LANES: Array<[string, RegExp]> = [
  ["push and pull_request on main", /on:[\s\S]*?push:[\s\S]*?pull_request:[\s\S]*?- main/],
  ["frozen workspace install", /pnpm install --frozen-lockfile/],
  ["frozen evals install", /pnpm --dir evals install --frozen-lockfile/],
  ["root typecheck", /pnpm typecheck/],
  ["EE-free boundary guard", /vitest run --project pr specs\/myai-ee-free-boundary\.test\.ts/],
  ["CI hygiene guard", /vitest run --project pr specs\/myai-ci-hygiene\.test\.ts/],
];

function filesUnder(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) filesUnder(absolute, found);
    else found.push(absolute);
  }
  return found;
}

briefTest(testBrief({
  behavior: "myai CI stays one slim pipeline on GitHub-hosted runners, free of upstream infrastructure.",
  claims: {
    singleWorkflow: claim("only .github/workflows/myai-ci.yml runs CI", {
      never: "an upstream workflow returns unnoticed after a sync",
    }),
    noUpstreamInfra: claim("no file under .github/ names upstream runners, hosts, eval lanes, or Den", {
      never: "upstream infrastructure silently rejoins the pipeline",
    }),
    requiredLanes: claim("myai-ci.yml gates a PR on install, typecheck, and both myai guard specs", {
      never: "the merge gate loses a lane without the guard failing",
    }),
  },
}), async ({ prove }) => {
  const workflows = readdirSync(workflowsDirectory).sort();
  expect(workflows).toEqual(["myai-ci.yml"]);
  prove.singleWorkflow(true, `.github/workflows lists exactly ${JSON.stringify(workflows)}`);

  const files = filesUnder(githubDirectory);
  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8").toLowerCase();
    for (const token of FORBIDDEN_INFRA) {
      if (text.includes(token)) offenders.push(`${relative(repoRoot, file)} names ${token}`);
    }
  }
  expect(offenders).toEqual([]);
  prove.noUpstreamInfra(offenders.length === 0, `scanned ${files.length} files under .github/ for ${FORBIDDEN_INFRA.length} forbidden tokens; none found`);

  const workflow = readFileSync(join(workflowsDirectory, "myai-ci.yml"), "utf8");
  const missing = REQUIRED_LANES.filter(([, pattern]) => !pattern.test(workflow)).map(([lane]) => lane);
  expect(missing).toEqual([]);
  prove.requiredLanes(missing.length === 0, `myai-ci.yml declares all ${REQUIRED_LANES.length} required lanes`);
});
