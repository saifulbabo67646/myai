export type WorldPatch<T> = T extends object
  ? { [Key in keyof T]?: WorldPatch<T[Key]> }
  : T;

export interface WorldDefinitionMetadata {
  adapter: string;
  detached?: boolean;
  requiresSharedState?: boolean;
}

export type WorldDefinitionMetadataResolver<TTopology> =
  | WorldDefinitionMetadata
  | ((topology: TTopology) => WorldDefinitionMetadata);

export interface WorldDefinition<TTopology = unknown> {
  readonly adapter: string;
  readonly detached: boolean;
  readonly requiresSharedState: boolean;
  readonly topology: TTopology;
  with(patch: WorldPatch<TTopology>): WorldDefinition<TTopology>;
}

export interface LaunchableWorldDefinition {
  readonly adapter: string;
  readonly detached: boolean;
  readonly requiresSharedState: boolean;
  readonly topology: unknown;
}

export type WorldTopologyValidator<TTopology> = (input: unknown) => TTopology;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return merged;
}

function makeDefinition<TTopology>(
  topology: TTopology,
  metadataResolver: WorldDefinitionMetadataResolver<TTopology>,
  validate: WorldTopologyValidator<TTopology>,
): WorldDefinition<TTopology> {
  const metadata = typeof metadataResolver === "function"
    ? metadataResolver(topology)
    : metadataResolver;
  return {
    adapter: metadata.adapter,
    detached: metadata.detached ?? false,
    requiresSharedState: metadata.requiresSharedState ?? false,
    topology,
    with(patch) {
      return makeDefinition(
        validate(deepMerge(topology, patch)),
        metadataResolver,
        validate,
      );
    },
  };
}

export function createWorldDefinition<TTopology>(
  topology: TTopology,
  metadata: WorldDefinitionMetadataResolver<TTopology>,
  validate: WorldTopologyValidator<TTopology>,
): WorldDefinition<TTopology> {
  return makeDefinition(validate(topology), metadata, validate);
}

/** Define a trusted adapter-owned topology. Its runtime adapter performs validation before launch. */
export function defineWorld(
  topology: unknown,
  metadata: WorldDefinitionMetadata,
): WorldDefinition {
  return makeDefinition(topology, metadata, (input) => input);
}

export function isWorldDefinition(value: unknown): value is LaunchableWorldDefinition {
  return isRecord(value)
    && typeof value.adapter === "string"
    && typeof value.detached === "boolean"
    && typeof value.requiresSharedState === "boolean"
    && "topology" in value;
}
