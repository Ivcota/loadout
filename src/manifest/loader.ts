import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect, Schema } from "effect";
import yaml from "js-yaml";
import writeFileAtomic from "write-file-atomic";
import {
  ManifestIOError,
  ManifestParseError,
  ManifestVersionError,
} from "./errors.js";
import { MANIFEST_VERSION, ModesManifest } from "./schema.js";

const decodeUnknown = Schema.decodeUnknown(ModesManifest);

export interface ManifestPaths {
  readonly manifestFile: string;
}

export const manifestPathsFor = (root: string): ManifestPaths => ({
  manifestFile: path.join(root, "modes.yaml"),
});

export const emptyManifest: ModesManifest = {
  version: MANIFEST_VERSION,
  modes: {},
};

export const exists = (paths: ManifestPaths): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: async () => {
      try {
        await fs.access(paths.manifestFile);
        return true;
      } catch {
        return false;
      }
    },
    catch: () => false as never,
  }).pipe(Effect.orElseSucceed(() => false));

export const load = (
  paths: ManifestPaths,
): Effect.Effect<ModesManifest, ManifestParseError | ManifestVersionError | ManifestIOError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => fs.readFile(paths.manifestFile, "utf8"),
      catch: (cause) =>
        (cause as NodeJS.ErrnoException)?.code === "ENOENT"
          ? null
          : new ManifestIOError({ path: paths.manifestFile, op: "read", cause }),
    }).pipe(
      Effect.catchAll((err) => (err === null ? Effect.succeed(null) : Effect.fail(err))),
    );

    if (raw === null) return emptyManifest;

    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch (cause) {
      return yield* Effect.fail(
        new ManifestParseError({
          path: paths.manifestFile,
          message: "modes.yaml is not valid YAML",
          cause,
        }),
      );
    }

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "version" in parsed &&
      (parsed as { version: unknown }).version !== MANIFEST_VERSION
    ) {
      return yield* Effect.fail(
        new ManifestVersionError({
          path: paths.manifestFile,
          found: (parsed as { version: unknown }).version,
          expected: MANIFEST_VERSION,
        }),
      );
    }

    return yield* decodeUnknown(parsed).pipe(
      Effect.mapError(
        (cause) =>
          new ManifestParseError({
            path: paths.manifestFile,
            message: `modes.yaml does not match schema: ${String(cause)}`,
            cause,
          }),
      ),
    );
  });

export const save = (
  paths: ManifestPaths,
  manifest: ModesManifest,
): Effect.Effect<void, ManifestIOError> =>
  Effect.tryPromise({
    try: async () => {
      await fs.mkdir(path.dirname(paths.manifestFile), { recursive: true });
      const body = yaml.dump(manifest, { lineWidth: 100, noRefs: true });
      await writeFileAtomic(paths.manifestFile, body);
    },
    catch: (cause) =>
      new ManifestIOError({ path: paths.manifestFile, op: "write", cause }),
  });
