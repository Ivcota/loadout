import * as path from "node:path";
import { Effect } from "effect";
import { type AdapterError, type HarnessAdapter, type HarnessSnapshot } from "../adapters/HarnessAdapter.js";
import type { ModesManifest } from "../manifest/schema.js";
import {
  pathsFor,
  save,
  type LoadoutPaths,
} from "../state/manager.js";
import type { StateIOError, StateParseError } from "../state/errors.js";
import type { InProgress, PlannedMove, State } from "../state/schema.js";

export type EngineError = AdapterError | StateIOError | StateParseError;

export type SwapOp = InProgress["op"];

export interface PlanInput {
  readonly op: SwapOp;
  readonly mode: string;
  readonly manifest: ModesManifest;
  readonly activeModes: ReadonlyArray<string>;
  readonly harnesses: ReadonlyArray<HarnessSnapshot>;
}

export interface PlanResult {
  readonly newActiveModes: ReadonlyArray<string>;
  readonly moves: ReadonlyArray<PlannedMove>;
}

const unionSkills = (
  manifest: ModesManifest,
  modes: ReadonlyArray<string>,
): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const m of modes) {
    const def = manifest.modes[m];
    if (!def) continue;
    for (const s of def.skills) out.add(s);
  }
  return out;
};

const allManagedSkills = (manifest: ModesManifest): ReadonlySet<string> =>
  unionSkills(manifest, Object.keys(manifest.modes));

const movePool2Active = (h: HarnessSnapshot, skill: string): PlannedMove => ({
  harness: h.name,
  skill,
  op: "activate",
  source_path: path.join(h.poolDir, skill),
  dest_path: path.join(h.activeDir, skill),
});

const moveActive2Pool = (h: HarnessSnapshot, skill: string): PlannedMove => ({
  harness: h.name,
  skill,
  op: "deactivate",
  source_path: path.join(h.activeDir, skill),
  dest_path: path.join(h.poolDir, skill),
});

export const plan = (input: PlanInput): PlanResult => {
  const { op, mode, manifest, activeModes, harnesses } = input;

  // Reject if mode is unknown — caller should validate, but plan() should be defensive.
  if (!(mode in manifest.modes)) {
    return { newActiveModes: activeModes, moves: [] };
  }

  let newActive: ReadonlyArray<string>;
  switch (op) {
    case "on":
      newActive = activeModes.includes(mode) ? activeModes : [...activeModes, mode];
      break;
    case "off":
      newActive = activeModes.filter((m) => m !== mode);
      break;
    case "use":
      newActive = [mode];
      break;
  }

  const required = unionSkills(manifest, newActive);
  const managed = allManagedSkills(manifest);

  const moves: PlannedMove[] = [];
  for (const h of harnesses) {
    // Activate: skills that should be active and harness has them in its pool.
    for (const skill of required) {
      if (h.pool.has(skill) && !h.active.has(skill)) {
        moves.push(movePool2Active(h, skill));
      }
    }
    // Deactivate: skills currently active+managed that should no longer be active.
    for (const skill of h.active) {
      if (!managed.has(skill)) continue; // unmanaged: never touch
      if (required.has(skill)) continue; // still required
      moves.push(moveActive2Pool(h, skill));
    }
  }

  return { newActiveModes: newActive, moves };
};

export interface ExecuteDeps {
  readonly paths: LoadoutPaths;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
  readonly dryRun?: boolean;
}

