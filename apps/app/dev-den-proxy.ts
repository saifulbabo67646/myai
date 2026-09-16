interface DevDenProxyOptions {
  target: string;
  changeOrigin: boolean;
  rewrite?: (path: string) => string;
}

/**
 * Same-origin `/api/den` proxy for the source dev server.
 *
 * The target is whatever the launching world/config pinned (`VITE_DEN_API_BASE_URL`
 * drives the renderer's API base, `OPENWORK_DEV_HEADLESS_DEN_TARGET` drives this
 * proxy). myai ships no hosted origin and remaps nothing: the configured target
 * is used exactly as given, so a deployment whose API lives on a different
 * origin than its web app declares both explicitly instead of relying on a
 * borrowed host's shape.
 */
export function devDenProxy(env: NodeJS.ProcessEnv): Record<string, DevDenProxyOptions> {
  const target = env.OPENWORK_DEV_HEADLESS_DEN_TARGET?.trim();
  if (!target) return {};
  return {
    "/api/den": {
      target,
      changeOrigin: true,
    },
  };
}
