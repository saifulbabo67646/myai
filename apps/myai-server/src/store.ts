import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "./database.js";

export type Role = "owner" | "admin" | "member" | "viewer";
export type GrantRole = "member" | "viewer";

export interface UserSummary {
  id: string;
  email: string;
  name: string;
}

export interface Membership {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: "active" | "revoked";
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface WorkspaceAccess {
  userId: string;
  role: GrantRole;
}

export interface Invitation {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  expiresAt: string;
}

export interface RuntimeCredential {
  id: string;
  workspaceId: string;
  userId: string;
  tokenHash: string;
  scopes: string[];
  expiresAt: number;
  revokedAt: number | null;
}

export interface AuditEvent {
  id: string;
  type: string;
  actorUserId: string | null;
  subjectId: string | null;
  workspaceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Database row missing ${field}`);
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberField(value: unknown, field: string): number {
  if (typeof value !== "number") throw new Error(`Database row missing ${field}`);
  return value;
}

function isoTime(value: unknown, field: string): string {
  return new Date(numberField(value, field)).toISOString();
}

function role(value: unknown): Role {
  if (value === "owner" || value === "admin" || value === "member" || value === "viewer") return value;
  throw new Error("Database row contains invalid role");
}

function grantRole(value: unknown): GrantRole {
  if (value === "member" || value === "viewer") return value;
  throw new Error("Database row contains invalid workspace role");
}

function membershipRow(value: unknown): Membership {
  const row = record(value);
  if (!row) throw new Error("Expected membership row");
  const status = row.status === "active" || row.status === "revoked" ? row.status : null;
  if (!status) throw new Error("Database row contains invalid membership status");
  return {
    userId: stringField(row.user_id, "user_id"),
    email: stringField(row.email, "email"),
    name: stringField(row.name, "name"),
    role: role(row.role),
    status,
    createdAt: isoTime(row.created_at, "created_at"),
  };
}

function workspaceRow(value: unknown): Workspace {
  const row = record(value);
  if (!row) throw new Error("Expected workspace row");
  return {
    id: stringField(row.id, "id"),
    name: stringField(row.name, "name"),
    path: stringField(row.path, "path"),
    createdAt: isoTime(row.created_at, "created_at"),
  };
}

export class ControlStore {
  constructor(readonly database: SqliteDatabase) {}

  ownerExists(): boolean {
    const row: unknown = this.database.prepare("SELECT 1 AS present FROM myai_membership WHERE role = 'owner' AND status = 'active' LIMIT 1").get();
    return record(row)?.present === 1;
  }

  addMembership(user: UserSummary, memberRole: Role): void {
    const now = Date.now();
    this.database.prepare("INSERT INTO myai_membership (id, installation_id, user_id, role, status, created_at) VALUES (?, 'team_local', ?, ?, 'active', ?)").run(randomUUID(), user.id, memberRole, now);
  }

  membership(userId: string): Membership | null {
    const row: unknown = this.database.prepare("SELECT m.user_id, u.email, u.name, m.role, m.status, m.created_at FROM myai_membership m JOIN user u ON u.id = m.user_id WHERE m.user_id = ?").get(userId);
    return row === undefined ? null : membershipRow(row);
  }

  activeMembership(userId: string): Membership | null {
    const found = this.membership(userId);
    return found?.status === "active" ? found : null;
  }

  members(): Membership[] {
    const rows: unknown[] = this.database.prepare("SELECT m.user_id, u.email, u.name, m.role, m.status, m.created_at FROM myai_membership m JOIN user u ON u.id = m.user_id ORDER BY m.created_at, m.user_id").all();
    return rows.map(membershipRow);
  }

  changeRole(userId: string, memberRole: Exclude<Role, "owner">): Membership | null {
    this.database.prepare("UPDATE myai_membership SET role = ? WHERE user_id = ? AND role <> 'owner'").run(memberRole, userId);
    return this.membership(userId);
  }

  revokeMember(userId: string): boolean {
    const result = this.database.prepare("UPDATE myai_membership SET status = 'revoked' WHERE user_id = ? AND role <> 'owner' AND status = 'active'").run(userId);
    this.database.prepare("DELETE FROM session WHERE user_id = ?").run(userId);
    this.database.prepare("UPDATE myai_runtime_credential SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(Date.now(), userId);
    return result.changes > 0;
  }

  createInvitation(email: string, memberRole: Exclude<Role, "owner">, codeHash: string, expiresAt: number): Invitation {
    const id = `inv_${randomUUID()}`;
    this.database.prepare("INSERT INTO myai_invitation (id, installation_id, email, role, code_hash, expires_at, created_at) VALUES (?, 'team_local', ?, ?, ?, ?, ?)").run(id, email, memberRole, codeHash, expiresAt, Date.now());
    return { id, email, role: memberRole, expiresAt: new Date(expiresAt).toISOString() };
  }

  invitationByHash(codeHash: string): (Invitation & { codeHash: string; acceptedAt: number | null; revokedAt: number | null }) | null {
    const value: unknown = this.database.prepare("SELECT id, email, role, code_hash, expires_at, accepted_at, revoked_at FROM myai_invitation WHERE code_hash = ?").get(codeHash);
    const row = record(value);
    if (!row) return null;
    const memberRole = row.role === "admin" || row.role === "member" || row.role === "viewer" ? row.role : null;
    if (!memberRole) throw new Error("Database row contains invalid invitation role");
    return {
      id: stringField(row.id, "id"),
      email: stringField(row.email, "email"),
      role: memberRole,
      codeHash: stringField(row.code_hash, "code_hash"),
      expiresAt: new Date(numberField(row.expires_at, "expires_at")).toISOString(),
      acceptedAt: typeof row.accepted_at === "number" ? row.accepted_at : null,
      revokedAt: typeof row.revoked_at === "number" ? row.revoked_at : null,
    };
  }

  acceptInvitation(id: string): void {
    this.database.prepare("UPDATE myai_invitation SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL").run(Date.now(), id);
  }

  createWorkspace(name: string, path: string): Workspace {
    const id = `wsp_${randomUUID()}`;
    const now = Date.now();
    this.database.prepare("INSERT INTO myai_workspace (id, installation_id, name, path, created_at) VALUES (?, 'team_local', ?, ?, ?)").run(id, name, path, now);
    return { id, name, path, createdAt: new Date(now).toISOString() };
  }

  workspace(workspaceId: string): Workspace | null {
    const value: unknown = this.database.prepare("SELECT id, name, path, created_at FROM myai_workspace WHERE id = ?").get(workspaceId);
    return value === undefined ? null : workspaceRow(value);
  }

  workspacesFor(userId: string, elevated: boolean): Workspace[] {
    const rows: unknown[] = elevated
      ? this.database.prepare("SELECT id, name, path, created_at FROM myai_workspace ORDER BY created_at, id").all()
      : this.database.prepare("SELECT w.id, w.name, w.path, w.created_at FROM myai_workspace w JOIN myai_workspace_access a ON a.workspace_id = w.id WHERE a.user_id = ? ORDER BY w.created_at, w.id").all(userId);
    return rows.map(workspaceRow);
  }

  grantWorkspace(workspaceId: string, userId: string, accessRole: GrantRole): WorkspaceAccess {
    this.database.prepare("INSERT INTO myai_workspace_access (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role").run(randomUUID(), workspaceId, userId, accessRole, Date.now());
    return { userId, role: accessRole };
  }

  revokeWorkspace(workspaceId: string, userId: string): boolean {
    const result = this.database.prepare("DELETE FROM myai_workspace_access WHERE workspace_id = ? AND user_id = ?").run(workspaceId, userId);
    this.database.prepare("UPDATE myai_runtime_credential SET revoked_at = ? WHERE workspace_id = ? AND user_id = ? AND revoked_at IS NULL").run(Date.now(), workspaceId, userId);
    return result.changes > 0;
  }

  workspaceAccess(workspaceId: string, userId: string): GrantRole | null {
    const value: unknown = this.database.prepare("SELECT role FROM myai_workspace_access WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId);
    const row = record(value);
    return row ? grantRole(row.role) : null;
  }

  createRuntimeCredential(workspaceId: string, userId: string, tokenHash: string, scopes: string[], expiresAt: number): RuntimeCredential {
    const id = `rtc_${randomUUID()}`;
    this.database.prepare("INSERT INTO myai_runtime_credential (id, workspace_id, user_id, token_hash, scopes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, workspaceId, userId, tokenHash, JSON.stringify(scopes), expiresAt, Date.now());
    return { id, workspaceId, userId, tokenHash, scopes, expiresAt, revokedAt: null };
  }

  runtimeCredential(tokenHash: string): RuntimeCredential | null {
    const value: unknown = this.database.prepare("SELECT id, workspace_id, user_id, token_hash, scopes, expires_at, revoked_at FROM myai_runtime_credential WHERE token_hash = ?").get(tokenHash);
    const row = record(value);
    if (!row || typeof row.scopes !== "string" || !Array.isArray(JSON.parse(row.scopes))) return null;
    const parsedScopes: unknown = JSON.parse(row.scopes);
    if (!Array.isArray(parsedScopes) || !parsedScopes.every((scope) => typeof scope === "string")) return null;
    return {
      id: stringField(row.id, "id"),
      workspaceId: stringField(row.workspace_id, "workspace_id"),
      userId: stringField(row.user_id, "user_id"),
      tokenHash: stringField(row.token_hash, "token_hash"),
      scopes: parsedScopes,
      expiresAt: numberField(row.expires_at, "expires_at"),
      revokedAt: typeof row.revoked_at === "number" ? row.revoked_at : null,
    };
  }

  audit(type: string, actorUserId: string | null, subjectId: string | null, workspaceId: string | null, metadata: Record<string, unknown> = {}): void {
    this.database.prepare("INSERT INTO myai_audit_event (id, event_type, actor_user_id, subject_id, workspace_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(`aud_${randomUUID()}`, type, actorUserId, subjectId, workspaceId, JSON.stringify(metadata), Date.now());
  }

  auditEvents(limit: number): AuditEvent[] {
    const rows: unknown[] = this.database.prepare("SELECT id, event_type, actor_user_id, subject_id, workspace_id, metadata_json, created_at FROM myai_audit_event ORDER BY created_at DESC, id DESC LIMIT ?").all(limit);
    return rows.map((value) => {
      const row = record(value);
      if (!row || typeof row.metadata_json !== "string") throw new Error("Database row contains invalid audit event");
      const metadata: unknown = JSON.parse(row.metadata_json);
      const metadataRecord = record(metadata);
      if (!metadataRecord) throw new Error("Database row contains invalid audit metadata");
      return {
        id: stringField(row.id, "id"),
        type: stringField(row.event_type, "event_type"),
        actorUserId: nullableString(row.actor_user_id),
        subjectId: nullableString(row.subject_id),
        workspaceId: nullableString(row.workspace_id),
        metadata: metadataRecord,
        createdAt: isoTime(row.created_at, "created_at"),
      };
    });
  }
}
