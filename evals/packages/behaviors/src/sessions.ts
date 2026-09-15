import type { Surface } from "@openwork/cdp";
import { control } from "./desktop.ts";

const FIRST_CREATE_TIMEOUT_MS = 60_000;
const SUBSEQUENT_CREATE_TIMEOUT_MS = 15_000;
const CREATE_ATTEMPT_TIMEOUT_MS = 8_000;
const POLL_INTERVAL_MS = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createSession(app: Surface, title: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    attempts += 1;
    const remainingMs = Math.max(1, deadline - Date.now());
    let result: unknown;
    try {
      result = await control(app, "session.create_task", undefined, {
        timeoutMs: Math.min(CREATE_ATTEMPT_TIMEOUT_MS, remainingMs),
      });
    } catch (error) {
      lastError = error;
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
      continue;
    }

    if (typeof result !== "string" || !result.trim()) {
      throw new Error(`Desktop control action session.create_task returned an invalid session ID for ${JSON.stringify(title)}.`);
    }
    return result.trim();
  }

  throw new Error(
    `Desktop control action session.create_task did not become available for ${JSON.stringify(title)} within ${timeoutMs}ms (${attempts} attempts)${lastError ? `: ${messageText(lastError)}` : ""}.`,
  );
}

export async function listSessions(app: Surface): Promise<{ sessionId: string; title: string }[]> {
  const result = await control(app, "session.list_sessions");
  if (!Array.isArray(result)) {
    throw new Error(`Desktop control action session.list_sessions returned an invalid list: ${JSON.stringify(result)}`);
  }

  const sessions: { sessionId: string; title: string }[] = [];
  for (const session of result) {
    if (!isRecord(session) || typeof session.sessionId !== "string" || typeof session.title !== "string") {
      throw new Error(`Desktop control action session.list_sessions returned an invalid session: ${JSON.stringify(session)}`);
    }
    sessions.push({ sessionId: session.sessionId, title: session.title });
  }
  return sessions;
}

export async function seedSessions(
  app: Surface,
  titles: readonly string[],
): Promise<{ sessionId: string; title: string }[]> {
  const seeded: { sessionId: string; title: string }[] = [];
  for (const [index, title] of titles.entries()) {
    const timeoutMs = index === 0 ? FIRST_CREATE_TIMEOUT_MS : SUBSEQUENT_CREATE_TIMEOUT_MS;
    const sessionId = await createSession(app, title, timeoutMs);
    await control(app, "session.rename", { sessionId, title });
    seeded.push({ sessionId, title });
  }

  const observed = await listSessions(app);
  const missing = titles.filter((title) => !observed.some((session) => session.title === title));
  if (missing.length > 0) {
    throw new Error(
      `Seeded session titles were not present after creation. Missing: ${JSON.stringify(missing)}. Observed: ${JSON.stringify(observed)}.`,
    );
  }
  return seeded;
}
