import * as os from "node:os";
import * as path from "node:path";
import { manifestPathsFor, type ManifestPaths } from "./manifest/loader.js";
import { pathsFor, type LoadoutPaths as StatePaths } from "./state/manager.js";

export interface LoadoutHome {
  readonly home: string;
  readonly root: string;
  readonly poolRoot: string;
  readonly state: StatePaths;
  readonly manifest: ManifestPaths;
}

export const defaultLoadoutRoot = (home: string = os.homedir()): string =>
  path.join(home, ".loadout");

export const loadoutHome = (opts: { home?: string; root?: string } = {}): LoadoutHome => {
  const home = opts.home ?? os.homedir();
  const root = opts.root ?? defaultLoadoutRoot(home);
  return {
    home,
    root,
    poolRoot: path.join(root, "pool"),
    state: pathsFor(root),
    manifest: manifestPathsFor(root),
  };
};
