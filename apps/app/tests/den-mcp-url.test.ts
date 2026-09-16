import { describe, expect, test } from "bun:test";

import {
  getDenMcpUrl,
  isLegacyWebAppMcpUrl,
  parseDenMcpToken,
  resolveCloudMcpResourceUrl,
  resolveDenBaseUrls,
} from "../src/app/lib/den";

/**
 * The hosted origin used to prove the redirect machinery is configuration
 * driven. It is deliberately not a real deployment: `den.ts` reads
 * `VITE_DEN_HOSTED_BASE_URL` at module load, so each configured case imports a
 * fresh module instance with the variable set (bun's `import.meta.env` is a
 * live view of `process.env`).
 */
const HOSTED_ORIGIN = "https://app.team.example.test";

/**
 * Import a fresh `den.ts` instance with the given build configuration.
 * `cacheKey` must be unique per configuration: the query only cache-busts the
 * module, and it stays free of URL characters so bun's resolver treats it as
 * the same file with a distinct instance.
 */
async function importConfigured(cacheKey: string, config: { hostedOrigin?: string; baseUrl?: string } = {}) {
  if (config.hostedOrigin === undefined) delete process.env.VITE_DEN_HOSTED_BASE_URL;
  else process.env.VITE_DEN_HOSTED_BASE_URL = config.hostedOrigin;
  if (config.baseUrl === undefined) delete process.env.VITE_DEN_BASE_URL;
  else process.env.VITE_DEN_BASE_URL = config.baseUrl;
  try {
    return await import(`../src/app/lib/den.ts?configured=${cacheKey}`);
  } finally {
    delete process.env.VITE_DEN_HOSTED_BASE_URL;
    delete process.env.VITE_DEN_BASE_URL;
  }
}

describe("resolveDenBaseUrls", () => {
  test("adds the API proxy path to an explicit API base URL", () => {
    const resolved = resolveDenBaseUrls({
      baseUrl: "https://den.example.test",
      apiBaseUrl: "https://den.example.test",
    });
    expect(resolved.apiBaseUrl).toBe("https://den.example.test");
  });

  test("keeps an explicit API origin independent from the web base URL", () => {
    const resolved = resolveDenBaseUrls({
      baseUrl: "https://den.example.test",
      apiBaseUrl: "https://api.example.com",
    });
    expect(resolved.baseUrl).toBe("https://den.example.test");
    expect(resolved.apiBaseUrl).toBe("https://api.example.com");
  });

  test("keeps an explicit loopback API URL when a base URL is present", () => {
    const resolved = resolveDenBaseUrls({
      baseUrl: "http://localhost:3000",
      apiBaseUrl: "http://127.0.0.1:8787",
    });
    expect(resolved.baseUrl).toBe("http://localhost:3000");
    expect(resolved.apiBaseUrl).toBe("http://127.0.0.1:8787");
  });

  test("keeps the same-origin API path for a self-hosted baseUrl when no apiBaseUrl is set", () => {
    const resolved = resolveDenBaseUrls({ baseUrl: "https://den.self-hosted.example.com" });
    expect(resolved.baseUrl).toBe("https://den.self-hosted.example.com");
    expect(resolved.apiBaseUrl).toBe("https://den.self-hosted.example.com/api/den");
  });

  test("uses an explicit api host directly when no apiBaseUrl is set", () => {
    const resolved = resolveDenBaseUrls({ baseUrl: "https://api.den.example" });
    expect(resolved.baseUrl).toBe("https://api.den.example");
    expect(resolved.apiBaseUrl).toBe("https://api.den.example");
  });

  test("invents no api sibling for a web-app-shaped origin when no hosted origin is declared", () => {
    const resolved = resolveDenBaseUrls({ baseUrl: HOSTED_ORIGIN });
    expect(resolved.baseUrl).toBe(HOSTED_ORIGIN);
    expect(resolved.apiBaseUrl).toBe(`${HOSTED_ORIGIN}/api/den`);
  });
});

describe("hosted-origin configuration", () => {
  test("ships no default control-plane host and no cloud endpoints", async () => {
    const mod = await importConfigured("defaults");
    expect(mod.DEFAULT_DEN_BASE_URL).toBe("");
    expect(mod.getDenMcpUrl()).toBe("");
    expect(mod.buildDenAuthUrl("", "sign-in")).toBe("");
    expect(mod.isSelfHostedControlPlane()).toBe(true);
    expect(mod.hasConfiguredControlPlane("")).toBe(false);
  });

  test("derives the api sibling from the configured hosted origin, not from a host literal", async () => {
    const mod = await importConfigured("hosted", { hostedOrigin: HOSTED_ORIGIN, baseUrl: HOSTED_ORIGIN });
    expect(mod.resolveDenBaseUrls({ baseUrl: HOSTED_ORIGIN }).apiBaseUrl).toBe(
      "https://api.app.team.example.test",
    );
    // A look-alike host that is not the configured origin keeps its own proxy:
    // nothing about the derivation is baked into the shipped source.
    expect(mod.resolveDenBaseUrls({ baseUrl: "https://staging.team.example.test" }).apiBaseUrl).toBe(
      "https://staging.team.example.test/api/den",
    );
    // Hosted-only surfaces unlock only when the build *is* the declared origin.
    expect(mod.isSelfHostedControlPlane()).toBe(false);
  });

  test("treats the build's own configured server as self-hosted", async () => {
    const mod = await importConfigured("team", { baseUrl: "https://myai.team.example.test" });
    expect(mod.DEFAULT_DEN_BASE_URL).toBe("https://myai.team.example.test");
    expect(mod.isSelfHostedControlPlane()).toBe(true);
  });
});

