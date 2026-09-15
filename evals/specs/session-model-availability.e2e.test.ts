// A conversation's remembered model must be validated as ITSELF against the
// active workspace's settled catalog. Regression: after a workspace switch,
// route-level availability judged every conversation by the global default —
// a conversation displaying a valid remembered model was disabled with a
// false "Model no longer available" banner, its picker checkmark sat on the
// default, and Retry could not recover.
import { expect, test } from "vitest";
import type { Surface } from "@openwork/cdp";
import { createVisualEvidence, screenshot, validate } from "@openwork/test-evidence";
import { desktop } from "@openwork/hosts";
import {
  createAndSelectWorkspace,
  evalIn,
  readAvailableModels,
  readComposerState,
  selectModel,
  waitFor,
  waitForText,
  writeComposerText,
} from "@openwork/behaviors";

const e2eTestsEnabled = process.env.OPENWORK_EVAL_E2E_TESTS === "1";
const title = e2eTestsEnabled
  ? "a conversation keeps its remembered model when the global default disappears across a workspace switch"
  : "session model availability skipped: set OPENWORK_EVAL_E2E_TESTS=1 to opt in";
const warning = "Model no longer available";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function executeControl(app: Surface, action: string, args?: unknown): Promise<unknown> {
  const value = await evalIn(
    app,
    `window.__openworkControl.execute(${JSON.stringify(action)}, ${JSON.stringify(args ?? null)})`,
    { awaitPromise: true },
  );
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(`Control action ${action} failed: ${JSON.stringify(value)}`);
  }
  return value.result;
}

async function createConversation(app: Surface): Promise<string> {
  await waitFor(app, `window.__openworkControl?.listActions().some((entry) => entry.id === "session.create_task" && entry.disabled === false)`, {
    timeoutMs: 90_000,
    label: "session.create_task enabled",
  });
  const sessionId = await executeControl(app, "session.create_task");
  if (typeof sessionId !== "string" || !sessionId) throw new Error("Task creation did not return a session id.");
  await waitFor(app, `window.location.hash.includes(${JSON.stringify(sessionId)})`, {
    timeoutMs: 60_000,
    label: "created conversation opened",
  });
  return sessionId;
}

async function closeModelPicker(app: Surface): Promise<void> {
  await evalIn(app, `(() => {
    const dialog = document.querySelector('[data-slot="dialog-content"]');
    if (!dialog) return true;
    const done = [...dialog.querySelectorAll("button")].find((button) => (button.textContent ?? "").trim() === "Done");
    if (done) { done.click(); return true; }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return true;
  })()`);
  await waitFor(app, `!Boolean(document.querySelector('input[placeholder="Search providers and models..."]'))`, {
    timeoutMs: 30_000,
    label: "Models dialog closed",
  });
}

test.skipIf(!e2eTestsEnabled)(title, async () => {
  await using app = await desktop({ name: "session-model-availability" });
  await using visualEvidence = createVisualEvidence("session-model-availability");
  const stamp = Date.now();

  // Workspace A with a conversation that remembers its own model.
  const { workspaceId: workspaceA } = await createAndSelectWorkspace(app, {
    path: `/tmp/openwork-session-model-a-${stamp}`,
  });
  const conversationA = await createConversation(app);

  let models = await readAvailableModels(app);
  const catalogDeadline = Date.now() + 90_000;
  while (models.length === 0 && Date.now() < catalogDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    models = await readAvailableModels(app);
  }
  const rememberedModel = models.find((candidate) => candidate.selectable);
  expect(rememberedModel).toBeTruthy();
  if (!rememberedModel) throw new Error("No selectable model was returned.");
  const selected = await selectModel(app, rememberedModel.id);
  expect(selected.id).toBe(rememberedModel.id);

  // Workspace B: switching re-keys the provider catalog context.
  await executeControl(app, "workspace.create", { path: `/tmp/openwork-session-model-b-${stamp}` });
  await waitFor(app, `(() => {
    try {
      const active = localStorage.getItem("openwork.react.activeWorkspace") ?? "";
      return active !== "" && active !== ${JSON.stringify(workspaceA)};
    } catch { return false; }
  })()`, { timeoutMs: 120_000, label: "workspace B selected" });

  // Break ONLY the global default while workspace B is active; conversation
  // A's remembered selection is untouched.
  const seeded = await executeControl(app, "eval.model_not_available.seed", { scope: "default" });
  if (!isRecord(seeded) || !isRecord(seeded.unavailableModel)) {
    throw new Error(`Seed returned malformed facts: ${JSON.stringify(seeded)}`);
  }

  // Switch back into workspace A's conversation.
  await executeControl(app, "session.open", { sessionId: conversationA });
  await waitFor(app, `window.location.hash.includes(${JSON.stringify(conversationA)})`, {
    timeoutMs: 60_000,
    label: "conversation A reopened",
  });
  await writeComposerText(app, "Remembered model survives the workspace switch.");

  // The conversation validates its OWN model: the composer must stay usable
  // and no false unavailable banner may appear once the catalog settles.
  await waitFor(app, `(() => {
    const run = [...document.querySelectorAll("button")].find((button) => (button.textContent ?? "").trim() === "Run task");
    return Boolean(run && !run.disabled);
  })()`, { timeoutMs: 60_000, label: "conversation A composer usable" });
  const settleDeadline = Date.now() + 6_000;
  while (Date.now() < settleDeadline) {
    const state = await readComposerState(app);
    expect(state.modelUnavailable, "conversation A must not report the default model's unavailability").toBe(false);
    expect(state.runTaskEnabled).toBe(true);
    expect(state.selectedModelLabel).toContain(selected.name);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The conversation composer is usable with a visible selected model",
      "No 'Model no longer available' warning is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await visualEvidence.recordScreenshot(shot, seen);
  }

  // The picker checkmark targets the conversation's model, not the default.
  const pickerModels = await readAvailableModels(app);
  const checked = pickerModels.filter((model) => model.selected);
  expect(checked.map((model) => model.id)).toContain(rememberedModel.id);
  await closeModelPicker(app);

  // Honesty: when the conversation's OWN model is genuinely missing, the
  // unavailable state appears for that conversation and recovery targets it.
  const bothSeed = await executeControl(app, "eval.model_not_available.seed", { scope: "both" });
  if (!isRecord(bothSeed) || !isRecord(bothSeed.availableModel)) {
    throw new Error(`Seed returned malformed facts: ${JSON.stringify(bothSeed)}`);
  }
  const recoveryModelId = String(
    isRecord(bothSeed.availableModel) ? bothSeed.availableModel.modelID ?? "" : "",
  );
  await waitForText(app, warning, { timeoutMs: 30_000 });
  {
    const state = await readComposerState(app);
    expect(state.modelUnavailable).toBe(true);
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "A Model no longer available warning is visible for the conversation",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await visualEvidence.recordScreenshot(shot, seen);
  }

  // Choosing a replacement recovers this conversation.
  expect(recoveryModelId).toBeTruthy();
  await selectModel(app, recoveryModelId);
  await waitFor(app, `!document.body.innerText.includes(${JSON.stringify(warning)})`, {
    timeoutMs: 30_000,
    label: "unavailable warning cleared after recovery",
  });
  const recovered = await readComposerState(app);
  expect(recovered.modelUnavailable).toBe(false);
  expect(recovered.runTaskEnabled).toBe(true);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The conversation composer is usable again after selecting a replacement model",
      "No 'Model no longer available' warning is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await visualEvidence.recordScreenshot(shot, seen);
  }
});
