import * as path from "node:path";
import { Effect } from "effect";
import type {
  AdapterError,
  HarnessAdapter,
} from "../../adapters/HarnessAdapter.js";
import type { LoadoutHome } from "../../paths.js";
import type {
  StateIOError,
  StateParseError,
  StateVersionError,
} from "../../state/errors.js";
import {
  acquireLock,
  load as loadState,
  save as saveState,
} from "../../state/manager.js";
import type { PlannedMove, State } from "../../state/schema.js";

export interface RestoreInProgress {
  readonly _tag: "RestoreInProgress";
  readonly op: string;
  readonly mode: string;
}

export type RestoreAllError =
  | AdapterError
  | StateIOError
  | StateParseError
  | StateVersionError
  | RestoreInProgress;

export interface RestoreAllInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

export interface RestoreAllReport {
  readonly root: string;
  readonly moves: ReadonlyArray<PlannedMove>;
  readonly dryRun: boolean;
  readonly stateBefore: State;
  readonly stateAfter: State;
}

const runRestoreAll = (
  input: RestoreAllInput,
): Effect.Effect<RestoreAllReport, RestoreAllError> =>
  Effect.gen(function* () {
    const dryRun = input.dryRun ?? false;
    const force = input.force ?? false;

    const stateBefore = yield* loadState(input.paths.state);

    if (stateBefore.in_progress !== null && !force) {
      return yield* Effect.fail({
        _tag: "RestoreInProgress" as const,
        op: stateBefore.in_progress.op,
        mode: stateBefore.in_progress.mode,
      } satisfies RestoreInProgress);
    }

    const snapshots = yield* Effect.all(
      input.adapters.map((a) => a.snapshot()),
    );
    const adapterByName = new Map(input.adapters.map((a) => [a.name, a]));

    const moves: PlannedMove[] = [];
    for (const snap of snapshots) {
      for (const skill of snap.pool) {
        moves.push({
          harness: snap.name,
          skill,
          op: "activate",
          source_path: path.join(snap.poolDir, skill),
          dest_path: path.join(snap.activeDir, skill),
        });
      }
    }

    if (dryRun) {
      return {
        root: input.paths.root,
        moves,
        dryRun: true,
        stateBefore,
        stateAfter: stateBefore,
      } satisfies RestoreAllReport;
    }

    for (const move of moves) {
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
    }

    // After restore-all every skill is active; no mode subset describes that,
    // so clear active_modes. Keep manifest untouched.
    const stateAfter: State = {
      ...stateBefore,
      active_modes: [],
      in_progress: null,
    };
    yield* saveState(input.paths.state, stateAfter);

    return {
      root: input.paths.root,
      moves,
      dryRun: false,
      stateBefore,
      stateAfter,
    } satisfies RestoreAllReport;
  });

export const restoreAll = (
  input: RestoreAllInput,
): Effect.Effect<RestoreAllReport, RestoreAllError> =>
  Effect.acquireUseRelease(
    acquireLock(input.paths.state),
    () => runRestoreAll(input),
    (lock) => Effect.promise(() => lock.release()),
  );

export const renderRestoreAll = (r: RestoreAllReport): string => {
  const lines: string[] = [];
  const prefix = r.dryRun ? "[dry-run] " : "";
  lines.push(`${prefix}loadout restore-all — root: ${r.root}`);
  if (r.moves.length === 0) {
    lines.push(`  · no pool skills to move back to active`);
  } else {
    for (const m of r.moves) {
      lines.push(`  → activate ${m.skill} (${m.harness})`);
    }
  }
  if (r.dryRun) {
    lines.push(`(dry-run: no files moved, state.json unchanged)`);
  } else {
    lines.push(
      `  ✓ ${r.moves.length} skill(s) restored; modes.yaml kept, active_modes cleared`,
    );
  }
  return lines.join("\n");
};
