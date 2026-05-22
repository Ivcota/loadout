import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentsAdapter } from "../adapters/agents/index.js";
import { createClaudeAdapter } from "../adapters/claude/index.js";
import { createCodexAdapter } from "../adapters/codex/index.js";
import { materializeInstructionFiles } from "./materialize.js";
import { sha256 } from "./drift.js";
import { BASELINE_MODE, writeModeMd } from "./storage.js";
import type { State } from "../state/schema.js";

let tmpHome: string;
let loadoutRoot: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-mds-mat-"));
  loadoutRoot = path.join(tmpHome, ".loadout");
  await fs.mkdir(loadoutRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const makeState = (
  active_modes: string[],
  live_mds: State["live_mds"] = undefined,
): State => ({
  version: 1,
  active_modes,
  in_progress: null,
  live_mds,
});

const readLive = async (filePath: string): Promise<string | null> => {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
};

describe("materializeInstructionFiles", () => {
  it("does nothing when there are no modes and no baseline", async () => {
    const claude = createClaudeAdapter({ home: tmpHome });
    const state = makeState([]);
    const result = await run(
      materializeInstructionFiles([claude], state, loadoutRoot),
    );
    expect(result.notices).toEqual([]);
    expect(result.newLiveMds).toEqual({});
    expect(await readLive(claude.instructionFilePath as string)).toBeNull();
  });

  it("materializes the baseline when no active mode has an MD", async () => {
    const claude = createClaudeAdapter({ home: tmpHome });
    await run(writeModeMd(loadoutRoot, BASELINE_MODE, "claude", "# baseline\n"));
    const state = makeState(["daily"]);
    const result = await run(
      materializeInstructionFiles([claude], state, loadoutRoot),
    );
    expect(await readLive(claude.instructionFilePath as string)).toBe(
      "# baseline\n",
    );
    expect(result.newLiveMds.claude).toEqual({
      mode: BASELINE_MODE,
      sha256: sha256("# baseline\n"),
    });
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]?.harness).toBe("claude");
  });

  it("materializes the active mode's MD when it has one", async () => {
    const claude = createClaudeAdapter({ home: tmpHome });
    await run(writeModeMd(loadoutRoot, "coding", "claude", "# coding\n"));
    const state = makeState(["coding"]);
    const result = await run(
      materializeInstructionFiles([claude], state, loadoutRoot),
    );
    expect(await readLive(claude.instructionFilePath as string)).toBe(
      "# coding\n",
    );
    expect(result.newLiveMds.claude?.mode).toBe("coding");
  });

  it("picks the most-recently-activated mode that has an MD (last-wins)", async () => {
    const claude = createClaudeAdapter({ home: tmpHome });
    await run(writeModeMd(loadoutRoot, "daily", "claude", "# daily\n"));
    await run(writeModeMd(loadoutRoot, "coding", "claude", "# coding\n"));
    const state = makeState(["daily", "coding"]);
    const result = await run(
      materializeInstructionFiles([claude], state, loadoutRoot),
    );
    expect(await readLive(claude.instructionFilePath as string)).toBe(
      "# coding\n",
    );
    expect(result.newLiveMds.claude?.mode).toBe("coding");
  });

  it("falls back to a prior active mode's MD if the most recent has none", async () => {
    const claude = createClaudeAdapter({ home: tmpHome });
    await run(writeModeMd(loadoutRoot, "daily", "claude", "# daily\n"));
    // 'coding' is active but has no claude MD
    const state = makeState(["daily", "coding"]);
    const result = await run(
      materializeInstructionFiles([claude], state, loadoutRoot),
    );
    expect(await readLive(claude.instructionFilePath as string)).toBe(
      "# daily\n",
    );
    expect(result.newLiveMds.claude?.mode).toBe("daily");
  });

  it("emits no notice when the live content already matches the recorded hash", async () => {
    const claude = createClaudeAdapter({ home: tmpHome });
    await run(writeModeMd(loadoutRoot, "coding", "claude", "# coding\n"));
    // Pre-populate the live file with the same content + record matching sha
    await fs.mkdir(path.dirname(claude.instructionFilePath as string), {
      recursive: true,
    });
    await fs.writeFile(
      claude.instructionFilePath as string,
      "# coding\n",
    );
    const state = makeState(["coding"], {
      claude: { mode: "coding", sha256: sha256("# coding\n") },
    });
    const result = await run(
      materializeInstructionFiles([claude], state, loadoutRoot),
    );
    expect(result.notices).toEqual([]);
    expect(result.newLiveMds.claude?.sha256).toBe(sha256("# coding\n"));
  });

  it("emits a notice when content changes from the recorded hash", async () => {
    const claude = createClaudeAdapter({ home: tmpHome });
    await run(writeModeMd(loadoutRoot, "coding", "claude", "# new\n"));
    await fs.mkdir(path.dirname(claude.instructionFilePath as string), {
      recursive: true,
    });
    await fs.writeFile(claude.instructionFilePath as string, "# old\n");
    const state = makeState(["coding"], {
      claude: { mode: "daily", sha256: sha256("# old\n") },
    });
    const result = await run(
      materializeInstructionFiles([claude], state, loadoutRoot),
    );
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatchObject({
      harness: "claude",
      mode: "coding",
      previous_mode: "daily",
    });
  });

  it("skips adapters that have no instruction file path (agents harness)", async () => {
    const agents = createAgentsAdapter({ home: tmpHome });
    await run(writeModeMd(loadoutRoot, "coding", "agents", "# ignored\n"));
    const state = makeState(["coding"]);
    const result = await run(
      materializeInstructionFiles([agents], state, loadoutRoot),
    );
    expect(result.notices).toEqual([]);
    expect(result.newLiveMds).toEqual({});
  });

  it("handles multiple harnesses independently", async () => {
    const claude = createClaudeAdapter({ home: tmpHome });
    const codex = createCodexAdapter({ home: tmpHome });
    await run(writeModeMd(loadoutRoot, "coding", "claude", "# claude\n"));
    await run(writeModeMd(loadoutRoot, BASELINE_MODE, "codex", "# codex baseline\n"));
    const state = makeState(["coding"]);
    const result = await run(
      materializeInstructionFiles([claude, codex], state, loadoutRoot),
    );
    expect(await readLive(claude.instructionFilePath as string)).toBe("# claude\n");
    expect(await readLive(codex.instructionFilePath as string)).toBe(
      "# codex baseline\n",
    );
    expect(result.newLiveMds.claude?.mode).toBe("coding");
    expect(result.newLiveMds.codex?.mode).toBe(BASELINE_MODE);
  });

  it("clears the live_mds record for a harness when there's no MD to apply", async () => {
    const claude = createClaudeAdapter({ home: tmpHome });
    // No MDs anywhere, but a stale record exists from a prior session.
    const state = makeState([], {
      claude: { mode: "old-mode", sha256: "stale" },
    });
    const result = await run(
      materializeInstructionFiles([claude], state, loadoutRoot),
    );
    expect(result.newLiveMds.claude).toBeUndefined();
  });
});
