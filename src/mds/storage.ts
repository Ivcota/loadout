import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Data, Effect } from "effect";
import writeFileAtomic from "write-file-atomic";

export const BASELINE_MODE = "baseline";

export class MdsIOError extends Data.TaggedError("MdsIOError")<{
  readonly path: string;
  readonly op: "read" | "write" | "delete" | "list";
  readonly cause: unknown;
}> {}

export interface MdsPaths {
  readonly root: string;
  readonly modeDir: (mode: string) => string;
  readonly modeFile: (mode: string, harness: string) => string;
}

export const mdsPathsFor = (loadoutRoot: string): MdsPaths => {
  const root = path.join(loadoutRoot, "mds");
  return {
    root,
    modeDir: (mode) => path.join(root, mode),
    modeFile: (mode, harness) => path.join(root, mode, `${harness}.md`),
  };
};

export const readModeMd = (
  loadoutRoot: string,
  mode: string,
  harness: string,
): Effect.Effect<string | null, MdsIOError> => {
  const filePath = mdsPathsFor(loadoutRoot).modeFile(mode, harness);
  return Effect.tryPromise({
    try: async () => {
      try {
        return await fs.readFile(filePath, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    catch: (cause) => new MdsIOError({ path: filePath, op: "read", cause }),
  });
};

export const writeModeMd = (
  loadoutRoot: string,
  mode: string,
  harness: string,
  content: string,
): Effect.Effect<void, MdsIOError> => {
  const paths = mdsPathsFor(loadoutRoot);
  const dir = paths.modeDir(mode);
  const filePath = paths.modeFile(mode, harness);
  return Effect.tryPromise({
    try: async () => {
      await fs.mkdir(dir, { recursive: true });
      await writeFileAtomic(filePath, content);
    },
    catch: (cause) => new MdsIOError({ path: filePath, op: "write", cause }),
  });
};

export const deleteModeMd = (
  loadoutRoot: string,
  mode: string,
  harness: string,
): Effect.Effect<void, MdsIOError> => {
  const filePath = mdsPathsFor(loadoutRoot).modeFile(mode, harness);
  return Effect.tryPromise({
    try: async () => {
      await fs.rm(filePath, { force: true });
    },
    catch: (cause) => new MdsIOError({ path: filePath, op: "delete", cause }),
  });
};

export const listHarnessesForMode = (
  loadoutRoot: string,
  mode: string,
): Effect.Effect<string[], MdsIOError> => {
  const dir = mdsPathsFor(loadoutRoot).modeDir(mode);
  return Effect.tryPromise({
    try: async () => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      return entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name.replace(/\.md$/, ""));
    },
    catch: (cause) => new MdsIOError({ path: dir, op: "list", cause }),
  });
};
