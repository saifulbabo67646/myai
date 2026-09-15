import { defineHeadlessWebWorld } from "../packages/world/src/index.ts";

/** Source web/backend processes using the installed production desktop stores. */
export default defineHeadlessWebWorld({ state: "installed-production", detached: true });
