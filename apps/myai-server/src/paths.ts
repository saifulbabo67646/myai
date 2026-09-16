import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export class InvalidWorkspacePathError extends Error {
  constructor() {
    super("Workspace path is outside the configured roots.");
  }
}

function inside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export function validateWorkspacePath(candidate: string, roots: readonly string[]): string {
  if (!isAbsolute(candidate) || candidate.includes("\0") || roots.length === 0 || !existsSync(candidate)) {
    throw new InvalidWorkspacePathError();
  }
  const canonicalCandidate = realpathSync(candidate);
  for (const configuredRoot of roots) {
    if (!existsSync(configuredRoot)) continue;
    const canonicalRoot = realpathSync(configuredRoot);
    if (inside(canonicalRoot, canonicalCandidate)) return canonicalCandidate;
  }
  throw new InvalidWorkspacePathError();
}

export function validateWorkspaceFilePath(root: string, filePath: string): string {
  if (!filePath || filePath.includes("\0") || isAbsolute(filePath)) throw new InvalidWorkspacePathError();
  const candidate = resolve(root, filePath);
  const canonicalRoot = realpathSync(root);
  if (!inside(canonicalRoot, candidate)) throw new InvalidWorkspacePathError();
  const existing = existsSync(candidate) ? realpathSync(candidate) : realpathSync(dirname(candidate));
  if (!inside(canonicalRoot, existing)) throw new InvalidWorkspacePathError();
  return candidate;
}
