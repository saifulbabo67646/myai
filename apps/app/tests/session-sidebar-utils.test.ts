import { describe, expect, test } from "bun:test";

import type { SidebarSessionItem } from "../src/app/types";
import { flattenSessionRows } from "../src/react-app/domains/session/sidebar/utils";

const sessions: SidebarSessionItem[] = [
  { id: "session-a", title: "Pinned root" },
  { id: "session-a-child", title: "Sub-agent child", parentID: "session-a" },
  { id: "session-b", title: "Regular root" },
];

describe("sidebar session rows", () => {
  test("never emits sub-agent (child) sessions", () => {
    const rows = flattenSessionRows(sessions, Number.MAX_SAFE_INTEGER);

    expect(rows.map((row) => row.session.id)).toEqual(["session-a", "session-b"]);
  });

  test("selects a pinned root without its descendants", () => {
    const rows = flattenSessionRows(
      sessions,
      1,
      new Set(["session-a"]),
      [],
      { include: new Set(["session-a"]) },
    );

    expect(rows.map((row) => row.session.id)).toEqual(["session-a"]);
  });

  test("removes pinned roots before applying the workspace preview limit", () => {
    const rows = flattenSessionRows(
      sessions,
      1,
      new Set(),
      [],
      { exclude: new Set(["session-a"]) },
    );

    expect(rows.map((row) => row.session.id)).toEqual(["session-b"]);
  });

  test("keeps a child whose parent is outside the list as a root", () => {
    const orphaned: SidebarSessionItem[] = [
      { id: "session-c", title: "Orphan child", parentID: "missing-parent" },
    ];
    const rows = flattenSessionRows(orphaned, Number.MAX_SAFE_INTEGER);

    expect(rows.map((row) => row.session.id)).toEqual(["session-c"]);
  });
});
