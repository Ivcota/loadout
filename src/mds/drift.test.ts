import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeAdapter } from "../adapters/claude/index.js";
import type { State } from "../state/schema.js";
import { detectDrift, sha256 } from "./drift.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-mds-drift-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const makeState = (live_mds: State["live_mds"]): State => ({
  version: 1,
  active_modes: [],
  in_progress: null,
  live_mds,
});

describe("sha256", () => {
  it("is deterministic for the same input", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });

  it("differs for different inputs", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("produces hex of length 64", () => {
    expect(sha256("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("detectDrift", () => {
  it("returns null when there is no live_mds record for the harness", async () => {
    const adapter = createClaudeAdapter({ home: tmpHome });
    const state = makeState({});
    const result = await run(detectDrift(adapter, state));
    expect(result).toBeNull();
  });

  it("returns drift=false when the live file matches the recorded sha", async () => {
    const adapter = createClaudeAdapter({ home: tmpHome });
    const content = "# coding rules\n";
    await fs.mkdir(path.dirname(adapter.instructionFilePath as string), {
      recursive: true,
    });
    await fs.writeFile(adapter.instructionFilePath as string, content);
    const state = makeState({
      claude: { mode: "coding", sha256: sha256(content) },
    });
    const result = await run(detectDrift(adapter, state));
    expect(result).toEqual({
      harness: "claude",
      mode: "coding",
      expected_sha256: sha256(content),
      actual_sha256: sha256(content),
      drift: false,
    });
  });

  it("returns drift=true when the live file content has changed", async () => {
    const adapter = createClaudeAdapter({ home: tmpHome });
    const recorded = "# v1\n";
    const live = "# v2 (hand-edited)\n";
    await fs.mkdir(path.dirname(adapter.instructionFilePath as string), {
      recursive: true,
    });
    await fs.writeFile(adapter.instructionFilePath as string, live);
    const state = makeState({
      claude: { mode: "coding", sha256: sha256(recorded) },
    });
    const result = await run(detectDrift(adapter, state));
    expect(result?.drift).toBe(true);
    expect(result?.expected_sha256).toBe(sha256(recorded));
    expect(result?.actual_sha256).toBe(sha256(live));
  });

  it("returns drift=true when the live file was deleted out of band", async () => {
    const adapter = createClaudeAdapter({ home: tmpHome });
    const state = makeState({
      claude: { mode: "coding", sha256: sha256("# v1\n") },
    });
    const result = await run(detectDrift(adapter, state));
    expect(result?.drift).toBe(true);
    expect(result?.actual_sha256).toBeNull();
  });
});
