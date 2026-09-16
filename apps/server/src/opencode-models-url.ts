import { loopbackFetch } from "./server-fetch.js";

const LOCAL_MODELS_URL = "http://localhost:8791/models";
/**
 * Catalog URL the managed engine is pointed at when nothing local applies.
 *
 * myai ships **no** models host: the upstream OpenWork Models catalog is gone,
 * so an unconfigured server injects nothing and the engine keeps its own
 * built-in catalog. A distribution points this at its own catalog through
 * `OPENCODE_MODELS_URL`.
 */
const DEFAULT_MODELS_URL = "";

type ResolveOpencodeModelsUrlOptions = {
  env?: NodeJS.ProcessEnv;
  fetchModels?: (input: string, init?: RequestInit) => Promise<{ ok: boolean }>;
};

/**
 * The models catalog URL for the managed engine, or "" when none is
 * configured. Callers must omit `OPENCODE_MODELS_URL` rather than inject an
 * empty value.
 */
export async function resolveOpencodeModelsUrl(
  options: ResolveOpencodeModelsUrlOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const override = env.OPENCODE_MODELS_URL?.trim();
  if (override) return override;
  if (env.OPENWORK_DEV_MODE !== "1") return DEFAULT_MODELS_URL;

  try {
    const response = await (options.fetchModels ?? loopbackFetch)(`${LOCAL_MODELS_URL}/api.json`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (response.ok) return LOCAL_MODELS_URL;
  } catch {
    // A standalone desktop dev session does not run the local inference stack.
  }

  return DEFAULT_MODELS_URL;
}
