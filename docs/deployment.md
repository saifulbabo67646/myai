# Deploying myai server

Self-hosted, single-team myai control plane (Phase 1, `docs/myai-plan.md` §4.7).
This guide covers one installation on one host: one myai server image pair, one
persistent control-data volume, one workspace directory, and an optional TLS
reverse proxy.

Everything here is plain Docker Compose on a host you control. There is no cloud
provisioning, no managed gateway, no Kubernetes manifests, no billing, no SSO,
and no hosted dependency: the only images are built from this repository, and
the only third-party images referenced are the Node, Bun, and nginx bases.

---

## 1. What gets deployed

| Piece | What it is | Reachable from |
|---|---|---|
| `myai-server` | The control plane: sign-in, membership/roles, workspace registry, scoped runtime credentials, audit log | The TLS proxy only, on loopback |
| `openwork-runtime` | The MIT `openwork-server` runtime (files, sessions, approvals, MCP) | The myai server only, on loopback |
| `tls-proxy` *(profile `tls`)* | Neutral nginx TLS termination | The one published port |
| `myai-control-data` | Named volume: control database + log file | The myai server |
| `${MYAI_WORKSPACE_HOST_PATH}` | Host directory: workspace storage | myai server + runtime |

```text
        host :8443
            │
            ▼
   ┌──────────────────────── shared network namespace ────────────────────────┐
   │  tls-proxy  0.0.0.0:8443 ──▶ myai-server  127.0.0.1:8788                │
   │                                    │                                     │
   │                                    └──▶ openwork-runtime  127.0.0.1:8787 │
   └──────────────────────────────────────────────────────────────────────────┘
```

Only `tls-proxy` has a published port. The runtime is never published and never
reachable from the host network or from any other container.

Both images come from `packaging/docker/Dockerfile.myai-server`:

```bash
# from the repository root
docker build -f packaging/docker/Dockerfile.myai-server -t myai-server:local .
docker build -f packaging/docker/Dockerfile.myai-server --target runtime -t myai-runtime:local .
```

`docker compose ... up --build` builds both for you.

---

## 2. Requirements

* Docker Engine with Compose v2.23 or newer (the bundled nginx configuration is
  a Compose `configs:` entry) — validated here on Docker 28.0.4 / Compose
  v2.34.0.
* A host with 2 vCPU, 2 GB RAM, and disk for the control volume plus workspaces.
* One published TCP port (default `127.0.0.1:8443`) for the TLS proxy.
* A TLS certificate and key in PEM form, or your own certificate automation.
* Outbound HTTPS from the myai server so the desktop client and the runtime can
  reach the model providers you configure.

Building from source additionally needs a checkout of this repository. The
build uses Node 24, pnpm 11.4.0, and Bun 1.3.10 **inside the image**; you do not
install them on the host.

---

## 3. Topology constraints (read before changing anything)

The merged server enforces two loopback rules in production
(`apps/myai-server/src/config.ts`). They are security checks, not defaults, and
this packaging does not weaken them:

1. **The server must bind to loopback.** Any other `MYAI_HOST` is rejected with
   `Invalid myai server configuration: production server must bind to loopback
   while HTTPS terminates at a reverse proxy`. A Docker published port is
   delivered to the container's bridge address, so a container that binds only
   to its own loopback cannot be reached by a published port.
2. **The runtime URL must be loopback.** `MYAI_RUNTIME_BASE_URL` accepts only
   `127.0.0.1`, `localhost`, or `::1` as a hostname; anything else — including a
   Compose service name such as `openwork-runtime` — is rejected with
   `Invalid myai server configuration: runtime must be internal`.

Consequences, and how this packaging satisfies them:

