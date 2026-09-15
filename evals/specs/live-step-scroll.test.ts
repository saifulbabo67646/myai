import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { test } from "@openwork/testkit";

const messageListPath = fileURLToPath(
  new URL("../../apps/app/src/components/chat/message-list.tsx", import.meta.url),
);

test("live thinking uses the transcript scroll instead of a nested step scroller", ({ evidence }) => {
  const source = readFileSync(messageListPath, "utf8");
  expect(source).toContain('data-live-steps=""');
  expect(source).toContain('data-live-steps="" className="flex flex-col gap-2"');
  expect(source).not.toContain('data-scrollable=""');
  expect(source).not.toContain("max-h-[520px]");
  expect(source).not.toContain("overflow-y-auto");

  evidence.recordAssertionEvidence(
    "Live thinking has no nested scrollbar",
    "Live and completed step runs render inline without a height cap or overflow scroller, leaving the transcript as the only vertical scroll container.",
    true,
  );
});
