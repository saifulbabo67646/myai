import { access, readdir } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isWorldDefinition } from "./definition.ts";
import type { LaunchableWorldDefinition } from "./definition.ts";

export interface DiscoveredWorld {
  name: string;
  path: string;
}

export interface LoadedWorld {
  definition: LaunchableWorldDefinition;
  defaultName?: string;
  description: string;
  sourcePath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function definitionFromModule(value: unknown): LaunchableWorldDefinition | null {
  if (!isRecord(value)) return null;
  if (isWorldDefinition(value.default)) return value.default;
  if (isWorldDefinition(value.world)) return value.world;
  return null;
}

function worldName(path: string): string {
  return basename(path, extname(path));
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

export async function discoverWorlds(directory: string): Promise<DiscoveredWorld[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort()
    .map((name) => ({ name: worldName(name), path: join(directory, name) }));
}

export async function loadWorldFile(path: string): Promise<LoadedWorld> {
  const absolutePath = resolve(path);
  const loaded: unknown = await import(pathToFileURL(absolutePath).href);
  const definition = definitionFromModule(loaded);
  if (!definition) {
    throw new Error(`World file ${JSON.stringify(path)} must export a world definition as default or as \`world\`.`);
  }
  return {
    definition,
    defaultName: worldName(absolutePath),
    description: `world file ${path}`,
    sourcePath: absolutePath,
  };
}

export async function loadWorldSource(
  source: string,
  options: {
    cwd: string;
    worldsDirectory: string;
    presets: Readonly<Record<string, LaunchableWorldDefinition>>;
  },
): Promise<LoadedWorld> {
  const preset = options.presets[source];
  if (preset) return { definition: preset, description: `preset ${source}` };

  const requestedPath = isAbsolute(source) ? source : resolve(options.cwd, source);
  if (await exists(requestedPath)) return loadWorldFile(requestedPath);

  const discovered = (await discoverWorlds(options.worldsDirectory)).find((candidate) => candidate.name === source);
  if (discovered) return loadWorldFile(discovered.path);

  const available = [
    ...Object.keys(options.presets),
    ...(await discoverWorlds(options.worldsDirectory)).map((world) => world.name),
  ].sort();
  throw new Error(`Unknown world ${JSON.stringify(source)}. Available: ${available.join(", ") || "(none)"}.`);
}

export function displayWorldPath(path: string, cwd: string): string {
  const displayed = relative(cwd, path);
  return displayed.startsWith("..") ? path : displayed;
}