* The runtime and the TLS proxy do **not** get their own bridge network. They
  join the myai server's network namespace (`network_mode:
  "service:myai-server"`), so `127.0.0.1` names the same interface for all
  three processes. `openwork-runtime` can therefore keep the loopback URL the
  server demands, and `tls-proxy` is the only process that listens on a
  published port.
* **You cannot put the runtime on a separate bridge network**, even though
  `docs/myai-plan.md` §4.1 allows "loopback *or an isolated container network*".
  The merged server accepts loopback hostnames only, so the isolated-network
  option is not reachable today. This is a known gap between the plan text and
  the merged implementation; see the WP-7 PR for the report. Until it is
  addressed, use the shared-namespace topology in this guide.
* **A reverse proxy that is not inside this namespace cannot reach the server.**
  Terminate TLS either with the bundled `tls` profile (recommended), with your
  own proxy container that also sets `network_mode: "service:myai-server"` and
  listens on `127.0.0.1:8788`, or by running myai server outside Docker on the
  host with a host-level proxy in front of it.
* Anything that needs the server reachable at a stable address on a bridge
  network (Kubernetes, a multi-host orchestrator, a service-mesh sidecar) is out
  of scope for Phase 1 for the same reason.

---

## 4. Configuration reference

The compose file pins the container-side values below and takes the operator
values from the env file. Values marked *env file* are the ones you set; the
rest are part of the image/volume contract.

| Setting | Environment variable | Value used by this deployment | Source of truth |
|---|---|---|---|
| Environment | `MYAI_ENV` | `production` (fails closed) | compose |
| Data directory | `MYAI_DATA_DIR` | `/var/lib/myai/data` (the named volume) | compose |
| Database path | `MYAI_DATABASE_PATH` | `/var/lib/myai/data/control.sqlite` | compose |
| Workspace roots | `MYAI_WORKSPACE_ROOTS` | `/srv/myai/workspaces` (comma-separated for more) | compose |
| Runtime base URL | `MYAI_RUNTIME_BASE_URL` | `http://127.0.0.1:8787` — loopback only | compose |
| Host to bind | `MYAI_HOST` | `127.0.0.1` — loopback only in production | compose |
| Port to bind | `MYAI_PORT` | `8788` | compose |
| Log file | `MYAI_LOG_FILE` | `/var/lib/myai/data/myai-server.log` (JSON lines) | compose |
| Public base URL | `MYAI_PUBLIC_BASE_URL` | your HTTPS URL, no trailing slash | **env file** |
| Session secret | `MYAI_SESSION_SECRET` | at least 32 characters | **env file** |
| Bootstrap secret | `MYAI_BOOTSTRAP_SECRET` | one-time first-owner secret | **env file** |
| Workspace storage | `MYAI_WORKSPACE_HOST_PATH` | host directory, writable by uid `10001` | **env file** |
| Edge bind / port | `MYAI_EDGE_BIND`, `MYAI_EDGE_PORT` | `127.0.0.1`, `8443` | **env file** |
| TLS material | `MYAI_TLS_CERT_DIR` | host directory with `tls.crt` + `tls.key` | **env file** |
| Image overrides | `MYAI_SERVER_IMAGE`, `MYAI_RUNTIME_IMAGE`, `MYAI_TLS_PROXY_IMAGE` | optional pins | **env file** |

Server defaults when a variable is absent (`MYAI_DATA_DIR=./data`,
`MYAI_DATABASE_PATH=./data/control.sqlite`, `MYAI_RUNTIME_BASE_URL=
http://127.0.0.1:8787`, `MYAI_HOST=127.0.0.1`, `MYAI_PORT=8788`,
`MYAI_PUBLIC_BASE_URL=http://127.0.0.1`) are development conveniences. This
deployment never relies on them: the compose file sets each one explicitly, and
`MYAI_ENV=production` makes the server refuse to start when a required value is
missing or invalid (see §12).

`MYAI_PUBLIC_BASE_URL` is also the auth `baseURL` and the only trusted origin
(`apps/myai-server/src/auth.ts`), so it must be the exact URL users and the
desktop app use. Production cookies are `Secure`, which is why plain HTTP on
`8788` cannot complete a browser sign-in.

---

## 5. Fresh install

