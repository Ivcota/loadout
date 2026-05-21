import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DirectoryAdapter } from "../adapters/DirectoryAdapter.js";
import { load, pathsFor, save } from "../state/manager.js";
import type { PlannedMove, State } from "../state/schema.js";
import { resume, rollback } from "./engine.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-resume-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

interface World {
  loadoutRoot: string;
  activeDir: string;
  poolDir: string;
  adapter: DirectoryAdapter;
  paths: ReturnType<typeof pathsFor>;
}

const setupWorld = async (
  poolSkills: string[],
  activeSkills: string[],
): Promise<World> => {
  const loadoutRoot = path.join(tmp, ".loadout");
  const activeDir = path.join(tmp, "active", "claude");
  const poolDir = path.join(loadoutRoot, "pool", "claude");
  await fs.mkdir(activeDir, { recursive: true });
  await fs.mkdir(poolDir, { recursive: true });
  for (const s of poolSkills) {
    await fs.mkdir(path.join(poolDir, s), { recursive: true });
  }
  for (const s of activeSkills) {
    await fs.mkdir(path.join(activeDir, s), { recursive: true });
  }
  const paths = pathsFor(loadoutRoot);
  return {
    loadoutRoot,
    activeDir,
    poolDir,
    paths,
    adapter: new DirectoryAdapter("claude", activeDir, poolDir),
  };
};

const mv = (w: World, skill: string, op: PlannedMove["op"]): PlannedMove => ({
  harness: "claude",
  skill,
  op,
  source_path: op === "activate"
    ? path.join(w.poolDir, skill)
    : path.join(w.activeDir, skill),
  dest_path: op === "activate"
    ? path.join(w.activeDir, skill)
    : path.join(w.poolDir, skill),
});

describe("SwapEngine.resume", () => {
  it("replays pending moves and reaches target state when half-completed", async () => {
    // Initial filesystem: a,c already in active (a was the "completed" move
    // from a prior pass), b,d still in pool (pending).
    const w = await setupWorld(["b", "d"], ["a", "c"]);
    const state: State = {
      version: 1,
      active_modes: [],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [mv(w, "a", "activate"), mv(w, "c", "activate")],
        pending: [mv(w, "b", "activate"), mv(w, "d", "activate")],
      },
    };
    await run(save(w.paths, state));

    const finalState = await run(
      resume(state, { paths: w.paths, adapters: [w.adapter] }),
    );
    expect(finalState.in_progress).toBeNull();
    expect(finalState.active_modes).toEqual(["product"]);

    const snap = await run(w.adapter.snapshot());
    expect([...snap.active].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...snap.pool].sort()).toEqual([]);
  });

  it("no-op when state.in_progress is null", async () => {
    const w = await setupWorld(["a"], []);
    const state: State = {
      version: 1,
      active_modes: ["default"],
      in_progress: null,
    };
    const finalState = await run(
      resume(state, { paths: w.paths, adapters: [w.adapter] }),
    );
    expect(finalState).toEqual(state);
  });

  it("dry-run resume does not mutate the filesystem", async () => {
    const w = await setupWorld(["b"], ["a"]);
    const state: State = {
      version: 1,
      active_modes: [],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [mv(w, "a", "activate")],
        pending: [mv(w, "b", "activate")],
      },
    };
    await run(save(w.paths, state));
    const finalState = await run(
      resume(state, { paths: w.paths, adapters: [w.adapter], dryRun: true }),
    );
    expect(finalState.in_progress).not.toBeNull();
    const snap = await run(w.adapter.snapshot());
    expect([...snap.active].sort()).toEqual(["a"]);
    expect([...snap.pool].sort()).toEqual(["b"]);
  });

  it("computes final active_modes correctly for each op", async () => {
    const w = await setupWorld([], []);

    // on(M)
    const onState: State = {
      version: 1,
      active_modes: ["default"],
      in_progress: {
        op: "on",
        mode: "design",
        completed: [],
        pending: [],
      },
    };
    let final = await run(resume(onState, { paths: w.paths, adapters: [w.adapter] }));
    expect(final.active_modes).toEqual(["default", "design"]);

    // off(M)
    const offState: State = {
      version: 1,
      active_modes: ["default", "design"],
      in_progress: { op: "off", mode: "default", completed: [], pending: [] },
    };
    final = await run(resume(offState, { paths: w.paths, adapters: [w.adapter] }));
    expect(final.active_modes).toEqual(["design"]);

    // use(M)
    const useState: State = {
      version: 1,
      active_modes: ["default", "design"],
      in_progress: { op: "use", mode: "product", completed: [], pending: [] },
    };
    final = await run(resume(useState, { paths: w.paths, adapters: [w.adapter] }));
    expect(final.active_modes).toEqual(["product"]);

    // on(M) when M is already in active_modes (defensive: in_progress + active overlap)
    const onAlreadyState: State = {
      version: 1,
      active_modes: ["product"],
      in_progress: { op: "on", mode: "product", completed: [], pending: [] },
    };
    final = await run(resume(onAlreadyState, { paths: w.paths, adapters: [w.adapter] }));
    expect(final.active_modes).toEqual(["product"]);
  });

  it("is idempotent: persisted in_progress is cleared after success", async () => {
    const w = await setupWorld(["b"], []);
    const state: State = {
      version: 1,
      active_modes: [],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [],
        pending: [mv(w, "b", "activate")],
      },
    };
    await run(save(w.paths, state));
    await run(resume(state, { paths: w.paths, adapters: [w.adapter] }));
    // resume again on the loaded state should be a no-op.
    const loaded = await run(load(w.paths));
    expect(loaded.in_progress).toBeNull();
    const finalAgain = await run(resume(loaded, { paths: w.paths, adapters: [w.adapter] }));
    expect(finalAgain).toEqual(loaded);
  });

  it("fails with AdapterError when no adapter registered for a pending move's harness", async () => {
    const w = await setupWorld(["a"], []);
    const state: State = {
      version: 1,
      active_modes: [],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [],
        pending: [mv(w, "a", "activate")],
      },
    };
    const exit = await Effect.runPromiseExit(
      resume(state, {
        paths: w.paths,
        adapters: [new DirectoryAdapter("codex", "/nope", "/nope")],
      }),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("no adapter registered for harness claude");
    }
  });
});

