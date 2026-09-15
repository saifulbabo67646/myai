// Availability of one provider/model identity against the active workspace's
// provider catalogs. The route builds a resolver from its catalog state and
// each composer (an existing conversation or the New Task default) evaluates
// its OWN effective model through it, so a missing global default can never
// disable a conversation that remembers a different, valid model — and vice
// versa. `pending` is explicit: an unsettled catalog (still loading, cloud
// provider sync incomplete, or superseded by a workspace switch) never
// produces a definitive "unavailable" verdict.
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import {
  isDesktopProviderBlocked,
  type DesktopAppRestrictionChecker,
} from "@/app/cloud/desktop-app-restrictions";
import type { ModelRef } from "@/app/types";
import { isCloudManagedProviderKey } from "@/react-app/domains/connections/provider-auth/cloud-provider-config";
import { isManagedModelAvailabilityPending } from "@/react-app/domains/connections/provider-auth/managed-models-recovery";
import { isModelAvailableInConnectedProviders } from "@/react-app/infra/provider-list-query";

export type ModelUnavailableReason =
  | "provider_blocked"
  | "provider_not_connected"
  | "model_missing";

export type ModelAvailability =
  | { status: "pending" }
  | { status: "available" }
  | { status: "unavailable"; reason: ModelUnavailableReason };

export type ModelAvailabilityResolver = (model: ModelRef | null) => ModelAvailability;

export type ModelAvailabilityContext = {
  /** Workspace + engine client are resolved (route is not still booting). */
  workspaceReady: boolean;
  /** Route-level loading flag; nothing is settled while it is true. */
  loading: boolean;
  signedIn: boolean;
  /** Cloud provider sync completed for the CURRENT workspace/org context. */
  cloudProviderSyncReady: boolean;
  openWorkModelsSyncing: boolean;
  /** Org policy restricts members to cloud-managed providers. */
  restrictToCloud: boolean;
  checkRestriction: DesktopAppRestrictionChecker;
  /** Settled cloud-managed catalog for the current context, if any. */
  cloudProviderList: ProviderListResponse | null;
  /**
   * Provider catalog for the current workspace (query keyed by server +
   * directory). `null`/`undefined` means the catalog has not settled for this
   * context yet — a stale catalog from a previous workspace never appears
   * here because the query key changes with the workspace.
   */
  providerList: ProviderListResponse | null | undefined;
};

export function computeModelAvailability(
  model: ModelRef | null | undefined,
  context: ModelAvailabilityContext,
): ModelAvailability {
  if (!context.workspaceReady || context.loading) return { status: "pending" };
  if (!model?.providerID?.trim() || !model.modelID?.trim()) {
    // No selection to validate: never claim a model is unavailable.
    return { status: "pending" };
  }

  const providerId = model.providerID.trim();
  const usesCloudProvider = isCloudManagedProviderKey(providerId);
  if (
    isManagedModelAvailabilityPending({
      signedIn: context.signedIn,
      selectedModelUsesCloudProvider: usesCloudProvider,
      cloudProviderSyncReady: context.cloudProviderSyncReady,
      openWorkModelsSyncing: context.openWorkModelsSyncing,
    })
  ) {
    return { status: "pending" };
  }
  if (usesCloudProvider && !context.cloudProviderSyncReady) return { status: "pending" };

  // Desktop policy blocks are definitive regardless of catalog state.
  if (
    isDesktopProviderBlocked({
      providerId,
      checkRestriction: context.checkRestriction,
    })
  ) {
    return { status: "unavailable", reason: "provider_blocked" };
  }

  const providerList = usesCloudProvider ? context.cloudProviderList : context.providerList;
  if (!providerList) {
    // Catalog not settled for the current context: pending, not unavailable.
    return { status: "pending" };
  }

  if (
    context.restrictToCloud &&
    !providerList.connected.some((connectedId) => connectedId.trim() === providerId)
  ) {
    return { status: "unavailable", reason: "provider_not_connected" };
  }

  if (!isModelAvailableInConnectedProviders(providerList, model)) {
    return { status: "unavailable", reason: "model_missing" };
  }

  return { status: "available" };
}
