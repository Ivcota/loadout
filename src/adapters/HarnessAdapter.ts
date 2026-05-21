import { Data, type Effect } from "effect";
import type { PlannedMove } from "../state/schema.js";

export interface HarnessSnapshot {
  readonly name: string;
  readonly activeDir: string;
  readonly poolDir: string;
  readonly active: ReadonlySet<string>;
  readonly pool: ReadonlySet<string>;
}

export class AdapterError extends Data.TaggedError("AdapterError")<{
  readonly harness: string;
  readonly skill: string;
  readonly op: PlannedMove["op"];
  readonly cause: "EXDEV" | "EACCES" | "ENOENT" | "EXISTS" | "unknown";
  readonly message: string;
  readonly source?: unknown;
}> {}

export interface HarnessAdapter {
  readonly name: string;
  readonly activeDir: string;
  readonly poolDir: string;
  snapshot(): Effect.Effect<HarnessSnapshot, AdapterError>;
  apply(move: PlannedMove): Effect.Effect<void, AdapterError>;
  invert(move: PlannedMove): PlannedMove;
}
