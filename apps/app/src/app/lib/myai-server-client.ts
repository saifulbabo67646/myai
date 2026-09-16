import { desktopFetchViaMainWithCredentials } from "./desktop";
import { isDesktopRuntime } from "./runtime-env";

export type MyaiUser = {
  id: string;
  email: string;
  name: string | null;
};

export type MyaiTeam = {
  id: string;
  name: string;
};

export type MyaiMembership = {
  userId: string;
  role: "owner" | "admin" | "member" | "viewer";
  status: string;
};

export type MyaiPrincipal = {
  user: MyaiUser;
  team: MyaiTeam;
  membership: MyaiMembership;
};

export type MyaiWorkspace = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
};

export type MyaiRuntimeToken = {
  token: string;
  workspaceId: string;
  scopes: string[];
  expiresAt: string;
};

type MyaiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type MyaiServerClientOptions = {
  baseUrl: string;
  fetcher?: MyaiFetch;
};

type MyaiErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_path"
  | "runtime_unavailable"
  | "not_ready"
  | "internal_error"
  | "unknown";

export class MyaiServerApiError extends Error {
  readonly status: number;
  readonly code: MyaiErrorCode;
  readonly requestId: string | null;

  constructor(message: string, status: number, code: MyaiErrorCode, requestId: string | null) {
    super(message);
    this.name = "MyaiServerApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`myai response is missing ${field}.`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`myai response has an invalid ${field}.`);
  }
  return value;
}

function normalizeMyaiServerUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("The myai server URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The myai server URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("The myai server URL must not contain credentials.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function parseUser(value: unknown): MyaiUser {
  const payload = object(value);
  if (!payload) throw new Error("myai response has an invalid user.");
  return {
    id: requiredString(payload.id, "user id"),
    email: requiredString(payload.email, "user email"),
    name: nullableString(payload.name, "user name"),
  };
}

function parsePrincipal(value: unknown): MyaiPrincipal {
  const payload = object(value);
  const team = payload ? object(payload.team) : null;
  const membership = payload ? object(payload.membership) : null;
  if (!payload || !team || !membership) throw new Error("myai response has an invalid principal.");
  const role = membership.role;
  if (role !== "owner" && role !== "admin" && role !== "member" && role !== "viewer") {
    throw new Error("myai response has an invalid membership role.");
  }
  return {
    user: parseUser(payload.user),
    team: {
      id: requiredString(team.id, "team id"),
      name: requiredString(team.name, "team name"),
    },
    membership: {
      userId: requiredString(membership.userId, "membership user id"),
      role,
      status: typeof membership.status === "string" ? membership.status : "active",
    },
  };
}

function parseWorkspace(value: unknown): MyaiWorkspace {
  const payload = object(value);
  if (!payload) throw new Error("myai response has an invalid workspace.");
  return {
    id: requiredString(payload.id, "workspace id"),
    name: requiredString(payload.name, "workspace name"),
    path: requiredString(payload.path, "workspace path"),
    createdAt: requiredString(payload.createdAt, "workspace creation time"),
  };
}

function parseWorkspaces(value: unknown): { workspaces: MyaiWorkspace[] } {
  const payload = object(value);
  if (!payload || !Array.isArray(payload.workspaces)) {
    throw new Error("myai response has an invalid workspace list.");
  }
  return { workspaces: payload.workspaces.map(parseWorkspace) };
}

function parseRuntimeToken(value: unknown): MyaiRuntimeToken {
  const payload = object(value);
  if (!payload) throw new Error("myai response has an invalid runtime token.");
  return {
    token: requiredString(payload.token, "runtime token"),
    workspaceId: requiredString(payload.workspaceId, "runtime workspace id"),
    scopes: stringArray(payload.scopes, "runtime scopes"),
    expiresAt: requiredString(payload.expiresAt, "runtime token expiry"),
  };
}

function parseApiError(value: unknown): {
  code: MyaiErrorCode;
  message: string;
  requestId: string | null;
} | null {
  const payload = object(value);
  const error = payload ? object(payload.error) : null;
  if (!error) return null;
  const rawCode = error.code;
  const code: MyaiErrorCode = rawCode === "invalid_request"
    || rawCode === "unauthenticated"
    || rawCode === "forbidden"
    || rawCode === "not_found"
    || rawCode === "conflict"
    || rawCode === "invalid_path"
    || rawCode === "runtime_unavailable"
    || rawCode === "not_ready"
    || rawCode === "internal_error"
    ? rawCode
    : "unknown";
  return {
    code,
    message: typeof error.message === "string" && error.message.length > 0
      ? error.message
      : "The myai server rejected the request.",
    requestId: typeof error.requestId === "string" ? error.requestId : null,
  };
}

async function request(
  baseUrl: string,
  fetcher: MyaiFetch,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetcher(`${baseUrl}${path}`, {
    ...init,
    headers,
    credentials: "include",
    signal: init.signal ?? AbortSignal.timeout(12_000),
  });
  if (response.status === 204) return null;
  const raw = await response.text();
  let payload: unknown = null;
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      payload = parsed;
    } catch {
      if (!response.ok) {
        throw new MyaiServerApiError("The myai server returned an invalid error response.", response.status, "unknown", response.headers.get("x-request-id"));
      }
      throw new Error("The myai server returned invalid JSON.");
    }
  }
  if (!response.ok) {
    const failure = parseApiError(payload);
    throw new MyaiServerApiError(
      failure?.message ?? `The myai server returned HTTP ${response.status}.`,
      response.status,
      failure?.code ?? "unknown",
      failure?.requestId ?? response.headers.get("x-request-id"),
    );
  }
  return payload;
}

function runtimePath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new Error("The runtime path is invalid.");
  }
  const parsed = new URL(value, "http://myai.invalid");
  if (parsed.pathname !== "/opencode/session" && parsed.pathname !== "/files/content") {
    throw new Error("The runtime operation is not supported.");
  }
  return `${parsed.pathname}${parsed.search}`;
}

export function createMyaiServerClient(options: MyaiServerClientOptions) {
  const baseUrl = normalizeMyaiServerUrl(options.baseUrl);
  const fetcher = options.fetcher
    ?? (isDesktopRuntime() ? desktopFetchViaMainWithCredentials : globalThis.fetch.bind(globalThis));

  return {
    async getMe(): Promise<MyaiPrincipal> {
      return parsePrincipal(await request(baseUrl, fetcher, "/api/v1/me"));
    },

    async signIn(email: string, password: string): Promise<MyaiPrincipal> {
      return parsePrincipal(await request(baseUrl, fetcher, "/api/v1/auth/sign-in", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }));
    },

    async signOut(): Promise<void> {
      await request(baseUrl, fetcher, "/api/v1/auth/sign-out", { method: "POST" });
    },

    async listWorkspaces(): Promise<{ workspaces: MyaiWorkspace[] }> {
      return parseWorkspaces(await request(baseUrl, fetcher, "/api/v1/workspaces"));
    },

    async createRuntimeToken(workspaceId: string): Promise<MyaiRuntimeToken> {
      return parseRuntimeToken(await request(
        baseUrl,
        fetcher,
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/runtime-token`,
        { method: "POST" },
      ));
    },

    async runtimeRequest(
      workspaceId: string,
      path: string,
      token: string,
      init: RequestInit = {},
    ): Promise<unknown> {
      const target = runtimePath(path);
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      return request(
        baseUrl,
        fetcher,
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/runtime${target}`,
        { ...init, headers },
      );
    },
  };
}

export function readMyaiString(value: unknown, field: string): string {
  const payload = object(value);
  return requiredString(payload?.[field], field);
}
