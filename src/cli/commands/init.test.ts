import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { createCodexAdapter } from "../../adapters/codex/index.js";
import { loadoutHome } from "../../paths.js";
import { init } from "./init.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-init-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const seedActive = async (
  homeRoot: string,
  harness: "claude" | "codex",
  skills: string[],
): Promise<void> => {
  const dir = path.join(
    homeRoot,
    harness === "claude" ? ".claude" : ".agents",
    "skills",
  );
  for (const s of skills) {
    await fs.mkdir(path.join(dir, s), { recursive: true });
  }
};

const mkInput = () => {
  const paths = loadoutHome({ home: tmpHome });
  const adapters = [
    createClaudeAdapter({ home: tmpHome }),
    createCodexAdapter({ home: tmpHome }),
  ];
  return { paths, adapters };
};

describe("init command", () => {
  it("creates modes.yaml + state.json on a fresh install, no files move", async () => {
    await seedActive(tmpHome, "claude", ["qa", "review"]);
    await seedActive(tmpHome, "codex", ["noah-kagan"]);
    const input = mkInput();
    const report = await run(init(input));

    expect(report.manifestWritten).toBe(true);
    expect(report.stateWritten).toBe(true);
    expect(report.manifest.modes["default"]?.skills.sort()).toEqual(
      ["noah-kagan", "qa", "review"],
    );
    expect(report.state.active_modes).toEqual(["default"]);

    // Files in active dirs are still there — init must not move anything.
    expect(
      (await fs.stat(path.join(tmpHome, ".claude/skills/qa"))).isDirectory(),
    ).toBe(true);
    expect(
      (await fs.stat(path.join(tmpHome, ".agents/skills/noah-kagan"))).isDirectory(),
    ).toBe(true);

    // Pool dirs are NOT created by init — first move (on/off/use) creates them.
    await expect(fs.access(path.join(tmpHome, ".loadout/pool"))).rejects.toThrow();
  });

  it("is idempotent: second run leaves modes.yaml and state.json untouched", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const input = mkInput();
    await run(init(input));

    // User customizes the manifest between runs.
    const manifestPath = input.paths.manifest.manifestFile;
    await fs.writeFile(
      manifestPath,
      "version: 1\nmodes:\n  default:\n    skills: [custom]\n  product:\n    skills: [office-hours]\n",
    );
    const before = await fs.readFile(manifestPath, "utf8");

    const report2 = await run(init(input));
    expect(report2.manifestWritten).toBe(false);
    expect(report2.stateWritten).toBe(false);
    const after = await fs.readFile(manifestPath, "utf8");
    expect(after).toBe(before);
    expect(report2.manifest.modes["product"]?.skills).toEqual(["office-hours"]);
  });

  it("handles zero discovered skills on fresh install", async () => {
    const input = mkInput();
    const report = await run(init(input));
    expect(report.manifestWritten).toBe(true);
    expect(report.manifest.modes["default"]?.skills).toEqual([]);
    expect(report.state.active_modes).toEqual(["default"]);
  });

  it("does not overwrite an existing state.json with active_modes set", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const input = mkInput();
    await run(init(input));
    // Simulate user switching modes.
    await fs.writeFile(
      input.paths.state.stateFile,
      JSON.stringify({
        version: 1,
        active_modes: ["product"],
        in_progress: null,
      }),
    );
    const report = await run(init(input));
    expect(report.stateWritten).toBe(false);
    expect(report.state.active_modes).toEqual(["product"]);
  });

  it("installs the bundled 'loadout' skill into each adapter's active dir, but never adds it to the default mode", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const input = mkInput();
    const report = await run(init(input));

    // Skill copied into both harnesses' active dirs.
    expect(
      (await fs.stat(path.join(tmpHome, ".claude/skills/loadout/SKILL.md"))).isFile(),
    ).toBe(true);
    expect(
      (await fs.stat(path.join(tmpHome, ".agents/skills/loadout/SKILL.md"))).isFile(),
    ).toBe(true);

    // Default mode must NOT include the reserved skill name.
    expect(report.manifest.modes["default"]?.skills).not.toContain("loadout");

    // Report surface mentions installation for each harness.
    expect(report.reservedInstalled.map((r) => r.harness).sort()).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("dedupes skills present in both harnesses for the default mode", async () => {
    await seedActive(tmpHome, "claude", ["qa", "shared"]);
    await seedActive(tmpHome, "codex", ["shared", "noah-kagan"]);
    const input = mkInput();
    const report = await run(init(input));
    expect(report.manifest.modes["default"]?.skills).toEqual([
      "noah-kagan",
      "qa",
      "shared",
    ]);
  });
});
