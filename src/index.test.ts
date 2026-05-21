import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as loadout from "./index.js";

const packageJson = JSON.parse(
  fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf8",
  ),
) as { version: string };

describe("loadout package", () => {
  it("exports the package version", () => {
    expect(loadout.VERSION).toBe(packageJson.version);
  });

  it("exports the public API", () => {
    expect(loadout.createClaudeAdapter).toBeTypeOf("function");
    expect(loadout.createCodexAdapter).toBeTypeOf("function");
    expect(loadout.createAgentsAdapter).toBeTypeOf("function");
    expect(loadout.loadoutHome).toBeTypeOf("function");
    expect(loadout.ManifestLoader.load).toBeTypeOf("function");
    expect(loadout.StateManager.load).toBeTypeOf("function");
    expect(loadout.SwapEngine.plan).toBeTypeOf("function");
  });
});
