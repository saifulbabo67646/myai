import { defineHeadlessWebWorld } from "../packages/world/src/index.ts";

/** Isolated source UI + local backend. This is the world behind pnpm dev:headless-web. */
export const isolated = defineHeadlessWebWorld({ state: "isolated", detached: true });

export default isolated;
