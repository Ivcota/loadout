import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAUDE_HARNESS_NAME,
  createClaudeAdapter,
  defaultClaudeActiveDir,
  defaultClaudeInstructionFile,
  defaultClaudePoolDir,
} from "./index.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-claude-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("ClaudeAdapter", () => {
  it("defaults to ~/.claude/skills and ~/.loadout/pool/claude", () => {
    const home = "/tmp/fake-home";
    expect(defaultClaudeActiveDir(home)).toBe("/tmp/fake-home/.claude/skills");
    expect(defaultClaudePoolDir(home)).toBe("/tmp/fake-home/.loadout/pool/claude");
  });

  it("instruction file defaults to ~/.claude/CLAUDE.md", () => {
    expect(defaultClaudeInstructionFile("/tmp/fake-home")).toBe(
      "/tmp/fake-home/.claude/CLAUDE.md",
    );
  });

  it("exposes its instruction file path on the adapter", () => {
    const a = createClaudeAdapter({ home: tmpHome });
    expect(a.instructionFilePath).toBe(
      path.join(tmpHome, ".claude", "CLAUDE.md"),
    );
  });

  it("honors explicit instructionFilePath override", () => {
    const a = createClaudeAdapter({
      home: tmpHome,
      instructionFilePath: "/custom/CLAUDE.md",
    });
    expect(a.instructionFilePath).toBe("/custom/CLAUDE.md");
  });

  it("uses harness name 'claude'", () => {
    const a = createClaudeAdapter({ home: tmpHome });
    expect(a.name).toBe(CLAUDE_HARNESS_NAME);
  });

  it("honors explicit activeDir/poolDir overrides", () => {
    const a = createClaudeAdapter({
      activeDir: "/custom/active",
      poolDir: "/custom/pool",
    });
    expect(a.activeDir).toBe("/custom/active");
    expect(a.poolDir).toBe("/custom/pool");
  });

  it("derives paths from a custom home", () => {
    const a = createClaudeAdapter({ home: tmpHome });
    expect(a.activeDir).toBe(path.join(tmpHome, ".claude", "skills"));
    expect(a.poolDir).toBe(path.join(tmpHome, ".loadout", "pool", "claude"));
  });

  it("snapshot reads from the resolved active/pool dirs", async () => {
    const a = createClaudeAdapter({ home: tmpHome });
    await fs.mkdir(path.join(a.poolDir, "qa"), { recursive: true });
    await fs.mkdir(path.join(a.activeDir, "review"), { recursive: true });
    const snap = await Effect.runPromise(a.snapshot());
    expect([...snap.active]).toEqual(["review"]);
    expect([...snap.pool]).toEqual(["qa"]);
    expect(snap.name).toBe("claude");
  });
});
