import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { createCodexAdapter } from "../../adapters/codex/index.js";
import { loadoutHome } from "../../paths.js";
import { save as saveManifest } from "../../manifest/loader.js";
import { save as saveState } from "../../state/manager.js";
import type { State } from "../../state/schema.js";
import { init } from "./init.js";
import { off, on, renderSwap, swap, use } from "./swap.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-swap-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const runExit = <A, E>(
  eff: Effect.Effect<A, E>,
): Promise<Exit.Exit<A, E>> => Effect.runPromiseExit(eff);

const seedActive = async (
  homeRoot: string,
  harness: "claude" | "codex",
  skills: string[],
): Promise<void> => {
  const dir = path.join(
    homeRoot,
    harness === "claude" ? ".claude" : ".agents",
    "skills",
  );
  for (const s of skills) {
    await fs.mkdir(path.join(dir, s), { recursive: true });
  }
};

const mkDeps = () => {
  const paths = loadoutHome({ home: tmpHome });
  const adapters = [
    createClaudeAdapter({ home: tmpHome }),
    createCodexAdapter({ home: tmpHome }),
  ];
  return { paths, adapters };
};

const exists = async (p: string): Promise<boolean> =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);

describe("swap commands (on/off/use)", () => {
  it("on: activates an inactive mode, moves skills from pool to active", async () => {
    await seedActive(tmpHome, "claude", ["qa", "review"]);
    const deps = mkDeps();
    await run(init(deps));

    // Build a richer manifest: default (qa,review), product (office-hours).
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: {
        default: { skills: ["qa", "review"] },
        product: { skills: ["office-hours"] },
      },
    }));
    // Seed office-hours into the claude POOL so `on product` can activate it.
    await fs.mkdir(
      path.join(tmpHome, ".loadout/pool/claude/office-hours"),
      { recursive: true },
    );

    const report = await run(on({ ...deps, mode: "product" }));

    expect(report.op).toBe("on");
    expect(report.dryRun).toBe(false);
    expect(report.rolledBack).toBe(false);
    expect(report.after.active_modes.sort()).toEqual(["default", "product"]);
    expect(report.moves).toHaveLength(1);
    expect(report.moves[0]).toMatchObject({
      skill: "office-hours",
      harness: "claude",
      op: "activate",
    });

    // File actually moved.
    expect(
      await exists(path.join(tmpHome, ".claude/skills/office-hours")),
    ).toBe(true);
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/office-hours")),
    ).toBe(false);
  });

  it("off: deactivates an active mode, moves orphaned skills to pool", async () => {
    await seedActive(tmpHome, "claude", ["qa", "review"]);
    const deps = mkDeps();
    await run(init(deps));
    // default mode has qa+review; only review is in the "keep" mode.
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: {
        default: { skills: ["qa", "review"] },
        keep: { skills: ["review"] },
      },
    }));
    // Start with both modes active so `off default` still leaves review in place.
    await run(saveState(deps.paths.state, {
      version: 1,
      active_modes: ["default", "keep"],
      in_progress: null,
    }));

    const report = await run(off({ ...deps, mode: "default" }));

    expect(report.op).toBe("off");
    expect(report.after.active_modes).toEqual(["keep"]);
    // qa is no longer required, review still is.
    expect(report.moves.map((m) => m.skill).sort()).toEqual(["qa"]);
    expect(
      await exists(path.join(tmpHome, ".claude/skills/qa")),
    ).toBe(false);
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/qa")),
    ).toBe(true);
    expect(
      await exists(path.join(tmpHome, ".claude/skills/review")),
    ).toBe(true);
  });

  it("use: replaces all active modes with exactly the given mode", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: {
        default: { skills: ["qa"] },
        product: { skills: ["office-hours"] },
      },
    }));
    await fs.mkdir(
      path.join(tmpHome, ".loadout/pool/claude/office-hours"),
      { recursive: true },
    );

    const report = await run(use({ ...deps, mode: "product" }));
    expect(report.after.active_modes).toEqual(["product"]);
    expect(
      await exists(path.join(tmpHome, ".claude/skills/office-hours")),
    ).toBe(true);
    expect(
      await exists(path.join(tmpHome, ".claude/skills/qa")),
    ).toBe(false);
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/qa")),
    ).toBe(true);
  });

  it("--dry-run: plans but writes nothing (no fs moves, state.json unchanged)", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: {
        default: { skills: ["qa"] },
        product: { skills: ["office-hours"] },
      },
    }));
    await fs.mkdir(
      path.join(tmpHome, ".loadout/pool/claude/office-hours"),
      { recursive: true },
    );

    const beforeRaw = await fs.readFile(deps.paths.state.stateFile, "utf8");
    const report = await run(on({ ...deps, mode: "product", dryRun: true }));

    expect(report.dryRun).toBe(true);
    expect(report.moves.length).toBe(1);
    // File untouched.
    expect(
      await exists(path.join(tmpHome, ".claude/skills/office-hours")),
    ).toBe(false);
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/office-hours")),
    ).toBe(true);
    // state.json untouched.
    const afterRaw = await fs.readFile(deps.paths.state.stateFile, "utf8");
    expect(afterRaw).toBe(beforeRaw);
  });

  it("--rollback: reverts a stale in_progress op", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: {
        default: { skills: ["qa"] },
        product: { skills: ["office-hours"] },
      },
    }));
    await fs.mkdir(
      path.join(tmpHome, ".loadout/pool/claude/office-hours"),
      { recursive: true },
    );

    // Simulate a partial swap: office-hours was already moved into active,
    // but state.json still has it as "in_progress" with that move completed.
    await fs.rename(
      path.join(tmpHome, ".loadout/pool/claude/office-hours"),
      path.join(tmpHome, ".claude/skills/office-hours"),
    );
    const stale: State = {
      version: 1,
      active_modes: ["default"],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [
          {
            harness: "claude",
            skill: "office-hours",
            op: "activate",
            source_path: path.join(tmpHome, ".loadout/pool/claude/office-hours"),
            dest_path: path.join(tmpHome, ".claude/skills/office-hours"),
          },
        ],
        pending: [],
      },
    };
    await run(saveState(deps.paths.state, stale));

    // Rollback. Mode argument is ignored when --rollback is set; we still pass one
    // through the wrapper to mirror real CLI usage.
    const report = await run(
      on({ ...deps, mode: "product", rollback: true }),
    );

    expect(report.rolledBack).toBe(true);
    expect(report.after.in_progress).toBeNull();
    expect(report.after.active_modes).toEqual(["default"]);
    // File moved back to pool.
    expect(
      await exists(path.join(tmpHome, ".claude/skills/office-hours")),
    ).toBe(false);
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/office-hours")),
    ).toBe(true);
  });

  it("--rollback with no in_progress: fails with SwapNothingToRollback", async () => {
    const deps = mkDeps();
    await run(init(deps));
    const exit = await runExit(
      on({ ...deps, mode: "default", rollback: true }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = exit.cause.toJSON() as unknown as string;
      expect(JSON.stringify(err)).toContain("SwapNothingToRollback");
    }
  });

  it("auto-resumes a pending in_progress op before applying the new one", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: {
        default: { skills: ["qa"] },
        product: { skills: ["office-hours"] },
      },
    }));
    // office-hours sits in pool, partially-executed swap left it there with a pending move.
    await fs.mkdir(
      path.join(tmpHome, ".loadout/pool/claude/office-hours"),
      { recursive: true },
    );
    await run(saveState(deps.paths.state, {
      version: 1,
      active_modes: ["default"],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [],
        pending: [
          {
            harness: "claude",
            skill: "office-hours",
            op: "activate",
            source_path: path.join(tmpHome, ".loadout/pool/claude/office-hours"),
            dest_path: path.join(tmpHome, ".claude/skills/office-hours"),
          },
        ],
      },
    }));

    // Now user runs `loadout use default` — we should resume the prior op first,
    // then apply `use default` (which removes product).
    const report = await run(use({ ...deps, mode: "default" }));
    expect(report.resumedPrior).toBe(true);
    expect(report.after.active_modes).toEqual(["default"]);
    expect(report.after.in_progress).toBeNull();
    // office-hours ended up back in pool because `use default` deactivates it.
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/office-hours")),
    ).toBe(true);
    expect(
      await exists(path.join(tmpHome, ".claude/skills/office-hours")),
    ).toBe(false);
  });

  it("unknown mode: fails with SwapModeNotFound listing known modes", async () => {
    const deps = mkDeps();
    await run(init(deps));
    const exit = await runExit(swap({ ...deps, op: "on", mode: "nope" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const j = JSON.stringify(exit.cause.toJSON());
      expect(j).toContain("SwapModeNotFound");
      expect(j).toContain("default");
    }
  });

  it("on an already-active mode is a no-op (no moves, idempotent active_modes)", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));

    const report = await run(on({ ...deps, mode: "default" }));
    expect(report.moves).toHaveLength(0);
    expect(report.after.active_modes).toEqual(["default"]);
  });
});

