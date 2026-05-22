import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENTS_HARNESS_NAME,
  createAgentsAdapter,
  defaultAgentsActiveDir,
  defaultAgentsPoolDir,
} from "./index.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-agents-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("AgentsAdapter", () => {
  it("defaults to ~/.agents/skills and ~/.loadout/pool/agents", () => {
    const home = "/tmp/fake-home";
    expect(defaultAgentsActiveDir(home)).toBe("/tmp/fake-home/.agents/skills");
    expect(defaultAgentsPoolDir(home)).toBe("/tmp/fake-home/.loadout/pool/agents");
  });

  it("uses harness name 'agents'", () => {
    const a = createAgentsAdapter({ home: tmpHome });
    expect(a.name).toBe(AGENTS_HARNESS_NAME);
  });

  it("honors explicit activeDir/poolDir overrides", () => {
    const a = createAgentsAdapter({
      activeDir: "/custom/active",
      poolDir: "/custom/pool",
    });
    expect(a.activeDir).toBe("/custom/active");
    expect(a.poolDir).toBe("/custom/pool");
  });

  it("derives paths from a custom home", () => {
    const a = createAgentsAdapter({ home: tmpHome });
    expect(a.activeDir).toBe(path.join(tmpHome, ".agents", "skills"));
    expect(a.poolDir).toBe(path.join(tmpHome, ".loadout", "pool", "agents"));
  });

  it("snapshot reads from the resolved active/pool dirs", async () => {
    const a = createAgentsAdapter({ home: tmpHome });
    await fs.mkdir(path.join(a.poolDir, "noah-kagan"), { recursive: true });
    await fs.mkdir(path.join(a.activeDir, "scripture"), { recursive: true });
    const snap = await Effect.runPromise(a.snapshot());
    expect([...snap.active]).toEqual(["scripture"]);
    expect([...snap.pool]).toEqual(["noah-kagan"]);
    expect(snap.name).toBe("agents");
  });

  it("has no instruction file (agents harness lacks one)", () => {
    const a = createAgentsAdapter({ home: tmpHome });
    expect(a.instructionFilePath).toBeNull();
  });

  it("readInstructionFile fails because agents has no instruction file", async () => {
    const a = createAgentsAdapter({ home: tmpHome });
    const result = await Effect.runPromise(Effect.either(a.readInstructionFile()));
    expect(result._tag).toBe("Left");
  });
});
