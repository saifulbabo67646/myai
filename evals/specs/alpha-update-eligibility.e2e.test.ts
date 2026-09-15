import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { createAndSelectWorkspace, evalIn, go, waitFor } from "@openwork/behaviors";
import { allocateFreePort } from "@openwork/cdp";
import { desktop, localHost } from "@openwork/hosts";
import { needs, test } from "@openwork/testkit";
import { screenshot } from "@openwork/test-evidence";

const e2eTestsEnabled = process.env.OPENWORK_EVAL_E2E_TESTS === "1";
const onMac = process.platform === "darwin";
const enabled = e2eTestsEnabled && onMac;
const title = enabled
  ? "the macOS updater surfaces eligible and gated Alpha builds accurately"
  : e2eTestsEnabled
    ? `alpha update eligibility skipped — needs: run on macOS (Alpha is unavailable on ${process.platform})`
    : "alpha update eligibility skipped — needs: set OPENWORK_EVAL_E2E_TESTS=1";

async function installUpdaterBridge(app: Parameters<typeof evalIn>[0]): Promise<void> {
  const installed = await evalIn(app, `(() => {
    const nativeUpdater = window.__OPENWORK_ELECTRON__?.updater;
    if (!nativeUpdater?.getChannel || !nativeUpdater.setChannel) return false;
    const state = {
      checks: [],
      currentVersion: "0.18.37-alpha.2491+64d2d37",
      latestVersion: "0.18.37-alpha.2492+4921a02",
    };
    window.__openworkAlphaUpdateEligibilityEvalState = state;
    window.localStorage.setItem("openwork.react.settings.update-auto-check", "0");
    window.__openworkApplyDesktopConfig?.({ allowAlphaUpdates: true });
    window.__openworkSetDesktopConfigRefreshResult?.({ allowAlphaUpdates: true });
    window.__openworkReadDesktopVersionMetadataEval = () => ({
      minAppVersion: "0.17.0",
      latestAppVersion: "0.18.35",
      publishedDesktopVersions: ["0.18.35"],
    });
    window.__openworkUpdaterEvalBridge = {
      getChannel: () => nativeUpdater.getChannel(),
      setChannel: (channel) => nativeUpdater.setChannel(channel),
      check: async (channel) => {
        state.checks.push(channel);
        return channel === "alpha"
          ? {
              available: true,
              channel,
              currentVersion: state.currentVersion,
              latestVersion: state.latestVersion,
            }
          : {
              available: false,
              channel,
              currentVersion: state.currentVersion,
              latestVersion: "0.18.35",
            };
      },
      download: async () => ({ ok: false, reason: "unused by this update eligibility proof" }),
      installAndRestart: async () => ({ ok: false, reason: "unused by this update eligibility proof" }),
      onDownloadProgress: () => () => {},
    };
    return true;
  })()`);
  expect(installed).toBe(true);
}

async function selectAlpha(app: Parameters<typeof evalIn>[0]): Promise<void> {
  const triggerPoint = await evalIn(app, `(() => {
    const trigger = document.querySelector('[aria-label="Release channel"]');
    if (!(trigger instanceof HTMLElement)) return null;
    const rect = trigger.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (
    !triggerPoint ||
    typeof triggerPoint !== "object" ||
    !("x" in triggerPoint) ||
    !("y" in triggerPoint) ||
    typeof triggerPoint.x !== "number" ||
    typeof triggerPoint.y !== "number"
  ) {
    throw new Error(`Could not resolve the release channel trigger: ${JSON.stringify(triggerPoint)}`);
  }
  await app.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...triggerPoint });
  await app.client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...triggerPoint, button: "left", clickCount: 1 });
  await app.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...triggerPoint, button: "left", clickCount: 1 });
  await waitFor(
    app,
    `[...document.querySelectorAll('[data-slot="select-item"]')]
      .some((item) => item.textContent?.trim() === "Alpha")`,
    { timeoutMs: 15_000, label: "Alpha release channel option" },
  );
  const optionPoint = await evalIn(app, `(() => {
    const option = [...document.querySelectorAll('[data-slot="select-item"]')]
      .find((item) => item.textContent?.trim() === "Alpha");
    if (!(option instanceof HTMLElement)) return null;
    const rect = option.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (
    !optionPoint ||
    typeof optionPoint !== "object" ||
    !("x" in optionPoint) ||
    !("y" in optionPoint) ||
    typeof optionPoint.x !== "number" ||
    typeof optionPoint.y !== "number"
  ) {
    throw new Error(`Could not resolve the Alpha release channel option: ${JSON.stringify(optionPoint)}`);
  }
  await app.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...optionPoint });
  await app.client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...optionPoint, button: "left", clickCount: 1 });
  await app.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...optionPoint, button: "left", clickCount: 1 });
}

