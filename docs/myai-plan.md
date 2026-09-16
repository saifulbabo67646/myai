# myai Master Plan — Single Source of Truth

- Status: Active plan (consolidated)
- Date: 2026-09-16
- Supersedes (deleted): `docs/superpowers/specs/2026-09-16-myai-self-hosted-single-team-design.md`,
  `docs/myai-subscription-usage-planning.md`, `docs/myai-pilot-plan.md`
- Kept as reference only: `docs/myai-desktop-cloud-feature-reference.md` (feature inventory of the
  upstream app; learning material, not a plan)
- Home: this document moves to the **new myai repo** (Section 2) as soon as it is created. The
  existing fork (`different-ai/openwork` → `saifulbabo67646/myai`) is retired to
  **inspiration/learning/reference** and receives no further product work.

---

## 1. Product and licensing foundation

### 1.1 What myai is (Phase 1 shape)

A local-first AI workspace: the MIT desktop app (Electron + React renderer + `openwork-server`
runtime + OpenCode engine), plus a **self-hosted myai server** providing single-team sign-in,
membership/roles, workspace registry, and scoped runtime access. One team per installation, on
infrastructure the team controls. Workspace files and runtime data stay on the team's server.

### 1.2 License map and red lines

| Source area | License | myai rights |
|---|---|---|
| Everything outside `ee/` (apps, packages, scripts, worlds, docs) | MIT © Different AI | Fork, modify, rebrand, ship closed or open, sell. Keep the MIT notice; no trademark rights granted. |
| `ee/` (den-api, den-web, den-gateway, den-worker-proxy, inference, den-db, telemetry, …) | OpenWork EE License | **None for myai.** Production use requires a Different AI subscription; copying/distributing/sublicensing forbidden; modifications contractually belong to Different AI. |
| Older `ee/` versions | FSL-1.1-MIT (delayed MIT conversion per version) | Do not rely on the conversion without per-version legal analysis. |

**Red lines (never):**
1. Ship `ee/` code — or anything derived from it — in myai binaries, images, repos, or docs.
2. Copy or paraphrase EE source, schemas, migrations, tests, comments, documentation, or config.
3. Modify `ee/` anywhere (modifications would belong to Different AI).
4. Run EE Den/inference for real users without a written Different AI agreement.
5. Leave OpenWork branding, hosts (`*.openworklabs.com`), gateway headers, or release repos
   advertised in shipped builds.
6. Remove the Different AI MIT copyright/permission notice from source or binary distributions.

### 1.3 Clean-room rules (binding for all myai-owned code)

- The API/behavior contract is derived from **requirements, this plan, and the MIT client code**
  (`apps/app/src/app/lib/den.ts` and friends are MIT — reading them is fine), plus observed HTTP
  behavior. Never from EE server sources.
- Architecture review may use the *behavior and public concepts* of EE components; implementation
  must be independently authored.
- Implementers do not open `ee/` server sources while writing myai server code.
- Keep dated design notes (this document is the first artifact) as provenance evidence.

### 1.4 Attribution and trademark obligations

- Ship the upstream MIT license text + Different AI copyright notice in the repo root and in
  installer/about legal screens.
- Add a myai `NOTICE`/copyright line for myai-authored files.
- Record every third-party dependency with license + source (CI-generated license report / SBOM
  for the server image and desktop artifacts; block GPL/AGPL additions to the shipped closure).
- All user-visible "OpenWork" naming/logos become myai. Internal npm scope `@openwork/*` may stay
  (not user-visible; renaming creates large upstream merge conflicts).

---

## 2. Repository strategy (new repo)

**Decision (locked 2026-09-16):** the myai product lives in a **new repository**. The existing
fork and its `origin` (`github.com/saifulbabo67646/myai`) are kept only for inspiration/learning
and eventually archived.

- **Implemented 2026-09-16:** the repo was created at `/Users/saiful/Desktop/work/myai` from a
  `git archive` **snapshot** of the tracking fork's `branding` branch (MIT tree + myai rebrand) —
  no upstream git history was imported, so the repo's history starts EE-free. Origin record:
  `PROVENANCE.md`.
- **EE never enters the new repo — including `.git`.** The repo has no `upstream` remote; EE
  blobs cannot arrive through history or fetches. `scripts/strip-ee.mjs` ran at import and re-runs
  after every sync. A guard test proves EE-freeness (tree, manifests, and full git history).
- Layout: upstream structure stays intact (`apps/`, `packages/`, `evals/`, `worlds/`) to keep
  future upstream syncs cheap; the new myai control-plane server is added as a new workspace
  (proposed: `apps/myai-server`).