describe("renderSwap", () => {
  it("formats moves with arrows and harness names", () => {
    const out = renderSwap({
      op: "on",
      mode: "product",
      dryRun: false,
      rolledBack: false,
      resumedPrior: false,
      moves: [
        {
          harness: "claude",
          skill: "office-hours",
          op: "activate",
          source_path: "/a",
          dest_path: "/b",
        },
      ],
      before: { version: 1, active_modes: ["default"], in_progress: null },
      after: {
        version: 1,
        active_modes: ["default", "product"],
        in_progress: null,
      },
      manifest: { version: 1, modes: {} },
    });
    expect(out).toContain("loadout on product");
    expect(out).toContain("→ activate office-hours (claude)");
    expect(out).toContain("active_modes: default, product");
  });

  it("dry-run output mentions no files moved", () => {
    const out = renderSwap({
      op: "use",
      mode: "default",
      dryRun: true,
      rolledBack: false,
      resumedPrior: false,
      moves: [],
      before: { version: 1, active_modes: [], in_progress: null },
      after: { version: 1, active_modes: ["default"], in_progress: null },
      manifest: { version: 1, modes: {} },
    });
    expect(out.startsWith("[dry-run]")).toBe(true);
    expect(out).toContain("dry-run: no files moved");
  });

  it("rollback output marks reverts and uses the prior op", () => {
    const out = renderSwap({
      op: "on",
      mode: "product",
      dryRun: false,
      rolledBack: true,
      resumedPrior: false,
      moves: [
        {
          harness: "claude",
          skill: "office-hours",
          op: "activate",
          source_path: "/a",
          dest_path: "/b",
        },
      ],
      before: { version: 1, active_modes: ["default"], in_progress: null },
      after: { version: 1, active_modes: ["default"], in_progress: null },
      manifest: { version: 1, modes: {} },
    });
    expect(out).toContain("loadout --rollback (was: on product)");
    expect(out).toContain("revert activate office-hours");
  });
});
