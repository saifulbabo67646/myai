# AGENTS.md

myai is a local-first AI workspace for doing work with AI agents on your own
files, derived from the MIT-licensed portions of OpenWork
(https://github.com/different-ai/openwork) and built on OpenCode, running any
model from 50+ providers. Two surfaces live in this repo:

* **Desktop app** (`apps/`, `packages/`) — local-first agent workspace: chat on
  files, skills, browser automation, scheduled automations, Anthropic-compatible
  plugins.
- **myai server** (Phase 1, planned: `apps/myai-server`) — self-hosted
  single-team control plane: sign-in, membership/roles, workspace registry,
  scoped runtime access in front of the loopback-only MIT `openwork-server`.

This repo contains **no OpenWork Enterprise Edition (EE) code** and never
will. The single source of truth for product, licensing, and phasing is
`docs/myai-plan.md`.

**Working as an agent here:** claim exactly one work package (WP) from
`docs/myai-plan.md` §9 — it defines the dependency graph, per-WP file
ownership, the agent contract (§9.1), and observable exit criteria. One WP =
one `wp/<id>-<slug>` branch = one PR. Never touch paths owned by another WP.

## Repo rules (must follow)

- This repo was snapshot-imported (no upstream git history). Record of origin:
  `PROVENANCE.md`.
- There is deliberately **no `upstream` remote**. Never add one; never merge
  upstream history — EE blobs must not enter `.git`.
- Upstream syncs are patch-based through the private tracking fork at
  `/Users/saiful/Desktop/work/openwork` (its `dev` branch mirrors
  `upstream/dev`). Ritual: generate an EE-excluded diff from `UPSTREAM_BASE`
  (see `PROVENANCE.md`) → apply 3-way here → re-run `node scripts/strip-ee.mjs`
  → run guard tests → update `UPSTREAM_BASE`.
- Keep the upstream file layout intact where possible. Make myai changes in
  small, separate commits to reduce future sync conflicts.
- Do not force-push the mainline except with `--force-with-lease`, and only
  when necessary.

## Licensing red lines (non-negotiable)

- Never copy, import, paraphrase, or derive from OpenWork `/ee` code —
  including schemas, migrations, tests, comments, docs, and config. It is
  under the OpenWork EE License (commercial use requires a Different AI
  subscription; copying/distribution forbidden; modifications belong to
  Different AI).
- Never modify `ee/` in the tracking fork for myai purposes.
- New myai control-plane code is independently authored (clean room): contracts
  come from requirements, `docs/myai-plan.md`, and the MIT client code — never
  from EE server sources. See docs/myai-plan.md §1.3.
- Keep the MIT copyright/permission notice (LICENSE) in source and binary
  distributions; ship NOTICE. No OpenWork trademark use beyond origin
  attribution.
- Shipped builds must not advertise OpenWork hosts (`*.openworklabs.com`),
  product names, gateway headers, or release repositories.

## Confidentiality (hard rule — this repo is public)

- The only proof path is `evals/specs/**/*.test.ts` with `test` from
  `@openwork/testkit`; app-driving E2E tests use `.e2e.test.ts`. Prose,
  screenshots, and recordings never decide pass/fail — test evidence does.
- Skills own the mechanics: `prove-a-pr` → `write-a-spec` → `run-tests` →
  `diagnose-a-red-run` when red → `publish-evidence`. Evidence is ambient; never
  create or pass test-evidence recorder handles.
- Verdicts: `Passed` only when every claim has an observable assertion in the
  test run; otherwise `Incomplete` or `Failed` with repro steps. Skips are never
  passed.
- EE-dependent eval specs were removed at import; the Daytona lane and Den
  eval infrastructure are dormant (allow-listed in `scripts/strip-ee.mjs`).
  Local runs are the expected path until the myai server exists.
- Docs/comments, types-only, and inert agent config may skip runtime proof —
  say so.

## Pull requests

- Do not default to draft PRs. A request to create or make a PR means a
  ready-for-review PR once the required proof is published. Use a draft only
  when the requester explicitly asks for one or the current verdict is
  `Incomplete` or `Failed`, and state exactly what proof is missing.
- Run tests and report commands + results. A runtime-observable change is not
  done until its test evidence is visible on the PR. If validation cannot run,
  say why and give exact repro steps.

## Local headless web (agents)

- `pnpm world up ./worlds/dev-headless.ts` launches an isolated browser UI +
  local `openwork-server` without Electron, detached by the world definition.
  `pnpm dev:headless-web` remains a compatibility alias with its prior
  foreground default (`--detach` still works). Read `tmp/dev-headless-web.json`
  for `webUrl`, tokens, and logs. Cloud/Den sign-in surfaces are disabled in
  myai builds (docs/myai-plan.md §5).

## Coding

* pnpm only, never npm/yarn. TypeScript: never `any`, typecasts, or `as` unless
  100% necessary or instructed.
* Prefer Tailwind, React, shadcn/ui (Base UI), TanStack Query, Zustand, Zod,
  Drizzle, Better-Auth. Reuse `@/components`; end users are non-technical.
- Smallest possible diff, then make it smaller. Propose the simpler solution.
  No fallback expressions when types or control flow already guarantee a value.
- If asked to do too much at once, stop and say so.
