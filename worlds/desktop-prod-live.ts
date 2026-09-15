import { createWorldDefinition } from "../packages/world/src/index.ts";
import {
  parseWorldTopology,
  usesLiveSharedProductionState,
} from "../evals/packages/env/src/topology.ts";

/** Eval runtime topology: isolated source Electron pointed at installed production state. */
export const desktopProductionLiveTopology: {
  den: { orgs: Record<string, never>; substrate: "local" };
  apps: {
    main: {
      desktopState: { source: "installed-production"; mode: "live-shared" };
    };
  };
} = {
  den: { orgs: {}, substrate: "local" },
  apps: {
    main: {
      desktopState: { source: "installed-production", mode: "live-shared" },
    },
  },
};

export default createWorldDefinition(desktopProductionLiveTopology, (topology) => ({
  adapter: "eval",
  detached: true,
  requiresSharedState: usesLiveSharedProductionState(topology),
}), parseWorldTopology);
