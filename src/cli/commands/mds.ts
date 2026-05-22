import { Effect } from "effect";
import type {
  AdapterError,
  HarnessAdapter,
} from "../../adapters/HarnessAdapter.js";
import {
  BASELINE_MODE,
  deleteModeMd,
  type MdsIOError,
  readModeMd,
  writeModeMd,
} from "../../mds/storage.js";
import type { LoadoutHome } from "../../paths.js";

export interface MdNotFound {
  readonly _tag: "MdNotFound";
  readonly mode: string;
  readonly harness: string;
}

export interface MdHarnessHasNoInstructionFile {
  readonly _tag: "MdHarnessHasNoInstructionFile";
  readonly harness: string;
}

export type MdError =
  | AdapterError
  | MdsIOError
  | MdNotFound
  | MdHarnessHasNoInstructionFile;

export interface MdInput {
  readonly paths: LoadoutHome;
  readonly mode: string;
  readonly harness: string;
}

export interface MdShowReport {
  readonly mode: string;
  readonly harness: string;
  readonly content: string;
}

export const showMd = (
  input: MdInput,
): Effect.Effect<MdShowReport, MdError> =>
  Effect.gen(function* () {
    const content = yield* readModeMd(
      input.paths.root,
      input.mode,
      input.harness,
    );
    if (content === null) {
      return yield* Effect.fail({
        _tag: "MdNotFound" as const,
        mode: input.mode,
        harness: input.harness,
      } satisfies MdNotFound);
    }
    return { mode: input.mode, harness: input.harness, content };
  });

export interface MdSetInput extends MdInput {
  readonly content: string;
}

export interface MdSetReport {
  readonly mode: string;
  readonly harness: string;
  readonly created: boolean;
}

export const setMd = (
  input: MdSetInput,
): Effect.Effect<MdSetReport, MdError> =>
  Effect.gen(function* () {
    const existed =
      (yield* readModeMd(input.paths.root, input.mode, input.harness)) !== null;
    yield* writeModeMd(
      input.paths.root,
      input.mode,
      input.harness,
      input.content,
    );
    return {
      mode: input.mode,
      harness: input.harness,
      created: !existed,
    } satisfies MdSetReport;
  });

export interface MdUnsetReport {
  readonly mode: string;
  readonly harness: string;
  readonly removed: boolean;
}

export const unsetMd = (
  input: MdInput,
): Effect.Effect<MdUnsetReport, MdError> =>
  Effect.gen(function* () {
    const existed =
      (yield* readModeMd(input.paths.root, input.mode, input.harness)) !== null;
    yield* deleteModeMd(input.paths.root, input.mode, input.harness);
    return {
      mode: input.mode,
      harness: input.harness,
      removed: existed,
    } satisfies MdUnsetReport;
  });

export interface AdoptBaselineInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
  readonly force?: boolean;
}

export interface AdoptBaselineReport {
  readonly adopted: ReadonlyArray<{ harness: string; bytes: number }>;
  readonly skipped: ReadonlyArray<{ harness: string; reason: string }>;
}

// Snapshot whatever currently lives at each harness's instruction-file path
// into ~/.loadout/mds/baseline/<harness>.md, so loadout can restore it when
// no active mode supplies one. Idempotent: re-running on an unchanged harness
// is a no-op write of the same content.
export const adoptBaseline = (
  input: AdoptBaselineInput,
): Effect.Effect<AdoptBaselineReport, AdapterError | MdsIOError> =>
  Effect.gen(function* () {
    const adopted: { harness: string; bytes: number }[] = [];
    const skipped: { harness: string; reason: string }[] = [];

    for (const adapter of input.adapters) {
      if (adapter.instructionFilePath === null) {
        skipped.push({
          harness: adapter.name,
          reason: "harness has no instruction file",
        });
        continue;
      }
      const existing = yield* readModeMd(
        input.paths.root,
        BASELINE_MODE,
        adapter.name,
      );
      if (existing !== null && !input.force) {
        skipped.push({
          harness: adapter.name,
          reason: "baseline already exists (use --force to overwrite)",
        });
        continue;
      }
      const live = yield* adapter.readInstructionFile();
      if (live === null) {
        skipped.push({
          harness: adapter.name,
          reason: "no live instruction file to adopt",
        });
        continue;
      }
      yield* writeModeMd(
        input.paths.root,
        BASELINE_MODE,
        adapter.name,
        live,
      );
      adopted.push({
        harness: adapter.name,
        bytes: Buffer.byteLength(live, "utf8"),
      });
    }

    return { adopted, skipped } satisfies AdoptBaselineReport;
  });

// `loadout save <mode> --md` snapshots whatever is currently live for each
// harness into the mode's MD slot. Mirrors how `loadout save` already
// snapshots active skills — "make it look right live, then capture it."
export interface CaptureLiveMdsInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
  readonly mode: string;
}

export interface CaptureLiveMdsReport {
  readonly mode: string;
  readonly captured: ReadonlyArray<{ harness: string; bytes: number }>;
  readonly skipped: ReadonlyArray<{ harness: string; reason: string }>;
}

export const captureLiveMdsForMode = (
  input: CaptureLiveMdsInput,
): Effect.Effect<CaptureLiveMdsReport, AdapterError | MdsIOError> =>
  Effect.gen(function* () {
    const captured: { harness: string; bytes: number }[] = [];
    const skipped: { harness: string; reason: string }[] = [];

    for (const adapter of input.adapters) {
      if (adapter.instructionFilePath === null) {
        continue; // silently skip harnesses without instruction files
      }
      const live = yield* adapter.readInstructionFile();
      if (live === null) {
        skipped.push({
          harness: adapter.name,
          reason: "no live instruction file to capture",
        });
        continue;
      }
      yield* writeModeMd(input.paths.root, input.mode, adapter.name, live);
      captured.push({
        harness: adapter.name,
        bytes: Buffer.byteLength(live, "utf8"),
      });
    }

    return { mode: input.mode, captured, skipped } satisfies CaptureLiveMdsReport;
  });

export const renderMdShow = (r: MdShowReport): string => r.content;

export const renderMdSet = (r: MdSetReport): string =>
  `${r.created ? "created" : "updated"} ${r.harness} MD for mode '${r.mode}'`;

export const renderMdUnset = (r: MdUnsetReport): string =>
  r.removed
    ? `removed ${r.harness} MD from mode '${r.mode}'`
    : `${r.harness} MD was not set for mode '${r.mode}' (no-op)`;

export const renderAdoptBaseline = (r: AdoptBaselineReport): string => {
  const lines: string[] = [];
  if (r.adopted.length === 0 && r.skipped.length === 0) {
    return "no harnesses to adopt baseline from";
  }
  for (const a of r.adopted) {
    lines.push(`  → adopted ${a.harness} baseline (${a.bytes} bytes)`);
  }
  for (const s of r.skipped) {
    lines.push(`  · skipped ${s.harness}: ${s.reason}`);
  }
  return lines.join("\n");
};

export const renderCaptureLiveMds = (r: CaptureLiveMdsReport): string => {
  const lines: string[] = [];
  if (r.captured.length === 0) {
    lines.push(`no MDs captured for mode '${r.mode}'`);
  } else {
    lines.push(`captured ${r.captured.length} MD(s) into mode '${r.mode}':`);
    for (const c of r.captured) {
      lines.push(`  → ${c.harness} (${c.bytes} bytes)`);
    }
  }
  for (const s of r.skipped) {
    lines.push(`  · skipped ${s.harness}: ${s.reason}`);
  }
  return lines.join("\n");
};
