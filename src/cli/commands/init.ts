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
import {
  emptyManifest,
  exists as manifestExists,
  load as loadManifest,
  save as saveManifest,
} from "../../manifest/loader.js";
import type { ModesManifest } from "../../manifest/schema.js";
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
import { initialState, type State } from "../../state/schema.js";

export interface InitInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
}

export interface InitReport {
  readonly manifestWritten: boolean;
  readonly stateWritten: boolean;
  readonly manifest: ModesManifest;
  readonly state: State;
  readonly discovered: ReadonlyArray<{
    readonly harness: string;
    readonly skills: ReadonlyArray<string>;
  }>;
}

export type InitError =
  | AdapterError
  | ManifestIOError
  | ManifestParseError
  | ManifestVersionError
  | StateIOError
  | StateParseError
  | StateVersionError;

const runInit = (input: InitInput): Effect.Effect<InitReport, InitError> =>
  Effect.gen(function* () {
    const discovered = yield* Effect.all(
      input.adapters.map((a) =>
        a.snapshot().pipe(
          Effect.map((s) => ({
            harness: a.name,
            skills: [...s.active].sort(),
          })),
        ),
      ),
    );

    const allSkills = Array.from(
      new Set(discovered.flatMap((d) => d.skills)),
    ).sort();

    const manifestAlreadyExists = yield* manifestExists(input.paths.manifest);
    let manifest: ModesManifest;
    let manifestWritten = false;
    if (manifestAlreadyExists) {
      manifest = yield* loadManifest(input.paths.manifest);
    } else {
      manifest = {
        ...emptyManifest,
        modes: { default: { skills: allSkills } },
      };
      yield* saveManifest(input.paths.manifest, manifest);
      manifestWritten = true;
    }

    const existingState = yield* loadState(input.paths.state);
    const isFreshState =
      existingState.active_modes.length === 0 &&
      existingState.in_progress === null;
    let stateOut: State;
    let stateWritten = false;
    if (isFreshState) {
      stateOut = {
        ...initialState,
        active_modes: "default" in manifest.modes ? ["default"] : [],
      };
      yield* saveState(input.paths.state, stateOut);
      stateWritten = true;
    } else {
      stateOut = existingState;
    }

    return {
      manifestWritten,
      stateWritten,
      manifest,
      state: stateOut,
      discovered,
    };
  });

export const init = (input: InitInput): Effect.Effect<InitReport, InitError> =>
  Effect.acquireUseRelease(
    acquireLock(input.paths.state),
    () => runInit(input),
    (lock) => Effect.promise(() => lock.release()),
  );