- **Upstream sync ritual (vendor-branch, corrected 2026-09-16):** merges never happen in this
  repo (it has no upstream objects, so 3-way patch application is impossible — and must stay
  impossible to keep `.git` EE-free). All merging happens on the tracking fork's `myai-main`
  branch: import the public tree → `git merge upstream/dev` with full context → re-run
  `scripts/strip-ee.mjs` → rsync the stripped tree back here → guards → snapshot commit. Full
  recipe: `PROVENANCE.md` rule 2. myai changes stay in small, separate commits.
- The old fork (`/Users/saiful/Desktop/work/openwork`) is the **tracking fork**: kept private for
  upstream mirroring, inspiration, and learning. It receives no product work; its GitHub origin is
  to be archived once this repo has its own remote.
- **License of new myai code:** decide MIT (community-friendly, simplest) vs. proprietary
  (protects the control plane). If anything non-MIT lands in-repo, the root `LICENSE` and
  `REUSE.toml` must be amended with an explicit carve-out for that directory (mirroring how
  upstream carves out `ee/`) — otherwise new code defaults to the repo-wide MIT declaration.

---

## 3. Phase 0 — Bootstrap the new repo with an EE-free boundary

1. Create repo; import MIT tree; strip EE.
2. `scripts/strip-ee.mjs` (repeatable, used at bootstrap **and** every upstream sync) removes:
   - `ee/` entirely;
   - `packaging/docker/Dockerfile.den*`, `Dockerfile.inference`, `docker-compose.den-dev.yml`,
     `den-dev-up.sh`;
   - EE CI workflows (`publish-ee-images.yml`, `den-db-check.yml`, `den-db-migrate.yml`);
   - `ee/apps/*`, `ee/packages/*` entries from `pnpm-workspace.yaml`;
   - root `package.json` scripts filtering `@openwork-ee/*` (`dev:den*`, `dev:web`, `build:web`,
     `dev:enterprise-mock-lab`, `dev:diagnostics`, `check:enterprise-mock-lab`, …);
   - Den-only entries in `turbo.json` `globalEnv`;
   - the `ee/**` annotation in `REUSE.toml` and `LICENSES/LicenseRef-OpenWork-EE.txt`.
3. Remove/gate the EE-dependent eval specs (36 files under `evals/specs` spawn `@openwork-ee/*`,
   e.g. `den-web-vercel-install.test.ts`, `oauth-token-rate-limit.test.ts`,
   `mcp-stateless-2026-transport.test.ts`, `skill-created-mcp-app.test.ts`,
   `connect-flow-mcp-apps.test.ts`, `den-api-production-package.test.ts`).
