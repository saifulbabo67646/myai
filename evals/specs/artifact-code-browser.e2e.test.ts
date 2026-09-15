import { expect } from "vitest";
import { clickButton, control, createAndSelectWorkspace, evalIn, fill, seedSessions, waitFor } from "@openwork/behaviors";
import { desktop } from "@openwork/hosts";
import { screenshot, validate } from "@openwork/test-evidence";
import { needs, test } from "@openwork/testkit";

const enabled = process.env.OPENWORK_EVAL_E2E_TESTS === "1";
const title = enabled
  ? "artifact editor renders code with Pierre and browses workspace files"
  : "artifact code browser skipped — needs: set OPENWORK_EVAL_E2E_TESTS=1";

test.skipIf(!enabled)(title, async ({ evidence }) => {
  needs({ optIn: ["OPENWORK_EVAL_E2E_TESTS"] });
  await using app = await desktop({
    name: "artifact-code-browser",
    mode: process.env.OPENWORK_EVAL_CDP_URL?.trim() ? "attach" : "spawn",
    env: { OPENWORK_ELECTRON_START_URL: "", PORT: "0" },
  });
  const workspace = await createAndSelectWorkspace(app, { path: `/tmp/openwork-artifact-code-browser-${Date.now()}` });
  await waitFor(app, `window.__openworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "new task action enabled",
  });
  await seedSessions(app, ["Artifact code browser proof"]);
  await control(app, "browser.open_url", { url: "about:blank" }).catch(() => undefined);
  await waitFor(app, `window.__openworkControl.listActions().some((action) => action.id === "eval.artifact_tabs.seed_overflow" && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "artifact seed action enabled",
  });
  const wroteCodeFiles = await evalIn(app, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return false;
    const write = (path, content) => fetch(
      "http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(${JSON.stringify(workspace.workspaceId)}) + "/files/content",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ path, content, baseUpdatedAt: null }),
      },
    );
    const responses = await Promise.all([
      write("src/openwork-artifact-proof.ts", "export const artifactEditor = true;\\n"),
      write("config/openwork-artifact-settings.json", "{\\\"artifactEditor\\\":true}\\n"),
    ]);
    return responses.every((response) => response.ok);
  })()`, { awaitPromise: true });
  expect(wroteCodeFiles).toBe(true);
  await control(app, "eval.artifact_tabs.seed_overflow", { count: 12 });
  await clickButton(app, "overflow-tab-12.md");

  await waitFor(app, `Boolean(document.querySelector("[data-workspace-file-tree]"))`, {
    timeoutMs: 30_000,
    label: "workspace file tree mounted",
  });
  await waitFor(app, `Number(document.querySelector("[data-workspace-file-count]")?.getAttribute("data-workspace-file-count") || 0) > 0`, {
    timeoutMs: 30_000,
    label: "workspace file tree populated",
  });
  const clickTreeFile = async (filename: string) => {
    const rawPoint = await evalIn(app, `(() => {
    const visit = (root) => {
      for (const element of Array.from(root.querySelectorAll("*")).reverse()) {
        const identity = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("data-path"), element.getAttribute("data-item-path")].filter(Boolean).join(" ");
        if (identity.includes(${JSON.stringify(filename)})) {
          const clickable = element.closest("button") || element;
          const rect = clickable.getBoundingClientRect();
          return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        }
        if (element.shadowRoot) {
          const nested = visit(element.shadowRoot);
          if (nested) return nested;
        }
      }
      return "";
    };
    return visit(document);
  })()`);
    if (typeof rawPoint !== "string" || !rawPoint) return false;
    const point = JSON.parse(rawPoint) as { x: number; y: number };
    await app.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await app.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await app.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    return true;
  };
  const searchSelector = '[data-workspace-file-tree] input[placeholder="Search files"]';
  await fill(app, searchSelector, "openwork-artifact-proof.ts");
  const clickedTypeScript = await clickTreeFile("openwork-artifact-proof.ts");
  expect(clickedTypeScript).toBe(true);

  await waitFor(app, `(() => {
    const root = document.querySelector('[data-artifact-code-view="src/openwork-artifact-proof.ts"]');
    if (!root) return false;
    const collect = (node) => {
      let text = node.textContent || "";
      for (const element of node.querySelectorAll("*")) if (element.shadowRoot) text += collect(element.shadowRoot);
      return text;
    };
    return collect(root).includes("artifactEditor");
  })()`, { timeoutMs: 30_000, label: "TypeScript code rendered" });
  expect(await evalIn(app, `Boolean(document.querySelector("[data-workspace-file-tree]"))`)).toBe(true);
  evidence.recordAssertionEvidence(
    "A code artifact opens in the Pierre code viewer beside a workspace file tree",
    "The TypeScript artifact mounted the dedicated code-view surface and the artifact editor exposed its workspace tree at the same time.",
    true,
  );
  const typeScriptShot = await screenshot(app);
  const typeScriptSeen = await validate(typeScriptShot, [
    "The artifact panel visibly shows a workspace file tree beside a syntax-highlighted TypeScript code viewer",
    "The code viewer visibly contains the TypeScript declaration export const artifactEditor = true",
    "No error dialog, blank artifact surface, or crash message is visible",
  ]);
  expect(typeScriptSeen.ok, typeScriptSeen.why).toBe(true);

  await fill(app, searchSelector, "openwork-artifact-settings.json");
  expect(await clickTreeFile("openwork-artifact-settings.json")).toBe(true);
  await waitFor(app, `Boolean(document.querySelector('[data-artifact-code-view="config/openwork-artifact-settings.json"]'))`, {
    timeoutMs: 30_000,
    label: "tree-selected JSON artifact opened",
  });
  await waitFor(app, `(() => {
    const root = document.querySelector('[data-artifact-code-view="config/openwork-artifact-settings.json"]');
    if (!root) return false;
    const collect = (node) => {
      let text = node.textContent || "";
      for (const element of node.querySelectorAll("*")) if (element.shadowRoot) text += collect(element.shadowRoot);
      return text;
    };
    return collect(root).includes("artifactEditor");
  })()`, { timeoutMs: 30_000, label: "JSON code rendered" });
  expect(await evalIn(app, `Boolean(document.querySelector('[data-artifact-code-view="src/openwork-artifact-proof.ts"]'))`)).toBe(false);
  evidence.recordAssertionEvidence(
    "Selecting another file in the workspace tree opens it as the active code artifact",
    "Choosing the JSON file replaced the visible TypeScript code surface with the selected JSON artifact; the old file was no longer active.",
    true,
  );
  const jsonShot = await screenshot(app);
  const jsonSeen = await validate(jsonShot, [
    "The artifact panel visibly shows the workspace file tree beside a syntax-highlighted JSON code viewer",
    "The code viewer visibly contains the JSON property artifactEditor set to true, and no TypeScript declaration is visible",
    "No error dialog, blank artifact surface, or crash message is visible",
  ]);
  expect(jsonSeen.ok, jsonSeen.why).toBe(true);
});