describe("SwapEngine.rollback", () => {
  it("reverts completed moves to their source paths", async () => {
    // a was moved pool->active (completed), b is pending (still in pool).
    const w = await setupWorld(["b"], ["a"]);
    const state: State = {
      version: 1,
      active_modes: [],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [mv(w, "a", "activate")],
        pending: [mv(w, "b", "activate")],
      },
    };
    await run(save(w.paths, state));
    const final = await run(
      rollback(state, { paths: w.paths, adapters: [w.adapter] }),
    );
    expect(final.in_progress).toBeNull();
    expect(final.active_modes).toEqual([]);
    const snap = await run(w.adapter.snapshot());
    expect([...snap.active].sort()).toEqual([]);
    expect([...snap.pool].sort()).toEqual(["a", "b"]);
  });

  it("no-op when state.in_progress is null", async () => {
    const w = await setupWorld([], []);
    const state: State = { version: 1, active_modes: ["x"], in_progress: null };
    const final = await run(rollback(state, { paths: w.paths, adapters: [w.adapter] }));
    expect(final).toEqual(state);
  });

  it("dry-run rollback does not mutate the filesystem", async () => {
    const w = await setupWorld([], ["a"]);
    const state: State = {
      version: 1,
      active_modes: [],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [mv(w, "a", "activate")],
        pending: [],
      },
    };
    const final = await run(
      rollback(state, { paths: w.paths, adapters: [w.adapter], dryRun: true }),
    );
    expect(final.in_progress).not.toBeNull();
    const snap = await run(w.adapter.snapshot());
    expect([...snap.active].sort()).toEqual(["a"]);
  });

  it("fails with AdapterError when no adapter registered for a completed move's harness", async () => {
    const w = await setupWorld([], ["a"]);
    const state: State = {
      version: 1,
      active_modes: [],
      in_progress: {
        op: "on",
        mode: "product",
        completed: [mv(w, "a", "activate")],
        pending: [],
      },
    };
    const exit = await Effect.runPromiseExit(
      rollback(state, {
        paths: w.paths,
        adapters: [new DirectoryAdapter("codex", "/nope", "/nope")],
      }),
    );
    expect(exit._tag).toBe("Failure");
  });
});