describe("getDenMcpUrl", () => {
  test("returns no MCP endpoint while no control plane is configured", () => {
    expect(getDenMcpUrl()).toBe("");
  });
});

describe("isLegacyWebAppMcpUrl", () => {
  test("flags nothing while this build declares no hosted origin", () => {
    // myai ships no hosted web app, so the old "app.* bare /mcp" heuristic no
    // longer matches a borrowed host: a stale entry is left untouched rather
    // than rewritten toward a host nobody configured.
    expect(isLegacyWebAppMcpUrl(`${HOSTED_ORIGIN}/mcp`)).toBe(false);
  });

  test("flags the configured hosted web origin's bare /mcp path", async () => {
    const mod = await importConfigured("hosted-legacy", { hostedOrigin: HOSTED_ORIGIN });
    expect(mod.isLegacyWebAppMcpUrl(`${HOSTED_ORIGIN}/mcp`)).toBe(true);
    expect(mod.isLegacyWebAppMcpUrl(`${HOSTED_ORIGIN}/api/den/mcp`)).toBe(false);
    // The api sibling already serves the API, so it is never healed again.
    expect(mod.isLegacyWebAppMcpUrl("https://api.app.team.example.test/mcp")).toBe(false);
    expect(mod.isLegacyWebAppMcpUrl("http://127.0.0.1:8787/mcp")).toBe(false);
  });

  test("ignores empty or malformed input", () => {
    expect(isLegacyWebAppMcpUrl(null)).toBe(false);
    expect(isLegacyWebAppMcpUrl("not a url")).toBe(false);
  });
});

describe("resolveCloudMcpResourceUrl", () => {
  test("keeps resources verbatim while no hosted origin is declared", () => {
    expect(resolveCloudMcpResourceUrl(`${HOSTED_ORIGIN}/mcp`)).toBe(`${HOSTED_ORIGIN}/mcp`);
    expect(resolveCloudMcpResourceUrl("https://api.den.example.test/mcp")).toBe("https://api.den.example.test/mcp");
  });

  test("heals the configured hosted minted web-app resources to the direct API origin", async () => {
    const mod = await importConfigured("hosted-heal", { hostedOrigin: HOSTED_ORIGIN });
    expect(mod.resolveCloudMcpResourceUrl(`${HOSTED_ORIGIN}/mcp`)).toBe(
      "https://api.app.team.example.test/mcp",
    );
    expect(mod.resolveCloudMcpResourceUrl(`${HOSTED_ORIGIN}/api/den/mcp`)).toBe(
      "https://api.app.team.example.test/mcp",
    );
  });

  test("keeps healthy resources verbatim", () => {
    expect(resolveCloudMcpResourceUrl("https://api.den.example.test/mcp")).toBe(
      "https://api.den.example.test/mcp",
    );
    expect(resolveCloudMcpResourceUrl("https://app.example.com/api/den/mcp")).toBe(
      "https://app.example.com/api/den/mcp",
    );
    expect(resolveCloudMcpResourceUrl("http://127.0.0.1:8787/mcp")).toBe(
      "http://127.0.0.1:8787/mcp",
    );
  });

  test("returns null for unusable resources so callers keep their fallback", () => {
    expect(resolveCloudMcpResourceUrl(null)).toBeNull();
    expect(resolveCloudMcpResourceUrl("")).toBeNull();
    expect(resolveCloudMcpResourceUrl("   ")).toBeNull();
    expect(resolveCloudMcpResourceUrl("not a url")).toBeNull();
    expect(resolveCloudMcpResourceUrl("ftp://app.openwork.test/mcp")).toBeNull();
  });
});

describe("parseDenMcpToken", () => {
  test("accepts an older Den response while leaving the private App host closed", () => {
    expect(parseDenMcpToken({
      token: "central-token",
      expiresAt: "2026-08-18T00:00:00.000Z",
      organizationId: "org_1",
      scopes: ["mcp:read", "mcp:write"],
      resource: "https://api.openwork.test/mcp",
    })).toEqual({
      token: "central-token",
      expiresAt: "2026-08-18T00:00:00.000Z",
      organizationId: "org_1",
      scopes: ["mcp:read", "mcp:write"],
      resource: "https://api.openwork.test/mcp",
    });
  });

  test("keeps the App-host token pair only when both fields are present", () => {
    const base = {
      token: "central-token",
      expiresAt: "2026-08-18T00:00:00.000Z",
      organizationId: "org_1",
      scopes: ["mcp:read", "mcp:write"],
      resource: "https://api.openwork.test/mcp",
    };
    expect(parseDenMcpToken({ ...base, appHostToken: "private-token" })?.appHostToken).toBeUndefined();
    expect(parseDenMcpToken({
      ...base,
      appHostToken: "private-token",
      appHostExpiresAt: "2026-08-18T00:00:00.000Z",
    })?.appHostToken).toBe("private-token");
  });
});
