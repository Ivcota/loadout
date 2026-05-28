import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import * as lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentsAdapter } from "../../adapters/agents/index.js";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { createCodexAdapter } from "../../adapters/codex/index.js";
import { save as saveManifest } from "../../manifest/loader.js";
import { loadoutHome } from "../../paths.js";
import { save as saveState } from "../../state/manager.js";
import { doctor, renderDoctor, type DoctorIssue } from "./doctor.js";
import { init } from "./init.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-doctor-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

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

const seedPool = async (
  homeRoot: string,
  harness: "claude" | "codex" | "agents",
  skills: string[],
): Promise<void> => {
  const dir = path.join(homeRoot, ".loadout/pool", harness);
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

const kinds = (issues: ReadonlyArray<DoctorIssue>): string[] =>
  issues.map((i) => i.kind);

describe("doctor", () => {
  it("reports no issues on a freshly-initialized loadout", async () => {
    await seedActive(tmpHome, "claude", ["qa", "review"]);
    const deps = mkDeps();
    await run(init(deps));

    const report = await run(doctor(deps));
    expect(report.issues).toEqual([]);
  });

  it("reports unknown-active-mode when state names a mode missing from modes.yaml", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveState(deps.paths.state, {
      version: 1,
      active_modes: ["default", "ghost"],
      in_progress: null,
    }));

    const report = await run(doctor(deps));
    expect(kinds(report.issues)).toContain("unknown-active-mode");
    const i = report.issues.find((x) => x.kind === "unknown-active-mode");
    expect(i && "mode" in i ? i.mode : null).toBe("ghost");
  });

  it("reports unknown-skill when a manifest mode references a skill that exists nowhere", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: { default: { skills: ["qa", "phantom"] } },
    }));

    const report = await run(doctor(deps));
    const i = report.issues.find((x) => x.kind === "unknown-skill");
    expect(i).toBeDefined();
    expect(i && "skill" in i ? i.skill : null).toBe("phantom");
  });

  it("reports orphan-pool-skill for pool items no mode references", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    await seedPool(tmpHome, "claude", ["abandoned"]);
    const deps = mkDeps();
    await run(init(deps));

    const report = await run(doctor(deps));
    const i = report.issues.find((x) => x.kind === "orphan-pool-skill");
    expect(i).toBeDefined();
    if (i && i.kind === "orphan-pool-skill") {
      expect(i.skill).toBe("abandoned");
      expect(i.harness).toBe("claude");
    }
  });

  it("reports missing-active-skill when an active mode's skill sits in pool", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    await seedPool(tmpHome, "claude", ["review"]);
    const deps = mkDeps();
    await run(init(deps));
    // init only seeds active skills into default — author a richer manifest so
    // default references review (which is pooled). Doctor should catch it.
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: { default: { skills: ["qa", "review"] } },
    }));

    const report = await run(doctor(deps));
    const i = report.issues.find((x) => x.kind === "missing-active-skill");
    expect(i).toBeDefined();
    if (i && i.kind === "missing-active-skill") {
      expect(i.mode).toBe("default");
      expect(i.skill).toBe("review");
      expect(i.harness).toBe("claude");
    }
  });

  it("reports managed-hook-command when a Codex hook points into an active skill dir", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await fs.mkdir(path.join(tmpHome, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(tmpHome, ".codex/hooks.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: path.join(
                    tmpHome,
                    ".claude/skills/gstack/bin/gstack-session-update",
                  ),
                },
              ],
            },
          ],
        },
      }),
    );

    const report = await run(doctor(deps));
    const i = report.issues.find((x) => x.kind === "managed-hook-command");
    expect(i).toBeDefined();
    if (i && i.kind === "managed-hook-command") {
      expect(i.harness).toBe("claude");
      expect(i.skill).toBe("gstack");
      expect(i.hookFile).toBe(path.join(tmpHome, ".codex/hooks.json"));
    }
  });

  it("does NOT report managed-hook-command for hooks outside managed skill dirs", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await fs.mkdir(path.join(tmpHome, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(tmpHome, ".codex/hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "/usr/bin/true" }] }],
        },
      }),
    );

    const report = await run(doctor(deps));
    expect(report.issues.find((x) => x.kind === "managed-hook-command")).toBeUndefined();
  });

  it("reports stale-lock when a .lock directory exists with no live holder", async () => {
    const deps = mkDeps();
    await run(init(deps));
    // Create an orphaned lock directory directly. proper-lockfile uses mkdir
    // for the lock; doctor's check should see no live holder and flag it.
    const lockDir = `${deps.paths.state.lockFile}.lock`;
    await fs.mkdir(lockDir, { recursive: true });
    // Backdate the mtime so ageSec > 0 (older than the 2s mtimePrecision floor).
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lockDir, old, old);

    const report = await run(doctor(deps));
    const i = report.issues.find((x) => x.kind === "stale-lock");
    expect(i).toBeDefined();
    if (i && i.kind === "stale-lock") {
      expect(i.path).toBe(lockDir);
      expect(i.ageSec).toBeGreaterThan(0);
    }

    // Cleanup: rm the dir so afterEach doesn't have to.
    await fs.rm(lockDir, { recursive: true, force: true });
  });

  it("does NOT report stale-lock when the lock is actively held", async () => {
    const deps = mkDeps();
    await run(init(deps));
    // Ensure the lock target file exists, then take a real lock.
    await fs.mkdir(path.dirname(deps.paths.state.lockFile), { recursive: true });
    await fs.writeFile(deps.paths.state.lockFile, "", { flag: "a" });
    const release = await lockfile.lock(deps.paths.state.lockFile, {
      stale: 10_000,
      retries: { retries: 0 },
    });
    try {
      const report = await run(doctor(deps));
      expect(report.issues.find((x) => x.kind === "stale-lock")).toBeUndefined();
    } finally {
      await release();
    }
  });

  it("does NOT report stale-lock when no lockfile exists", async () => {
    const deps = mkDeps();
    await run(init(deps));
    const report = await run(doctor(deps));
    expect(report.issues.find((x) => x.kind === "stale-lock")).toBeUndefined();
  });

  it("returns multiple issues stacked", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    await seedPool(tmpHome, "claude", ["abandoned"]);
    const deps = mkDeps();
    await run(init(deps));
    // Add a phantom skill to default + a ghost active mode.
    await run(saveManifest(deps.paths.manifest, {
      version: 1,
      modes: { default: { skills: ["qa", "phantom"] } },
    }));
    await run(saveState(deps.paths.state, {
      version: 1,
      active_modes: ["default", "ghost"],
      in_progress: null,
    }));

    const report = await run(doctor(deps));
    expect(kinds(report.issues).sort()).toEqual(
      ["orphan-pool-skill", "unknown-active-mode", "unknown-skill"].sort(),
    );
  });

  it("reports md-drift when the live instruction file disagrees with the recorded sha", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));

    // Materialize an MD by activating a mode that has one — emulated here by
    // writing the live file + recording state.live_mds with a stale sha.
    await fs.writeFile(path.join(tmpHome, ".claude/CLAUDE.md"), "# v2 hand-edited\n");
    await run(saveState(deps.paths.state, {
      version: 1,
      active_modes: ["default"],
      in_progress: null,
      live_mds: {
        claude: { mode: "coding", sha256: "stale-recorded-hash" },
      },
    }));
    // Also have a stored mode MD so missing-mode-md doesn't fire too.
    await fs.mkdir(path.join(tmpHome, ".loadout/mds/coding"), { recursive: true });
    await fs.writeFile(
      path.join(tmpHome, ".loadout/mds/coding/claude.md"),
      "# v1\n",
    );

    const report = await run(doctor(deps));
    expect(kinds(report.issues)).toContain("md-drift");
    const drift = report.issues.find((i) => i.kind === "md-drift");
    expect(drift && "harness" in drift ? drift.harness : null).toBe("claude");
  });

  it("reports missing-mode-md when live_mds points to a non-existent stored MD", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));

    const liveContent = "# whatever\n";
    await fs.writeFile(path.join(tmpHome, ".claude/CLAUDE.md"), liveContent);
    const { sha256 } = await import("../../mds/drift.js");
    await run(saveState(deps.paths.state, {
      version: 1,
      active_modes: ["default"],
      in_progress: null,
      live_mds: {
        claude: { mode: "phantom-mode", sha256: sha256(liveContent) },
      },
    }));

    const report = await run(doctor(deps));
    expect(kinds(report.issues)).toContain("missing-mode-md");
  });
});

describe("renderDoctor", () => {
  it("renders the clean case", () => {
    const out = renderDoctor({
      root: "/tmp/loadout",
      state: { version: 1, active_modes: [], in_progress: null },
      manifest: { version: 1, modes: {} },
      harnesses: [],
      issues: [],
    });
    expect(out).toContain("no issues found.");
  });

  it("renders each issue with a tag and summary count", () => {
    const out = renderDoctor({
      root: "/tmp/loadout",
      state: { version: 1, active_modes: ["default"], in_progress: null },
      manifest: { version: 1, modes: { default: { skills: ["qa"] } } },
      harnesses: [],
      issues: [
        { kind: "unknown-active-mode", severity: "error", mode: "ghost" },
        {
          kind: "orphan-pool-skill",
          severity: "warn",
          harness: "claude",
          skill: "abandoned",
        },
      ],
    });
    expect(out).toContain("issues (2):");
    expect(out).toContain("[E] unknown-active-mode");
    expect(out).toContain("[W] orphan-pool-skill");
    expect(out).toContain("2 issue(s): 1 error, 1 warn");
  });
});
