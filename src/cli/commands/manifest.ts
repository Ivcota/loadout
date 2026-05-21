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
import type { LoadoutHome } from "../../paths.js";
import type {
  StateIOError,
  StateParseError,
  StateVersionError,
} from "../../state/errors.js";
import { acquireLock, load as loadState } from "../../state/manager.js";

export interface ManifestModeAlreadyExists {
  readonly _tag: "ManifestModeAlreadyExists";
  readonly mode: string;
}

export interface ManifestModeNotFound {
  readonly _tag: "ManifestModeNotFound";
  readonly mode: string;
  readonly knownModes: ReadonlyArray<string>;
}

export interface ManifestModeInUse {
  readonly _tag: "ManifestModeInUse";
  readonly mode: string;
}

export interface ManifestSkillNotKnown {
  readonly _tag: "ManifestSkillNotKnown";
  readonly skill: string;
}

export interface ManifestSkillNotInMode {
  readonly _tag: "ManifestSkillNotInMode";
  readonly mode: string;
  readonly skill: string;
}

export type ManifestEditError =
  | AdapterError
  | ManifestIOError
  | ManifestParseError
  | ManifestVersionError
  | StateIOError
  | StateParseError
  | StateVersionError
  | ManifestModeAlreadyExists
  | ManifestModeNotFound
  | ManifestModeInUse
  | ManifestSkillNotKnown
  | ManifestSkillNotInMode;

export type ManifestEditOp = "new" | "delete" | "add" | "rm" | "sync";

export interface ManifestNewInput {
  readonly paths: LoadoutHome;
  readonly mode: string;
}

export interface ManifestDeleteInput {
  readonly paths: LoadoutHome;
  readonly mode: string;
}

export interface ManifestAddInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
  readonly mode: string;
  readonly skill: string;
}

export interface ManifestRmInput {
  readonly paths: LoadoutHome;
  readonly mode: string;
  readonly skill: string;
}

export interface ManifestSyncInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
  readonly mode: string;
}

export interface ManifestEditReport {
  readonly op: ManifestEditOp;
  readonly mode: string;
  readonly skill: string | null;
  readonly before: ModesManifest;
  readonly after: ModesManifest;
  readonly noop: boolean;
  readonly added?: ReadonlyArray<string>;
}

const knownModes = (m: ModesManifest): ReadonlyArray<string> =>
  Object.keys(m.modes).sort();

const runNew = (
  input: ManifestNewInput,
): Effect.Effect<ManifestEditReport, ManifestEditError> =>
  Effect.gen(function* () {
    const before = yield* loadManifest(input.paths.manifest);
    if (input.mode in before.modes) {
      return yield* Effect.fail({
        _tag: "ManifestModeAlreadyExists" as const,
        mode: input.mode,
      } satisfies ManifestModeAlreadyExists);
    }
    const after: ModesManifest = {
      ...before,
      modes: { ...before.modes, [input.mode]: { skills: [] } },
    };
    yield* saveManifest(input.paths.manifest, after);
    return {
      op: "new" as const,
      mode: input.mode,
      skill: null,
      before,
      after,
      noop: false,
    } satisfies ManifestEditReport;
  });

const runDelete = (
  input: ManifestDeleteInput,
): Effect.Effect<ManifestEditReport, ManifestEditError> =>
  Effect.gen(function* () {
    const state = yield* loadState(input.paths.state);
    const before = yield* loadManifest(input.paths.manifest);
    if (!(input.mode in before.modes)) {
      return yield* Effect.fail({
        _tag: "ManifestModeNotFound" as const,
        mode: input.mode,
        knownModes: knownModes(before),
      } satisfies ManifestModeNotFound);
    }
    if (state.active_modes.includes(input.mode)) {
      return yield* Effect.fail({
        _tag: "ManifestModeInUse" as const,
        mode: input.mode,
      } satisfies ManifestModeInUse);
    }
    const nextModes = { ...before.modes };
    delete nextModes[input.mode];
    const after: ModesManifest = { ...before, modes: nextModes };
    yield* saveManifest(input.paths.manifest, after);
    return {
      op: "delete" as const,
      mode: input.mode,
      skill: null,
      before,
      after,
      noop: false,
    } satisfies ManifestEditReport;
  });

const runAdd = (
  input: ManifestAddInput,
): Effect.Effect<ManifestEditReport, ManifestEditError> =>
  Effect.gen(function* () {
    const before = yield* loadManifest(input.paths.manifest);
    const mode = before.modes[input.mode];
    if (mode === undefined) {
      return yield* Effect.fail({
        _tag: "ManifestModeNotFound" as const,
        mode: input.mode,
        knownModes: knownModes(before),
      } satisfies ManifestModeNotFound);
    }
    if (mode.skills.includes(input.skill)) {
      return {
        op: "add" as const,
        mode: input.mode,
        skill: input.skill,
        before,
        after: before,
        noop: true,
      } satisfies ManifestEditReport;
    }
    const harnesses = yield* Effect.all(
      input.adapters.map((a) => a.snapshot()),
    );
    const isKnown = harnesses.some(
      (h) => h.active.has(input.skill) || h.pool.has(input.skill),
    );
    if (!isKnown) {
      return yield* Effect.fail({
        _tag: "ManifestSkillNotKnown" as const,
        skill: input.skill,
      } satisfies ManifestSkillNotKnown);
    }
    const after: ModesManifest = {
      ...before,
      modes: {
        ...before.modes,
        [input.mode]: { skills: [...mode.skills, input.skill] },
      },
    };
    yield* saveManifest(input.paths.manifest, after);
    return {
      op: "add" as const,
      mode: input.mode,
      skill: input.skill,
      before,
      after,
      noop: false,
    } satisfies ManifestEditReport;
  });

