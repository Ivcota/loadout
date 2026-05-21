import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentsAdapter } from "../../adapters/agents/index.js";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { createCodexAdapter } from "../../adapters/codex/index.js";
import { load as loadManifest, save as saveManifest } from "../../manifest/loader.js";
import { loadoutHome } from "../../paths.js";
import { init } from "./init.js";
import { edit, renderEdit, type TuiRenderer } from "./edit.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-edit-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const runExit = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff);

const seedActive = async (
  harness: "claude" | "codex" | "agents",
  skills: string[],
): Promise<void> => {
  const dir = path.join(
    tmpHome,
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

const fakeRenderer = (next: Set<string>, saved = true): TuiRenderer =>
  async () => ({ saved, selected: next });

describe("loadout edit", () => {
  it("returns rows from the union of all harness pools + active dirs", async () => {
    await seedActive("claude", ["alpha", "beta"]);
    await seedActive("codex", ["gamma"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: { product: { skills: ["alpha"] } },
    }));

    let observed: ReadonlyArray<string> = [];
    const renderer: TuiRenderer = async (input) => {
      observed = input.rows.map((r) => r.name);
      return { saved: false, selected: new Set(input.modeSkills) };
    };
    await run(edit({ ...deps, mode: "product", renderer }));
    expect(observed).toContain("alpha");
    expect(observed).toContain("beta");
    expect(observed).toContain("gamma");
  });

  it("includes mode skills that are not on disk as orphan rows", async () => {
    await seedActive("claude", ["alpha"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: { product: { skills: ["alpha", "ghost"] } },
    }));

    let orphanFlag = false;
    const renderer: TuiRenderer = async (input) => {
      const ghost = input.rows.find((r) => r.name === "ghost");
      orphanFlag = ghost?.orphan === true;
      return { saved: false, selected: new Set(input.modeSkills) };
    };
    await run(edit({ ...deps, mode: "product", renderer }));
    expect(orphanFlag).toBe(true);
  });

  it("persists selection on save and reports +/- diff", async () => {
    await seedActive("claude", ["alpha", "beta", "gamma"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: { product: { skills: ["alpha"] } },
    }));

    const report = await run(
      edit({
        ...deps,
        mode: "product",
        renderer: fakeRenderer(new Set(["beta", "gamma"])),
      }),
    );

    expect(report.saved).toBe(true);
    expect(report.added).toEqual(["beta", "gamma"]);
    expect(report.removed).toEqual(["alpha"]);
    expect(report.after).toEqual(["beta", "gamma"]);

    const reloaded = await run(loadManifest(deps.paths.manifest));
    expect(reloaded.modes["product"]?.skills).toEqual(["beta", "gamma"]);
  });

  it("does not write manifest when nothing changed", async () => {
    await seedActive("claude", ["alpha", "beta"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: { product: { skills: ["alpha", "beta"] } },
    }));

    const before = await fs.stat(deps.paths.manifest.manifestFile);
    await new Promise((r) => setTimeout(r, 10));
    const report = await run(
      edit({
        ...deps,
        mode: "product",
        renderer: fakeRenderer(new Set(["alpha", "beta"])),
      }),
    );
    const after = await fs.stat(deps.paths.manifest.manifestFile);

    expect(report.noop).toBe(true);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("does not write manifest when the user cancels", async () => {
    await seedActive("claude", ["alpha", "beta"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: { product: { skills: ["alpha"] } },
    }));

    const before = await fs.readFile(deps.paths.manifest.manifestFile, "utf8");
    const report = await run(
      edit({
        ...deps,
        mode: "product",
        renderer: fakeRenderer(new Set(["beta"]), false),
      }),
    );
    const after = await fs.readFile(deps.paths.manifest.manifestFile, "utf8");

    expect(report.saved).toBe(false);
    expect(after).toBe(before);
  });

  it("fails with ManifestModeNotFound when the mode is missing", async () => {
    await seedActive("claude", ["alpha"]);
    const deps = mkDeps();
    await run(init(deps));
    const exit = await runExit(
      edit({
        ...deps,
        mode: "nope",
        renderer: fakeRenderer(new Set()),
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const j = JSON.stringify(exit.cause.toJSON());
      expect(j).toContain("ManifestModeNotFound");
    }
  });

  it("renderEdit formats save / cancel / noop", () => {
    expect(
      renderEdit({
        mode: "product",
        saved: false,
        before: ["a"],
        after: ["a"],
        added: [],
        removed: [],
        noop: true,
      }),
    ).toContain("cancelled");
    expect(
      renderEdit({
        mode: "product",
        saved: true,
        before: ["a"],
        after: ["a"],
        added: [],
        removed: [],
        noop: true,
      }),
    ).toContain("unchanged");
    const saved = renderEdit({
      mode: "product",
      saved: true,
      before: ["a"],
      after: ["b", "c"],
      added: ["b", "c"],
      removed: ["a"],
      noop: false,
    });
    expect(saved).toContain("+2 -1");
    expect(saved).toContain("+ b, c");
    expect(saved).toContain("- a");
  });
});
