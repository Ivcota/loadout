import * as os from "node:os";
import * as path from "node:path";
import {
  DirectoryAdapter,
  type DirectoryAdapterOptions,
} from "../DirectoryAdapter.js";

export const CLAUDE_HARNESS_NAME = "claude";

export interface ClaudeAdapterOptions extends DirectoryAdapterOptions {
  readonly home?: string;
  readonly activeDir?: string;
  readonly poolDir?: string;
}

export const defaultClaudeActiveDir = (home: string = os.homedir()): string =>
  path.join(home, ".claude", "skills");

export const defaultClaudePoolDir = (home: string = os.homedir()): string =>
  path.join(home, ".loadout", "pool", CLAUDE_HARNESS_NAME);

export const createClaudeAdapter = (
  opts: ClaudeAdapterOptions = {},
): DirectoryAdapter => {
  const home = opts.home ?? os.homedir();
  const activeDir = opts.activeDir ?? defaultClaudeActiveDir(home);
  const poolDir = opts.poolDir ?? defaultClaudePoolDir(home);
  const { renameFn } = opts;
  return new DirectoryAdapter(
    CLAUDE_HARNESS_NAME,
    activeDir,
    poolDir,
    renameFn ? { renameFn } : {},
  );
};
