import { Schema } from "effect";

export const HarnessName = Schema.String.pipe(Schema.brand("HarnessName"));
export type HarnessName = Schema.Schema.Type<typeof HarnessName>;

export const SkillName = Schema.String.pipe(Schema.brand("SkillName"));
export type SkillName = Schema.Schema.Type<typeof SkillName>;

export const ModeName = Schema.String.pipe(Schema.brand("ModeName"));
export type ModeName = Schema.Schema.Type<typeof ModeName>;

export const PlannedMove = Schema.Struct({
  harness: Schema.String,
  skill: Schema.String,
  op: Schema.Literal("activate", "deactivate"),
  source_path: Schema.String,
  dest_path: Schema.String,
});
export type PlannedMove = Schema.Schema.Type<typeof PlannedMove>;

export const InProgress = Schema.Struct({
  op: Schema.Literal("on", "off", "use"),
  mode: Schema.String,
  completed: Schema.Array(PlannedMove),
  pending: Schema.Array(PlannedMove),
});
export type InProgress = Schema.Schema.Type<typeof InProgress>;

export const STATE_VERSION = 1 as const;

// Records which mode's instruction file (or the baseline) is currently
// materialized at each harness's live path. sha256 is the digest of the
// content we wrote, so later swaps can detect out-of-band edits.
export const LiveMd = Schema.Struct({
  mode: Schema.String,
  sha256: Schema.String,
});
export type LiveMd = Schema.Schema.Type<typeof LiveMd>;

export const LiveMdsMap = Schema.Record({
  key: Schema.String,
  value: LiveMd,
});
export type LiveMdsMap = Schema.Schema.Type<typeof LiveMdsMap>;

export const State = Schema.Struct({
  version: Schema.Literal(STATE_VERSION),
  active_modes: Schema.Array(Schema.String),
  in_progress: Schema.NullOr(InProgress),
  live_mds: Schema.optional(LiveMdsMap),
});
export type State = Schema.Schema.Type<typeof State>;

// Treat a missing live_mds as the empty record — callers should use this so
// downstream code never has to special-case undefined.
export const liveMdsOf = (state: State): LiveMdsMap => state.live_mds ?? {};

export const initialState: State = {
  version: STATE_VERSION,
  active_modes: [],
  in_progress: null,
};

export const decodeState = Schema.decodeUnknown(State);
export const decodeStateSync = Schema.decodeUnknownSync(State);
export const encodeState = Schema.encode(State);