const runRm = (
  input: ManifestRmInput,
): Effect.Effect<ManifestEditReport, ManifestEditError> =>
  Effect.gen(function* () {
    const before = yield* loadManifest(input.paths.manifest);
    const mode = before.modes[input.mode];
    if (mode === undefined) {
      return yield* Effect.fail({
        _tag: "ManifestModeNotFound" as const,
        mode: input.mode,
        knownModes: knownModes(before),
      } satisfies ManifestModeNotFound);
    }
    if (!mode.skills.includes(input.skill)) {
      return yield* Effect.fail({
        _tag: "ManifestSkillNotInMode" as const,
        mode: input.mode,
        skill: input.skill,
      } satisfies ManifestSkillNotInMode);
    }
    const after: ModesManifest = {
      ...before,
      modes: {
        ...before.modes,
        [input.mode]: {
          skills: mode.skills.filter((s) => s !== input.skill),
        },
      },
    };
    yield* saveManifest(input.paths.manifest, after);
    return {
      op: "rm" as const,
      mode: input.mode,
      skill: input.skill,
      before,
      after,
      noop: false,
    } satisfies ManifestEditReport;
  });

const runSync = (
  input: ManifestSyncInput,
): Effect.Effect<ManifestEditReport, ManifestEditError> =>
  Effect.gen(function* () {
    const before = yield* loadManifest(input.paths.manifest);
    const snapshots = yield* Effect.all(
      input.adapters.map((a) => a.snapshot()),
    );
    const known = new Set<string>();
    for (const h of snapshots) {
      for (const skill of h.active) known.add(skill);
      for (const skill of h.pool) known.add(skill);
    }

    const existing = before.modes[input.mode]?.skills ?? [];
    const existingSet = new Set(existing);
    const added = [...known].filter((skill) => !existingSet.has(skill)).sort();
    const skills = [...new Set([...existing, ...added])].sort();
    const after: ModesManifest = {
      ...before,
      modes: { ...before.modes, [input.mode]: { skills } },
    };

    if (added.length === 0 && input.mode in before.modes) {
      return {
        op: "sync" as const,
        mode: input.mode,
        skill: null,
        before,
        after: before,
        noop: true,
        added,
      } satisfies ManifestEditReport;
    }

    yield* saveManifest(input.paths.manifest, after);
    return {
      op: "sync" as const,
      mode: input.mode,
      skill: null,
      before,
      after,
      noop: false,
      added,
    } satisfies ManifestEditReport;
  });

const withLock = <A, E>(
  paths: LoadoutHome,
  body: Effect.Effect<A, E>,
): Effect.Effect<A, E | StateIOError> =>
  Effect.acquireUseRelease(
    acquireLock(paths.state),
    () => body,
    (lock) => Effect.promise(() => lock.release()),
  );

export const newMode = (
  input: ManifestNewInput,
): Effect.Effect<ManifestEditReport, ManifestEditError> =>
  withLock(input.paths, runNew(input));

export const deleteMode = (
  input: ManifestDeleteInput,
): Effect.Effect<ManifestEditReport, ManifestEditError> =>
  withLock(input.paths, runDelete(input));

export const addSkill = (
  input: ManifestAddInput,
): Effect.Effect<ManifestEditReport, ManifestEditError> =>
  withLock(input.paths, runAdd(input));

export const rmSkill = (
  input: ManifestRmInput,
): Effect.Effect<ManifestEditReport, ManifestEditError> =>
  withLock(input.paths, runRm(input));

export const syncMode = (
  input: ManifestSyncInput,
): Effect.Effect<ManifestEditReport, ManifestEditError> =>
  withLock(input.paths, runSync(input));

export const renderManifestEdit = (r: ManifestEditReport): string => {
  const skillCount = (m: ModesManifest, mode: string): number =>
    m.modes[mode]?.skills.length ?? 0;
  switch (r.op) {
    case "new":
      return `+ mode '${r.mode}' created (0 skills)`;
    case "delete":
      return `- mode '${r.mode}' deleted`;
    case "add":
      if (r.noop) {
        return `· '${r.skill}' is already in mode '${r.mode}' — no change`;
      }
      return `+ '${r.skill}' → mode '${r.mode}' (${skillCount(r.after, r.mode)} skill(s))`;
    case "rm":
      return `- '${r.skill}' removed from mode '${r.mode}' (${skillCount(r.after, r.mode)} skill(s))`;
    case "sync": {
      const added = r.added ?? [];
      if (r.noop) return `· mode '${r.mode}' already synced — no change`;
      return `↻ mode '${r.mode}' synced (${skillCount(r.after, r.mode)} skill(s), +${added.length})`;
    }
  }
};
