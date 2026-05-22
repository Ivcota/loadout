import { Effect } from "effect";
import type {
  AdapterError,
  HarnessAdapter,
} from "../../adapters/HarnessAdapter.js";
import type {
  ManifestIOError,
  ManifestParseError,
  ManifestVersionError,
} from "../../manifest/errors.js";
import { load as loadManifest } from "../../manifest/loader.js";
import type { ModesManifest } from "../../manifest/schema.js";
import {
  materializeInstructionFiles,
  type MaterializeNotice,
} from "../../mds/materialize.js";
import type { MdsIOError } from "../../mds/storage.js";
import type { LoadoutHome } from "../../paths.js";
import type {
  StateIOError,
  StateParseError,
  StateVersionError,
} from "../../state/errors.js";
import { acquireLock, load as loadState, save as saveState } from "../../state/manager.js";
import type { PlannedMove, State } from "../../state/schema.js";
import {
  execute,
  plan,
  resume,
  rollback,
  type SwapOp,
} from "../../swap/engine.js";

export interface SwapModeNotFound {
  readonly _tag: "SwapModeNotFound";
  readonly mode: string;
  readonly knownModes: ReadonlyArray<string>;
}

export interface SwapNothingToRollback {
  readonly _tag: "SwapNothingToRollback";
}

export type SwapError =
  | AdapterError
  | ManifestIOError
  | ManifestParseError
  | ManifestVersionError
  | MdsIOError
  | StateIOError
  | StateParseError
  | StateVersionError
  | SwapModeNotFound
  | SwapNothingToRollback;

export interface SwapInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
  readonly op: SwapOp;
  readonly mode: string;
  readonly dryRun?: boolean;
  readonly rollback?: boolean;
}

export interface SwapReport {
  readonly op: SwapOp;
  readonly mode: string;
  readonly dryRun: boolean;
  readonly rolledBack: boolean;
  readonly resumedPrior: boolean;
  readonly moves: ReadonlyArray<PlannedMove>;
  readonly before: State;
  readonly after: State;
  readonly manifest: ModesManifest;
  readonly mdNotices: ReadonlyArray<MaterializeNotice>;
}

const runSwap = (input: SwapInput): Effect.Effect<SwapReport, SwapError> =>
  Effect.gen(function* () {
    const dryRun = input.dryRun ?? false;
    const wantRollback = input.rollback ?? false;

    const before = yield* loadState(input.paths.state);

    // Rollback path: revert the in-progress op and stop.
    if (wantRollback) {
      if (before.in_progress === null) {
        return yield* Effect.fail({
          _tag: "SwapNothingToRollback" as const,
        } satisfies SwapNothingToRollback);
      }
      const afterRollback = yield* rollback(before, {
        paths: input.paths.state,
        adapters: input.adapters,
        dryRun,
      });
      const manifestForReport = yield* loadManifest(input.paths.manifest);
      const { state: after, notices: mdNotices } = yield* applyMaterialize(
        afterRollback,
        input.adapters,
        input.paths,
        dryRun,
      );
      return {
        op: before.in_progress.op,
        mode: before.in_progress.mode,
        dryRun,
        rolledBack: true,
        resumedPrior: false,
        moves: before.in_progress.completed,
        before,
        after,
        manifest: manifestForReport,
        mdNotices,
      } satisfies SwapReport;
    }

    // Auto-resume: drain any pending in-progress op before starting the new one.
    let resumed = before;
    let resumedPrior = false;
    if (before.in_progress !== null) {
      resumed = yield* resume(before, {
        paths: input.paths.state,
        adapters: input.adapters,
        dryRun,
      });
      resumedPrior = true;
    }

    const manifest = yield* loadManifest(input.paths.manifest);

    if (!(input.mode in manifest.modes)) {
      return yield* Effect.fail({
        _tag: "SwapModeNotFound" as const,
        mode: input.mode,
        knownModes: Object.keys(manifest.modes).sort(),
      } satisfies SwapModeNotFound);
    }

    const harnesses = yield* Effect.all(input.adapters.map((a) => a.snapshot()));

    const result = plan({
      op: input.op,
      mode: input.mode,
      manifest,
      activeModes: resumed.active_modes,
      harnesses,
    });

    const afterSkills = yield* execute(resumed, input.op, input.mode, result, {
      paths: input.paths.state,
      adapters: input.adapters,
      dryRun,
    });

    const { state: after, notices: mdNotices } = yield* applyMaterialize(
      afterSkills,
      input.adapters,
      input.paths,
      dryRun,
    );

    return {
      op: input.op,
      mode: input.mode,
      dryRun,
      rolledBack: false,
      resumedPrior,
      moves: result.moves,
      before,
      after,
      manifest,
      mdNotices,
    } satisfies SwapReport;
  });

const applyMaterialize = (
  state: State,
  adapters: ReadonlyArray<HarnessAdapter>,
  paths: LoadoutHome,
  dryRun: boolean,
): Effect.Effect<
  { state: State; notices: ReadonlyArray<MaterializeNotice> },
  AdapterError | MdsIOError | StateIOError | StateParseError
> =>
  Effect.gen(function* () {
    if (dryRun) return { state, notices: [] };
    const result = yield* materializeInstructionFiles(
      adapters,
      state,
      paths.root,
    );
    const next: State = { ...state, live_mds: result.newLiveMds };
    yield* saveState(paths.state, next);
    return { state: next, notices: result.notices };
  });

const withLock = (input: SwapInput): Effect.Effect<SwapReport, SwapError> =>
  Effect.acquireUseRelease(
    acquireLock(input.paths.state),
    () => runSwap(input),
    (lock) => Effect.promise(() => lock.release()),
  );

export const swap = withLock;

export const on = (
  input: Omit<SwapInput, "op">,
): Effect.Effect<SwapReport, SwapError> => withLock({ ...input, op: "on" });

export const off = (
  input: Omit<SwapInput, "op">,
): Effect.Effect<SwapReport, SwapError> => withLock({ ...input, op: "off" });

export const use = (
  input: Omit<SwapInput, "op">,
): Effect.Effect<SwapReport, SwapError> => withLock({ ...input, op: "use" });

export const renderSwap = (r: SwapReport): string => {
  const lines: string[] = [];
  const prefix = r.dryRun ? "[dry-run] " : "";

  if (r.rolledBack) {
    lines.push(`${prefix}loadout --rollback (was: ${r.op} ${r.mode})`);
  } else {
    lines.push(`${prefix}loadout ${r.op} ${r.mode}`);
  }

  if (r.resumedPrior) {
    lines.push(`  · resumed prior in-progress op before applying this one`);
  }

  if (r.moves.length === 0) {
    lines.push(`  · no skill moves needed`);
  } else {
    for (const m of r.moves) {
      const verb = r.rolledBack
        ? m.op === "activate"
          ? "revert activate"
          : "revert deactivate"
        : m.op;
      lines.push(`  → ${verb} ${m.skill} (${m.harness})`);
    }
  }

  lines.push(
    `active_modes: ${r.after.active_modes.length === 0 ? "(none)" : r.after.active_modes.join(", ")}`,
  );

  for (const n of r.mdNotices) {
    lines.push(
      `note: ${n.harness} instruction file changed (now ${n.mode}) — restart your harness session to load it.`,
    );
  }

  if (r.dryRun) {
    lines.push(`(dry-run: no files moved, state.json unchanged)`);
  }

  return lines.join("\n");
};