4. Verify EE-free tree: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm dev`,
   `pnpm world up ./worlds/dev-headless.ts` all pass.
5. **Automated release guards** (written as `evals/specs/*.test.ts` with `@openwork/testkit`,
   per the repo's proof model):
   - no `/ee` paths in any distributable artifact or workspace outside the strip list;
   - no `@openwork-ee` dependency in any `apps/**` / `packages/**` manifest;
   - no OpenWork production URLs (`openworklabs.com` endpoints) in release-configured defaults;
   - no prohibited OpenWork branding in shipped artifacts;
   - MIT `LICENSE` + myai `NOTICE` present in packaged resources;
   - dependency license report generated; no copyleft (GPL/AGPL) in the shipped closure.
6. Update `AGENTS.md` for the new repo: fork rules (new remote layout), red lines (1.2),
   clean-room rules (1.3), and the sync ritual (Section 2).

## 4. Phase 1 — myai self-hosted single-team server

*(Design absorbed from the 2026-09-16 spec; requirements unchanged.)*

**Decision:** Phase 1 ships a self-hosted myai server for **one team per installation**. The
desktop app and the MIT `openwork-server` remain the execution foundation. myai provides its own
team control layer; **no OpenWork EE components**. Cloud workers, per-user provisioning,
multi-org hosting, hosted billing, Daytona/Render integrations, and a cloud gateway are future
work (Section 7). Phase 1 leaves a clean execution-backend seam so they can be added without
coupling the desktop client to a provider.

**Goals:** team-controlled install; member sign-in from the myai desktop; membership, roles,
workspace registry, access control; files/runtime data stay on the team's server; reuse the MIT
`openwork-server` runtime without importing/distributing EE; documented repeatable
deployment + backup; extensible backend seam.

**Non-goals (Phase 1):** multiple orgs; OpenWork user/data migration; hosted cloud workers or
provisioning; Daytona/Render/K8s scheduling; billing, subscriptions, usage metering; SSO, SCIM,
social login, enterprise identity; any EE package; any copying of EE source, schemas,
migrations, tests, comments, docs, or config.

### 4.1 Architecture

```text
myai Desktop
      |
      | HTTPS: user session and scoped workspace access
      v
myai Server
  |-- Team control API
  |-- Authentication and sessions
  |-- Membership and role checks
  |-- Workspace registry and authorization
  |-- Scoped runtime token broker
  |-- Runtime request proxy
  |-- Local SQLite control database
  |
  `--> openwork-server (loopback-only MIT runtime)
          |-- workspaces and files
          |-- agent sessions
          |-- approvals
          |-- MCP connections
          `-- model/provider execution
```

The myai server is the **only public application endpoint**. The managed `openwork-server`
listens on loopback or an isolated container network, never exposed directly. A standard TLS
reverse proxy may terminate HTTPS in front of myai server; a secure local development mode is
also required.

**Control plane vs runtime boundary:** the control plane owns identity, membership, workspace
metadata, authorization, and administration. The MIT runtime owns sessions, files, agent
execution, approvals, and MCP behavior. The control plane must not duplicate the runtime's
session engine: it either proxies authorized runtime routes or issues short-lived,
scope-limited runtime credentials after checking team membership and workspace access.

### 4.2 Single-team model and roles

One installation team; every team-owned record still carries an installation/team identifier
where practical (future multi-org must not require rewriting tables). Creating or selecting a
second organization is rejected in Phase 1.

- `owner` — full installation administration and member management.
- `admin` — member and workspace administration; cannot transfer ownership.
- `member` — access to assigned workspaces and normal agent actions.
- `viewer` — read-only access where the runtime supports it.

Authorization is enforced server-side on every protected request. The desktop UI is not an
authorization boundary.

### 4.3 Data model (independently designed myai tables)

Installation/team metadata; users; sessions; memberships and roles; invitations; workspaces and
filesystem roots; workspace memberships; hashed access tokens and token scopes; audit events;
server configuration and schema version.

Runtime databases and workspace files remain under the configured myai data directory. The
control database never stores raw passwords or reusable access tokens. Secrets are hashed or
encrypted with a server secret documented as required backup material.

### 4.4 API surface (versioned, myai-owned names)

Health/readiness; first-admin bootstrap and sign-in/session management; current user, team,
membership, role info; member invitations, role changes, removal; workspace listing,
registration, access grants, revocation; scoped runtime connection/token exchange; server
configuration and backup diagnostics; audit event listing for admins.

The API must not advertise OpenWork hosts, product names, gateway headers, or release repos.
The **runtime protocol may stay compatible where the MIT client requires it**; the public myai
API and configuration names are myai-owned.

### 4.5 Authentication and security

- HTTPS required for non-loopback production access.
- First owner bootstrapped via one-time admin setup flow.
- Secure, revocable sessions; password hashing only via a maintained auth library
  (proposed: better-auth) — never hand-rolled.
- Bearer tokens hashed at rest; token value shown once at creation.
- `openwork-server` bound to loopback / isolated internal network.
- Workspace paths validated against configured roots; traversal and symlink escape prevented.
- Membership, role, workspace access, and token scope checked on every request.
- Credentials, cookies, file contents, and prompt contents scrubbed from logs.
- Audit: sign-in, invitation, role change, token create/revoke, workspace access changes,
  failed authorization.
- Documented rotation/recovery procedures for server secret and control database.

### 4.6 Execution-backend seam

Internal abstraction: resolve a workspace runtime; start/verify runtime availability; issue
scoped runtime access; proxy or connect to runtime routes; report health and shutdown state.
Phase 1 maps every workspace to the local `openwork-server` and contains **no cloud provisioning
code**. A future cloud backend implements the same contract without changing the desktop's
workspace/session model.

### 4.7 Deployment

Documented containerized install: one myai server image; one persistent data volume; one
optional TLS reverse proxy; one loopback/internal `openwork-server` runtime; explicit env file
(base URL, data directory, bootstrap settings, secret references). Docs cover installation,
upgrade, backup, restore, owner recovery, log collection, safe uninstall. Server **fails
closed** when required production secrets or data paths are invalid.

### 4.8 Verification (Phase 1)

`evals/specs/**/*.test.ts` with `@openwork/testkit` remains the release proof path. Observable
tests for: first-owner bootstrap; sign-in/session expiry/revocation; role enforcement;
invitation acceptance and removal; workspace access isolation; runtime token scope and
revocation; path traversal and symlink escape rejection; audit events without secret leakage;
runtime proxy behavior and failure handling; backup/restore configuration validation; clean
install and upgrade on a disposable data directory; release artifact scans proving no EE
runtime dependency ships.

First acceptance test proves the complete path:

```text
fresh installation -> owner bootstrap -> invite member -> member sign-in
-> grant workspace access -> create session -> perform approved file action
-> revoke member -> subsequent access is rejected
```

## 5. Phase 2 — Desktop integration and cloud neutralization

The MIT desktop already supports a configurable server base URL (`den.ts` settings,
`desktop-bootstrap.json`, enterprise-activation `denBaseUrl`); the myai server slots into that
seam. Every OpenWork cloud touchpoint becomes exactly one of **disable / redirect / keep-local**:

- `apps/app`: `src/app/lib/den.ts` (`HOSTED_DEFAULT_DEN_BASE_URL`,
  `HOSTED_DEFAULT_DEN_API_BASE_URL`), `src/app/constants.ts` (hardcoded
  `api.app.openworklabs.com/mcp/agent` catalog entry), `lib/feedback.ts`,
  `lib/den-sign-in-intent.ts`, `domains/workspace/openwork-den-help-link.tsx`,
  `remote-workspace-diagnostics.ts`, `session/sidebar/account-status-menu.tsx`,
  `session/panel/side-panel.tsx`, `session/surface/session-surface.tsx`,
  `design-system/provider-logo-src.ts`
- `apps/server`: `connect-mcp-server-catalog.ts`, `cloud-mcp-health.ts`,
  `agent-context-cloud-probe.ts`, `opencode-models-url.ts`,
  `opencode-plugins/openwork-capabilities-knowledge.ts`
- `apps/desktop`: `electron/main.mjs`, `electron/workspace-store.mjs`, `package.json`
  (`support@openworklabs.com`)

Ship-state defaults: public flavor keeps `requireSignin: false`; team flavor signs in against
the myai server (`requireSignin: true` via distribution/bootstrap config); OpenWork Connect MCP
entry, cloud account panel, and help links hidden or repointed; third-party telemetry (PostHog
keys, Sentry DSNs, `diagnostic.openworklabs.com`) removed or myai-owned. BYOK provider auth,
local workspaces, skills, automations stay untouched (all MIT).

## 6. Phase 3 — Branding/trademark completion

Finish renaming user-visible "OpenWork" strings, logos, `app-demo.gif`, READMEs, translated
readmes, help links, support email, window titles, installer metadata. Distribution identifiers
are already myai (`appName: myai`, `bd.myai.app`, `myai://`). Keep MIT attribution in
about/legal screens. Guard test from Phase 0 prevents regressions on every sync.

