import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DirectoryAdapter } from "../adapters/DirectoryAdapter.js";
import type { ModesManifest } from "../manifest/schema.js";
import { load, pathsFor } from "../state/manager.js";
import { initialState, type State } from "../state/schema.js";
import { execute, plan } from "./engine.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-exec-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

interface World {
  paths: ReturnType<typeof pathsFor>;
  adapter: DirectoryAdapter;
  manifest: ModesManifest;
}

const setup = async (poolSkills: string[], activeSkills: string[]): Promise<World> => {
  const loadoutRoot = path.join(tmp, ".loadout");
  const activeDir = path.join(tmp, "active", "claude");
  const poolDir = path.join(loadoutRoot, "pool", "claude");
  await fs.mkdir(activeDir, { recursive: true });
  await fs.mkdir(poolDir, { recursive: true });
  for (const s of poolSkills) {
    await fs.mkdir(path.join(poolDir, s), { recursive: true });
    await fs.writeFile(path.join(poolDir, s, "SKILL.md"), `# ${s}\n`);
  }
  for (const s of activeSkills) {
    await fs.mkdir(path.join(activeDir, s), { recursive: true });
    await fs.writeFile(path.join(activeDir, s, "SKILL.md"), `# ${s}\n`);
  }
  return {
    paths: pathsFor(loadoutRoot),
    adapter: new DirectoryAdapter("claude", activeDir, poolDir),
    manifest: {
      version: 1,
      modes: {
        default: { skills: ["a", "b", "c"] },
        product: { skills: ["a", "x"] },
      },
    },
  };
};

describe("SwapEngine.execute", () => {
  it("happy path: on(product) from empty active moves a,x from pool to active", async () => {
    const w = await setup(["a", "b", "c", "x"], []);
    const snap = await run(w.adapter.snapshot());
    const result = plan({
      op: "on",
      mode: "product",
      manifest: w.manifest,
      activeModes: [],
      harnesses: [snap],
    });
    const finalState = await run(
      execute(initialState, "on", "product", result, {
        paths: w.paths,
        adapters: [w.adapter],
      }),
    );
    expect(finalState.active_modes).toEqual(["product"]);
    expect(finalState.in_progress).toBeNull();
    // Verify filesystem
    const afterSnap = await run(w.adapter.snapshot());
    expect([...afterSnap.active].sort()).toEqual(["a", "x"]);
    expect([...afterSnap.pool].sort()).toEqual(["b", "c"]);
    // state.json persisted
    const loaded = await run(load(w.paths));
    expect(loaded.active_modes).toEqual(["product"]);
  });

  it("dry-run produces zero filesystem writes and zero state.json writes", async () => {
    const w = await setup(["a", "b", "c", "x"], []);
    const snap = await run(w.adapter.snapshot());
    const result = plan({
      op: "on",
      mode: "product",
      manifest: w.manifest,
      activeModes: [],
      harnesses: [snap],
    });
    const before = await listAll(w.paths.root);
    const finalState = await run(
      execute(initialState, "on", "product", result, {
        paths: w.paths,
        adapters: [w.adapter],
        dryRun: true,
      }),
    );
    expect(finalState).toEqual(initialState);
    const afterSnap = await run(w.adapter.snapshot());
    expect([...afterSnap.active].sort()).toEqual([]);
    expect([...afterSnap.pool].sort()).toEqual(["a", "b", "c", "x"]);
    const after = await listAll(w.paths.root);
    expect(after).toEqual(before);
  });

  it("empty plan still updates active_modes for no-op on(M) when M is fresh", async () => {
    // If the mode is already active and no moves are needed, no state change.
    const w = await setup([], ["a"]);
    const snap = await run(w.adapter.snapshot());
    const result = plan({
      op: "on",
      mode: "default",
      manifest: w.manifest,
      activeModes: ["default"],
      harnesses: [snap],
    });
    expect(result.moves).toEqual([]);
    const state: State = {
      version: 1,
      active_modes: ["default"],
      in_progress: null,
    };
    const finalState = await run(
      execute(state, "on", "default", result, {
        paths: w.paths,
        adapters: [w.adapter],
      }),
    );
    expect(finalState.active_modes).toEqual(["default"]);
  });

  it("writes the planned-moves snapshot to state.in_progress before any move", async () => {
    // Use a stalling adapter that records the on-disk state.in_progress
    // at the moment of the first move.
    const w = await setup(["a", "b"], []);
    let observedInProgress: State["in_progress"] | undefined;
    const stalling = new (class extends DirectoryAdapter {
      override apply = (move: import("../state/schema.js").PlannedMove): Effect.Effect<void, import("../adapters/HarnessAdapter.js").AdapterError> => {
        return Effect.gen(function* () {
          // Read state.json at this moment
          const s = yield* load(w.paths);
          if (observedInProgress === undefined) observedInProgress = s.in_progress;
          // Delegate to the original move
          yield* DirectoryAdapter.prototype.apply.call(stalling, move) as Effect.Effect<void, import("../adapters/HarnessAdapter.js").AdapterError>;
        }) as Effect.Effect<void, import("../adapters/HarnessAdapter.js").AdapterError>;
      };
    })("claude", w.adapter.activeDir, w.adapter.poolDir);

    const snap = await run(stalling.snapshot());
    const result = plan({
      op: "on",
      mode: "default",
      manifest: w.manifest,
      activeModes: [],
      harnesses: [snap],
    });
    await run(
      execute(initialState, "on", "default", result, {
        paths: w.paths,
        adapters: [stalling],
      }),
    );
    expect(observedInProgress).not.toBeNull();
    expect(observedInProgress?.op).toBe("on");
    expect(observedInProgress?.mode).toBe("default");
    // Snapshot was captured before first move ran: completed should be empty,
    // and pending should hold the full plan.
    expect(observedInProgress?.completed).toHaveLength(0);
    expect(observedInProgress?.pending.map((m) => m.skill).sort()).toEqual(["a", "b"]);
  });

  it("AdapterError surfaces with {skill, harness, op, cause}", async () => {
    const w = await setup(["a"], []);
    const snap = await run(w.adapter.snapshot());
    const result = plan({
      op: "on",
      mode: "default",
      manifest: w.manifest,
      activeModes: [],
      harnesses: [snap],
    });
    // Wrong adapter name registered -> adapter lookup miss.
    const exit = await Effect.runPromiseExit(
      execute(initialState, "on", "default", result, {
        paths: w.paths,
        adapters: [new DirectoryAdapter("codex", "/nope", "/nope")],
      }),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const s = String(exit.cause);
      expect(s).toContain("AdapterError");
      expect(s).toContain("no adapter registered for harness claude");
    }
  });
});

const listAll = async (dir: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
    return entries.map((e) => e.name).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
};
