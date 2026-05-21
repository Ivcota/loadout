import { Data } from "effect";

export class StateParseError extends Data.TaggedError("StateParseError")<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class StateVersionError extends Data.TaggedError("StateVersionError")<{
  readonly path: string;
  readonly found: unknown;
  readonly expected: number;
}> {}

export class StateIOError extends Data.TaggedError("StateIOError")<{
  readonly path: string;
  readonly op: "read" | "write";
  readonly cause: unknown;
}> {}
