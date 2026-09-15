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
- **Upstream sync ritual (patch-based, through the tracking fork):** update the tracking fork's
  `dev` mirror (`git fetch upstream && git merge --ff-only upstream/dev`) → generate an EE-excluded
  diff from `UPSTREAM_BASE` (`git -C <fork> diff <base>..upstream/dev -- . ':(exclude)ee'`) →
  apply 3-way in this repo → re-run `node scripts/strip-ee.mjs` → run guard tests → update
  `UPSTREAM_BASE` in `PROVENANCE.md` → commit. myai changes stay in small, separate commits.
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

## 9. First-week task list

1. ✅ Create the new repo; import MIT tree; write `scripts/strip-ee.mjs`; commit EE-free baseline.
   [Phase 0 — done 2026-09-16 at `/Users/saiful/Desktop/work/myai`; GitHub remote TBD]
2. ✅ Prune workspace/root scripts/turbo/CI/packaging per Section 3; remove the EE eval specs
   (31 swept + `spec-impact.test.ts`); EE reference scan clean.
3. Add Phase 0 guard tests (EE paths incl. git history, `@openwork-ee` deps, LICENSE/NOTICE
   presence). URL/branding guards activate with Phase 2/3 work.
4. Decide license for myai-authored code (MIT vs proprietary carve-out) and update root
   `LICENSE` + `REUSE.toml` accordingly. Baseline: repo stays MIT (§1.4 notices in place).
5. Catch-up sync `UPSTREAM_BASE 03664d1f0 → upstream/dev fa9705458` (~670 commits) via the
   Section 2 patch ritual — first real exercise of the sync machinery.
6. Follow-ups from the strip: port `spec-impact.test.ts` with MIT fixture paths; clean up dormant
   Den/Daytona eval infra (`evals/packages/{env,hosts,testkit}` den modules,
   `.devcontainer/start-daytona-server.sh`) once the myai server replaces the Den lane; decide the
   GitHub remote for this repo and archive the old fork's origin.
7. Scaffold `apps/myai-server`: better-auth + SQLite (Drizzle) + seam interface + health routes;
   write the first acceptance test (4.8 path) red, then implement to green. [Phase 1]
8. Phase 2 endpoint inventory → per-surface disable/redirect/keep-local decisions; make server
   base URL fully build-configurable with no `openworklabs.com` default in release builds.
