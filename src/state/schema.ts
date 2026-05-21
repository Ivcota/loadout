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

export const State = Schema.Struct({
  version: Schema.Literal(STATE_VERSION),
  active_modes: Schema.Array(Schema.String),
  in_progress: Schema.NullOr(InProgress),
});
export type State = Schema.Schema.Type<typeof State>;

export const initialState: State = {
  version: STATE_VERSION,
  active_modes: [],
  in_progress: null,
};

export const decodeState = Schema.decodeUnknown(State);
export const decodeStateSync = Schema.decodeUnknownSync(State);
export const encodeState = Schema.encode(State);
