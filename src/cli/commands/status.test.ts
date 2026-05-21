import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { createCodexAdapter } from "../../adapters/codex/index.js";
import { loadoutHome } from "../../paths.js";
import { init } from "./init.js";
import { renderStatus, status } from "./status.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-status-"));
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

describe("status command", () => {
  it("returns empty state on a fresh tree", async () => {
    const input = mkInput();
    const report = await run(status(input));
    expect(report.state.active_modes).toEqual([]);
    expect(report.inProgress).toBeNull();
    expect(report.harnesses.map((h) => h.name)).toEqual(["claude", "codex"]);
    expect(report.harnesses.every((h) => h.activeCount === 0)).toBe(true);
  });

  it("reflects init-seeded state and counts active skills", async () => {
    await seedActive(tmpHome, "claude", ["qa", "review"]);
    await seedActive(tmpHome, "codex", ["noah-kagan"]);
    const input = mkInput();
    await run(init(input));
    const report = await run(status(input));
    expect(report.state.active_modes).toEqual(["default"]);
    const claude = report.harnesses.find((h) => h.name === "claude")!;
    const codex = report.harnesses.find((h) => h.name === "codex")!;
    expect(claude.activeCount).toBe(2);
    expect(codex.activeCount).toBe(1);
    expect(report.unknownActiveModes).toEqual([]);
  });

  it("flags active_modes that are missing from modes.yaml", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const input = mkInput();
    await run(init(input));
    // User deletes the default mode from manifest but leaves state.
    await fs.writeFile(
      input.paths.manifest.manifestFile,
      "version: 1\nmodes:\n  product:\n    skills: []\n",
    );
    const report = await run(status(input));
    expect(report.unknownActiveModes).toEqual(["default"]);
  });

  it("surfaces in_progress with completed/total counts", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const input = mkInput();
    await run(init(input));
    await fs.writeFile(
      input.paths.state.stateFile,
      JSON.stringify({
        version: 1,
        active_modes: ["default"],
        in_progress: {
          op: "on",
          mode: "product",
          completed: [
            {
              harness: "claude",
              skill: "qa",
              op: "activate",
              source_path: "/p",
              dest_path: "/a",
            },
          ],
          pending: [
            {
              harness: "claude",
              skill: "review",
              op: "activate",
              source_path: "/p",
              dest_path: "/a",
            },
          ],
        },
      }),
    );
    const report = await run(status(input));
    expect(report.inProgress?.op).toBe("on");
    expect(report.inProgress?.mode).toBe("product");
    const rendered = renderStatus(report);
    expect(rendered).toContain("1/2 moves complete");
    expect(rendered).toContain("resume with: loadout on product");
  });

  it("renderStatus emits 'in_progress: none' when nothing is pending", async () => {
    const input = mkInput();
    const report = await run(status(input));
    expect(renderStatus(report)).toContain("in_progress: none");
  });
});
