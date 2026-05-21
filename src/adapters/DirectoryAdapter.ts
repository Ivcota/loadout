import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect } from "effect";
import fsExtra from "fs-extra";
import {
  AdapterError,
  type HarnessAdapter,
  type HarnessSnapshot,
} from "./HarnessAdapter.js";
import type { PlannedMove } from "../state/schema.js";

const listDirs = async (dir: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
};

// Skills loadout manages itself. Hidden from snapshot so they're never swept
// into modes, swapped into the pool, flagged by doctor, or moved by uninstall.
// The skill files are written into active dirs by `init` and removed by
// `uninstall`, never participating in normal swap planning.
export const RESERVED_SKILLS: ReadonlySet<string> = new Set(["loadout"]);

export const isReservedSkill = (name: string): boolean =>
  RESERVED_SKILLS.has(name);

const causeOf = (err: unknown): AdapterError["cause"] => {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case "EXDEV":
    case "EACCES":
    case "ENOENT":
      return code;
    case "EEXIST":
      return "EXISTS";
    default:
      return "unknown";
  }
};

export interface DirectoryAdapterOptions {
  readonly renameFn?: (src: string, dest: string) => Promise<void>;
}

export class DirectoryAdapter implements HarnessAdapter {
  private readonly renameFn: (src: string, dest: string) => Promise<void>;

  constructor(
    public readonly name: string,
    public readonly activeDir: string,
    public readonly poolDir: string,
    opts: DirectoryAdapterOptions = {},
  ) {
    this.renameFn = opts.renameFn ?? fs.rename;
  }

  snapshot(): Effect.Effect<HarnessSnapshot, AdapterError> {
    return Effect.tryPromise({
      try: async () => {
        const [active, pool] = await Promise.all([
          listDirs(this.activeDir),
          listDirs(this.poolDir),
        ]);
        const visible = (xs: string[]): Set<string> =>
          new Set(xs.filter((s) => !RESERVED_SKILLS.has(s)));
        return {
          name: this.name,
          activeDir: this.activeDir,
          poolDir: this.poolDir,
          active: visible(active),
          pool: visible(pool),
        } satisfies HarnessSnapshot;
      },
      catch: (cause) =>
        new AdapterError({
          harness: this.name,
          skill: "*",
          op: "activate",
          cause: causeOf(cause),
          message: `failed to snapshot ${this.name}: ${String(cause)}`,
          source: cause,
        }),
    });
  }

  apply(move: PlannedMove): Effect.Effect<void, AdapterError> {
    return Effect.tryPromise({
      try: async () => {
        await fs.mkdir(path.dirname(move.dest_path), { recursive: true });
        try {
          await this.renameFn(move.source_path, move.dest_path);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EXDEV") {
            await fsExtra.move(move.source_path, move.dest_path, { overwrite: false });
          } else {
            throw err;
          }
        }
      },
      catch: (cause) =>
        new AdapterError({
          harness: this.name,
          skill: move.skill,
          op: move.op,
          cause: causeOf(cause),
          message: `failed to ${move.op} ${move.skill} in ${this.name}: ${String(cause)}`,
          source: cause,
        }),
    });
  }

  invert(move: PlannedMove): PlannedMove {
    return {
      harness: move.harness,
      skill: move.skill,
      op: move.op === "activate" ? "deactivate" : "activate",
      source_path: move.dest_path,
      dest_path: move.source_path,
    };
  }
}
