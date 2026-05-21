import { Schema } from "effect";

export const MANIFEST_VERSION = 1 as const;

export const Mode = Schema.Struct({
  skills: Schema.Array(Schema.String),
});
export type Mode = Schema.Schema.Type<typeof Mode>;

export const ModesManifest = Schema.Struct({
  version: Schema.Literal(MANIFEST_VERSION),
  modes: Schema.Record({ key: Schema.String, value: Mode }),
});
export type ModesManifest = Schema.Schema.Type<typeof ModesManifest>;

export const decodeManifestSync = Schema.decodeUnknownSync(ModesManifest);