test.skipIf(!enabled)(title, async ({ evidence }) => {
  needs({ optIn: ["OPENWORK_EVAL_E2E_TESTS"] });

  const profileDir = await mkdtemp(join(tmpdir(), "openwork-alpha-update-eligibility-eval-"));
  const workspacePath = join(profileDir, "workspace");
  const desktopEnv = { PORT: String(await allocateFreePort()) };
  await using host = localHost();

  try {
    const app = await desktop({ name: "alpha-update-eligibility", host, profileDir, env: desktopEnv });
    try {
      const { workspaceId } = await createAndSelectWorkspace(app, { path: workspacePath });
      await installUpdaterBridge(app);
      await go(app, `/workspace/${workspaceId}/settings/updates`);
      await waitFor(
        app,
        `window.location.hash.includes("/settings/updates")
          && Boolean(document.querySelector('[aria-label="Release channel"]'))`,
        { timeoutMs: 60_000, label: "public macOS Updates page with release channel picker" },
      );
      await selectAlpha(app);
      await waitFor(
        app,
        `window.__openworkAlphaUpdateEligibilityEvalState?.checks
            ?.filter((channel) => channel === "alpha").length === 1
          && document.body.innerText.includes("Update available: v0.18.37-alpha.2492+4921a02")
          && [...document.querySelectorAll("button")]
            .some((button) => button.textContent?.trim() === "Download")`,
        { timeoutMs: 30_000, label: "eligible same-release Alpha update" },
      );

      const availableText = await evalIn(app, "document.body.innerText");
      expect(availableText).toContain("Update available: v0.18.37-alpha.2492+4921a02");
      expect(availableText).not.toContain("You're up to date");
      await screenshot(app);
      evidence.recordAssertionEvidence(
        "A newer build on the installed Alpha release is offered despite lagging stable metadata",
        "With 0.18.37-alpha.2491 installed and Den metadata at 0.18.35, the Updates page offered 0.18.37-alpha.2492 with a Download action and did not say the app was up to date.",
        true,
      );

      const switchedCandidate = await evalIn(app, `(() => {
        const state = window.__openworkAlphaUpdateEligibilityEvalState;
        if (!state) return false;
        state.latestVersion = "0.18.38-alpha.2493+abcdef0";
        const checkButton = [...document.querySelectorAll("button")]
          .find((button) => button.textContent?.trim() === "Check now");
        if (!(checkButton instanceof HTMLElement)) return false;
        checkButton.click();
        return true;
      })()`);
      expect(switchedCandidate).toBe(true);
      await waitFor(
        app,
        `document.body.innerText.includes("Update available: v0.18.38-alpha.2493+abcdef0")
          && document.body.innerText.includes("this installation is not eligible for it yet")
          && ![...document.querySelectorAll("button")]
            .some((button) => button.textContent?.trim() === "Download")`,
        { timeoutMs: 30_000, label: "blocked newer-release Alpha update" },
      );

      const blockedText = await evalIn(app, "document.body.innerText");
      expect(blockedText).toContain("Update available: v0.18.38-alpha.2493+abcdef0");
      expect(blockedText).not.toContain("You're up to date");
      await screenshot(app);
      evidence.recordAssertionEvidence(
        "A gated Alpha release stays blocked without a false current status",
        "The Updates page identified 0.18.38-alpha.2493 as available but ineligible, withheld the Download action, and did not say the app was up to date.",
        true,
      );
    } finally {
      await app.stop();
    }
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});
