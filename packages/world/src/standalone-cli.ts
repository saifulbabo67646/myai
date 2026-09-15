import { join, resolve } from "node:path";
import { main } from "./cli.ts";
import { createHeadlessWebAdapter } from "./headless-adapter.ts";

/** Standalone shared-package CLI. Repository-specific adapters compose their own wrapper. */
export function runStandaloneWorldCli(
  argv: string[] = process.argv.slice(2),
  cwdInput: string = process.cwd(),
): Promise<number> {
  const cwd = resolve(cwdInput);
  return main(argv, {
    cwd,
    worldsDirectory: join(cwd, "worlds"),
    adapters: [createHeadlessWebAdapter(cwd)],
  });
}
