# myai Server API Contract

**Contract version:** `1.0`

This document defines the public control-plane API for a single-team myai
installation. It is independently authored from the myai Phase 1 requirements
in `docs/myai-plan.md` and is not an implementation of any external service.

## Boundary and transport

The public service is rooted at `/api/v1`. JSON endpoints use
`Content-Type: application/json`; timestamps are RFC 3339 strings. Production
access requires HTTPS. `/healthz` and `/readyz` are unauthenticated and expose
only service status.

The local execution runtime is an internal dependency. It must bind to
loopback or an isolated container network and is never advertised as a public
endpoint. Runtime calls are available only through the scoped proxy described
below.

## Common response shapes

Successful responses use the DTO named by the route. Errors use this envelope:

```json
{
  "error": {
    "code": "unauthenticated",
    "message": "Authentication is required.",
    "requestId": "req_...",
    "details": {}
  }
}
```

`requestId` is present on every API response and is safe to share with an
administrator. `details` is optional and contains field names or safe public
identifiers only; it never contains credentials, cookies, token values, file
contents, or prompts.

The stable error taxonomy is:

| Code | HTTP | Meaning |
|---|---:|---|
| `invalid_request` | 400 | Malformed JSON, invalid field, or unsupported operation. |
| `unauthenticated` | 401 | No valid control session or runtime credential. |
| `forbidden` | 403 | Authenticated principal lacks the required role, grant, or scope. |
| `not_found` | 404 | Resource does not exist or is not visible to the principal. |
| `conflict` | 409 | Operation conflicts with installation state or an existing record. |
| `invalid_path` | 422 | Workspace path is outside configured roots or escapes through a link. |
| `runtime_unavailable` | 502 | The selected local runtime cannot be reached. |
| `not_ready` | 503 | Required server configuration or storage is not ready. |
| `internal_error` | 500 | Unexpected server failure; details are omitted. |

## Authentication and sessions

### `POST /api/v1/setup/owner`

Bootstraps the first owner exactly once. The request is accepted only when no
owner exists and the server is configured for bootstrap. A deployment may
require a separate one-time bootstrap secret through configuration.

Request:

```json
{ "email": "owner@example.test", "password": "correct horse battery staple", "name": "Owner" }
```

Response `201` is `BootstrapResult`:

```json
{
  "user": { "id": "usr_...", "email": "owner@example.test", "name": "Owner" },
  "team": { "id": "team_...", "name": "myai team" },
  "membership": { "userId": "usr_...", "role": "owner" },
  "session": { "id": "ses_...", "expiresAt": "2026-10-16T00:00:00Z" }
}
```

The response also sets an HTTP-only control-session cookie. The raw session
credential is never included in logs or persisted in plaintext.

### `POST /api/v1/auth/sign-in`

Request `{ "email": string, "password": string }`; response `200` is
`SessionResult` containing `user`, `membership`, and `session`. Invalid
credentials return the same `unauthenticated` response regardless of whether
the email exists.

### `POST /api/v1/auth/sign-out`

Revokes the current control session and clears its cookie. Response `204`.

### `GET /api/v1/me`

Returns `CurrentPrincipal`:

```json
{
  "user": { "id": "usr_...", "email": "member@example.test", "name": "Member" },
  "team": { "id": "team_...", "name": "myai team" },
  "membership": { "userId": "usr_...", "role": "member", "status": "active" }
}
```

## Membership and invitations

Roles are exactly `owner`, `admin`, `member`, and `viewer`. The server checks
the role on every protected request. An owner is the only role that can change
ownership or remove an admin; an admin can manage non-owner members and
workspace access.

### `POST /api/v1/invitations`

Owner/admin only. Request `{ "email": string, "role": "admin" | "member" | "viewer" }`.
Response `201` is `Invitation` plus a one-time `acceptCode` shown only in this
response:

```json
{
  "invitation": { "id": "inv_...", "email": "member@example.test", "role": "member", "expiresAt": "2026-09-23T00:00:00Z" },
  "acceptCode": "invite_..."
}
```

The code is hashed at rest, expires, and is invalid after acceptance or
revocation. It must be scrubbed from logs and URLs before logging.

### `POST /api/v1/invitations/{acceptCode}/accept`

Unauthenticated one-time acceptance. Request
`{ "name": string, "password": string }`; response `201` is `SessionResult`
and sets a control-session cookie. The invitation email becomes the new user's
email. Reuse or expiry returns `not_found`.

