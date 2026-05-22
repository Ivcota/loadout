import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BASELINE_MODE,
  deleteModeMd,
  listHarnessesForMode,
  mdsPathsFor,
  readModeMd,
  writeModeMd,
} from "./storage.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-mds-storage-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const runExit = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff);

describe("mds storage paths", () => {
  it("mdsPathsFor exposes the mds root under the loadout root", () => {
    const p = mdsPathsFor("/r");
    expect(p.root).toBe("/r/mds");
  });

  it("mdsPathsFor builds a per-mode directory path", () => {
    const p = mdsPathsFor("/r");
    expect(p.modeDir("coding")).toBe("/r/mds/coding");
    expect(p.modeDir(BASELINE_MODE)).toBe("/r/mds/baseline");
  });

  it("mdsPathsFor builds a per-(mode, harness) file path", () => {
    const p = mdsPathsFor("/r");
    expect(p.modeFile("coding", "claude")).toBe("/r/mds/coding/claude.md");
    expect(p.modeFile(BASELINE_MODE, "codex")).toBe("/r/mds/baseline/codex.md");
  });
});

describe("readModeMd", () => {
  it("returns null when the file does not exist", async () => {
    const result = await run(readModeMd(tmp, "coding", "claude"));
    expect(result).toBeNull();
  });

  it("returns null when the mode directory does not exist", async () => {
    const result = await run(readModeMd(tmp, "nonexistent-mode", "claude"));
    expect(result).toBeNull();
  });

  it("returns the file content when present", async () => {
    const p = mdsPathsFor(tmp);
    await fs.mkdir(p.modeDir("coding"), { recursive: true });
    await fs.writeFile(p.modeFile("coding", "claude"), "# coding rules\n");
    const result = await run(readModeMd(tmp, "coding", "claude"));
    expect(result).toBe("# coding rules\n");
  });

  it("reads the baseline like any other mode", async () => {
    const p = mdsPathsFor(tmp);
    await fs.mkdir(p.modeDir(BASELINE_MODE), { recursive: true });
    await fs.writeFile(p.modeFile(BASELINE_MODE, "claude"), "# baseline\n");
    const result = await run(readModeMd(tmp, BASELINE_MODE, "claude"));
    expect(result).toBe("# baseline\n");
  });
});

describe("writeModeMd", () => {
  it("creates the file with the given content", async () => {
    await run(writeModeMd(tmp, "coding", "claude", "# fresh\n"));
    const p = mdsPathsFor(tmp);
    const content = await fs.readFile(p.modeFile("coding", "claude"), "utf8");
    expect(content).toBe("# fresh\n");
  });

  it("overwrites existing content", async () => {
    await run(writeModeMd(tmp, "coding", "claude", "# v1\n"));
    await run(writeModeMd(tmp, "coding", "claude", "# v2\n"));
    const p = mdsPathsFor(tmp);
    const content = await fs.readFile(p.modeFile("coding", "claude"), "utf8");
    expect(content).toBe("# v2\n");
  });

  it("creates parent directories that don't yet exist", async () => {
    await run(writeModeMd(tmp, "new-mode", "claude", "# created\n"));
    const p = mdsPathsFor(tmp);
    const content = await fs.readFile(p.modeFile("new-mode", "claude"), "utf8");
    expect(content).toBe("# created\n");
  });
});

describe("deleteModeMd", () => {
  it("removes an existing MD file", async () => {
    await run(writeModeMd(tmp, "coding", "claude", "# rm me\n"));
    await run(deleteModeMd(tmp, "coding", "claude"));
    const p = mdsPathsFor(tmp);
    await expect(fs.access(p.modeFile("coding", "claude"))).rejects.toThrow();
  });

  it("is a no-op when the file is absent", async () => {
    const exit = await runExit(deleteModeMd(tmp, "coding", "claude"));
    expect(exit._tag).toBe("Success");
  });
});

describe("listHarnessesForMode", () => {
  it("returns an empty list when the mode dir does not exist", async () => {
    const result = await run(listHarnessesForMode(tmp, "ghost"));
    expect(result).toEqual([]);
  });

  it("returns the harness names whose MD files exist for a mode", async () => {
    await run(writeModeMd(tmp, "coding", "claude", "# c\n"));
    await run(writeModeMd(tmp, "coding", "codex", "# d\n"));
    const result = await run(listHarnessesForMode(tmp, "coding"));
    expect(result.sort()).toEqual(["claude", "codex"]);
  });

  it("ignores subdirectories or non-.md files", async () => {
    const p = mdsPathsFor(tmp);
    await fs.mkdir(p.modeDir("coding"), { recursive: true });
    await fs.writeFile(p.modeFile("coding", "claude"), "# c\n");
    await fs.writeFile(path.join(p.modeDir("coding"), "README"), "ignored");
    await fs.mkdir(path.join(p.modeDir("coding"), "subdir"));
    const result = await run(listHarnessesForMode(tmp, "coding"));
    expect(result).toEqual(["claude"]);
  });
});
