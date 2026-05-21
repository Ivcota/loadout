import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentsAdapter } from "../../adapters/agents/index.js";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { createCodexAdapter } from "../../adapters/codex/index.js";
import {
  load as loadManifest,
  save as saveManifest,
} from "../../manifest/loader.js";
import { loadoutHome } from "../../paths.js";
import { init } from "./init.js";
import { renderSave, save } from "./save.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-save-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const runExit = <A, E>(
  eff: Effect.Effect<A, E>,
): Promise<Exit.Exit<A, E>> => Effect.runPromiseExit(eff);

const seedActive = async (
  homeRoot: string,
  harness: "claude" | "codex" | "agents",
  skills: string[],
): Promise<void> => {
  const dir = path.join(
    homeRoot,
    harness === "claude" ? ".claude" : harness === "codex" ? ".codex" : ".agents",
    "skills",
  );
  for (const s of skills) {
    await fs.mkdir(path.join(dir, s), { recursive: true });
  }
};

const mkDeps = () => {
  const paths = loadoutHome({ home: tmpHome });
  const adapters = [
    createClaudeAdapter({ home: tmpHome }),
    createCodexAdapter({ home: tmpHome }),
    createAgentsAdapter({ home: tmpHome }),
  ];
  return { paths, adapters };
};

describe("loadout save <mode>", () => {
  it("snapshots the union of active skills across harnesses into a new mode", async () => {
    await seedActive(tmpHome, "claude", ["qa", "review"]);
    await seedActive(tmpHome, "codex", ["review", "ship"]);
    await seedActive(tmpHome, "agents", ["review", "shared"]);
    const deps = mkDeps();
    await run(init(deps));

    const report = await run(save({ ...deps, mode: "snapshot" }));
    expect(report.overwrote).toBe(false);
    expect(report.skills).toEqual(["qa", "review", "shared", "ship"]);
    expect(report.perHarness).toEqual([
      { harness: "claude", count: 2 },
      { harness: "codex", count: 2 },
      { harness: "agents", count: 2 },
    ]);

    const reloaded = await run(loadManifest(deps.paths.manifest));
    expect(reloaded.modes["snapshot"]?.skills).toEqual([
      "qa",
      "review",
      "shared",
      "ship",
    ]);
  });

  it("refuses to overwrite an existing mode by default", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));

    const exit = await runExit(save({ ...deps, mode: "default" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const j = JSON.stringify(exit.cause.toJSON());
      expect(j).toContain("SaveModeExists");
    }
  });

  it("overwrites an existing mode with --force", async () => {
    await seedActive(tmpHome, "claude", ["qa", "ship"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(
      saveManifest(deps.paths.manifest, {
        version: 1,
        modes: { default: { skills: ["qa", "ship"] }, snapshot: { skills: ["old"] } },
      }),
    );

    const report = await run(save({ ...deps, mode: "snapshot", force: true }));
    expect(report.overwrote).toBe(true);
    expect(report.skills).toEqual(["qa", "ship"]);

    const reloaded = await run(loadManifest(deps.paths.manifest));
    expect(reloaded.modes["snapshot"]?.skills).toEqual(["qa", "ship"]);
  });

  it("fails when there are no active skills to capture", async () => {
    const deps = mkDeps();
    await run(init(deps));

    const exit = await runExit(save({ ...deps, mode: "snapshot" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const j = JSON.stringify(exit.cause.toJSON());
      expect(j).toContain("SaveEmpty");
    }
  });

  it("renders a human-readable summary", () => {
    const out = renderSave({
      mode: "snapshot",
      skills: ["qa", "review"],
      overwrote: false,
      perHarness: [
        { harness: "claude", count: 2 },
        { harness: "codex", count: 1 },
      ],
      before: { version: 1, modes: {} },
      after: { version: 1, modes: { snapshot: { skills: ["qa", "review"] } } },
    });
    expect(out).toContain("created mode 'snapshot' (2 skill(s))");
    expect(out).toContain("claude: 2 active");
    expect(out).toContain("loadout use snapshot");
  });
});