```bash
# 1. Get the sources and build the images.
git clone <your-fork-url> myai && cd myai/packaging/docker

# 2. Create the environment file from the template and fill it in.
cp .env.example .env
chmod 600 .env
$EDITOR .env          # MYAI_PUBLIC_BASE_URL, MYAI_SESSION_SECRET,
                      # MYAI_BOOTSTRAP_SECRET, MYAI_WORKSPACE_HOST_PATH

# 3. Generate the two secrets (placeholders in the template are not secrets).
openssl rand -base64 48   # -> MYAI_SESSION_SECRET
openssl rand -hex 32      # -> MYAI_BOOTSTRAP_SECRET

# 4. Prepare the workspace directory. The containers run as uid 10001.
sudo mkdir -p /srv/myai/workspaces/team-files
sudo chown -R 10001:10001 /srv/myai/workspaces

# 5. Put the TLS certificate and key in place.
mkdir -p tls && cp /path/to/fullchain.pem tls/tls.crt && cp /path/to/privkey.pem tls/tls.key

# 6. Start the stack (add --build the first time, or after an upgrade).
docker compose --env-file .env -f docker-compose.myai.yml --profile tls up -d --build

# 7. Watch it become ready.
docker compose --env-file .env -f docker-compose.myai.yml ps
curl -fsS https://myai.example.com/healthz
curl -fsS https://myai.example.com/readyz
```

Then create the first owner. The one-time bootstrap secret is presented as the
`X-Myai-Bootstrap-Secret` header, exactly once:

```bash
curl -fsS -X POST https://myai.example.com/api/v1/setup/owner \
  -H 'content-type: application/json' \
  -H "x-myai-bootstrap-secret: $MYAI_BOOTSTRAP_SECRET" \
  -d '{"email":"owner@example.com","password":"<at-least-8-chars>","name":"Owner"}'
```

The response sets an HTTP-only control-session cookie. Afterwards
`POST /api/v1/setup/owner` always returns `409 conflict` — the installation has
an owner — so remove `MYAI_BOOTSTRAP_SECRET` from `.env` and restart:

```bash
docker compose --env-file .env -f docker-compose.myai.yml --profile tls up -d
```

Register the first workspace. The path must already exist **inside** a
configured root; anything outside, or reaching outside through a symlink, is
rejected with `invalid_path`:

```bash
curl -fsS -c cookies.txt -X POST https://myai.example.com/api/v1/auth/sign-in \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"<password>"}'

curl -fsS -b cookies.txt -X POST https://myai.example.com/api/v1/workspaces \
  -H 'content-type: application/json' \
  -d '{"name":"Team files","path":"/srv/myai/workspaces/team-files"}'
```

Add members with `POST /api/v1/invitations` (the one-time `acceptCode` is shown
only in that response), grant workspace access with
`POST /api/v1/workspaces/{id}/access`, and read the audit trail with
`GET /api/v1/audit/events`. The full surface is in
[`apps/myai-server/CONTRACT.md`](../apps/myai-server/CONTRACT.md).

---

## 6. Health and readiness

| Endpoint | Meaning | Unauthenticated |
|---|---|---|
| `GET /healthz` | The process is alive: `{"status":"ok","service":"myai-server","version":"1.0"}` | yes |
| `GET /readyz` | Configuration, workspace roots, session secret, control database, and the loopback runtime are all usable | yes |

Both are served by the server itself; the runtime's own `GET /health` is only
reachable from inside the shared namespace.

```bash
# Compose health (readiness-based: the container reports healthy only when the runtime answers)
docker compose --env-file .env -f docker-compose.myai.yml ps

# Explicit checks from inside the namespace
docker compose --env-file .env -f docker-compose.myai.yml exec myai-server \
  node -e "fetch('http://127.0.0.1:8788/readyz').then(r=>r.text()).then(console.log)"
```

A `503` with `{"error":{"code":"not_ready"}}` means the server is up but not
ready — the `details` field says whether `config` or `runtime` failed. The most
common cause is a runtime that is not running or not answering on
`127.0.0.1:8787`.

---

## 7. TLS reverse proxy

### Bundled profile (recommended)

`--profile tls` starts a neutral nginx that terminates TLS on the published port
and forwards to `127.0.0.1:8788`. The configuration lives in the compose file
(`configs.myai_tls_config`), so there is no second file to keep in sync. It
enables TLS 1.2/1.3, disables proxy buffering (streaming responses and
websockets), allows 64 MB bodies, and forwards `Host`, `X-Forwarded-For`, and
`X-Forwarded-Proto`.

```bash
docker compose --env-file .env -f docker-compose.myai.yml --profile tls up -d
```

Verify the certificate is what you expect, then close the loop:

```bash
openssl s_client -connect myai.example.com:8443 -servername myai.example.com </dev/null 2>/dev/null | openssl x509 -noout -subject -dates
```

