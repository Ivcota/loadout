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
import type { LoadoutHome } from "../../paths.js";
import type {
  StateIOError,
  StateParseError,
  StateVersionError,
} from "../../state/errors.js";
import { load as loadState } from "../../state/manager.js";
import type { InProgress, State } from "../../state/schema.js";

export interface StatusInput {
  readonly paths: LoadoutHome;
  readonly adapters: ReadonlyArray<HarnessAdapter>;
}

export interface HarnessStatus {
  readonly name: string;
  readonly activeDir: string;
  readonly poolDir: string;
  readonly activeCount: number;
  readonly poolCount: number;
}

export interface StatusReport {
  readonly root: string;
  readonly state: State;
  readonly manifest: ModesManifest;
  readonly inProgress: InProgress | null;
  readonly harnesses: ReadonlyArray<HarnessStatus>;
  readonly unknownActiveModes: ReadonlyArray<string>;
}

export type StatusError =
  | AdapterError
  | ManifestIOError
  | ManifestParseError
  | ManifestVersionError
  | StateIOError
  | StateParseError
  | StateVersionError;

export const status = (
  input: StatusInput,
): Effect.Effect<StatusReport, StatusError> =>
  Effect.gen(function* () {
    const state = yield* loadState(input.paths.state);
    const manifest = yield* loadManifest(input.paths.manifest);
    const harnesses = yield* Effect.all(
      input.adapters.map((a) =>
        a.snapshot().pipe(
          Effect.map(
            (s) =>
              ({
                name: a.name,
                activeDir: a.activeDir,
                poolDir: a.poolDir,
                activeCount: s.active.size,
                poolCount: s.pool.size,
              }) satisfies HarnessStatus,
          ),
        ),
      ),
    );
    const unknownActiveModes = state.active_modes.filter(
      (m) => !(m in manifest.modes),
    );
    return {
      root: input.paths.root,
      state,
      manifest,
      inProgress: state.in_progress,
      harnesses,
      unknownActiveModes,
    };
  });

export const renderStatus = (r: StatusReport, updateNotice?: string | null): string => {
  const lines: string[] = [];
  lines.push(`loadout — root: ${r.root}`);
  lines.push(
    `active_modes: ${r.state.active_modes.length === 0 ? "(none)" : r.state.active_modes.join(", ")}`,
  );
  if (r.unknownActiveModes.length > 0) {
    lines.push(
      `  ! these active modes are not defined in modes.yaml: ${r.unknownActiveModes.join(", ")}`,
    );
  }
  if (r.inProgress) {
    const ip = r.inProgress;
    const total = ip.completed.length + ip.pending.length;
    lines.push(
      `in_progress: ${ip.op} ${ip.mode} — ${ip.completed.length}/${total} moves complete`,
    );
    lines.push(
      `  resume with: loadout ${ip.op} ${ip.mode}   (or use --rollback to undo)`,
    );
  } else {
    lines.push(`in_progress: none`);
  }
  lines.push(``);
  lines.push(`harnesses:`);
  const w = Math.max(...r.harnesses.map((h) => h.name.length), 6);
  for (const h of r.harnesses) {
    lines.push(
      `  ${h.name.padEnd(w)}  active: ${String(h.activeCount).padStart(3)}   pool: ${String(h.poolCount).padStart(3)}`,
    );
  }
  if (updateNotice) {
    lines.push(``);
    lines.push(updateNotice);
  }
  return lines.join("\n");
};
