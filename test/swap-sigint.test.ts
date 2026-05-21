import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DirectoryAdapter } from "../src/adapters/DirectoryAdapter.js";
import { load, pathsFor } from "../src/state/manager.js";
import { resume } from "../src/swap/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, "sigint-worker.ts");

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-sigint-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const SKILLS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

describe("SIGINT mid-swap recovery", () => {
  it(
    "persists in_progress on SIGINT, then resume() reaches target state",
    async () => {
      const loadoutRoot = path.join(tmp, ".loadout");
      const activeDir = path.join(tmp, "active", "claude");
      const poolDir = path.join(loadoutRoot, "pool", "claude");
      await fs.mkdir(activeDir, { recursive: true });
      await fs.mkdir(poolDir, { recursive: true });
      for (const s of SKILLS) {
        await fs.mkdir(path.join(poolDir, s), { recursive: true });
        await fs.writeFile(path.join(poolDir, s, "SKILL.md"), `# ${s}\n`);
      }

      // Run worker with each move sleeping 80ms => ~800ms total. SIGINT after 250ms.
      const child = spawn(
        "node",
        ["--import", "tsx", workerPath],
        {
          env: {
            ...process.env,
            LOADOUT_ROOT: loadoutRoot,
            ACTIVE_DIR: activeDir,
            POOL_DIR: poolDir,
            MOVE_DELAY_MS: "80",
            SKILLS: SKILLS.join(","),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stderr = "";
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });

      // Wait for child to print READY (snapshot+plan done, execute starting).
      await new Promise<void>((resolveReady, rejectReady) => {
        const timer = setTimeout(
          () => rejectReady(new Error(`worker never printed READY. stderr=${stderr}`)),
          5000,
        );
        child.stdout.on("data", (d) => {
          if (d.toString().includes("READY")) {
            clearTimeout(timer);
            resolveReady();
          }
        });
      });

      // Let a few moves run, then SIGINT.
      await new Promise((r) => setTimeout(r, 250));
      child.kill("SIGINT");

      // Wait for exit.
      const exitCode: number | null = await new Promise((r) => {
        child.on("close", (code) => r(code));
      });
      // Killed by signal => exit code typically null with signal SIGINT.
      // Either way, we just need to verify state.json is consistent.
      expect(exitCode === null || exitCode !== 0).toBe(true);

      const paths = pathsFor(loadoutRoot);
      const persisted = await Effect.runPromise(load(paths));
      expect(persisted.in_progress).not.toBeNull();
      expect(persisted.in_progress?.op).toBe("on");
      expect(persisted.in_progress?.mode).toBe("default");

      // Some moves should be completed; some still pending.
      const completed = persisted.in_progress?.completed ?? [];
      const pending = persisted.in_progress?.pending ?? [];
      expect(completed.length + pending.length).toBe(SKILLS.length);
      // We sent SIGINT 250ms in with 80ms/move; expect at least some progress
      // and at least one pending move (otherwise SIGINT came after the swap finished).
      expect(completed.length).toBeGreaterThan(0);
      expect(pending.length).toBeGreaterThan(0);

      // Invariant on the filesystem: every skill is in exactly one of pool/active.
      const adapter = new DirectoryAdapter("claude", activeDir, poolDir);
      const midSnap = await Effect.runPromise(adapter.snapshot());
      const union = new Set([...midSnap.active, ...midSnap.pool]);
      expect(union).toEqual(new Set(SKILLS));
      for (const s of midSnap.active) expect(midSnap.pool.has(s)).toBe(false);

      // Resume in the parent process.
      const finalState = await Effect.runPromise(
        resume(persisted, { paths, adapters: [adapter] }),
      );
      expect(finalState.in_progress).toBeNull();
      expect(finalState.active_modes).toEqual(["default"]);

      const finalSnap = await Effect.runPromise(adapter.snapshot());
      expect([...finalSnap.active].sort()).toEqual([...SKILLS].sort());
      expect([...finalSnap.pool].sort()).toEqual([]);
    },
    15_000,
  );
});
