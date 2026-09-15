import { join, resolve } from "node:path";
import { main } from "./cli.ts";
import { createHeadlessWebAdapter } from "./headless-adapter.ts";
import { defineHeadlessWebWorld } from "./headless-definition.ts";

function readBool(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function runDevHeadlessWebCompatibility(
  argv: string[],
  repoRootInput: string,
): Promise<number> {
  const repoRoot = resolve(repoRootInput);
  const args = [...argv];
  if (readBool(process.env.OPENWORK_DEV_HEADLESS_WEB_REPLACE) && !args.includes("--replace")) {
    args.push("--replace");
  }
  const nameArgs = args.includes("--name") ? [] : ["--name", "dev-headless"];
  return main(["up", "dev-headless", ...nameArgs, ...args], {
    cwd: repoRoot,
    worldsDirectory: join(repoRoot, "worlds"),
    presets: {
      // The legacy command remains foreground by default; the checked-in
      // world file is detached by default when invoked through `world up`.
      "dev-headless": defineHeadlessWebWorld({ state: "isolated", detached: false }),
    },
    adapters: [createHeadlessWebAdapter(repoRoot)],
  });
}
