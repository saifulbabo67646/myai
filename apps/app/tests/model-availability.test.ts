import { describe, expect, test } from "vitest";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import type { ProviderListItem } from "../src/app/types";
import {
  computeModelAvailability,
  type ModelAvailabilityContext,
} from "../src/react-app/domains/session/surface/model-availability";

function provider(id: string, modelIds: string[]): ProviderListItem {
  return {
    id,
    name: id,
    source: "config",
    env: [],
    models: Object.fromEntries(modelIds.map((modelId) => [modelId, { name: modelId }])),
  } as unknown as ProviderListItem;
}

function catalog(providers: Array<{ id: string; models: string[] }>): ProviderListResponse {
  return {
    all: providers.map((entry) => provider(entry.id, entry.models)),
    connected: providers.map((entry) => entry.id),
    default: {},
  } as unknown as ProviderListResponse;
}

function context(overrides: Partial<ModelAvailabilityContext> = {}): ModelAvailabilityContext {
  return {
    workspaceReady: true,
    loading: false,
    signedIn: false,
    cloudProviderSyncReady: false,
    openWorkModelsSyncing: false,
    restrictToCloud: false,
    checkRestriction: () => false,
    cloudProviderList: null,
    providerList: catalog([
      { id: "anthropic", models: ["claude-fable-5"] },
      { id: "openai", models: ["gpt-5.5"] },
    ]),
    ...overrides,
  };
}

const sessionModel = { providerID: "anthropic", modelID: "claude-fable-5" };
const defaultModel = { providerID: "openai", modelID: "gpt-5.5" };

describe("computeModelAvailability", () => {
  test("a model present in the settled catalog is available", () => {
    expect(computeModelAvailability(sessionModel, context())).toEqual({ status: "available" });
  });

  test("a session model stays available when the global default is missing", () => {
    const shared = context({
      providerList: catalog([{ id: "anthropic", models: ["claude-fable-5"] }]),
    });
    expect(computeModelAvailability(sessionModel, shared)).toEqual({ status: "available" });
    expect(computeModelAvailability(defaultModel, shared)).toEqual({
      status: "unavailable",
      reason: "model_missing",
    });
  });

  test("a genuinely missing session model is unavailable while the default stays available", () => {
    const shared = context({
      providerList: catalog([{ id: "openai", models: ["gpt-5.5"] }]),
    });
    expect(computeModelAvailability(sessionModel, shared)).toEqual({
      status: "unavailable",
      reason: "model_missing",
    });
    expect(computeModelAvailability(defaultModel, shared)).toEqual({ status: "available" });
  });

  test("an unsettled catalog is pending, never unavailable", () => {
    expect(computeModelAvailability(sessionModel, context({ providerList: undefined }))).toEqual({
      status: "pending",
    });
    expect(computeModelAvailability(sessionModel, context({ providerList: null }))).toEqual({
      status: "pending",
    });
  });

  test("a workspace that is still booting is pending", () => {
    expect(computeModelAvailability(sessionModel, context({ workspaceReady: false }))).toEqual({
      status: "pending",
    });
    expect(computeModelAvailability(sessionModel, context({ loading: true }))).toEqual({
      status: "pending",
    });
  });

  test("no selection to validate is pending", () => {
    expect(computeModelAvailability(null, context())).toEqual({ status: "pending" });
    expect(
      computeModelAvailability({ providerID: "", modelID: "" }, context()),
    ).toEqual({ status: "pending" });
  });

  test("a cloud-managed model is pending until cloud provider sync settles", () => {
    const cloudModel = { providerID: "lpr_org_provider", modelID: "gpt-5.5" };
    expect(
      computeModelAvailability(cloudModel, context({ signedIn: true, cloudProviderSyncReady: false })),
    ).toEqual({ status: "pending" });
    expect(
      computeModelAvailability(
        cloudModel,
        context({
          signedIn: true,
          cloudProviderSyncReady: true,
          cloudProviderList: catalog([{ id: "lpr_org_provider", models: ["gpt-5.5"] }]),
        }),
      ),
    ).toEqual({ status: "available" });
    expect(
      computeModelAvailability(
        cloudModel,
        context({
          signedIn: true,
          cloudProviderSyncReady: true,
          cloudProviderList: catalog([{ id: "lpr_other", models: ["gpt-5.5"] }]),
        }),
      ),
    ).toEqual({ status: "unavailable", reason: "model_missing" });
  });

  test("cloud sync while OpenWork Models is reconciling stays pending", () => {
    const cloudModel = { providerID: "openwork", modelID: "gpt-5.5" };
    expect(
      computeModelAvailability(
        cloudModel,
        context({ signedIn: true, cloudProviderSyncReady: true, openWorkModelsSyncing: true }),
      ),
    ).toEqual({ status: "pending" });
  });

  test("a policy-blocked provider is unavailable even while the catalog loads", () => {
    expect(
      computeModelAvailability(
        { providerID: "opencode", modelID: "grok-code" },
        context({
          providerList: undefined,
          checkRestriction: ({ restriction }) => restriction === "allowZenModel",
        }),
      ),
    ).toEqual({ status: "unavailable", reason: "provider_blocked" });
  });

  test("restrict-to-cloud marks non-connected custom providers unavailable", () => {
    expect(
      computeModelAvailability(
        sessionModel,
        context({
          restrictToCloud: true,
          providerList: catalog([{ id: "openai", models: ["gpt-5.5"] }]),
        }),
      ),
    ).toEqual({ status: "unavailable", reason: "provider_not_connected" });
  });

  test("a disconnected provider's model is unavailable in a settled catalog", () => {
    const list = catalog([
      { id: "anthropic", models: ["claude-fable-5"] },
    ]);
    (list as { connected: string[] }).connected = [];
    expect(computeModelAvailability(sessionModel, context({ providerList: list }))).toEqual({
      status: "unavailable",
      reason: "model_missing",
    });
  });
});
