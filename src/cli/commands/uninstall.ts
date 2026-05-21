import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect } from "effect";
import { RESERVED_SKILLS } from "../../adapters/DirectoryAdapter.js";
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
  type LockRelease,
} from "../../state/manager.js";
import type { PlannedMove, State } from "../../state/schema.js";

export interface UninstallInProgress {
  readonly _tag: "UninstallInProgress";
  readonly op: string;
  readonly mode: string;
}

export type UninstallError =
  | AdapterError
  | StateIOError
  | StateParseError
  | StateVersionError
  | UninstallInProgress;

export interface UninstallInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

export interface UninstallReport {
  readonly root: string;
  readonly moves: ReadonlyArray<PlannedMove>;
  readonly removed: boolean;
  readonly dryRun: boolean;
  readonly stateBefore: State;
  readonly reservedRemoved: ReadonlyArray<{
    readonly harness: string;
    readonly skill: string;
    readonly path: string;
  }>;
}

const runUninstall = (
  input: UninstallInput,
  lock: LockRelease,
): Effect.Effect<UninstallReport, UninstallError> =>
  Effect.gen(function* () {
    const dryRun = input.dryRun ?? false;
    const force = input.force ?? false;

    const stateBefore = yield* loadState(input.paths.state);

    if (stateBefore.in_progress !== null && !force) {
      return yield* Effect.fail({
        _tag: "UninstallInProgress" as const,
        op: stateBefore.in_progress.op,
        mode: stateBefore.in_progress.mode,
      } satisfies UninstallInProgress);
    }

    // Snapshot every harness, build moves: every pool skill → activate.
    const snapshots = yield* Effect.all(
      input.adapters.map((a) => a.snapshot()),
    );

    const moves: PlannedMove[] = [];
    const adapterByName = new Map(input.adapters.map((a) => [a.name, a]));
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

    const plannedReserved = input.adapters.flatMap((a) =>
      [...RESERVED_SKILLS].map((skill) => ({
        harness: a.name,
        skill,
        path: path.join(a.activeDir, skill),
      })),
    );

    if (dryRun) {
      return {
        root: input.paths.root,
        moves,
        removed: false,
        dryRun: true,
        stateBefore,
        reservedRemoved: plannedReserved,
      } satisfies UninstallReport;
    }

    // Apply every move directly via adapters — no per-move state.json writes,
    // because state.json is about to disappear. Idempotent on retry: a partial
    // run leaves fewer pool items, and re-running uninstall just resumes.
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

    // Remove reserved skills from every adapter's active dir. These were
    // installed by `init` and are not tracked in modes.yaml, so we sweep
    // them here directly.
    const reservedRemoved: { harness: string; skill: string; path: string }[] =
      [];
    for (const r of plannedReserved) {
      yield* Effect.promise(() =>
        fs.rm(r.path, { recursive: true, force: true }),
      );
      reservedRemoved.push(r);
    }

    // Release the lock BEFORE rm -rf, otherwise proper-lockfile's cleanup
    // tries to rmdir a path inside the deleted root and throws ENOENT.
    yield* Effect.promise(() => lock.release());

    yield* Effect.tryPromise({
      try: () => fs.rm(input.paths.root, { recursive: true, force: true }),
      catch: (cause) =>
        ({
          _tag: "StateIOError" as const,
          path: input.paths.root,
          op: "write" as const,
          cause,
        }) as StateIOError,
    });

    return {
      root: input.paths.root,
      moves,
      removed: true,
      dryRun: false,
      stateBefore,
      reservedRemoved,
    } satisfies UninstallReport;
  });

export const uninstall = (
  input: UninstallInput,
): Effect.Effect<UninstallReport, UninstallError> =>
  Effect.acquireUseRelease(
    acquireLock(input.paths.state),
    (lock) => runUninstall(input, lock),
    // Idempotent: if runUninstall already released, this second call errors
    // (proper-lockfile rejects "not acquired") — swallow it.
    (lock) => Effect.promise(() => lock.release().catch(() => undefined)),
  );

export const renderUninstall = (r: UninstallReport): string => {
  const lines: string[] = [];
  const prefix = r.dryRun ? "[dry-run] " : "";
  lines.push(`${prefix}loadout uninstall — root: ${r.root}`);
  if (r.moves.length === 0) {
    lines.push(`  · no pool skills to move back to active`);
  } else {
    for (const m of r.moves) {
      lines.push(`  → activate ${m.skill} (${m.harness})`);
    }
  }
  for (const rr of r.reservedRemoved) {
    const verb = r.dryRun ? "would remove" : "removed";
    lines.push(`  → ${verb} reserved skill ${rr.skill} (${rr.harness}) at ${rr.path}`);
  }
  if (r.dryRun) {
    lines.push(`(dry-run: no files moved, ${r.root} not removed)`);
  } else if (r.removed) {
    lines.push(`  ✓ removed ${r.root}`);
  }
  return lines.join("\n");
};
