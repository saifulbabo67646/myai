import { createWorldDefinition } from "./definition.ts";
import type { WorldDefinition } from "./definition.ts";
import type { HeadlessWebState } from "./headless-web-helpers.ts";

export interface HeadlessWebTopology {
  surface: {
    kind: "headless-web";
    state: HeadlessWebState;
    workspace?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseHeadlessWebTopology(value: unknown): HeadlessWebTopology {
  if (!isRecord(value) || !isRecord(value.surface)) {
    throw new Error("A headless-web world must define surface.kind and surface.state.");
  }
  if (value.surface.kind !== "headless-web") {
    throw new Error('A headless-web world requires surface.kind "headless-web".');
  }
  if (value.surface.state !== "isolated" && value.surface.state !== "installed-production") {
    throw new Error('A headless-web world state must be "isolated" or "installed-production".');
  }
  if (value.surface.workspace !== undefined && typeof value.surface.workspace !== "string") {
    throw new Error("A headless-web workspace must be a path string.");
  }
  return {
    surface: {
      kind: "headless-web",
      state: value.surface.state,
      ...(value.surface.workspace === undefined ? {} : { workspace: value.surface.workspace }),
    },
  };
}

export function defineHeadlessWebWorld(input: {
  state: HeadlessWebState;
  workspace?: string;
  detached?: boolean;
}): WorldDefinition<HeadlessWebTopology> {
  return createWorldDefinition({
    surface: {
      kind: "headless-web",
      state: input.state,
      ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
    },
  }, (topology) => ({
    adapter: "headless-web",
    detached: input.detached ?? true,
    requiresSharedState: topology.surface.state === "installed-production",
  }), parseHeadlessWebTopology);
}