## 7. Deferred roadmap (with activation triggers)

Deferred ≠ cancelled. Each item is independently evaluated; none blocks the Phase 1 value prop.
All follow the clean-room rules (1.3) — the old EE-based designs are inputs, never sources.

| # | Item | Why deferred | Activation trigger |
|---|---|---|---|
| 1 | **Multiple organizations per installation** | Data-model refactor best done against real requirements; team identifiers are already required on Phase 1 records, so retrofit is cheap. | Second distinct team wants one shared install. |
| 2 | **Cloud-worker execution backend + provisioning + myai cloud gateway** | A distributed-systems product on its own (orchestration, sandboxing, lifecycle, networking, secrets, cost control). Phase 1 is deliberately self-hosted: files on the team's server is the differentiator and the simplest security story. The 4.6 seam exists so this needs no desktop rework. | Customer demand exceeds self-hosted capacity, or a hosted myai offering is green-lit. |
| 3 | **SSO / SCIM / external identity** | Security-heavy protocol work (SAML/OIDC federation, SCIM provisioning) plus support burden; irrelevant for a single team that works with invitations + password/authenticator login. | First enterprise prospect requires it in writing. |
| 4 | **Billing, subscriptions, quotas, hosted ops** | The previous design sat on EE Den (Stripe `org_subscriptions`, `inference_org_usage_buckets`) and cannot be reused; a clean-room rebuild (checkout, webhooks, entitlements, metering pipeline, quotas, dunning, tax/VAT, refunds) is weeks of work that only pays off once there is something to sell. A self-hosted Phase 1 has nothing to meter: BYOK means providers bill users directly, and metering *hosted* inference would require running our own inference proxy — real infra and COGS. | Launch of paid plans or a hosted myai offering. |