Self-signed certificates work for evaluation (`curl -k`), but the runtime is
openly reachable only through this port, so use a real certificate for anything
that matters.

### Bring your own proxy

The proxy must be able to open a TCP connection to `127.0.0.1:8788` **in the
myai server's network namespace** (§3). Either:

* run your proxy container with `network_mode: "service:myai-server"` and
  forward to `127.0.0.1:8788`, or
* drop the container and run `node apps/myai-server/dist/index.js` on the host
  with the same environment, then point your host-level proxy at
  `127.0.0.1:8788`.

A proxy on another host, or in its own bridge network, cannot reach the server
while the production loopback checks are in force.

---

## 8. Upgrade

```bash
cd myai && git fetch --tags && git checkout <new-tag-or-commit>

# 1. Back up first — always (§10). There is no migration runner yet.
# 2. Rebuild and restart.
cd packaging/docker
docker compose --env-file .env -f docker-compose.myai.yml --profile tls build --pull
docker compose --env-file .env -f docker-compose.myai.yml --profile tls up -d

# 3. Confirm readiness and version.
docker compose --env-file .env -f docker-compose.myai.yml ps
curl -fsS https://myai.example.com/healthz
```

The control database schema is created idempotently at boot
(`CREATE TABLE IF NOT EXISTS`, `apps/myai-server/src/database.ts`) and the
installation row is inserted with `INSERT OR IGNORE`, so restarting on an
existing volume preserves users, memberships, workspaces, tokens, and audit
events. Pending runtime credentials live at most 15 minutes and simply expire
across an upgrade; control sessions survive as long as `MYAI_SESSION_SECRET` is
unchanged.

There is no down-migration. If a future release changes an existing column, the
rollback path is the backup you took in step 1.

---

## 9. Rollback

```bash
cd myai && git checkout <previous-tag-or-commit>
cd packaging/docker
docker compose --env-file .env -f docker-compose.myai.yml down
docker compose --env-file .env -f docker-compose.myai.yml --profile tls up -d --build
curl -fsS https://myai.example.com/readyz
```

If the newer version wrote anything the older version cannot read, restore the
backup taken before the upgrade (§11) instead. Keep the `.env` file: a changed
`MYAI_SESSION_SECRET` invalidates every existing session (users sign in again;
their passwords and data are unaffected).

---

## 10. Backup

Back up **three** things: the control-data volume, the workspace directory, and
the env file.

```bash
cd packaging/docker
set -a; . ./.env; set +a          # load MYAI_WORKSPACE_HOST_PATH into this shell
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

# 1. Stop the writers so the SQLite database and the runtime state are quiescent.
docker compose --env-file .env -f docker-compose.myai.yml stop myai-server openwork-runtime tls-proxy

# 2. Control-data volume (control database + log file), using the image's own tar.
mkdir -p backups
docker run --rm -v myai_myai-control-data:/data -v "$PWD/backups:/backup" \
  myai-server:local tar czf "/backup/control-$STAMP.tgz" -C /data .

# 3. Workspace storage.
tar czf "backups/workspaces-$STAMP.tgz" -C "$(dirname "$MYAI_WORKSPACE_HOST_PATH")" "$(basename "$MYAI_WORKSPACE_HOST_PATH")"

# 4. The env file holds the session secret; store it with the backups, restricted.
cp .env "backups/env-$STAMP.bak" && chmod 600 "backups/env-$STAMP.bak"

# 5. Restart.
docker compose --env-file .env -f docker-compose.myai.yml --profile tls start
```

Volume name: the compose project is named `myai`, so the volume is
`myai_myai-control-data` unless you set `COMPOSE_PROJECT_NAME`. Confirm with
`docker volume ls`.

The control database never stores raw passwords or reusable access tokens, and
the runtime hashes and expires its credentials — but the volume and the env file
are still the crown jewels: anyone holding both can act as any member.

Restore-point cadence is yours to choose. The runtime credential table and audit
table grow forever; that growth is small text, and both live in the same SQLite
file.

---

## 11. Restore

