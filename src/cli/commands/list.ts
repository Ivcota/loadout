import { Effect } from "effect";
import type {
  ManifestIOError,
  ManifestParseError,
  ManifestVersionError,
} from "../../manifest/errors.js";
import { load as loadManifest } from "../../manifest/loader.js";
import type { ModesManifest } from "../../manifest/schema.js";
import type { LoadoutHome } from "../../paths.js";
import type {
  StateIOError,
  StateParseError,
  StateVersionError,
} from "../../state/errors.js";
import { load as loadState } from "../../state/manager.js";

export interface ListInput {
  readonly paths: LoadoutHome;
}

export interface ListEntry {
  readonly name: string;
  readonly skillCount: number;
  readonly active: boolean;
}

export interface ListReport {
  readonly manifest: ModesManifest;
  readonly activeModes: ReadonlySet<string>;
  readonly entries: ReadonlyArray<ListEntry>;
}

export type ListError =
  | ManifestIOError
  | ManifestParseError
  | ManifestVersionError
  | StateIOError
  | StateParseError
  | StateVersionError;

export const list = (input: ListInput): Effect.Effect<ListReport, ListError> =>
  Effect.gen(function* () {
    const state = yield* loadState(input.paths.state);
    const manifest = yield* loadManifest(input.paths.manifest);
    const activeModes = new Set(state.active_modes);
    const entries: ListEntry[] = Object.entries(manifest.modes)
      .map(([name, mode]) => ({
        name,
        skillCount: mode.skills.length,
        active: activeModes.has(name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { manifest, activeModes, entries };
  });

export const renderList = (r: ListReport): string => {
  if (r.entries.length === 0) {
    return `no modes defined. run \`loadout init\` to seed a default mode, or \`loadout new <name>\` to create one.`;
  }
  const lines: string[] = [];
  lines.push(`modes (${r.entries.length}):`);
  const w = Math.max(...r.entries.map((e) => e.name.length));
  for (const e of r.entries) {
    const marker = e.active ? "*" : " ";
    lines.push(
      `  ${marker} ${e.name.padEnd(w)}  ${e.skillCount} skill${e.skillCount === 1 ? "" : "s"}`,
    );
  }
  const orphans = [...r.activeModes].filter(
    (m) => !r.entries.some((e) => e.name === m),
  );
  if (orphans.length > 0) {
    lines.push(``);
    lines.push(
      `  ! active modes not defined in modes.yaml: ${orphans.join(", ")}`,
    );
  }
  return lines.join("\n");
};