**Design inputs preserved for item 4** (from the deleted subscription planning doc, to be
re-implemented clean-room on the myai backend): mandatory-sign-in gate already exists in the MIT
desktop (`requireSignin` → `DenSigninGate`/`ForcedSigninPage`); BYOK can be hidden later via the
`allowCustomProviders` desktop policy; target model was per-user plans (not org-level),
member-level quotas, 5-hour and activity-based usage buckets, a per-member usage ledger
(tokens + cost), desktop-side usage telemetry (including BYOK), and usage dashboards in both
server and desktop. Open decisions to revisit then: does BYOK count against quota; quota unit
and tiering; billing surface; offline/enforcement behavior.

**Pilot note** (salvaged from the deleted pilot plan): the pilot now runs entirely on Phase 1
outputs — myai server deployed on team-controlled infra (container + TLS reverse proxy or
tunnel) + myai desktop builds. The old plan's EE legal gate no longer exists because no EE
component is involved. Pilot validation ideas worth keeping: small invited group, website
automation workflow as the adoption hook, weekly validation checklist, usage metrics, explicit
go/no-go criteria.

## 8. Verification and evidence model

Unchanged from repo convention: the only proof path is `evals/specs/**/*.test.ts` with `test`
from `@openwork/testkit` (`.e2e.test.ts` for app-driving E2E). Verdicts: `Passed` only with
observable assertions; skips never pass. Phase 0 guards + Phase 1 acceptance path + Phase 2/3
regression checks are all expressed there. Docs-only changes may skip runtime proof (say so).

## 9. Execution — work packages for parallel agents

This section is the dispatch board. Each work package (WP) is self-contained for one AI agent
(or one human). Design sections (§3–§6) define what to build; WP cards define scope, file
ownership, dependencies, and observable completion.

### 9.1 Agent contract (applies to every WP)

- Start by reading: `AGENTS.md` (red lines, proof model), §1 of this document (licensing),
  `PROVENANCE.md` (repo topology and sync ritual). For WP-4/WP-6/WP-7: also §1.3 clean-room rules.
- One WP = one branch `wp/<id>-<slug>` = one PR against `main`. Never commit to `main` directly.
- Touch only the paths in your WP's ownership list. If you must touch another WP's paths, stop
  and note it in the PR — cross-ownership conflicts are resolved by humans, not by agents.
- Done = observable: run the exit commands, paste real output into the PR. Verdict `Passed` only
  when every listed check is green; skips never pass (repo proof model, AGENTS.md).
- Every PR runs the repo-wide invariant green:
  `pnpm --dir evals exec vitest run --project pr specs/myai-ee-free-boundary.test.ts`
- Environment: pnpm 11.4.0, Node 24, bun 1.3.10 (`~/.bun/bin` must be on PATH); headless-world
  runs need `OPENWORK_OPENCODE_BIN=$PWD/apps/desktop/resources/sidecars/opencode` (staged by
  `pnpm build`).
- Keep commits small; update the WP status table (9.2) inside your PR.

### 9.2 Dependency graph, lanes, and status

```text
WP-1 catch-up sync (SOLO — critical path; no other WP runs while it is in flight)
   │
   ├─→ WP-2 CI curation                ┐
   ├─→ WP-3 endpoint neutralization    │  four parallel lanes
   ├─→ WP-5 branding completion        │  (WP-4 additionally gated on DEC-1)
   └─→ WP-4 myai-server MVP            ┘
             │                │
             │ 4a API contract (early deliverable, unblocks WP-6)
             ▼                ▼
        WP-7 deployment   WP-6 desktop integration (needs WP-3 + WP-4a)

WP-8 housekeeping/decisions: anytime, owner = human
```