export const execute = (
  state: State,
  op: SwapOp,
  mode: string,
  result: PlanResult,
  deps: ExecuteDeps,
): Effect.Effect<State, EngineError> =>
  Effect.gen(function* () {
    if (deps.dryRun || result.moves.length === 0) {
      // Dry-run never writes; empty plan still updates active_modes if it changed.
      if (deps.dryRun) return state;
      const next: State = {
        ...state,
        active_modes: [...result.newActiveModes],
        in_progress: null,
      };
      yield* save(deps.paths, next);
      return next;
    }

    const adapterByName = new Map(deps.adapters.map((a) => [a.name, a]));

    // Snapshot intent: write the full plan into state.in_progress BEFORE any move.
    const initial: State = {
      ...state,
      in_progress: {
        op,
        mode,
        completed: [],
        pending: [...result.moves],
      },
    };
    yield* save(deps.paths, initial);

    let completed: PlannedMove[] = [];
    let pending: PlannedMove[] = [...result.moves];

    for (const move of result.moves) {
      const adapter = adapterByName.get(move.harness);
      if (!adapter) {
        return yield* Effect.fail({
          _tag: "AdapterError" as const,
          harness: move.harness,
          skill: move.skill,
          op: move.op,
          cause: "unknown" as const,
          message: `no adapter registered for harness ${move.harness}`,
        } as AdapterError);
      }
      yield* adapter.apply(move);
      completed = [...completed, move];
      pending = pending.slice(1);
      yield* save(deps.paths, {
        ...state,
        in_progress: { op, mode, completed, pending },
      });
    }

    const final: State = {
      ...state,
      active_modes: [...result.newActiveModes],
      in_progress: null,
    };
    yield* save(deps.paths, final);
    return final;
  }) as Effect.Effect<State, EngineError>;

export const resume = (
  state: State,
  deps: ExecuteDeps,
): Effect.Effect<State, EngineError> =>
  Effect.gen(function* () {
    if (state.in_progress === null) return state;
    const ip = state.in_progress;
    if (deps.dryRun) return state;

    const adapterByName = new Map(deps.adapters.map((a) => [a.name, a]));

    let completed: PlannedMove[] = [...ip.completed];
    let pending: PlannedMove[] = [...ip.pending];

    for (const move of ip.pending) {
      const adapter = adapterByName.get(move.harness);
      if (!adapter) {
        return yield* Effect.fail({
          _tag: "AdapterError" as const,
          harness: move.harness,
          skill: move.skill,
          op: move.op,
          cause: "unknown" as const,
          message: `no adapter registered for harness ${move.harness}`,
        } as AdapterError);
      }
      yield* adapter.apply(move);
      completed = [...completed, move];
      pending = pending.slice(1);
      yield* save(deps.paths, {
        ...state,
        in_progress: { op: ip.op, mode: ip.mode, completed, pending },
      });
    }

    // Compute final active_modes from op + mode.
    let finalActive: ReadonlyArray<string>;
    switch (ip.op) {
      case "on":
        finalActive = state.active_modes.includes(ip.mode)
          ? state.active_modes
          : [...state.active_modes, ip.mode];
        break;
      case "off":
        finalActive = state.active_modes.filter((m) => m !== ip.mode);
        break;
      case "use":
        finalActive = [ip.mode];
        break;
    }

    const next: State = {
      ...state,
      active_modes: [...finalActive],
      in_progress: null,
    };
    yield* save(deps.paths, next);
    return next;
  }) as Effect.Effect<State, EngineError>;

export const rollback = (
  state: State,
  deps: ExecuteDeps,
): Effect.Effect<State, EngineError> =>
  Effect.gen(function* () {
    if (state.in_progress === null) return state;
    const ip = state.in_progress;
    if (deps.dryRun) return state;

    const adapterByName = new Map(deps.adapters.map((a) => [a.name, a]));

    // Revert completed moves in reverse order.
    const toRevert = [...ip.completed].reverse();
    let completed: PlannedMove[] = [...ip.completed];
    for (const move of toRevert) {
      const adapter = adapterByName.get(move.harness);
      if (!adapter) {
        return yield* Effect.fail({
          _tag: "AdapterError" as const,
          harness: move.harness,
          skill: move.skill,
          op: move.op,
          cause: "unknown" as const,
          message: `no adapter registered for harness ${move.harness}`,
        } as AdapterError);
      }
      yield* adapter.apply(adapter.invert(move));
      completed = completed.slice(0, -1);
      yield* save(deps.paths, {
        ...state,
        in_progress: { op: ip.op, mode: ip.mode, completed, pending: ip.pending },
      });
    }

    const next: State = {
      ...state,
      in_progress: null,
    };
    yield* save(deps.paths, next);
    return next;
  }) as Effect.Effect<State, EngineError>;

// Re-export path helpers so callers can use them cleanly.
export { pathsFor };
