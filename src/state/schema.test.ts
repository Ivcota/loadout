import { describe, expect, it } from "vitest";
import { decodeStateSync, initialState, STATE_VERSION } from "./schema.js";

describe("state schema", () => {
  it("decodes a minimal valid state", () => {
    const decoded = decodeStateSync(initialState);
    expect(decoded.version).toBe(STATE_VERSION);
    expect(decoded.active_modes).toEqual([]);
    expect(decoded.in_progress).toBeNull();
  });

  it("decodes a state with active modes and in_progress snapshot", () => {
    const input = {
      version: 1,
      active_modes: ["default", "product"],
      in_progress: {
        op: "on",
        mode: "design",
        completed: [
          {
            harness: "claude",
            skill: "refactoring-ui",
            op: "activate",
            source_path: "/pool/claude/refactoring-ui",
            dest_path: "/active/claude/refactoring-ui",
          },
        ],
        pending: [
          {
            harness: "claude",
            skill: "design-review",
            op: "activate",
            source_path: "/pool/claude/design-review",
            dest_path: "/active/claude/design-review",
          },
        ],
      },
    };
    const decoded = decodeStateSync(input);
    expect(decoded.active_modes).toHaveLength(2);
    expect(decoded.in_progress?.op).toBe("on");
    expect(decoded.in_progress?.completed).toHaveLength(1);
    expect(decoded.in_progress?.pending[0]?.skill).toBe("design-review");
  });

  it("rejects a state with version != 1 (upgrade loadout)", () => {
    expect(() => decodeStateSync({ version: 2, active_modes: [], in_progress: null })).toThrow();
    expect(() => decodeStateSync({ version: 0, active_modes: [], in_progress: null })).toThrow();
  });

  it("rejects a state missing the version field", () => {
    expect(() => decodeStateSync({ active_modes: [], in_progress: null })).toThrow();
  });

  it("rejects an in_progress with unknown op", () => {
    expect(() =>
      decodeStateSync({
        version: 1,
        active_modes: [],
        in_progress: {
          op: "swap",
          mode: "x",
          completed: [],
          pending: [],
        },
      }),
    ).toThrow();
  });

  it("treats live_mds as undefined when absent (callers use liveMdsOf)", () => {
    const decoded = decodeStateSync({
      version: 1,
      active_modes: [],
      in_progress: null,
    });
    expect(decoded.live_mds).toBeUndefined();
  });

  it("decodes a state with live_mds entries", () => {
    const decoded = decodeStateSync({
      version: 1,
      active_modes: ["coding"],
      in_progress: null,
      live_mds: {
        claude: { mode: "coding", sha256: "abc123" },
        codex: { mode: "baseline", sha256: "def456" },
      },
    });
    expect(decoded.live_mds?.claude?.mode).toBe("coding");
    expect(decoded.live_mds?.codex?.sha256).toBe("def456");
  });

  it("rejects a live_mds entry missing mode or sha256", () => {
    expect(() =>
      decodeStateSync({
        version: 1,
        active_modes: [],
        in_progress: null,
        live_mds: { claude: { mode: "coding" } },
      }),
    ).toThrow();
  });

  it("rejects a PlannedMove with unknown op", () => {
    expect(() =>
      decodeStateSync({
        version: 1,
        active_modes: [],
        in_progress: {
          op: "on",
          mode: "x",
          completed: [],
          pending: [
            {
              harness: "claude",
              skill: "qa",
              op: "delete",
              source_path: "/a",
              dest_path: "/b",
            },
          ],
        },
      }),
    ).toThrow();
  });
});

