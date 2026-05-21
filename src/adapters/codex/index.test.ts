import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CODEX_HARNESS_NAME,
  createCodexAdapter,
  defaultCodexActiveDir,
  defaultCodexPoolDir,
} from "./index.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-codex-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("CodexAdapter", () => {
  it("defaults to ~/.agents/skills and ~/.loadout/pool/codex", () => {
    const home = "/tmp/fake-home";
    expect(defaultCodexActiveDir(home)).toBe("/tmp/fake-home/.agents/skills");
    expect(defaultCodexPoolDir(home)).toBe("/tmp/fake-home/.loadout/pool/codex");
  });

  it("uses harness name 'codex'", () => {
    const a = createCodexAdapter({ home: tmpHome });
    expect(a.name).toBe(CODEX_HARNESS_NAME);
  });

  it("honors explicit activeDir/poolDir overrides", () => {
    const a = createCodexAdapter({
      activeDir: "/custom/active",
      poolDir: "/custom/pool",
    });
    expect(a.activeDir).toBe("/custom/active");
    expect(a.poolDir).toBe("/custom/pool");
  });

  it("derives paths from a custom home", () => {
    const a = createCodexAdapter({ home: tmpHome });
    expect(a.activeDir).toBe(path.join(tmpHome, ".agents", "skills"));
    expect(a.poolDir).toBe(path.join(tmpHome, ".loadout", "pool", "codex"));
  });

  it("snapshot reads from the resolved active/pool dirs", async () => {
    const a = createCodexAdapter({ home: tmpHome });
    await fs.mkdir(path.join(a.poolDir, "noah-kagan"), { recursive: true });
    await fs.mkdir(path.join(a.activeDir, "scripture"), { recursive: true });
    const snap = await Effect.runPromise(a.snapshot());
    expect([...snap.active]).toEqual(["scripture"]);
    expect([...snap.pool]).toEqual(["noah-kagan"]);
    expect(snap.name).toBe("codex");
  });
});
