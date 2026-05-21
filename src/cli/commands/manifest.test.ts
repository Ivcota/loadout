import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { createCodexAdapter } from "../../adapters/codex/index.js";
import { load as loadManifest, save as saveManifest } from "../../manifest/loader.js";
import { loadoutHome } from "../../paths.js";
import { save as saveState } from "../../state/manager.js";
import { init } from "./init.js";
import {
  addSkill,
  deleteMode,
  newMode,
  renderManifestEdit,
  rmSkill,
} from "./manifest.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-manifest-"));
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

const mkDeps = () => {
  const paths = loadoutHome({ home: tmpHome });
  const adapters = [
    createClaudeAdapter({ home: tmpHome }),
    createCodexAdapter({ home: tmpHome }),
  ];
  return { paths, adapters };
};

describe("manifest editors", () => {
  describe("new <mode>", () => {
    it("creates an empty mode in modes.yaml", async () => {
      await seedActive(tmpHome, "claude", ["qa"]);
      const deps = mkDeps();
      await run(init(deps));

      const report = await run(newMode({ paths: deps.paths, mode: "product" }));
      expect(report.op).toBe("new");
      expect(report.noop).toBe(false);
      expect(report.after.modes["product"]).toEqual({ skills: [] });

      const reloaded = await run(loadManifest(deps.paths.manifest));
      expect(reloaded.modes["product"]).toEqual({ skills: [] });
    });

    it("refuses to overwrite an existing mode", async () => {
      await seedActive(tmpHome, "claude", ["qa"]);
      const deps = mkDeps();
      await run(init(deps));

      const exit = await runExit(newMode({ paths: deps.paths, mode: "default" }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const j = JSON.stringify(exit.cause.toJSON());
        expect(j).toContain("ManifestModeAlreadyExists");
      }
    });
  });

  describe("delete <mode>", () => {
    it("removes an inactive mode from modes.yaml", async () => {
      await seedActive(tmpHome, "claude", ["qa"]);
      const deps = mkDeps();
      await run(init(deps));
      await run(saveManifest(deps.paths.manifest, {
        version: 1,
        modes: {
          default: { skills: ["qa"] },
          throwaway: { skills: [] },
        },
      }));

      const report = await run(
        deleteMode({ paths: deps.paths, mode: "throwaway" }),
      );
      expect(report.op).toBe("delete");
      expect("throwaway" in report.after.modes).toBe(false);

      const reloaded = await run(loadManifest(deps.paths.manifest));
      expect("throwaway" in reloaded.modes).toBe(false);
    });

    it("refuses to delete a mode that is currently active", async () => {
      await seedActive(tmpHome, "claude", ["qa"]);
      const deps = mkDeps();
      await run(init(deps));

      const exit = await runExit(
        deleteMode({ paths: deps.paths, mode: "default" }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const j = JSON.stringify(exit.cause.toJSON());
        expect(j).toContain("ManifestModeInUse");
      }
    });

    it("refuses to delete a mode that does not exist", async () => {
      const deps = mkDeps();
      await run(init(deps));
      const exit = await runExit(
        deleteMode({ paths: deps.paths, mode: "nope" }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const j = JSON.stringify(exit.cause.toJSON());
        expect(j).toContain("ManifestModeNotFound");
      }
    });
  });

  describe("add <mode> <skill>", () => {
    it("appends a known skill (active dir) to a mode", async () => {
      await seedActive(tmpHome, "claude", ["qa", "review"]);
      const deps = mkDeps();
      await run(init(deps));
      await run(saveManifest(deps.paths.manifest, {
        version: 1,
        modes: {
          default: { skills: ["qa"] },
          product: { skills: [] },
        },
      }));

      const report = await run(
        addSkill({ ...deps, mode: "product", skill: "review" }),
      );
      expect(report.op).toBe("add");
      expect(report.noop).toBe(false);
      expect(report.after.modes["product"]?.skills).toEqual(["review"]);
    });

    it("accepts a skill that lives only in the pool", async () => {
      const deps = mkDeps();
      await run(init(deps));
      await fs.mkdir(
        path.join(tmpHome, ".loadout/pool/claude/office-hours"),
        { recursive: true },
      );
      await run(saveManifest(deps.paths.manifest, {
        version: 1,
        modes: { product: { skills: [] } },
      }));

      const report = await run(
        addSkill({ ...deps, mode: "product", skill: "office-hours" }),
      );
      expect(report.after.modes["product"]?.skills).toEqual(["office-hours"]);
    });

    it("no-op when the skill is already in the mode", async () => {
      await seedActive(tmpHome, "claude", ["qa"]);
      const deps = mkDeps();
      await run(init(deps));

      const report = await run(
        addSkill({ ...deps, mode: "default", skill: "qa" }),
      );
      expect(report.noop).toBe(true);
      expect(report.after.modes["default"]?.skills).toEqual(["qa"]);
    });

    it("refuses an unknown skill (not in any harness pool or active dir)", async () => {
      const deps = mkDeps();
      await run(init(deps));
      const exit = await runExit(
        addSkill({ ...deps, mode: "default", skill: "ghost" }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const j = JSON.stringify(exit.cause.toJSON());
        expect(j).toContain("ManifestSkillNotKnown");
      }
    });

    it("refuses when the target mode does not exist", async () => {
      await seedActive(tmpHome, "claude", ["qa"]);
      const deps = mkDeps();
      await run(init(deps));
      const exit = await runExit(
        addSkill({ ...deps, mode: "missing", skill: "qa" }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const j = JSON.stringify(exit.cause.toJSON());
        expect(j).toContain("ManifestModeNotFound");
      }
    });
  });

  describe("rm <mode> <skill>", () => {
    it("removes a skill from a mode", async () => {
      await seedActive(tmpHome, "claude", ["qa", "review"]);
      const deps = mkDeps();
      await run(init(deps));

      const report = await run(
        rmSkill({ paths: deps.paths, mode: "default", skill: "qa" }),
      );
      expect(report.op).toBe("rm");
      expect(report.after.modes["default"]?.skills).toEqual(["review"]);
    });

    it("refuses when the mode does not exist", async () => {
      const deps = mkDeps();
      await run(init(deps));
      const exit = await runExit(
        rmSkill({ paths: deps.paths, mode: "nope", skill: "qa" }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const j = JSON.stringify(exit.cause.toJSON());
        expect(j).toContain("ManifestModeNotFound");
      }
    });

    it("refuses when the skill is not in the mode", async () => {
      await seedActive(tmpHome, "claude", ["qa"]);
      const deps = mkDeps();
      await run(init(deps));
      const exit = await runExit(
        rmSkill({ paths: deps.paths, mode: "default", skill: "review" }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const j = JSON.stringify(exit.cause.toJSON());
        expect(j).toContain("ManifestSkillNotInMode");
      }
    });
  });

  describe("interaction with state.json", () => {
    it("does not touch state.json on any edit", async () => {
      await seedActive(tmpHome, "claude", ["qa"]);
      const deps = mkDeps();
      await run(init(deps));
      // Hand-build state with in_progress to make sure we don't disturb it.
      await run(saveState(deps.paths.state, {
        version: 1,
        active_modes: ["default"],
        in_progress: null,
      }));
      const stateBefore = await fs.readFile(deps.paths.state.stateFile, "utf8");

      await run(newMode({ paths: deps.paths, mode: "product" }));

      const stateAfter = await fs.readFile(deps.paths.state.stateFile, "utf8");
      expect(stateAfter).toBe(stateBefore);
    });
  });
});

describe("renderManifestEdit", () => {
  const baseAfter = {
    version: 1 as const,
    modes: { product: { skills: ["a", "b"] } },
  };
  const baseBefore = {
    version: 1 as const,
    modes: { product: { skills: [] } },
  };

  it("formats new mode", () => {
    expect(
      renderManifestEdit({
        op: "new",
        mode: "product",
        skill: null,
        before: { version: 1, modes: {} },
        after: { version: 1, modes: { product: { skills: [] } } },
        noop: false,
      }),
    ).toBe("+ mode 'product' created (0 skills)");
  });

  it("formats delete", () => {
    expect(
      renderManifestEdit({
        op: "delete",
        mode: "throwaway",
        skill: null,
        before: { version: 1, modes: { throwaway: { skills: [] } } },
        after: { version: 1, modes: {} },
        noop: false,
      }),
    ).toBe("- mode 'throwaway' deleted");
  });

  it("formats add with skill count", () => {
    const out = renderManifestEdit({
      op: "add",
      mode: "product",
      skill: "b",
      before: baseBefore,
      after: baseAfter,
      noop: false,
    });
    expect(out).toContain("+ 'b' → mode 'product'");
    expect(out).toContain("2 skill(s)");
  });

  it("formats add no-op", () => {
    const out = renderManifestEdit({
      op: "add",
      mode: "product",
      skill: "a",
      before: baseAfter,
      after: baseAfter,
      noop: true,
    });
    expect(out).toContain("already in mode 'product'");
  });

  it("formats rm with skill count", () => {
    const out = renderManifestEdit({
      op: "rm",
      mode: "product",
      skill: "a",
      before: baseAfter,
      after: { version: 1, modes: { product: { skills: ["b"] } } },
      noop: false,
    });
    expect(out).toContain("- 'a' removed from mode 'product'");
    expect(out).toContain("1 skill(s)");
  });
});
