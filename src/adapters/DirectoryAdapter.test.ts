import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryAdapter } from "./DirectoryAdapter.js";
import type { PlannedMove } from "../state/schema.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-adapter-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const runExit = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff);

const mkAdapter = (): DirectoryAdapter => {
  const activeDir = path.join(tmp, "active");
  const poolDir = path.join(tmp, "pool");
  return new DirectoryAdapter("claude", activeDir, poolDir);
};

const moveSpec = (a: DirectoryAdapter, skill: string, op: PlannedMove["op"]): PlannedMove => ({
  harness: a.name,
  skill,
  op,
  source_path: op === "activate"
    ? path.join(a.poolDir, skill)
    : path.join(a.activeDir, skill),
  dest_path: op === "activate"
    ? path.join(a.activeDir, skill)
    : path.join(a.poolDir, skill),
});

describe("DirectoryAdapter", () => {
  it("snapshot returns empty sets when neither dir exists", async () => {
    const a = mkAdapter();
    const snap = await run(a.snapshot());
    expect(snap.active).toEqual(new Set());
    expect(snap.pool).toEqual(new Set());
    expect(snap.name).toBe("claude");
  });

  it("snapshot lists only directory entries, ignoring files", async () => {
    const a = mkAdapter();
    await fs.mkdir(a.poolDir, { recursive: true });
    await fs.mkdir(path.join(a.poolDir, "qa"), { recursive: true });
    await fs.writeFile(path.join(a.poolDir, "stray-file"), "");
    const snap = await run(a.snapshot());
    expect([...snap.pool]).toEqual(["qa"]);
  });

  it("snapshot ignores hidden directories (e.g. Codex's .system/)", async () => {
    const a = mkAdapter();
    await fs.mkdir(path.join(a.activeDir, "qa"), { recursive: true });
    await fs.mkdir(path.join(a.activeDir, ".system", "imagegen"), { recursive: true });
    await fs.mkdir(path.join(a.poolDir, ".system"), { recursive: true });
    const snap = await run(a.snapshot());
    expect([...snap.active]).toEqual(["qa"]);
    expect([...snap.pool]).toEqual([]);
  });

  it("apply moves a skill from source to dest via rename", async () => {
    const a = mkAdapter();
    await fs.mkdir(path.join(a.poolDir, "qa"), { recursive: true });
    await fs.writeFile(path.join(a.poolDir, "qa", "SKILL.md"), "# qa\n");
    await run(a.apply(moveSpec(a, "qa", "activate")));
    const contents = await fs.readFile(path.join(a.activeDir, "qa", "SKILL.md"), "utf8");
    expect(contents).toBe("# qa\n");
    await expect(fs.access(path.join(a.poolDir, "qa"))).rejects.toThrow();
  });

  it("apply surfaces AdapterError with cause=ENOENT when source missing", async () => {
    const a = mkAdapter();
    const exit = await runExit(a.apply(moveSpec(a, "ghost", "activate")));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const s = String(exit.cause);
      expect(s).toContain("AdapterError");
      expect(s).toContain("ghost");
    }
  });

  it("apply falls back to fs-extra.move when rename throws EXDEV", async () => {
    let renameCalled = 0;
    const renameFn = async () => {
      renameCalled += 1;
      const e = new Error("simulated cross-device link") as NodeJS.ErrnoException;
      e.code = "EXDEV";
      throw e;
    };
    const a = new DirectoryAdapter(
      "claude",
      path.join(tmp, "active"),
      path.join(tmp, "pool"),
      { renameFn },
    );
    await fs.mkdir(path.join(a.poolDir, "cross"), { recursive: true });
    await fs.writeFile(path.join(a.poolDir, "cross", "SKILL.md"), "# cross\n");
    await run(a.apply(moveSpec(a, "cross", "activate")));
    expect(renameCalled).toBeGreaterThan(0);
    const contents = await fs.readFile(path.join(a.activeDir, "cross", "SKILL.md"), "utf8");
    expect(contents).toBe("# cross\n");
    await expect(fs.access(path.join(a.poolDir, "cross"))).rejects.toThrow();
  });

  it("apply surfaces AdapterError when rename throws a non-EXDEV error", async () => {
    const renameFn = async () => {
      const e = new Error("simulated permission") as NodeJS.ErrnoException;
      e.code = "EACCES";
      throw e;
    };
    const a = new DirectoryAdapter(
      "claude",
      path.join(tmp, "active"),
      path.join(tmp, "pool"),
      { renameFn },
    );
    await fs.mkdir(path.join(a.poolDir, "denied"), { recursive: true });
    const exit = await runExit(a.apply(moveSpec(a, "denied", "activate")));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("AdapterError");
    }
  });

  it("snapshot hides reserved skill names from active and pool", async () => {
    const a = mkAdapter();
    await fs.mkdir(path.join(a.activeDir, "loadout"), { recursive: true });
    await fs.mkdir(path.join(a.activeDir, "qa"), { recursive: true });
    await fs.mkdir(path.join(a.poolDir, "loadout"), { recursive: true });
    await fs.mkdir(path.join(a.poolDir, "review"), { recursive: true });
    const snap = await run(a.snapshot());
    expect([...snap.active].sort()).toEqual(["qa"]);
    expect([...snap.pool].sort()).toEqual(["review"]);
  });

  it("invert flips op and swaps source/dest paths", () => {
    const a = mkAdapter();
    const m = moveSpec(a, "qa", "activate");
    const inv = a.invert(m);
    expect(inv.op).toBe("deactivate");
    expect(inv.source_path).toBe(m.dest_path);
    expect(inv.dest_path).toBe(m.source_path);
    const back = a.invert(inv);
    expect(back).toEqual(m);
  });

  describe("instruction file", () => {
    const mkWithFile = (filePath?: string): DirectoryAdapter =>
      new DirectoryAdapter(
        "claude",
        path.join(tmp, "active"),
        path.join(tmp, "pool"),
        { instructionFilePath: filePath ?? path.join(tmp, "CLAUDE.md") },
      );

    it("defaults instructionFilePath to null when not provided", () => {
      const a = new DirectoryAdapter(
        "agents",
        path.join(tmp, "active"),
        path.join(tmp, "pool"),
      );
      expect(a.instructionFilePath).toBeNull();
    });

    it("readInstructionFile returns null when the file is absent", async () => {
      const a = mkWithFile();
      const result = await run(a.readInstructionFile());
      expect(result).toBeNull();
    });

    it("readInstructionFile returns the content when the file exists", async () => {
      const a = mkWithFile();
      await fs.writeFile(a.instructionFilePath as string, "# hello\n");
      const result = await run(a.readInstructionFile());
      expect(result).toBe("# hello\n");
    });

    it("writeInstructionFile creates the file with the given content", async () => {
      const a = mkWithFile();
      await run(a.writeInstructionFile("# fresh\n"));
      const content = await fs.readFile(a.instructionFilePath as string, "utf8");
      expect(content).toBe("# fresh\n");
    });

    it("writeInstructionFile overwrites existing content", async () => {
      const a = mkWithFile();
      await fs.writeFile(a.instructionFilePath as string, "# old\n");
      await run(a.writeInstructionFile("# new\n"));
      const content = await fs.readFile(a.instructionFilePath as string, "utf8");
      expect(content).toBe("# new\n");
    });

    it("writeInstructionFile creates parent directories that don't exist yet", async () => {
      const nested = path.join(tmp, "nested", "deep", "CLAUDE.md");
      const a = mkWithFile(nested);
      await run(a.writeInstructionFile("# nested\n"));
      const content = await fs.readFile(nested, "utf8");
      expect(content).toBe("# nested\n");
    });

    it("writeInstructionFile leaves no temp file behind when rename succeeds", async () => {
      const a = mkWithFile();
      await run(a.writeInstructionFile("# ok\n"));
      const parent = path.dirname(a.instructionFilePath as string);
      const entries = await fs.readdir(parent);
      const stragglers = entries.filter((e) => e.includes("loadout-tmp"));
      expect(stragglers).toEqual([]);
    });

    it("writeInstructionFile cleans up its tmp file when rename fails", async () => {
      const renameFn = async () => {
        const e = new Error("simulated") as NodeJS.ErrnoException;
        e.code = "EACCES";
        throw e;
      };
      const filePath = path.join(tmp, "CLAUDE.md");
      const a = new DirectoryAdapter(
        "claude",
        path.join(tmp, "active"),
        path.join(tmp, "pool"),
        { instructionFilePath: filePath, renameFn },
      );
      const exit = await runExit(a.writeInstructionFile("# x\n"));
      expect(exit._tag).toBe("Failure");
      const entries = await fs.readdir(tmp);
      const stragglers = entries.filter((e) => e.includes("loadout-tmp"));
      expect(stragglers).toEqual([]);
    });

    it("writeInstructionFile falls back to fs-extra.move on EXDEV", async () => {
      let calls = 0;
      const renameFn = async () => {
        calls += 1;
        const e = new Error("xdev") as NodeJS.ErrnoException;
        e.code = "EXDEV";
        throw e;
      };
      const filePath = path.join(tmp, "CLAUDE.md");
      const a = new DirectoryAdapter(
        "claude",
        path.join(tmp, "active"),
        path.join(tmp, "pool"),
        { instructionFilePath: filePath, renameFn },
      );
      await run(a.writeInstructionFile("# xdev-ok\n"));
      expect(calls).toBeGreaterThan(0);
      const content = await fs.readFile(filePath, "utf8");
      expect(content).toBe("# xdev-ok\n");
    });

    it("readInstructionFile fails on a null-path adapter", async () => {
      const a = new DirectoryAdapter(
        "agents",
        path.join(tmp, "active"),
        path.join(tmp, "pool"),
      );
      const exit = await runExit(a.readInstructionFile());
      expect(exit._tag).toBe("Failure");
    });

    it("writeInstructionFile fails on a null-path adapter", async () => {
      const a = new DirectoryAdapter(
        "agents",
        path.join(tmp, "active"),
        path.join(tmp, "pool"),
      );
      const exit = await runExit(a.writeInstructionFile("# nope\n"));
      expect(exit._tag).toBe("Failure");
    });
  });
});
