import { Data } from "effect";

export class ManifestParseError extends Data.TaggedError("ManifestParseError")<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ManifestVersionError extends Data.TaggedError("ManifestVersionError")<{
  readonly path: string;
  readonly found: unknown;
  readonly expected: number;
}> {}

export class ManifestIOError extends Data.TaggedError("ManifestIOError")<{
  readonly path: string;
  readonly op: "read" | "write";
  readonly cause: unknown;
}> {}
