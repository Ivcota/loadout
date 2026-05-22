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
  load as loadManifest,
  save as saveManifest,
} from "../../manifest/loader.js";
import type { ModesManifest } from "../../manifest/schema.js";
import type { MdsIOError } from "../../mds/storage.js";
import type { LoadoutHome } from "../../paths.js";
import type {
  StateIOError,
  StateParseError,
  StateVersionError,
} from "../../state/errors.js";
import { acquireLock } from "../../state/manager.js";
import {
  captureLiveMdsForMode,
  type CaptureLiveMdsReport,
} from "./mds.js";

export interface SaveModeExists {
  readonly _tag: "SaveModeExists";
  readonly mode: string;
}

export interface SaveEmpty {
  readonly _tag: "SaveEmpty";
}

export type SaveError =
  | AdapterError
  | ManifestIOError
  | ManifestParseError
  | ManifestVersionError
  | MdsIOError
  | StateIOError
  | StateParseError
  | StateVersionError
  | SaveModeExists
  | SaveEmpty;

export interface SaveInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
  readonly mode: string;
  readonly force?: boolean;
  // When true, also snapshot the currently-live instruction file for each
  // harness into the mode's MD slot. Mirrors the skills-snapshot behavior.
  readonly md?: boolean;
}

export interface SaveReport {
  readonly mode: string;
  readonly skills: ReadonlyArray<string>;
  readonly overwrote: boolean;
  readonly perHarness: ReadonlyArray<{
    readonly harness: string;
    readonly count: number;
  }>;
  readonly before: ModesManifest;
  readonly after: ModesManifest;
  readonly md: CaptureLiveMdsReport | null;
}

const runSave = (input: SaveInput): Effect.Effect<SaveReport, SaveError> =>
  Effect.gen(function* () {
    const force = input.force ?? false;
    const before = yield* loadManifest(input.paths.manifest);
    const existed = input.mode in before.modes;
    if (existed && !force) {
      return yield* Effect.fail({
        _tag: "SaveModeExists" as const,
        mode: input.mode,
      } satisfies SaveModeExists);
    }

    const snapshots = yield* Effect.all(
      input.adapters.map((a) => a.snapshot()),
    );

    const union = new Set<string>();
    const perHarness = snapshots.map((s) => {
      for (const skill of s.active) union.add(skill);
      return { harness: s.name, count: s.active.size };
    });
    const skills = Array.from(union).sort();

    if (skills.length === 0) {
      return yield* Effect.fail({ _tag: "SaveEmpty" as const } satisfies SaveEmpty);
    }

    const after: ModesManifest = {
      ...before,
      modes: { ...before.modes, [input.mode]: { skills } },
    };
    yield* saveManifest(input.paths.manifest, after);

    const mdReport = input.md
      ? yield* captureLiveMdsForMode({
          paths: input.paths,
          adapters: input.adapters,
          mode: input.mode,
        })
      : null;

    return {
      mode: input.mode,
      skills,
      overwrote: existed,
      perHarness,
      before,
      after,
      md: mdReport,
    } satisfies SaveReport;
  });

export const save = (input: SaveInput): Effect.Effect<SaveReport, SaveError> =>
  Effect.acquireUseRelease(
    acquireLock(input.paths.state),
    () => runSave(input),
    (lock) => Effect.promise(() => lock.release()),
  );

export const renderSave = (r: SaveReport): string => {
  const lines: string[] = [];
  const verb = r.overwrote ? "overwrote" : "created";
  lines.push(`${verb} mode '${r.mode}' (${r.skills.length} skill(s))`);
  for (const h of r.perHarness) {
    lines.push(`  · ${h.harness}: ${h.count} active`);
  }
  if (r.md) {
    for (const c of r.md.captured) {
      lines.push(`  ✓ captured ${c.harness} instruction file (${c.bytes} bytes)`);
    }
    for (const s of r.md.skipped) {
      lines.push(`  · skipped ${s.harness} MD: ${s.reason}`);
    }
  }
  lines.push(`activate with: loadout use ${r.mode}`);
  return lines.join("\n");
};
