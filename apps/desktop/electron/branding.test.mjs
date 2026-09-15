import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

const ALLOWED_OPENWORK_SUFFIX = /^[ -](?:Cloud|Server|server|servers|Models|models|agent|Agent|agents|support|Den|worker|workers|host|hosts|workspace|workspaces|endpoint|endpoints|client|clients|token|tokens|organization|organizations|org|managed|provided|injected|owned|built|hosted|Docker|on-premises|Host-Token|control plane|diagnostics|Diagnostic)(?=$|[\s.,;:!?)\]"'/><]|[^\x00-\x7F])/;

async function walk(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", "testdata", "sidecars", "helpers", "resources"].includes(entry.name)) continue;
      await walk(full, out);
    } else if (/\.(?:ts|tsx|mjs|cjs|js|md|yml|json|sh|html|nsh)$/.test(entry.name) && !/(\.test\.|\.spec\.)/.test(entry.name)) {
      out.push(full);
    }
  }
}

test("desktop and renderer branding stays myai", async () => {
  const files = [];
  const desktopDir = path.join(repoRoot, "apps", "desktop");
  for (const entry of await readdir(desktopDir)) {
    if (/^electron-builder.*\.yml$/.test(entry)) files.push(path.join(desktopDir, entry));
  }
  files.push(path.join(desktopDir, "package.json"));
  files.push(path.join(repoRoot, "apps", "app", "index.html"));
  await walk(path.join(repoRoot, "apps", "app", "src"), files);
  await walk(path.join(desktopDir, "electron"), files);
  await walk(path.join(desktopDir, "scripts"), files);

  const violations = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const pattern = /\bOpenWork\b/g;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const rest = line.slice(match.index + match[0].length);
        if (!ALLOWED_OPENWORK_SUFFIX.test(rest)) {
          violations.push(`${path.relative(repoRoot, file)}:${index + 1}: ${line.trim()}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});
