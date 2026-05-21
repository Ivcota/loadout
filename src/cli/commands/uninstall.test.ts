import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentsAdapter } from "../../adapters/agents/index.js";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { createCodexAdapter } from "../../adapters/codex/index.js";
import { save as saveManifest } from "../../manifest/loader.js";
import { loadoutHome } from "../../paths.js";
import { save as saveState } from "../../state/manager.js";
import { init } from "./init.js";
import { off } from "./swap.js";
import { renderUninstall, uninstall } from "./uninstall.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-uninstall-"));
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
  harness: "claude" | "codex" | "agents",
  skills: string[],
): Promise<void> => {
  const dir = path.join(
    homeRoot,
    harness === "claude" ? ".claude" : harness === "codex" ? ".codex" : ".agents",
    "skills",
  );
  for (const s of skills) {
    await fs.mkdir(path.join(dir, s), { recursive: true });
  }
};

const exists = async (p: string): Promise<boolean> =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);

const mkDeps = () => {
  const paths = loadoutHome({ home: tmpHome });
  const adapters = [
    createClaudeAdapter({ home: tmpHome }),
    createCodexAdapter({ home: tmpHome }),
    createAgentsAdapter({ home: tmpHome }),
  ];
  return { paths, adapters };
};

describe("uninstall", () => {
  it("moves every pool skill back to active, then removes ~/.loadout/", async () => {
    await seedActive(tmpHome, "claude", ["qa", "review"]);
    const deps = mkDeps();
    await run(init(deps));
    // Manifest rewrite: default drops review, product owns it. `off product`
    // (a no-op for active_modes) ends up moving review to pool because default
    // no longer covers it — see the off semantics in swap engine.
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: {
        default: { skills: ["qa"] },
        product: { skills: ["review"] },
      },
    }));
    await run(off({ ...deps, mode: "product" }));

    // Precondition for the test: review is now in pool.
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/review")),
    ).toBe(true);

    const report = await run(uninstall(deps));

    expect(report.removed).toBe(true);
    expect(report.moves.map((m) => m.skill)).toContain("review");
    expect(await exists(deps.paths.root)).toBe(false);
    expect(
      await exists(path.join(tmpHome, ".claude/skills/review")),
    ).toBe(true);
    expect(
      await exists(path.join(tmpHome, ".claude/skills/qa")),
    ).toBe(true);
  });

  it("no-op happy path: pool is empty, just removes ~/.loadout/", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));

    const report = await run(uninstall(deps));
    expect(report.removed).toBe(true);
    expect(report.moves).toHaveLength(0);
    expect(await exists(deps.paths.root)).toBe(false);
    expect(await exists(path.join(tmpHome, ".claude/skills/qa"))).toBe(true);
  });

  it("refuses when state.in_progress is set and force is not passed", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveState(deps.paths.state, {
      version: 1,
      active_modes: ["default"],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [],
        pending: [],
      },
    }));

    const exit = await runExit(uninstall(deps));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const j = JSON.stringify(exit.cause.toJSON());
      expect(j).toContain("UninstallInProgress");
    }
    // Loadout root still there.
    expect(await exists(deps.paths.root)).toBe(true);
  });

  it("with force: removes even when in_progress is set", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveState(deps.paths.state, {
      version: 1,
      active_modes: ["default"],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [],
        pending: [],
      },
    }));

    const report = await run(uninstall({ ...deps, force: true }));
    expect(report.removed).toBe(true);
    expect(await exists(deps.paths.root)).toBe(false);
  });

  it("dry-run: lists moves, removes nothing, ~/.loadout/ intact", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    // Put one item in pool.
    await fs.mkdir(path.join(tmpHome, ".loadout/pool/claude/extra"), {
      recursive: true,
    });

    const report = await run(uninstall({ ...deps, dryRun: true }));
    expect(report.dryRun).toBe(true);
    expect(report.removed).toBe(false);
    expect(report.moves.map((m) => m.skill)).toContain("extra");
    // Nothing actually moved.
    expect(
      await exists(path.join(tmpHome, ".claude/skills/extra")),
    ).toBe(false);
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/extra")),
    ).toBe(true);
    expect(await exists(deps.paths.root)).toBe(true);
  });

  it("removes the reserved 'loadout' skill from every adapter's active dir", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));

    // init must have installed the reserved skill.
    expect(
      await exists(path.join(tmpHome, ".claude/skills/loadout/SKILL.md")),
    ).toBe(true);
    expect(
      await exists(path.join(tmpHome, ".codex/skills/loadout/SKILL.md")),
    ).toBe(true);
    expect(
      await exists(path.join(tmpHome, ".agents/skills/loadout/SKILL.md")),
    ).toBe(true);

    const report = await run(uninstall(deps));
    expect(report.removed).toBe(true);
    expect(report.reservedRemoved.map((r) => r.harness).sort()).toEqual([
      "agents",
      "claude",
      "codex",
    ]);
    expect(
      await exists(path.join(tmpHome, ".claude/skills/loadout")),
    ).toBe(false);
    expect(
      await exists(path.join(tmpHome, ".codex/skills/loadout")),
    ).toBe(false);
    expect(
      await exists(path.join(tmpHome, ".agents/skills/loadout")),
    ).toBe(false);
  });

  it("is idempotent on retry: a half-finished run resumes cleanly", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    // Two pool items.
    await fs.mkdir(path.join(tmpHome, ".loadout/pool/claude/a"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmpHome, ".loadout/pool/claude/b"), {
      recursive: true,
    });
    // Simulate prior crash: only `a` moved back to active.
    await fs.rename(
      path.join(tmpHome, ".loadout/pool/claude/a"),
      path.join(tmpHome, ".claude/skills/a"),
    );

    const report = await run(uninstall(deps));
    expect(report.removed).toBe(true);
    expect(report.moves.map((m) => m.skill)).toEqual(["b"]);
    expect(await exists(path.join(tmpHome, ".claude/skills/a"))).toBe(true);
    expect(await exists(path.join(tmpHome, ".claude/skills/b"))).toBe(true);
    expect(await exists(deps.paths.root)).toBe(false);
  });
});

describe("renderUninstall", () => {
  it("formats a normal uninstall with moves", () => {
    const out = renderUninstall({
      root: "/tmp/.loadout",
      moves: [
        {
          harness: "claude",
          skill: "review",
          op: "activate",
          source_path: "/a",
          dest_path: "/b",
        },
      ],
      removed: true,
      dryRun: false,
      stateBefore: { version: 1, active_modes: [], in_progress: null },
      reservedRemoved: [],
    });
    expect(out).toContain("loadout uninstall — root: /tmp/.loadout");
    expect(out).toContain("→ activate review (claude)");
    expect(out).toContain("✓ removed /tmp/.loadout");
  });

  it("formats an empty-pool uninstall", () => {
    const out = renderUninstall({
      root: "/tmp/.loadout",
      moves: [],
      removed: true,
      dryRun: false,
      stateBefore: { version: 1, active_modes: [], in_progress: null },
      reservedRemoved: [],
    });
    expect(out).toContain("no pool skills to move back");
    expect(out).toContain("✓ removed");
  });

  it("formats dry-run", () => {
    const out = renderUninstall({
      root: "/tmp/.loadout",
      moves: [],
      removed: false,
      dryRun: true,
      stateBefore: { version: 1, active_modes: [], in_progress: null },
      reservedRemoved: [],
    });
    expect(out.startsWith("[dry-run]")).toBe(true);
    expect(out).toContain("not removed");
  });
});
