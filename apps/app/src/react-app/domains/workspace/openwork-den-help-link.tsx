/** @jsxImportSource react */

/**
 * Placeholder for the upstream "OpenWork Den remote workers" help link.
 *
 * That link explained an OpenWork Den (hosted control plane) remote-worker
 * upgrade and offered an OpenWork support address. myai ships no hosted
 * control plane and no OpenWork support channel, so the affordance is
 * **disabled**: nothing renders and no link, mailto, or host is offered. Kept
 * as a named export so the sidebar that renders it keeps one import site to
 * flip if a myai support channel is configured later (WP-6).
 */
export function OpenWorkDenHelpLink() {
  return null;
}
