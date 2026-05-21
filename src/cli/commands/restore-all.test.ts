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
import { load as loadState } from "../../state/manager.js";
import { init } from "./init.js";
import { restoreAll } from "./restore-all.js";
import { off } from "./swap.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-restore-"));
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
  fs.access(p).then(() => true).catch(() => false);

const mkDeps = () => {
  const paths = loadoutHome({ home: tmpHome });
  const adapters = [
    createClaudeAdapter({ home: tmpHome }),
    createCodexAdapter({ home: tmpHome }),
    createAgentsAdapter({ home: tmpHome }),
  ];
  return { paths, adapters };
};

describe("loadout restore-all", () => {
  it("moves every pool skill back to active, keeps modes.yaml, clears active_modes", async () => {
    await seedActive(tmpHome, "claude", ["qa", "review"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(
      saveManifest(deps.paths.manifest, {
        version: 1,
        modes: {
          default: { skills: ["qa"] },
          product: { skills: ["review"] },
        },
      }),
    );
    await run(off({ ...deps, mode: "product" }));

    // Precondition: review is in pool now.
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/review")),
    ).toBe(true);

    const report = await run(restoreAll(deps));
    expect(report.moves).toHaveLength(1);
    expect(report.moves[0]?.skill).toBe("review");
    expect(report.stateAfter.active_modes).toEqual([]);

    // review back to active.
    expect(
      await exists(path.join(tmpHome, ".claude/skills/review")),
    ).toBe(true);
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/review")),
    ).toBe(false);
    // modes.yaml preserved.
    expect(await exists(deps.paths.manifest.manifestFile)).toBe(true);
    // state.json updated.
    const reloaded = await run(loadState(deps.paths.state));
    expect(reloaded.active_modes).toEqual([]);
  });

  it("dry-run plans the moves without touching files or state", async () => {
    await seedActive(tmpHome, "claude", ["qa", "review"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(
      saveManifest(deps.paths.manifest, {
        version: 1,
        modes: {
          default: { skills: ["qa"] },
          product: { skills: ["review"] },
        },
      }),
    );
    await run(off({ ...deps, mode: "product" }));

    const report = await run(restoreAll({ ...deps, dryRun: true }));
    expect(report.dryRun).toBe(true);
    expect(report.moves).toHaveLength(1);
    // review still in pool.
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/review")),
    ).toBe(true);
  });

  it("refuses to run while a swap is in progress unless --force", async () => {
    const deps = mkDeps();
    await run(init(deps));
    // Manually plant an in-progress op.
    const { load: loadState_, save: saveState_ } = await import(
      "../../state/manager.js"
    );
    const cur = await run(loadState_(deps.paths.state));
    await run(
      saveState_(deps.paths.state, {
        ...cur,
        in_progress: {
          op: "on" as const,
          mode: "product",
          completed: [],
          pending: [],
        },
      }),
    );

    const exit = await runExit(restoreAll(deps));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const j = JSON.stringify(exit.cause.toJSON());
      expect(j).toContain("RestoreInProgress");
    }
  });

  it("emits a noop summary when pool is empty", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));

    const report = await run(restoreAll(deps));
    expect(report.moves).toEqual([]);
    expect(report.stateAfter.active_modes).toEqual([]);
  });
});
