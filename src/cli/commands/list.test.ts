import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { loadoutHome } from "../../paths.js";
import { init } from "./init.js";
import { list, renderList } from "./list.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-list-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const seedActive = async (homeRoot: string, skills: string[]): Promise<void> => {
  for (const s of skills) {
    await fs.mkdir(path.join(homeRoot, ".claude/skills", s), { recursive: true });
  }
};

describe("list command", () => {
  it("returns empty entries when manifest is missing", async () => {
    const paths = loadoutHome({ home: tmpHome });
    const report = await run(list({ paths }));
    expect(report.entries).toEqual([]);
    expect(renderList(report)).toContain("no modes defined");
  });

  it("lists init-seeded default mode as active", async () => {
    await seedActive(tmpHome, ["qa", "review"]);
    const paths = loadoutHome({ home: tmpHome });
    await run(
      init({ paths, adapters: [createClaudeAdapter({ home: tmpHome })] }),
    );
    const report = await run(list({ paths }));
    expect(report.entries).toEqual([
      { name: "default", skillCount: 2, active: true },
    ]);
    const rendered = renderList(report);
    expect(rendered).toContain("modes (1)");
    expect(rendered).toContain("* default");
  });

  it("lists multiple modes alphabetically with active markers", async () => {
    const paths = loadoutHome({ home: tmpHome });
    await fs.mkdir(paths.root, { recursive: true });
    await fs.writeFile(
      paths.manifest.manifestFile,
      [
        "version: 1",
        "modes:",
        "  product:",
        "    skills: [office-hours, plan-ceo-review]",
        "  default:",
        "    skills: [qa, review, ship]",
        "  research:",
        "    skills: [investigate]",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      paths.state.stateFile,
      JSON.stringify({
        version: 1,
        active_modes: ["default", "research"],
        in_progress: null,
      }),
    );
    const report = await run(list({ paths }));
    expect(report.entries.map((e) => e.name)).toEqual([
      "default",
      "product",
      "research",
    ]);
    expect(report.entries.find((e) => e.name === "product")?.active).toBe(false);
    expect(report.entries.find((e) => e.name === "research")?.active).toBe(true);
    const rendered = renderList(report);
    expect(rendered).toContain("* default ");
    expect(rendered).toContain("  product ");
    expect(rendered).toContain("* research ");
    expect(rendered).toContain("3 skills");
    expect(rendered).toContain("1 skill");
  });

  it("flags active_modes that are not in modes.yaml as orphans", async () => {
    const paths = loadoutHome({ home: tmpHome });
    await fs.mkdir(paths.root, { recursive: true });
    await fs.writeFile(
      paths.manifest.manifestFile,
      "version: 1\nmodes:\n  default:\n    skills: []\n",
    );
    await fs.writeFile(
      paths.state.stateFile,
      JSON.stringify({
        version: 1,
        active_modes: ["default", "ghost"],
        in_progress: null,
      }),
    );
    const report = await run(list({ paths }));
    const rendered = renderList(report);
    expect(rendered).toContain("active modes not defined in modes.yaml: ghost");
  });
});
