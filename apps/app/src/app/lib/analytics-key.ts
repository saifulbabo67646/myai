/**
 * Product-analytics project key. myai ships **none**: the upstream OpenWork
 * PostHog project key is gone, so a release build has no analytics backend
 * until a distribution supplies its own key through
 * `VITE_OPENWORK_POSTHOG_KEY`. Unset means analytics stays off (the local
 * app-inspector mirror still records events).
 */
export const DEFAULT_POSTHOG_KEY = "";

/**
 * Resolve the PostHog project key. `raw` is VITE_OPENWORK_POSTHOG_KEY.
 * Unset uses the (empty) default in every build; explicit strings are used
 * after trim; an empty string disables analytics in any build.
 */
export function resolvePosthogKey(raw: unknown, isDev: boolean): string {
  if (typeof raw === "string") return raw.trim(); // explicit value wins; "" disables
  return isDev ? "" : DEFAULT_POSTHOG_KEY;
}
