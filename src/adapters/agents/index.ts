import * as os from "node:os";
import * as path from "node:path";
import {
  DirectoryAdapter,
  type DirectoryAdapterOptions,
} from "../DirectoryAdapter.js";

export const AGENTS_HARNESS_NAME = "agents";

export interface AgentsAdapterOptions extends DirectoryAdapterOptions {
  readonly home?: string;
  readonly activeDir?: string;
  readonly poolDir?: string;
}

export const defaultAgentsActiveDir = (home: string = os.homedir()): string =>
  path.join(home, ".agents", "skills");

export const defaultAgentsPoolDir = (home: string = os.homedir()): string =>
  path.join(home, ".loadout", "pool", AGENTS_HARNESS_NAME);

export const createAgentsAdapter = (
  opts: AgentsAdapterOptions = {},
): DirectoryAdapter => {
  const home = opts.home ?? os.homedir();
  const activeDir = opts.activeDir ?? defaultAgentsActiveDir(home);
  const poolDir = opts.poolDir ?? defaultAgentsPoolDir(home);
  const { renameFn } = opts;
  return new DirectoryAdapter(
    AGENTS_HARNESS_NAME,
    activeDir,
    poolDir,
    renameFn ? { renameFn } : {},
  );
};
