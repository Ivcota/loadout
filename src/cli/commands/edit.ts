import React from "react";
import { render } from "ink";
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
import { acquireLock } from "../../state/manager.js";
import { EditMode } from "../../tui/EditMode.js";
import { buildRows, type SkillRow } from "../../tui/editReducer.js";
import type { ManifestModeNotFound } from "./manifest.js";

export type EditError =
  | AdapterError
  | ManifestIOError
  | ManifestParseError
  | ManifestVersionError
  | StateIOError
  | StateParseError
  | StateVersionError
  | ManifestModeNotFound;

export interface EditInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
  readonly mode: string;
  readonly renderer?: TuiRenderer;
}

export interface EditReport {
  readonly mode: string;
  readonly saved: boolean;
  readonly before: ReadonlyArray<string>;
  readonly after: ReadonlyArray<string>;
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly noop: boolean;
}

export interface TuiRenderResult {
  readonly saved: boolean;
  readonly selected: ReadonlySet<string>;
}

export interface TuiRenderInput {
  readonly modeName: string;
  readonly rows: ReadonlyArray<SkillRow>;
  readonly modeSkills: ReadonlyArray<string>;
}

export type TuiRenderer = (
  input: TuiRenderInput,
) => Promise<TuiRenderResult>;

const inkRenderer: TuiRenderer = (input) =>
  new Promise<TuiRenderResult>((resolve) => {
    let captured: TuiRenderResult = {
      saved: false,
      selected: new Set(input.modeSkills),
    };
    const { waitUntilExit } = render(
      React.createElement(EditMode, {
        modeName: input.modeName,
        rows: input.rows,
        modeSkills: input.modeSkills,
        onDone: (r) => {
          captured = r;
        },
      }),
    );
    waitUntilExit().then(() => resolve(captured));
  });

const buildHarnessIndex = (
  snapshots: ReadonlyArray<{
    readonly name: string;
    readonly active: ReadonlySet<string>;
    readonly pool: ReadonlySet<string>;
  }>,
): { pool: Set<string>; harnessIndex: Map<string, string[]> } => {
  const pool = new Set<string>();
  const harnessIndex = new Map<string, string[]>();
  for (const snap of snapshots) {
    for (const skill of [...snap.active, ...snap.pool]) {
      pool.add(skill);
      const arr = harnessIndex.get(skill);
      if (arr === undefined) harnessIndex.set(skill, [snap.name]);
      else if (!arr.includes(snap.name)) arr.push(snap.name);
    }
  }
  return { pool, harnessIndex };
};

export const edit = (input: EditInput): Effect.Effect<EditReport, EditError> =>
  Effect.gen(function* () {
    const before = yield* loadManifest(input.paths.manifest);
    const mode = before.modes[input.mode];
    if (mode === undefined) {
      return yield* Effect.fail({
        _tag: "ManifestModeNotFound" as const,
        mode: input.mode,
        knownModes: Object.keys(before.modes).sort(),
      } satisfies ManifestModeNotFound);
    }
    const snapshots = yield* Effect.all(
      input.adapters.map((a) => a.snapshot()),
    );
    const { pool, harnessIndex } = buildHarnessIndex(snapshots);
    const rows = buildRows(pool, mode.skills, harnessIndex);

    const renderer = input.renderer ?? inkRenderer;
    const result = yield* Effect.promise(() =>
      renderer({
        modeName: input.mode,
        rows,
        modeSkills: mode.skills,
      }),
    );

    if (!result.saved) {
      return {
        mode: input.mode,
        saved: false,
        before: mode.skills,
        after: mode.skills,
        added: [],
        removed: [],
        noop: true,
      } satisfies EditReport;
    }

    const release = yield* acquireLock(input.paths.state);
    try {
      const fresh = yield* loadManifest(input.paths.manifest);
      const freshMode = fresh.modes[input.mode];
      if (freshMode === undefined) {
        return yield* Effect.fail({
          _tag: "ManifestModeNotFound" as const,
          mode: input.mode,
          knownModes: Object.keys(fresh.modes).sort(),
        } satisfies ManifestModeNotFound);
      }
      const nextSkills = [...result.selected].sort((a, b) =>
        a.localeCompare(b),
      );
      const after: ModesManifest = {
        ...fresh,
        modes: {
          ...fresh.modes,
          [input.mode]: { skills: nextSkills },
        },
      };
      const beforeSorted = [...freshMode.skills].sort((a, b) =>
        a.localeCompare(b),
      );
      const noop =
        beforeSorted.length === nextSkills.length &&
        beforeSorted.every((s, i) => s === nextSkills[i]);
      if (!noop) yield* saveManifest(input.paths.manifest, after);
      const beforeSet = new Set(freshMode.skills);
      const afterSet = new Set(nextSkills);
      const added = [...afterSet]
        .filter((s) => !beforeSet.has(s))
        .sort((a, b) => a.localeCompare(b));
      const removed = [...beforeSet]
        .filter((s) => !afterSet.has(s))
        .sort((a, b) => a.localeCompare(b));
      return {
        mode: input.mode,
        saved: true,
        before: freshMode.skills,
        after: nextSkills,
        added,
        removed,
        noop,
      } satisfies EditReport;
    } finally {
      yield* Effect.promise(() => release.release());
    }
  });

export const renderEdit = (r: EditReport): string => {
  if (!r.saved) return `· edit cancelled — mode '${r.mode}' unchanged`;
  if (r.noop) return `· mode '${r.mode}' unchanged (${r.after.length} skill(s))`;
  const lines: string[] = [];
  lines.push(
    `✓ mode '${r.mode}' saved (${r.after.length} skill(s), +${r.added.length} -${r.removed.length})`,
  );
  if (r.added.length > 0) lines.push(`  + ${r.added.join(", ")}`);
  if (r.removed.length > 0) lines.push(`  - ${r.removed.join(", ")}`);
  return lines.join("\n");
};
