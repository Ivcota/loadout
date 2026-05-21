import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Bundled skill assets live at:
//   - dev/test: <repo>/assets/skills/<skill>/  (this file is at <repo>/src/assets.ts)
//   - built:   <repo>/dist/skills/<skill>/     (tsup publicDir copies assets/ → dist/)
const CANDIDATES = [
  path.resolve(here, "..", "assets", "skills"),
  path.resolve(here, "skills"),
];

const RESERVED_SKILL_DIR = "loadout";

export const bundledSkillsDir = (): string => {
  for (const candidate of CANDIDATES) {
    if (fs.existsSync(path.join(candidate, RESERVED_SKILL_DIR, "SKILL.md"))) {
      return candidate;
    }
  }
  throw new Error(
    `loadout: bundled skill assets not found (looked in: ${CANDIDATES.join(", ")})`,
  );
};

export const bundledReservedSkillDir = (skill: string): string =>
  path.join(bundledSkillsDir(), skill);
