import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentsAdapter } from "../../adapters/agents/index.js";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { createCodexAdapter } from "../../adapters/codex/index.js";
import { save as saveManifest } from "../../manifest/loader.js";
import { loadoutHome } from "../../paths.js";
import { load as loadState, save as saveState } from "../../state/manager.js";
import { doctor, doctorFix, renderDoctorFix } from "./doctor.js";
import { init } from "./init.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-doctor-fix-"));
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

const exists = async (p: string): Promise<boolean> =>
  fs.access(p).then(() => true).catch(() => false);

const mkDeps = () => {
  const paths = loadoutHome({ home: tmpHome });
  const adapters = [
    createClaudeAdapter({ home: tmpHome }),
    createCodexAdapter({ home: tmpHome }),
    createAgentsAdapter({ home: tmpHome }),
  ];
  return { paths, adapters };
};

describe("doctor --fix", () => {
  it("activates a missing-active-skill by moving pool → active", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    await seedPool(tmpHome, "claude", ["review"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(
      saveManifest(deps.paths.manifest, {
        version: 1,
        modes: { default: { skills: ["qa", "review"] } },
      }),
    );

    const report = await run(doctorFix(deps));
    expect(report.actions.some((a) => a.kind === "activate-missing")).toBe(true);
    expect(
      await exists(path.join(tmpHome, ".claude/skills/review")),
    ).toBe(true);
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/review")),
    ).toBe(false);
    expect(report.after.issues.find((i) => i.kind === "missing-active-skill")).toBeUndefined();
  });

  it("drops unknown-active-mode entries from state.active_modes", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(
      saveState(deps.paths.state, {
        version: 1,
        active_modes: ["default", "ghost"],
        in_progress: null,
      }),
    );

    const report = await run(doctorFix(deps));
    expect(report.actions.some((a) => a.kind === "drop-unknown-mode")).toBe(true);
    const reloaded = await run(loadState(deps.paths.state));
    expect(reloaded.active_modes).toEqual(["default"]);
  });

  it("clears a stale lockfile dir", async () => {
    const deps = mkDeps();
    await run(init(deps));
    const lockDir = `${deps.paths.state.lockFile}.lock`;
    await fs.mkdir(lockDir, { recursive: true });
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lockDir, old, old);

    const before = await run(doctor(deps));
    expect(before.issues.find((i) => i.kind === "stale-lock")).toBeDefined();

    const report = await run(doctorFix(deps));
    expect(report.actions.some((a) => a.kind === "clear-stale-lock")).toBe(true);
    expect(await exists(lockDir)).toBe(false);
  });

  it("does not auto-fix unknown-skill or orphan-pool-skill (kept in skipped)", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    await seedPool(tmpHome, "claude", ["abandoned"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(
      saveManifest(deps.paths.manifest, {
        version: 1,
        modes: { default: { skills: ["qa", "phantom"] } },
      }),
    );

    const report = await run(doctorFix(deps));
    const skippedKinds = report.skipped.map((i) => i.kind).sort();
    expect(skippedKinds).toEqual(["orphan-pool-skill", "unknown-skill"]);
  });

  it("does not auto-fix managed hook commands", async () => {
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

    const report = await run(doctorFix(deps));
    expect(report.actions).toEqual([]);
    expect(report.skipped.map((i) => i.kind)).toEqual(["managed-hook-command"]);
  });

  it("dry-run reports planned actions without making changes", async () => {
    await seedActive(tmpHome, "claude", ["qa"]);
    await seedPool(tmpHome, "claude", ["review"]);
    const deps = mkDeps();
    await run(init(deps));
    await run(
      saveManifest(deps.paths.manifest, {
        version: 1,
        modes: { default: { skills: ["qa", "review"] } },
      }),
    );

    const report = await run(doctorFix({ ...deps, dryRun: true }));
    expect(report.dryRun).toBe(true);
    expect(report.actions.some((a) => a.kind === "activate-missing")).toBe(true);
    // Pool still has it — no files moved.
    expect(
      await exists(path.join(tmpHome, ".loadout/pool/claude/review")),
    ).toBe(true);
  });

  it("renders a fix summary", () => {
    const out = renderDoctorFix({
      before: {
        root: "/tmp/loadout",
        state: { version: 1, active_modes: [], in_progress: null },
        manifest: { version: 1, modes: {} },
        harnesses: [],
        issues: [],
      },
      after: {
        root: "/tmp/loadout",
        state: { version: 1, active_modes: [], in_progress: null },
        manifest: { version: 1, modes: {} },
        harnesses: [],
        issues: [],
      },
      actions: [
        { kind: "activate-missing", detail: "review (claude)" },
        { kind: "drop-unknown-mode", detail: "ghost" },
      ],
      skipped: [],
      dryRun: false,
    });
    expect(out).toContain("did activate review (claude)");
    expect(out).toContain("did drop unknown active mode 'ghost'");
    expect(out).toContain("remaining: 0 issue(s)");
  });
});
