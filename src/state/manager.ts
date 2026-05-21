import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect, Schema } from "effect";
import * as lockfile from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { StateIOError, StateParseError, StateVersionError } from "./errors.js";
import { initialState, State, STATE_VERSION } from "./schema.js";

const decodeUnknown = Schema.decodeUnknown(State);
const encode = Schema.encode(State);

export interface LoadoutPaths {
  readonly root: string;
  readonly stateFile: string;
  readonly lockFile: string;
}

export const pathsFor = (root: string): LoadoutPaths => ({
  root,
  stateFile: path.join(root, "state.json"),
  lockFile: path.join(root, "lock"),
});

export const load = (paths: LoadoutPaths): Effect.Effect<State, StateParseError | StateVersionError | StateIOError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => fs.readFile(paths.stateFile, "utf8"),
      catch: (cause) =>
        (cause as NodeJS.ErrnoException)?.code === "ENOENT"
          ? null
          : new StateIOError({ path: paths.stateFile, op: "read", cause }),
    }).pipe(
      Effect.catchAll((err) => (err === null ? Effect.succeed(null) : Effect.fail(err))),
    );

    if (raw === null) return initialState;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      return yield* Effect.fail(
        new StateParseError({
          path: paths.stateFile,
          message: "state.json is not valid JSON",
          cause,
        }),
      );
    }

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "version" in parsed &&
      (parsed as { version: unknown }).version !== STATE_VERSION
    ) {
      return yield* Effect.fail(
        new StateVersionError({
          path: paths.stateFile,
          found: (parsed as { version: unknown }).version,
          expected: STATE_VERSION,
        }),
      );
    }

    return yield* decodeUnknown(parsed).pipe(
      Effect.mapError(
        (cause) =>
          new StateParseError({
            path: paths.stateFile,
            message: `state.json does not match schema: ${String(cause)}`,
            cause,
          }),
      ),
    );
  });

export const save = (
  paths: LoadoutPaths,
  state: State,
): Effect.Effect<void, StateIOError | StateParseError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => fs.mkdir(paths.root, { recursive: true }),
      catch: (cause) => new StateIOError({ path: paths.root, op: "write", cause }),
    });
    const encoded = yield* encode(state).pipe(
      Effect.mapError(
        (cause) =>
          new StateParseError({
            path: paths.stateFile,
            message: "failed to encode state",
            cause,
          }),
      ),
    );
    yield* Effect.tryPromise({
      try: () => writeFileAtomic(paths.stateFile, `${JSON.stringify(encoded, null, 2)}\n`),
      catch: (cause) => new StateIOError({ path: paths.stateFile, op: "write", cause }),
    });
  });

export interface LockRelease {
  readonly release: () => Promise<void>;
}

export const acquireLock = (paths: LoadoutPaths): Effect.Effect<LockRelease, StateIOError> =>
  Effect.tryPromise({
    try: async () => {
      await fs.mkdir(paths.root, { recursive: true });
      await fs.writeFile(paths.lockFile, "", { flag: "a" });
      const release = await lockfile.lock(paths.lockFile, {
        stale: 10_000,
        retries: { retries: 0 },
      });
      return { release } satisfies LockRelease;
    },
    catch: (cause) => new StateIOError({ path: paths.lockFile, op: "write", cause }),
  });
