import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { AdapterError, HarnessAdapter } from "../adapters/HarnessAdapter.js";
import { liveMdsOf, type State } from "../state/schema.js";

export const sha256 = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

export interface DriftReport {
  readonly harness: string;
  readonly mode: string;
  readonly expected_sha256: string;
  readonly actual_sha256: string | null;
  readonly drift: boolean;
}

// Returns null when no live_mds record exists for this harness — that's
// "nothing was materialized through loadout yet," not drift. When a record
// exists, drift=true if the on-disk content disagrees with the recorded hash
// (including the case where the file was deleted out of band).
export const detectDrift = (
  adapter: HarnessAdapter,
  state: State,
): Effect.Effect<DriftReport | null, AdapterError> =>
  Effect.gen(function* () {
    const recorded = liveMdsOf(state)[adapter.name];
    if (!recorded) return null;
    const content = yield* adapter.readInstructionFile();
    const actual_sha256 = content === null ? null : sha256(content);
    return {
      harness: adapter.name,
      mode: recorded.mode,
      expected_sha256: recorded.sha256,
      actual_sha256,
      drift: actual_sha256 !== recorded.sha256,
    };
  });
