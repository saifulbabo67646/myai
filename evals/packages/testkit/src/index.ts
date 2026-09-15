import { readFile } from "node:fs/promises";
import { startWorld as startWorldRaw } from "@openwork/env";
import type { StartWorldOptions, World, WorldDefinition, WorldTopology } from "@openwork/env";
import { currentTestEvidence } from "@openwork/test-evidence";

export { createDesktopHandoffGrant, signInDesktopAs } from "@openwork/behaviors";
export type { DesktopHandle } from "@openwork/hosts";
export { test } from "./fixture.ts";
export * from "@openwork/env";
export * from "./brief.ts";
export * from "./eventually.ts";
export * from "./link.ts";
export * from "./self-host.ts";
export * from "./state.ts";

export async function startWorld(
  definition: WorldDefinition | WorldTopology,
  options: StartWorldOptions = {},
): Promise<World> {
  const world = await startWorldRaw(definition, options);
  try {
    const snapshot: unknown = JSON.parse(await readFile(world.snapshotPath, "utf8"));
    currentTestEvidence()?.recordJsonArtifact(`world-snapshot ${world.name}`, snapshot);
  } catch (error) {
    console.error(`[openwork/testkit] world snapshot evidence attach failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return world;
}
