import { runDevHeadlessWebCompatibility } from "../packages/world/src/index.ts";

process.exitCode = await runDevHeadlessWebCompatibility(process.argv.slice(2), process.cwd());
