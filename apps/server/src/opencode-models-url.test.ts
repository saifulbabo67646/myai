import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveOpencodeModelsUrl } from "./opencode-models-url.js";

function restoreProcessEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function writeFakeOpencodeBin(root: string): Promise<string> {
  const binPath = join(root, "fake-opencode.mjs");
  await writeFile(binPath, [
    "#!/usr/bin/env bun",
    "const portIndex = process.argv.indexOf(\"--port\");",
    "const port = portIndex >= 0 ? process.argv[portIndex + 1] : \"0\";",
    "const capturePath = process.env.OPENWORK_CAPTURE_MODELS_URL_FILE;",
    // "<unset>" distinguishes an omitted variable from an injected empty one.
    "if (capturePath) await Bun.write(capturePath, process.env.OPENCODE_MODELS_URL ?? \"<unset>\");",
    "console.log(`opencode server listening on http://127.0.0.1:${port}`);",
    "process.on(\"SIGTERM\", () => process.exit(0));",
    "setInterval(() => undefined, 1_000);",
  ].join("\n"));
  await chmod(binPath, 0o755);
  return binPath;
}

describe("resolveOpencodeModelsUrl", () => {
  test("honors an explicit catalog URL", async () => {
    expect(await resolveOpencodeModelsUrl({
      env: {
        OPENWORK_DEV_MODE: "1",
        OPENCODE_MODELS_URL: " https://catalog.example.test/models ",
      },
    })).toBe("https://catalog.example.test/models");
  });

  test("resolves to no catalog outside development when nothing is configured", async () => {
    // The engine must keep its own built-in catalog rather than being pointed
    // at a hosted models deployment nobody configured. Callers distinguish
    // this from a real URL by the empty string and omit the env var.
    expect(await resolveOpencodeModelsUrl({ env: {} })).toBe("");
  });

  test("does not reach for any catalog host outside development", async () => {
    let fetches = 0;
    expect(await resolveOpencodeModelsUrl({
      env: {},
      fetchModels: async () => {
        fetches += 1;
        return new Response(null, { status: 200 });
      },
    })).toBe("");
    expect(fetches).toBe(0);
  });

  test("uses the local catalog when the development server is available", async () => {
    expect(await resolveOpencodeModelsUrl({
      env: { OPENWORK_DEV_MODE: "1" },
      fetchModels: async () => new Response(null, { status: 200 }),
    })).toBe("http://localhost:8791/models");
  });

  test("resolves to no catalog when a development server is unavailable", async () => {
    expect(await resolveOpencodeModelsUrl({
      env: { OPENWORK_DEV_MODE: "1" },
      fetchModels: async () => new Response(null, { status: 503 }),
    })).toBe("");
  });

  test("keeps an explicit catalog URL even outside development", async () => {
    expect(await resolveOpencodeModelsUrl({
      env: { OPENCODE_MODELS_URL: "https://catalog.example.test/models" },
    })).toBe("https://catalog.example.test/models");
  });
});

describe("startEmbeddedServer managed OpenCode models URL", () => {
  test("injects an explicit OPENCODE_MODELS_URL override", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-embedded-models-url-"));
    const workspace = join(root, "workspace");
    const capturePath = join(root, "models-url.txt");
    await mkdir(workspace, { recursive: true });
    const opencodeBin = await writeFakeOpencodeBin(root);

    const previousDevMode = process.env.OPENWORK_DEV_MODE;
    const previousModelsUrl = process.env.OPENCODE_MODELS_URL;
    const previousCapturePath = process.env.OPENWORK_CAPTURE_MODELS_URL_FILE;
    const previousHome = process.env.HOME;
    const previousOpencodeBaseUrl = process.env.OPENWORK_OPENCODE_BASE_URL;

    try {
      process.env.OPENWORK_DEV_MODE = "1";
      process.env.OPENCODE_MODELS_URL = "https://catalog.example.test/models";
      process.env.OPENWORK_CAPTURE_MODELS_URL_FILE = capturePath;
      process.env.HOME = join(root, "home");
      delete process.env.OPENWORK_OPENCODE_BASE_URL;

      const { startEmbeddedServer } = await import("./embedded.js");
      const handle = await startEmbeddedServer({
        configPath: join(root, "server.json"),
        host: "127.0.0.1",
        port: 0,
        token: "server-token",
        hostToken: "host-token",
        workspaces: [workspace],
        manageOpencode: true,
        opencodeBin,
        opencodeCwd: workspace,
      });
      await handle.stop();

      expect(await readFile(capturePath, "utf8")).toBe("https://catalog.example.test/models");
    } finally {
      restoreProcessEnv("OPENWORK_DEV_MODE", previousDevMode);
      restoreProcessEnv("OPENCODE_MODELS_URL", previousModelsUrl);
      restoreProcessEnv("OPENWORK_CAPTURE_MODELS_URL_FILE", previousCapturePath);
      restoreProcessEnv("HOME", previousHome);
      restoreProcessEnv("OPENWORK_OPENCODE_BASE_URL", previousOpencodeBaseUrl);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("omits OPENCODE_MODELS_URL for the managed engine when no catalog is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-embedded-models-unset-"));
    const workspace = join(root, "workspace");
    const capturePath = join(root, "models-url.txt");
    await mkdir(workspace, { recursive: true });
    const opencodeBin = await writeFakeOpencodeBin(root);

    const previousDevMode = process.env.OPENWORK_DEV_MODE;
    const previousModelsUrl = process.env.OPENCODE_MODELS_URL;
    const previousCapturePath = process.env.OPENWORK_CAPTURE_MODELS_URL_FILE;
    const previousHome = process.env.HOME;
    const previousOpencodeBaseUrl = process.env.OPENWORK_OPENCODE_BASE_URL;

    try {
      // No dev mode, no override: nothing local applies, so the engine keeps
      // its own built-in catalog and must not receive an empty override.
      delete process.env.OPENWORK_DEV_MODE;
      delete process.env.OPENCODE_MODELS_URL;
      process.env.OPENWORK_CAPTURE_MODELS_URL_FILE = capturePath;
      process.env.HOME = join(root, "home");
      delete process.env.OPENWORK_OPENCODE_BASE_URL;

      const { startEmbeddedServer } = await import("./embedded.js");
      const handle = await startEmbeddedServer({
        configPath: join(root, "server.json"),
        host: "127.0.0.1",
        port: 0,
        token: "server-token",
        hostToken: "host-token",
        workspaces: [workspace],
        manageOpencode: true,
        opencodeBin,
        opencodeCwd: workspace,
      });
      await handle.stop();

      expect(await readFile(capturePath, "utf8")).toBe("<unset>");
    } finally {
      restoreProcessEnv("OPENWORK_DEV_MODE", previousDevMode);
      restoreProcessEnv("OPENCODE_MODELS_URL", previousModelsUrl);
      restoreProcessEnv("OPENWORK_CAPTURE_MODELS_URL_FILE", previousCapturePath);
      restoreProcessEnv("HOME", previousHome);
      restoreProcessEnv("OPENWORK_OPENCODE_BASE_URL", previousOpencodeBaseUrl);
      await rm(root, { recursive: true, force: true });
    }
  });
});
