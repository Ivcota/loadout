import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { HarnessSnapshot } from "../adapters/HarnessAdapter.js";
import type { ModesManifest } from "../manifest/schema.js";
import { plan, type SwapOp } from "./engine.js";

const mkManifest = (entries: Record<string, string[]>): ModesManifest => ({
  version: 1,
  modes: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { skills: v }])),
});

const mkHarness = (
  name: string,
  active: string[],
  pool: string[],
): HarnessSnapshot => ({
  name,
  activeDir: `/active/${name}`,
  poolDir: `/pool/${name}`,
  active: new Set(active),
  pool: new Set(pool),
});

describe("SwapEngine.plan — basic ops", () => {
  it("on(default) from empty state activates everything in default that's pooled", () => {
    const manifest = mkManifest({ default: ["a", "b", "c"] });
    const claude = mkHarness("claude", [], ["a", "b", "c"]);
    const result = plan({
      op: "on",
      mode: "default",
      manifest,
      activeModes: [],
      harnesses: [claude],
    });
    expect(result.newActiveModes).toEqual(["default"]);
    expect(result.moves.map((m) => m.skill).sort()).toEqual(["a", "b", "c"]);
    for (const m of result.moves) expect(m.op).toBe("activate");
  });

  it("on(M) when M already active is a no-op", () => {
    const manifest = mkManifest({ default: ["a"] });
    const claude = mkHarness("claude", ["a"], []);
    const result = plan({
      op: "on",
      mode: "default",
      manifest,
      activeModes: ["default"],
      harnesses: [claude],
    });
    expect(result.moves).toEqual([]);
    expect(result.newActiveModes).toEqual(["default"]);
  });

  it("off(M) deactivates only skills uniquely owned by M", () => {
    const manifest = mkManifest({
      product: ["a", "shared"],
      design: ["b", "shared"],
    });
    const claude = mkHarness("claude", ["a", "b", "shared"], []);
    const result = plan({
      op: "off",
      mode: "product",
      manifest,
      activeModes: ["product", "design"],
      harnesses: [claude],
    });
    expect(result.newActiveModes).toEqual(["design"]);
    expect(result.moves.map((m) => m.skill).sort()).toEqual(["a"]);
    expect(result.moves[0]?.op).toBe("deactivate");
  });

  it("use(M) deactivates non-M managed skills and activates missing M skills", () => {
    const manifest = mkManifest({
      default: ["a", "b", "c"],
      product: ["a", "x"],
    });
    const claude = mkHarness("claude", ["a", "b", "c"], ["x"]);
    const result = plan({
      op: "use",
      mode: "product",
      manifest,
      activeModes: ["default"],
      harnesses: [claude],
    });
    expect(result.newActiveModes).toEqual(["product"]);
    const skills = result.moves.map((m) => `${m.op}:${m.skill}`).sort();
    expect(skills).toEqual([
      "activate:x",
      "deactivate:b",
      "deactivate:c",
    ]);
  });

  it("use never touches unmanaged skills (not referenced by any mode)", () => {
    const manifest = mkManifest({ product: ["a"] });
    const claude = mkHarness("claude", ["a", "unmanaged"], []);
    const result = plan({
      op: "use",
      mode: "product",
      manifest,
      activeModes: ["product"],
      harnesses: [claude],
    });
    expect(result.moves).toEqual([]);
  });

  it("on(M) does not activate skills the harness doesn't have (in either dir)", () => {
    const manifest = mkManifest({ product: ["a", "missing"] });
    const claude = mkHarness("claude", [], ["a"]);
    const result = plan({
      op: "on",
      mode: "product",
      manifest,
      activeModes: [],
      harnesses: [claude],
    });
    expect(result.moves.map((m) => m.skill)).toEqual(["a"]);
  });

  it("multi-harness: same skill name moves in each harness that has it", () => {
    const manifest = mkManifest({ product: ["qa"] });
    const claude = mkHarness("claude", [], ["qa"]);
    const codex = mkHarness("codex", [], ["qa"]);
    const result = plan({
      op: "on",
      mode: "product",
      manifest,
      activeModes: [],
      harnesses: [claude, codex],
    });
    expect(result.moves.map((m) => m.harness).sort()).toEqual(["claude", "codex"]);
  });

  it("unknown mode is a defensive no-op", () => {
    const manifest = mkManifest({ default: ["a"] });
    const result = plan({
      op: "on",
      mode: "ghost",
      manifest,
      activeModes: [],
      harnesses: [mkHarness("claude", [], ["a"])],
    });
    expect(result.moves).toEqual([]);
    expect(result.newActiveModes).toEqual([]);
  });
});

// Apply a plan to a snapshot to produce a new snapshot (pure model for property tests).
const apply = (h: HarnessSnapshot, moves: ReadonlyArray<{ skill: string; op: SwapOp extends "use" ? never : "activate" | "deactivate" }>): HarnessSnapshot => {
  const active = new Set(h.active);
  const pool = new Set(h.pool);
  for (const m of moves) {
    if (m.op === "activate") {
      pool.delete(m.skill);
      active.add(m.skill);
    } else {
      active.delete(m.skill);
      pool.add(m.skill);
    }
  }
  return { ...h, active, pool };
};

describe("SwapEngine.plan — property: set-difference invariant", () => {
  it("after applying plan moves, pool ∪ active = all_managed and pool ∩ active = ∅", () => {
    const skillArb = fc.constantFrom("a", "b", "c", "d", "e");
    const modeNameArb = fc.constantFrom("default", "product", "design", "research");

    fc.assert(
      fc.property(
        // Manifest: 1-4 modes, each with 0-5 skills (from the universe of 5).
        fc.dictionary(
          modeNameArb,
          fc.record({ skills: fc.uniqueArray(skillArb, { maxLength: 5 }) }),
          { minKeys: 1, maxKeys: 4 },
        ),
        // Sequence of ops (1-8) to apply.
        fc.array(
          fc.record({
            op: fc.constantFrom<SwapOp>("on", "off", "use"),
            mode: modeNameArb,
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (modesObj, ops) => {
          const manifest: ModesManifest = { version: 1, modes: modesObj };
          // Initial harness has all referenced skills in pool.
          const universe = new Set<string>();
          for (const m of Object.values(modesObj)) for (const s of m.skills) universe.add(s);
          let snap: HarnessSnapshot = mkHarness("claude", [], [...universe]);
          let activeModes: ReadonlyArray<string> = [];

          for (const step of ops) {
            // Skip ops on unknown modes (defensive plan() returns empty).
            if (!(step.mode in modesObj)) continue;
            const result = plan({
              op: step.op,
              mode: step.mode,
              manifest,
              activeModes,
              harnesses: [snap],
            });
            snap = apply(snap, result.moves);
            activeModes = result.newActiveModes;

            // Invariant 1: pool ∩ active = ∅
            for (const s of snap.active) expect(snap.pool.has(s)).toBe(false);
            // Invariant 2: pool ∪ active = universe (all_managed)
            const merged = new Set([...snap.active, ...snap.pool]);
            expect(merged).toEqual(universe);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
