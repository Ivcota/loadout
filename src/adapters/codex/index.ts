import * as os from "node:os";
import * as path from "node:path";
import {
  DirectoryAdapter,
  type DirectoryAdapterOptions,
} from "../DirectoryAdapter.js";

export const CODEX_HARNESS_NAME = "codex";

export interface CodexAdapterOptions extends DirectoryAdapterOptions {
  readonly home?: string;
  readonly activeDir?: string;
  readonly poolDir?: string;
}

export const defaultCodexActiveDir = (home: string = os.homedir()): string =>
  path.join(home, ".codex", "skills");

export const defaultCodexPoolDir = (home: string = os.homedir()): string =>
  path.join(home, ".loadout", "pool", CODEX_HARNESS_NAME);

export const defaultCodexInstructionFile = (
  home: string = os.homedir(),
): string => path.join(home, ".codex", "AGENTS.md");

export const createCodexAdapter = (
  opts: CodexAdapterOptions = {},
): DirectoryAdapter => {
  const home = opts.home ?? os.homedir();
  const activeDir = opts.activeDir ?? defaultCodexActiveDir(home);
  const poolDir = opts.poolDir ?? defaultCodexPoolDir(home);
  const instructionFilePath =
    opts.instructionFilePath !== undefined
      ? opts.instructionFilePath
      : defaultCodexInstructionFile(home);
  const { renameFn } = opts;
  return new DirectoryAdapter(CODEX_HARNESS_NAME, activeDir, poolDir, {
    instructionFilePath,
    ...(renameFn ? { renameFn } : {}),
  });
};
