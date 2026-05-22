import { Effect } from "effect";
import type { AdapterError, HarnessAdapter } from "../adapters/HarnessAdapter.js";
import { liveMdsOf, type LiveMdsMap, type State } from "../state/schema.js";
import { sha256 } from "./drift.js";
import { type MdsIOError, readModeMd, BASELINE_MODE } from "./storage.js";

export interface MaterializeNotice {
  readonly harness: string;
  readonly mode: string; // mode whose MD is now live (may be BASELINE_MODE)
  readonly previous_mode: string | null;
  readonly previous_sha256: string | null;
  readonly sha256: string;
}

export interface MaterializeResult {
  readonly newLiveMds: LiveMdsMap;
  readonly notices: ReadonlyArray<MaterializeNotice>;
}

// Resolves the instruction file each harness should now show, writes it, and
// reports which ones actually changed. Skill moves should complete before this
// runs (Q11): if writing an MD fails, the user reruns and we recompute idempotently.
export const materializeInstructionFiles = (
  adapters: ReadonlyArray<HarnessAdapter>,
  state: State,
  loadoutRoot: string,
): Effect.Effect<MaterializeResult, AdapterError | MdsIOError> =>
  Effect.gen(function* () {
    const prior = liveMdsOf(state);
    const newLiveMds: Record<string, { mode: string; sha256: string }> = {};
    const notices: MaterializeNotice[] = [];

    for (const adapter of adapters) {
      if (adapter.instructionFilePath === null) continue;

      const resolved = yield* resolveInstructionContent(
        adapter.name,
        state.active_modes,
        loadoutRoot,
      );
      if (resolved === null) {
        // Nothing to materialize. Leave the live file alone but drop any stale
        // record so we don't think we own a file we no longer manage.
        continue;
      }

      const newSha = sha256(resolved.content);
      const priorRecord = prior[adapter.name];

      if (priorRecord && priorRecord.sha256 === newSha) {
        // No change; preserve the existing record verbatim.
        newLiveMds[adapter.name] = priorRecord;
        continue;
      }

      yield* adapter.writeInstructionFile(resolved.content);
      newLiveMds[adapter.name] = { mode: resolved.mode, sha256: newSha };
      notices.push({
        harness: adapter.name,
        mode: resolved.mode,
        previous_mode: priorRecord?.mode ?? null,
        previous_sha256: priorRecord?.sha256 ?? null,
        sha256: newSha,
      });
    }

    return { newLiveMds, notices };
  });

// Walks active_modes from most-recent to least-recent, picking the first mode
// that has an MD for this harness. Falls back to BASELINE_MODE. Returns null
// when no MD exists anywhere.
const resolveInstructionContent = (
  harness: string,
  active_modes: ReadonlyArray<string>,
  loadoutRoot: string,
): Effect.Effect<{ mode: string; content: string } | null, MdsIOError> =>
  Effect.gen(function* () {
    for (let i = active_modes.length - 1; i >= 0; i -= 1) {
      const mode = active_modes[i] as string;
      const content = yield* readModeMd(loadoutRoot, mode, harness);
      if (content !== null) return { mode, content };
    }
    const baseline = yield* readModeMd(loadoutRoot, BASELINE_MODE, harness);
    if (baseline !== null) return { mode: BASELINE_MODE, content: baseline };
    return null;
  });