| WP | Name | Depends on | Lane | Status |
|----|------|-----------|------|--------|
| WP-0 | Phase 0 bootstrap | — | — | ✅ done 2026-09-16 |
| WP-1 | Catch-up sync to upstream | WP-0 | solo (critical path) | ✅ done 2026-09-16 (PR #3, upstream `391d794d2`) |
| WP-2 | CI curation + guard hardening | WP-1 | A | 🔄 in review (PR: `wp/2-ci-curation`, PR #4) |
| WP-3 | Endpoint neutralization (Phase 2) | WP-1 | B | ready (WP-1 merged) |
| WP-4 | myai-server MVP (Phase 1) | WP-1 + DEC-1 | C | blocked on DEC-1 |
| WP-5 | Branding completion (Phase 3) | WP-1 | B (split ownership with WP-3) | ready (WP-1 merged) |
| WP-6 | Desktop ↔ server integration | WP-3 + WP-4a | D | waiting |
| WP-7 | Deployment packaging + docs | WP-4 green | C | waiting |
| WP-8 | Housekeeping & human decisions | — | anytime | open |

### 9.3 WP cards

**WP-0 — Phase 0 bootstrap. ✅ Done 2026-09-16.**
EE-free snapshot baseline (`e512d50`), pruned lockfile (`04a8013`), boundary guard
(`4dc687f`), published to public `saifulbabo67646/myai` with Actions/Dependabot disabled
(`9cdac04`). Evidence: guard green; `pnpm typecheck` (@openwork/app) green; desktop `pnpm build`
green; evals `lint:layers` clean (443 modules) + 218/218 self-tests; headless world web+server
HTTP 200; deep history scan 0 EE objects. Known pre-existing debt: evals `tsc -p .` reports 44
errors in untouched upstream specs (cross-boundary `.mjs` imports) — present at base snapshot,
not a regression; no WP fixes them opportunistically.

**WP-1 — Catch-up sync to upstream (`03664d1f0` → `fa9705458` or newer, ~670 commits).**
- Crew: ONE agent, solo. All other WPs pause while WP-1 is in flight (it touches the whole tree).
- Method: the vendor-branch ritual in `PROVENANCE.md` rule 2, bootstrapping `myai-main` in the
  tracking fork from `branding`. Merges happen ONLY in the fork; the public repo receives one
  stripped snapshot commit `sync: upstream <sha>`.
- Expected conflict hotspots (myai-owned files): `AGENTS.md`, `LICENSE`, `NOTICE`,
  `PROVENANCE.md`, `REUSE.toml`, `docs/myai-plan.md`, `scripts/strip-ee.mjs`,
  `evals/specs/myai-ee-free-boundary.test.ts`, `apps/desktop/electron/desktop-distribution.mjs`,
  `apps/app/src/app/lib/den.ts` (branding strings), root `package.json` (pruned scripts),
  `pnpm-lock.yaml` (never merge — regenerate with `pnpm install`), and
  `apps/app/src/react-app/domains/connections/provider-auth/store.ts` +
  `apps/app/tests/provider-auth-methods.test.ts` — the ported disabled-provider reconnect fix
  (DEC-2) lands in a region upstream reworked via #4357/#4358; after merging, re-check the fix
  still holds and re-run `bun test tests/provider-auth-methods.test.ts` (7/7 green pre-sync).
- Upstream will reintroduce EE coupling (new `dev:den*` scripts, workflows, eval specs, den
  files): extend `scripts/strip-ee.mjs` patterns and let it remove them; never hand-delete.
- Exit (all pasted into the PR): guard spec green; `pnpm typecheck` green; `pnpm build` green;
  evals self-tests + `lint:layers` green; `pnpm world up ./worlds/dev-headless.ts` reaches
  HTTP 200 on web+health then tears down; strip scan clean; `UPSTREAM_BASE` updated in
  `PROVENANCE.md`; record (not fix) the evals-tsc error count.

**WP-2 — CI curation + guard hardening.**
- Owns: `.github/**`; new guard specs `evals/specs/myai-*.test.ts`.
- Steps: remove upstream-only workflows (release cutting, blacksmith runners, alpha/desktop
  publish, Vercel/Den remnants); add one `myai-ci.yml` (push/PR to `main`: install → typecheck →
  evals `lint:layers` + self-tests → pr-project specs incl. the boundary guard); then re-enable
  Actions (`gh api repos/saifulbabo67646/myai/actions/permissions -X PUT -F enabled=true`) and
  enable branch protection requiring PR + green CI.
- Exit: a test PR runs myai CI green end-to-end; Actions enabled; no references to upstream
  infra (blacksmith, openworklabs secrets, Den) remain in `.github/`.
- **Landed 2026-09-16 (PR #4).** `.github/workflows/` holds one workflow, `myai-ci.yml` (push +
  PR to `main`). Blocking, and required by branch protection: frozen install of both workspaces →
  `pnpm typecheck` → the §9.1 boundary guard → new `evals/specs/myai-ci-hygiene.test.ts` (exactly
  this workflow under `.github/workflows/`, no upstream runner/host/eval-lane/Den token anywhere
  under `.github/`). Advisory (`continue-on-error`): evals `check:browser`, `lint:layers`, both
  spec ratchets, harness self-tests.
- **Why the card's own lanes are advisory:** all four are red on the WP-1 merge commit,
  upstream-identical, and outside WP-2's ownership — `lint:layers` 47 violations (upstream: 54),
  boundary ratchet 37 baseline-drift entries (our own boundary guard among them), channel ratchet
  aborts on `git merge-base HEAD origin/dev` (no `dev` branch exists here), self-tests 367/368
  (`mock-google`). Promotion path: clear one baseline → move that step into the blocking block.
  The unfiltered `pr` lane needs a local Den (MySQL + Redis) for ~30 specs and stays out of the
  gate — DEC-3 territory.
- **Follow-ups for the owner / WP-8:** `strip-ee.mjs` §5c `.github` trims (`dropYamlStep` on
  `ci-tests.yml`) are inert but harmless (every helper is `existsSync`-guarded);
  `scripts/ci/{workflow-authoring-gate,ubuntu-apt-https,verify-clean-revert}.test.mjs` and
  `warden.toml` + `.warden/` lost their only callers; `.github/ISSUE_TEMPLATE/*` still carry
  upstream product wording (WP-5 territory).

**WP-3 — Endpoint neutralization (Phase 2; design §5).**
- Owns: `apps/app/src/app/lib/den.ts`, `lib/feedback.ts`, `lib/den-sign-in-intent.ts`,
  `src/app/constants.ts` (Connect MCP catalog entry), `domains/workspace/openwork-den-help-link.tsx`,
  `domains/workspace/remote-workspace-diagnostics.ts`, `domains/session/sidebar/account-status-menu.tsx`,
  `domains/session/panel/side-panel.tsx`, `domains/session/surface/session-surface.tsx`,
  `domains/session/modals` sign-in surfaces, `domains/connections` cloud surfaces,
  `design-system/provider-logo-src.ts`; `apps/server/src/{connect-mcp-server-catalog,cloud-mcp-health,agent-context-cloud-probe,opencode-models-url}.ts`,
  `apps/server/src/opencode-plugins/openwork-capabilities-knowledge.ts`;
  `apps/desktop/electron/{main.mjs,workspace-store.mjs}`, `apps/desktop/package.json` (support
  email); `worlds/` + `packages/world` den-target defaults; telemetry keys (PostHog, Sentry,
  `diagnostic.openworklabs.com`).
- Rule per surface: **disable / redirect (build-configurable, no default host) / keep-local**.
  Ship state: public flavor `requireSignin:false`; cloud surfaces hidden; no code path can issue
  a request to `*.openworklabs.com` in a release build.
- Exit: new guard `evals/specs/myai-no-openwork-endpoints.test.ts` green (scans shipped sources
  + release config for OpenWork hosts/telemetry IDs); `pnpm world up` prints a disabled or
  myai-configured den target; `pnpm typecheck` + `apps/app/tests/den-*` suites green.
- Conflict split with WP-5: WP-3 owns sign-in/cloud *behavior* surfaces (incl.
  `welcome-page.tsx` CTA logic); WP-5 owns naming/logo/marketing surfaces.

**WP-4 — myai-server MVP (Phase 1; design §4; CLEAN ROOM per §1.3).**
- Gate: DEC-1 (license for myai-authored code) must be recorded; if non-MIT, `LICENSE` +
  `REUSE.toml` carve-out lands before coding starts.
- Owns: `apps/myai-server/**` (new pnpm workspace), `evals/specs/myai-server-*.test.ts`,
  root manifest/workspace entries needed to register them.
- Order of work: **4a** versioned API contract doc (routes, DTOs, token model, error taxonomy —
  publish as `apps/myai-server/CONTRACT.md` EARLY; it unblocks WP-6) → **4b** scaffold (Hono +
  better-auth + Drizzle/SQLite, health/readiness) → **4c** first-owner bootstrap, sessions,
  roles (§4.2) → **4d** invitations → **4e** workspace registry + path-root validation →
  **4f** scoped runtime token broker + proxy to loopback `openwork-server` (§4.1 boundary) →
  **4g** audit events → **4h** execution-backend seam (§4.6, local backend only).
- Test-first: the §4.8 acceptance path is written as a red spec before 4c–4f implementation.
- Exit: acceptance path green in one command (`bootstrap → invite → sign-in → grant → session →
  file action → revoke → rejected`); §4.5 security properties asserted in tests (library-based
  hashing, tokens hashed at rest, traversal/symlink rejection, fail-closed config, log
  scrubbing); PR includes a clean-room attestation (no `ee/` source consulted); boundary guard
  green.
- Prohibitions: consulting `ee/` sources anywhere (including the tracking fork); copying Den
  schemas, route names, or error strings — public API and config names are myai-owned (§4.4).

**WP-5 — Branding completion (Phase 3; design §6).**
- Owns: `README.md`, `translated_readmes/`, `SUPPORT.md`, `app-demo.gif`,
  `openwork-logo-transparent.svg`, `docs/` prose, window titles/installer display metadata,
  welcome/about *naming* surfaces, `constants.json`-adjacent display strings, `changelog/`
  presentation.
- Keep: MIT attribution screens (required), internal `@openwork/*` package names (deliberate,
  §1.4), nominative "derived from OpenWork" statements.
- Exit: new guard `evals/specs/myai-branding-boundary.test.ts` green (no user-visible OpenWork
  naming outside the attribution allow-list in shipped surfaces); attribution intact.

**WP-6 — Desktop ↔ myai-server integration.**
- Depends: WP-3 (redirect machinery) + WP-4a contract + WP-4c/4d/4e merged.
- Owns: `apps/app` sign-in/connect flows against the myai API (team flavor),
  `apps/desktop` bootstrap config wiring, `desktop-distribution.mjs` flavor defaults.
- Exit: `.e2e.test.ts` proving the §4.8 path through the real desktop UI against a locally
  spawned myai-server; public flavor still boots fully local with sign-in disabled.

**WP-7 — Deployment packaging + docs (design §4.7).**
- Depends: WP-4 acceptance path green.
- Owns: `packaging/docker/Dockerfile.myai-server`, compose file (myai server + loopback
  `openwork-server` + volume + optional TLS proxy), env template, `docs/deployment.md`
  (install, upgrade, backup, restore, owner recovery, log collection, safe uninstall).
- Exit: scripted clean-install + upgrade on a disposable volume green; fail-closed behavior
  tested (missing secrets/paths refuse to boot); backup/restore round-trip tested.

**WP-8 — Housekeeping & human decisions (owner: human; agents may execute decided items).**
- **DEC-1 (blocks WP-4):** license for myai-authored code — MIT (simplest, keeps repo uniform)
  vs proprietary carve-out (requires `LICENSE` + `REUSE.toml` amendment BEFORE writing code).
- **DEC-2: ✅ resolved 2026-09-16 — ported.** The tracking fork's uncommitted
  `provider-auth/store.ts` fix (disabled providers stay offerable so they can be reconnected;
  any connect clears the disabled flag) was verified green (7/7 `bun test`), confirmed absent
  from `upstream/dev`, and merged into `main`; the fork's working tree was reset. WP-1 must
  re-verify it after the merge (see WP-1 conflict hotspots).
- Port `spec-impact.test.ts` with MIT fixture paths (deleted at strip; tool itself remains).
- **DEC-3 (opened by WP-1; owner: human):** how far to trim `evals/`. It ships nothing —
  not in the pnpm workspace, no shipped app depends on it, `pnpm build` never touches it — but
  it is 40% of a sync's churn (82k of 207k insertions in the WP-1 sync), the largest source of
  EE re-coupling (40 of 95 path entries in `strip-ee.mjs`), and holds 180 specs of which
  exactly 1 is myai-owned. Sequencing matters: `strip-ee.mjs` already removes everything that
  *imports* EE, so what remains are specs exercising cloud/Den/enterprise **product surfaces**
  through the MIT client — WP-3 decides which of those surfaces still exist, so pruning before
  WP-3 lands is guesswork. Tiers and evidence: see the WP-1 PR analysis.
  - Must keep regardless: `evals/specs/myai-ee-free-boundary.test.ts` (the only automated proof
    of the EE-free claim, and a §9.1 repo-wide invariant), `@openwork/testkit` (the guard
    imports it), and the `pnpm world up` chain (`bin/`, local `worlds/`, `packages/world`).
  - Note: both exit checks red at WP-1 (`lint:layers`, the `mock-google` self-test) live inside
    evals and are inherited upstream debt; a trim would retire them rather than fix them.
- Clean dormant Den/Daytona eval infra (`evals/packages/{env,hosts,testkit}` den modules,
  `.devcontainer/start-daytona-server.sh`, allow-list in `strip-ee.mjs`) once WP-4 provides the
  replacement lane.
- Archive `saifulbabo67646/myai-old` after the first WP-1 cycle proves the sync ritual.

### 9.4 Recommended dispatch

1. **Now:** WP-1 (solo agent). Everything else waits — it rewrites the whole tree.
2. **After WP-1 merges:** fan out four agents → WP-2, WP-3, WP-4 (once DEC-1 is recorded),
   WP-5. Lanes are ownership-disjoint by design.
3. **Then:** WP-6 after WP-3 + WP-4a; WP-7 after WP-4 green.
4. Human closes DEC-1/DEC-2 and the archive step of WP-8 whenever convenient.
