declare const afterEach: (fn: () => void | Promise<void>) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
};

import { DEFAULT_DEN_BASE_URL, setDenBootstrapConfig } from "../../../app/lib/den";
import {
  hasOpenWorkModelsAvailable,
  isOpenWorkModelsPromoEligible,
  isOpenWorkModelsPromoEligibleForDenBaseUrl,
  shouldShowOpenWorkModelsPromo,
  shouldShowOpenWorkModelsSyncing,
  wasOpenWorkModelsStartupPromoShown,
} from "./openwork-models-promo";

afterEach(async () => {
  await setDenBootstrapConfig({ baseUrl: DEFAULT_DEN_BASE_URL, requireSignin: false });
});

describe("OpenWork Models promo eligibility", () => {
  test("suppresses promotions for every reachable control plane", () => {
    // myai declares no hosted control plane (VITE_DEN_HOSTED_BASE_URL is
    // unset), so the hosted-only upsell is never eligible — not even for the
    // build's own configured server or a path-normalized variant of it.
    expect(isOpenWorkModelsPromoEligibleForDenBaseUrl(DEFAULT_DEN_BASE_URL)).toBe(false);
    expect(isOpenWorkModelsPromoEligibleForDenBaseUrl(`${DEFAULT_DEN_BASE_URL}/api/den/`)).toBe(false);
  });

  test("suppresses promotions for custom configured Den URLs", async () => {
    await setDenBootstrapConfig({ baseUrl: "https://custom-den.example.com", requireSignin: false });

    expect(isOpenWorkModelsPromoEligible()).toBe(false);
    expect(shouldShowOpenWorkModelsPromo()).toBe(false);
    expect(wasOpenWorkModelsStartupPromoShown()).toBe(true);
  });
});

describe("hasOpenWorkModelsAvailable", () => {
  test("requires a connected openwork provider with at least one model", () => {
    expect(
      hasOpenWorkModelsAvailable({
        providerConnectedIds: ["openwork"],
        providers: [{ id: "openwork", models: {} }],
      }),
    ).toBe(false);
    expect(
      hasOpenWorkModelsAvailable({
        providerConnectedIds: ["openwork"],
        providers: [{ id: "openwork", models: { "gpt-5": {} } }],
      }),
    ).toBe(true);
  });
});

describe("shouldShowOpenWorkModelsSyncing", () => {
  test("only reports a real pending workspace reload", () => {
    expect(shouldShowOpenWorkModelsSyncing({
      entitled: true,
      available: false,
      workspaceReady: false,
      reloadPending: true,
    })).toBe(false);
    expect(shouldShowOpenWorkModelsSyncing({
      entitled: true,
      available: false,
      workspaceReady: true,
      reloadPending: false,
    })).toBe(false);
    expect(shouldShowOpenWorkModelsSyncing({
      entitled: true,
      available: false,
      workspaceReady: true,
      reloadPending: true,
    })).toBe(true);
  });
});
