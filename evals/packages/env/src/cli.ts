import { fileURLToPath } from "node:url";
import { createHeadlessWebAdapter, main as runWorldCli, parseWorldArgs } from "@openwork/world";
import { acmeDemo, acmeDocs, desktopProductionLive, soloWorkspace, supportOrg } from "./presets.ts";
import { createEvalWorldAdapter } from "./world-adapter.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

export const presetCatalog = {
  "acme-demo": acmeDemo,
  "acme-docs": acmeDocs,
  "desktop-prod-live": desktopProductionLive,
  solo: soloWorkspace,
  "support-org": supportOrg,
};

export { parseWorldArgs };

export function main(argv = process.argv.slice(2)): Promise<number> {
  return runWorldCli(argv, {
    cwd: REPO_ROOT,
    worldsDirectory: fileURLToPath(new URL("../../../../worlds", import.meta.url)),
    presets: presetCatalog,
    adapters: [createHeadlessWebAdapter(REPO_ROOT), createEvalWorldAdapter()],
  });
}
