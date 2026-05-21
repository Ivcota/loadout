import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const packageJsonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json",
);

const readPackageVersion = (): string => {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
};

export const VERSION = readPackageVersion();

export * from "./adapters/DirectoryAdapter.js";
export * from "./adapters/HarnessAdapter.js";
export * from "./adapters/agents/index.js";
export * from "./adapters/claude/index.js";
export * from "./adapters/codex/index.js";
export * from "./assets.js";
export * from "./manifest/errors.js";
export * from "./manifest/schema.js";
export * from "./paths.js";
export * from "./state/errors.js";
export * from "./state/schema.js";
export * as ManifestLoader from "./manifest/loader.js";
export * as StateManager from "./state/manager.js";
export * as SwapEngine from "./swap/engine.js";
