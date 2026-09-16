import type { MyaiConfig } from "./config.js";
import type { MyaiLogger } from "./logger.js";

export interface ExecutionBackend {
  readonly kind: "local";
  ready(): Promise<boolean>;
  proxy(request: Request, runtimePath: string): Promise<Response>;
}

const forwardedRequestHeaders = new Set(["accept", "content-type"]);

export function createLocalExecutionBackend(config: MyaiConfig, logger: MyaiLogger): ExecutionBackend {
  return {
    kind: "local",
    async ready() {
      try {
        const response = await fetch(`${config.runtimeBaseUrl}/health`, { method: "GET", signal: AbortSignal.timeout(1_000) });
        return response.ok;
      } catch {
        return false;
      }
    },
    async proxy(request, runtimePath) {
      const target = new URL(runtimePath, `${config.runtimeBaseUrl}/`);
      const headers = new Headers();
      for (const [key, value] of request.headers) {
        if (forwardedRequestHeaders.has(key.toLowerCase())) headers.set(key, value);
      }
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(await request.arrayBuffer());
      logger.write({ event: "runtime.proxy", method: request.method, path: runtimePath });
      const response = await fetch(target, {
        method: request.method,
        headers,
        ...(body ? { body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      const responseHeaders = new Headers();
      const contentType = response.headers.get("content-type");
      if (contentType) responseHeaders.set("content-type", contentType);
      const cacheControl = response.headers.get("cache-control");
      if (cacheControl) responseHeaders.set("cache-control", cacheControl);
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    },
  };
}