### `GET /api/v1/members`

Owner/admin only. Returns `{ "members": Member[] }` where each member has
`id`, `email`, `name`, `role`, `status`, `createdAt`.

### `PATCH /api/v1/members/{userId}`

Owner/admin only. Request `{ "role": Role }`; response `200` is the updated
`Member`. Ownership transfer is not part of Phase 1 and returns `forbidden`.

### `DELETE /api/v1/members/{userId}`

Owner/admin only. Revokes membership, all control sessions, workspace grants,
and runtime credentials for the user. Response `204`.

## Workspace registry and access

### `POST /api/v1/workspaces`

Owner/admin only. Request `{ "name": string, "path": string }`. `path` must
be absolute, resolve beneath one configured workspace root, and remain inside
that root after canonicalization. Traversal, missing roots, and symlink escape
return `invalid_path`.

Response `201` is `Workspace`:

```json
{
  "id": "wsp_...",
  "name": "Team files",
  "path": "/srv/myai/workspaces/team-files",
  "createdAt": "2026-09-16T00:00:00Z"
}
```

The canonical path is stored; no user-supplied path is used for runtime
routing after validation.

### `GET /api/v1/workspaces`

Returns only workspaces visible to the current principal as
`{ "workspaces": WorkspaceWithAccess[] }`. Owners/admins see all registered
workspaces. Members/viewers see only granted workspaces.

### `POST /api/v1/workspaces/{workspaceId}/access`

Owner/admin only. Request `{ "userId": string, "role": "member" | "viewer" }`.
Creates or replaces the user's grant. Response `201` is `WorkspaceGrant`.

### `DELETE /api/v1/workspaces/{workspaceId}/access/{userId}`

Owner/admin only. Revokes that grant and its runtime credentials. Response
`204`.

## Scoped runtime credentials and proxy

### `POST /api/v1/workspaces/{workspaceId}/runtime-token`

Requires a valid control session and a workspace grant. It creates a
short-lived opaque runtime credential with a maximum lifetime of 15 minutes.
The raw value is returned once:

```json
{
  "token": "rt_...",
  "workspaceId": "wsp_...",
  "scopes": ["runtime:session", "file:read", "file:write"],
  "expiresAt": "2026-09-16T00:15:00Z"
}
```

The token hash, workspace id, subject id, scopes, expiry, and revocation time
are stored. The raw token is never stored. Revoking a member or workspace
grant immediately invalidates all tokens for that subject/workspace.

### `ALL /api/v1/workspaces/{workspaceId}/runtime/{runtimePath}`

Requires `Authorization: Bearer <runtime-token>`. The server validates the
hashed token, expiry, revocation, subject, workspace, and required scope before
forwarding the request to the configured local runtime. The control session is
not forwarded. The proxy preserves the runtime protocol's method, safe request
headers, body, status, and response content type, while stripping hop-by-hop
headers and all credentials.

Phase 1 supports these public proxy operations:

| Runtime path | Method | Required scope |
|---|---|---|
| `/opencode/session` | `POST` | `runtime:session` |
| `/files/content?path=...` | `GET` | `file:read` |
| `/files/content?path=...` | `PUT` | `file:write` |

The file query path is revalidated against the registered canonical workspace
root before forwarding. Unsupported runtime paths return `forbidden`.

## Audit events

### `GET /api/v1/audit/events`

Owner/admin only. Supports `limit` (1–100) and `cursor`. Returns
`{ "events": AuditEvent[], "nextCursor": string | null }`. Each event has
`id`, `type`, `actorUserId`, `subjectId`, `workspaceId`, `createdAt`, and a
small safe `metadata` object. Event types include `owner_bootstrapped`,
`sign_in_succeeded`, `sign_in_failed`, `invitation_created`,
`invitation_accepted`, `member_role_changed`, `member_revoked`,
`workspace_registered`, `workspace_access_changed`, `runtime_token_created`,
`runtime_token_revoked`, `workspace_accessed`, and `authorization_failed`.

## Health and readiness

### `GET /healthz`

Returns `200` `{ "status": "ok", "service": "myai-server", "version": "1.0" }`
when the process is alive.

### `GET /readyz`

Returns `200` `{ "status": "ready", "checks": { "config": "ok", "database": "ok" } }`
only when required production configuration, data directory, configured roots,
and control database are usable. A failed check returns `503` with the same
shape and a safe check status; secret values and filesystem contents are never
returned.
