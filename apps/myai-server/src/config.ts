import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type MyaiEnvironment = "development" | "test" | "production";

export interface MyaiConfigInput {
  dataDir: string;
  databasePath: string;
  workspaceRoots: string[];
  runtimeBaseUrl: string;
  sessionSecret: string;
  environment?: MyaiEnvironment;
  bootstrapSecret?: string;
  publicBaseUrl?: string;
  host?: string;
  port?: number;
  logFile?: string;
}

export interface MyaiConfig {
  dataDir: string;
  databasePath: string;
  workspaceRoots: string[];
  runtimeBaseUrl: string;
  sessionSecret: string;
  environment: MyaiEnvironment;
  bootstrapSecret?: string;
  publicBaseUrl: string;
  host: string;
  port: number;
  logFile?: string;
}

function environment(value: string | undefined): MyaiEnvironment {
  if (value === "production" || value === "test") return value;
  return "development";
}

function validDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

export function resolveMyaiConfig(input: MyaiConfigInput): MyaiConfig {
  const mode = input.environment ?? "development";
  const dataDir = resolve(input.dataDir);
  const databasePath = resolve(input.databasePath);
  const workspaceRoots = input.workspaceRoots.map((root) => resolve(root));
  const runtimeBaseUrl = input.runtimeBaseUrl.trim().replace(/\/+$/, "");
  const publicBaseUrl = (input.publicBaseUrl ?? "http://127.0.0.1").trim().replace(/\/+$/, "");

  if (!isAbsolute(input.dataDir) || !isAbsolute(input.databasePath) || input.workspaceRoots.some((root) => !isAbsolute(root))) {
    throw new Error("Invalid myai server configuration: paths must be absolute");
  }
  if (!runtimeBaseUrl || !/^https?:\/\//.test(runtimeBaseUrl)) {
    throw new Error("Invalid myai server configuration: runtime URL is required");
  }
  if (mode === "production") {
    if (input.sessionSecret.trim().length < 32) {
      throw new Error("Invalid myai server configuration: session secret is too short");
    }
    if (!validDirectory(dataDir) || workspaceRoots.length === 0 || workspaceRoots.some((root) => !validDirectory(root))) {
      throw new Error("Invalid myai server configuration: data directory and workspace roots must exist");
    }
    const runtime = new URL(runtimeBaseUrl);
    if (runtime.hostname !== "127.0.0.1" && runtime.hostname !== "localhost" && runtime.hostname !== "::1") {
      throw new Error("Invalid myai server configuration: runtime must be internal");
    }
    const publicUrl = new URL(publicBaseUrl);
    const boundHost = input.host ?? "127.0.0.1";
    const loopbackHost = boundHost === "127.0.0.1" || boundHost === "localhost" || boundHost === "::1";
    if (!loopbackHost && publicUrl.protocol !== "https:") {
      throw new Error("Invalid myai server configuration: HTTPS is required for non-loopback access");
    }
  }
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 0 || input.port > 65535)) {
    throw new Error("Invalid myai server configuration: port is invalid");
  }

  return {
    dataDir,
    databasePath,
    workspaceRoots,
    runtimeBaseUrl,
    sessionSecret: input.sessionSecret,
    environment: mode,
    ...(input.bootstrapSecret ? { bootstrapSecret: input.bootstrapSecret } : {}),
    publicBaseUrl: publicBaseUrl || "http://127.0.0.1",
    host: input.host ?? "127.0.0.1",
    port: input.port ?? 8788,
    ...(input.logFile ? { logFile: resolve(input.logFile) } : {}),
  };
}

export function configFromEnvironment(env: NodeJS.ProcessEnv = process.env): MyaiConfig {
  const roots = (env.MYAI_WORKSPACE_ROOTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return resolveMyaiConfig({
    dataDir: env.MYAI_DATA_DIR ?? "./data",
    databasePath: env.MYAI_DATABASE_PATH ?? "./data/control.sqlite",
    workspaceRoots: roots,
    runtimeBaseUrl: env.MYAI_RUNTIME_BASE_URL ?? "http://127.0.0.1:8787",
    sessionSecret: env.MYAI_SESSION_SECRET ?? "",
    environment: environment(env.MYAI_ENV),
    ...(env.MYAI_BOOTSTRAP_SECRET ? { bootstrapSecret: env.MYAI_BOOTSTRAP_SECRET } : {}),
    ...(env.MYAI_PUBLIC_BASE_URL ? { publicBaseUrl: env.MYAI_PUBLIC_BASE_URL } : {}),
    ...(env.MYAI_HOST ? { host: env.MYAI_HOST } : {}),
    ...(env.MYAI_PORT ? { port: Number(env.MYAI_PORT) } : {}),
    ...(env.MYAI_LOG_FILE ? { logFile: env.MYAI_LOG_FILE } : {}),
  });
}