```bash
cd packaging/docker
set -a; . ./.env; set +a
STAMP=<the backup you want>

# 1. Stop everything. `down` keeps the volume.
docker compose --env-file .env -f docker-compose.myai.yml down

# 2. Restore the control-data volume into a clean volume.
docker volume rm myai_myai-control-data
docker volume create myai_myai-control-data
docker run --rm -v myai_myai-control-data:/data -v "$PWD/backups:/backup:ro" \
  myai-server:local tar xzf "/backup/control-$STAMP.tgz" -C /data

# 3. Restore workspace storage (the archive is relative to the parent directory).
sudo rm -rf "$MYAI_WORKSPACE_HOST_PATH"
sudo mkdir -p "$(dirname "$MYAI_WORKSPACE_HOST_PATH")"
sudo tar xzf "backups/workspaces-$STAMP.tgz" -C "$(dirname "$MYAI_WORKSPACE_HOST_PATH")"
sudo chown -R 10001:10001 "$MYAI_WORKSPACE_HOST_PATH"

# 4. Restore the matching env file, or accept re-sign-in with a new secret.
cp "backups/env-$STAMP.bak" .env && chmod 600 .env

# 5. Start and verify.
docker compose --env-file .env -f docker-compose.myai.yml --profile tls up -d
curl -fsS https://myai.example.com/readyz
```

Round-trip check (used as deployment proof as well): bootstrap an owner, sign
in, back up, destroy the volume, restore, then sign in again with the same
credentials. The session cookie does not need to survive; the credentials and
the data must.

---

## 12. Fail-closed behaviour

The server refuses to start rather than run in an unsafe state. In production
(`MYAI_ENV=production`) these are hard errors:

| Condition | Error | Where |
|---|---|---|
| `MYAI_SESSION_SECRET` shorter than 32 characters | `session secret is too short` | config |
| Data directory or any workspace root does not exist | `data directory and workspace roots must exist` | config |
| A path is not absolute | `paths must be absolute` | config |
| `MYAI_RUNTIME_BASE_URL` empty or not `http(s)://` | `runtime URL is required` | config |
| Runtime host is not loopback | `runtime must be internal` | config |
| Runtime URL carries credentials | `runtime credentials are not allowed` | config |
| `MYAI_HOST` is not loopback | `production server must bind to loopback while HTTPS terminates at a reverse proxy` | config |
| `MYAI_PORT` not an integer in 0–65535 | `port is invalid` | config |
| `MYAI_PUBLIC_BASE_URL` unset, or either secret unset | Compose refuses to create the container | compose |

Check the failure explicitly:

```bash
# Missing secret: compose stops before a container exists.
env -u MYAI_SESSION_SECRET docker compose -f docker-compose.myai.yml config

# Bad value: the container starts and exits with the reason on stderr.
docker compose --env-file .env -f docker-compose.myai.yml run --rm \
  -e MYAI_SESSION_SECRET=short myai-server
docker compose --env-file .env -f docker-compose.myai.yml logs myai-server
```

---

## 13. Owner recovery

Phase 1 has **no ownership transfer, no self-service password reset, and no
recovery endpoint**. By design: `PATCH /api/v1/members/{id}` returns `forbidden`
for an owner target and `DELETE /api/v1/members/{id}` refuses to revoke the
owner, so nobody — including an admin — can take over or remove the owner
through the API.

What you can do, in order of preference:

1. **Sign in as the owner.** Passwords live in the control database as
   better-auth hashes; if the owner knows the password, nothing else is needed.
2. **Restore a backup.** If the password is lost, restore the control-data
   volume from a backup taken while it was known (§11). Any data created after
   that backup is lost with it.
3. **Re-bootstrap a fresh installation.** With the owner's consent and a copy of
   the workspace files, remove the control volume
   (`docker compose ... down -v`), start clean, and create the owner again with
   `MYAI_BOOTSTRAP_SECRET` (§5). Members, workspace grants, and the audit trail
   are re-created by hand — this is a last resort, not a recovery procedure.

There is deliberately no offline database-editing recipe. Do not hand-edit
`control.sqlite`; a wrong row breaks the one-active-owner constraint or leaves
sessions signed with a stale secret.

If you need real recovery tooling, that is a Phase 1 gap to raise rather than
work around: the honest limitations are recorded in the WP-7 PR and belong in
the next planning pass.

---

## 14. Log collection

Two streams, both safe to share: neither contains credentials, cookies, token
values, file contents, or prompt contents — the logger redacts any field whose
name matches `authorization`, `password`, `token`, `cookie`, `secret`, `prompt`,
`content`, `code`, or `acceptCode` (`apps/myai-server/src/logger.ts`).

