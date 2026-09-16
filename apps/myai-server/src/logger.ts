import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const sensitiveKey = /(authorization|password|token|cookie|secret|prompt|content|acceptcode|code)/i;

function scrub(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((entry) => scrub(entry));
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) result[childKey] = scrub(childValue, childKey);
  return result;
}

export interface MyaiLogger {
  write(event: Record<string, unknown>): void;
}

export function createLogger(logFile?: string): MyaiLogger {
  return {
    write(event) {
      if (!logFile) return;
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, `${JSON.stringify(scrub(event))}\n`, "utf8");
    },
  };
}
