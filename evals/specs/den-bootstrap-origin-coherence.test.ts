import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "@openwork/testkit";
import { expect } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Desktop bootstrap and retained Den session must stay origin-coherent.
 *
 * The renderer suite this spec runs boots the real Den settings module
 * against deterministic loopback control-plane witnesses (real HTTP servers
 * that record every Authorization header they receive) and a scriptable shell
 * bridge, covering the full matrix:
 *
 * 1. a valid preload bootstrap resolves immediately and its matching session
 *    reaches its own origin with a bearer token;
 * 2. a retained token with an unresolved bootstrap produces zero
 *    credential-bearing requests to any origin;
 * 3. the unresolved fallback is never persisted or treated as an
 *    authoritative hosted selection, and the quarantined session survives;
 * 4. delayed resolution of the same self-hosted bootstrap (quick retry and
 *    background heal) re-enables the matching token and organization;
 * 5. resolution to a different origin quarantines the retained token and
 *    organization — neither origin receives a credentialed request;
 * 6. a late bootstrap result from an obsolete startup generation cannot
 *    replace the current generation;
 * 7. an explicitly configured hosted session keeps working;
 * 8. local-only startup stays usable while Den bootstrap is unresolved;
 * 9. quarantine diagnostics never contain the retained secret.
 */
test("desktop bootstrap and retained Den session stay origin-coherent", ({ evidence }) => {
  const run = spawnSync("pnpm", [
    "--dir",
    "apps/app",
    "exec",
    "bun",
    "test",
    "--isolate",
    "tests/den-bootstrap-origin-coherence.test.ts",
  ], { cwd: repoRoot, encoding: "utf8" });
  const output = `${run.stdout}${run.stderr}`;
  expect(run.error, output).toBeUndefined();
  expect(run.status, output).toBe(0);
  expect(output).toContain("13 pass");
  expect(output).toContain("0 fail");

  evidence.recordAssertionEvidence(
    "One resolved enrollment generation owns every credential-bearing Den request",
    "With deterministic origin witnesses, the retained token only ever reaches the origin recorded as its issuer, and only after the bootstrap resolved to that same origin.",
    run.status === 0,
  );
  evidence.recordAssertionEvidence(
    "An unresolved or mismatched bootstrap origin receives no credential-bearing request",
    "While the shell bootstrap is unavailable, and when it resolves to a different origin, the HTTP witnesses record zero requests carrying an Authorization header and the hosted fallback is never persisted as an authoritative selection.",
    run.status === 0,
  );
  evidence.recordAssertionEvidence(
    "Quarantine is recoverable and local startup stays usable",
    "The retained session survives quarantine in storage, delayed resolution of its own origin re-enables it, obsolete startup generations are discarded, and logged-out or local-only startup completes without Den authentication.",
    run.status === 0,
  );
});