```bash
cd packaging/docker

# Container stdout/stderr, all services, last 24h
docker compose --env-file .env -f docker-compose.myai.yml logs --since 24h

# The structured JSON log file inside the control-data volume
docker compose --env-file .env -f docker-compose.myai.yml exec myai-server \
  tail -n 200 /var/lib/myai/data/myai-server.log

# Copy it out for a support bundle
docker compose --env-file .env -f docker-compose.myai.yml exec myai-server \
  cat /var/lib/myai/data/myai-server.log > myai-server.log
```

Events recorded: `owner_bootstrapped`, `sign_in_succeeded`, `sign_in_failed`,
`invitation_created`, `invitation_accepted`, `member_role_changed`,
`member_revoked`, `sign_out`, `workspace_registered`,
`workspace_access_changed`, `runtime_token_created`, `runtime_token_revoked`,
`runtime_unavailable`, `internal_error`. The durable, admin-readable copy is
`GET /api/v1/audit/events`; the file is for operators.

Rotate the file by truncating it (`: > …/myai-server.log`) — the process appends
and reopens per write, so no restart is needed. It grows with usage; put the
volume on a disk you monitor.

---

## 15. Safe uninstall

```bash
cd packaging/docker

# 1. Stop and remove the containers and the network. The control-data volume and
#    the host workspace directory survive.
docker compose --env-file .env -f docker-compose.myai.yml --profile tls down

# 2. Take a final backup before destroying anything (§10).

# 3. Remove the control-data volume (destroys identity, workspaces registry,
#    tokens, audit history). This is irreversible.
docker volume rm myai_myai-control-data

# 4. Remove the images you built.
docker image rm myai-server:local myai-runtime:local

# 5. Remove everything else by hand — nothing outside this project is touched.
sudo rm -rf /srv/myai/workspaces      # workspace files
shred -u .env backups/env-*.bak       # secrets
rm -rf tls backups
```

`docker compose down -v` combines steps 1 and 3 in one command; prefer the
explicit form so the volume removal is deliberate. Uninstalling removes only
what belongs to this Compose project plus the host directories listed above.

---

## 16. Verifying a deployment

The packaging is covered by `evals/specs/myai-wp7-deployment.test.ts`, which
scripts a disposable-volume clean install, an upgrade, a backup/restore
round-trip, and the fail-closed matrix against the real server artifact:

```bash
# from the repository root
pnpm install --frozen-lockfile
pnpm --dir evals install --frozen-lockfile
pnpm --filter @myai/server build
pnpm --dir evals exec vitest run --project pr specs/myai-wp7-deployment.test.ts
```

Static validation of this directory:

```bash
cd packaging/docker
docker compose --env-file .env -f docker-compose.myai.yml --profile tls config
```

---

## 17. Known limitations

* **Runtime engine.** The runtime image serves files, sessions, approvals, and
  the HTTP surface. Agent execution additionally needs an OpenCode engine; this
  packaging does not ship or manage one, and `OPENWORK_MANAGE_OPENCODE=1` is not
  set. Point the runtime at an engine with `--opencode-base-url` (add it to the
  service `command`) or an `OPENWORK_OPENCODE_BIN` you provide.
* **Backups are cold.** The scripts stop the writer first; there is no online
  SQLite snapshot integration.
* **No owner recovery tooling** (§13), no ownership transfer, no password reset.
* **One loopback namespace per host.** Running two installations on one host
  needs distinct `MYAI_EDGE_PORT`, `MYAI_EDGE_BIND`, volume names, and workspace
  paths, and each stack has its own network namespace.
* **Recreate the project together.** The runtime and the proxy share the myai
  server's network namespace, so recreate all three at once (`down` then
  `up -d`, or `up -d --force-recreate`) after replacing that container. A
  namespace is rebuilt with its anchor, and a sharing container can be left
  pointing at the old one by a bare `docker compose restart myai-server`.
* **No high availability.** One host, one volume, one server process; the
  control plane is not horizontally scalable in Phase 1.
* **Public-URL coupling.** `MYAI_PUBLIC_BASE_URL` is the auth base URL and the
  only trusted origin. Changing it invalidates in-flight cookies and requires a
  restart.
