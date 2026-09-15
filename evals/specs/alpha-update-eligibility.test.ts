import { expect } from "vitest";
import { test } from "@openwork/testkit";
import { isAlphaUpdateAllowedByVersionCeiling } from "../../apps/app/src/app/lib/version-gate";
import { resolveCheckedUpdateState } from "../../apps/app/src/react-app/domains/settings/state/electron-updater-state";

test("an installed alpha can receive its next build without a false up-to-date status", ({ evidence }) => {
  const currentVersion = "0.18.37-alpha.2491+64d2d37";
  const updateVersion = "0.18.37-alpha.2492+4921a02";
  const allowed = isAlphaUpdateAllowedByVersionCeiling({
    updateVersion,
    currentVersion,
    denLatestAppVersion: "0.18.35",
    desktopConfig: { allowAlphaUpdates: true },
  });

  expect(allowed).toBe(true);
  expect(resolveCheckedUpdateState({ available: true, allowed })).toBe("available");
  evidence.recordAssertionEvidence(
    "An installed Alpha build remains eligible for newer builds on the same release",
    `${currentVersion} accepts ${updateVersion} even while Den's stable release metadata is 0.18.35, and the updater state exposes the candidate as available.`,
    true,
  );

  const newerReleaseAllowed = isAlphaUpdateAllowedByVersionCeiling({
    updateVersion: "0.18.38-alpha.2493+abcdef0",
    currentVersion,
    denLatestAppVersion: "0.18.35",
    desktopConfig: { allowAlphaUpdates: true },
  });
  expect(newerReleaseAllowed).toBe(false);
  expect(resolveCheckedUpdateState({ available: true, allowed: newerReleaseAllowed })).toBe("blocked");
  evidence.recordAssertionEvidence(
    "The rollout ceiling still blocks a new release line without claiming the app is current",
    "The same installation rejects 0.18.38-alpha.2493 and maps the available-but-ineligible candidate to blocked rather than idle.",
    true,
  );
});
