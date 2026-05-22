import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentsAdapter } from "../../adapters/agents/index.js";
import { createClaudeAdapter } from "../../adapters/claude/index.js";
import { createCodexAdapter } from "../../adapters/codex/index.js";
import { loadoutHome } from "../../paths.js";
import {
  adoptBaseline,
  captureLiveMdsForMode,
  setMd,
  showMd,
  unsetMd,
} from "./mds.js";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-mds-cmd-"));
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const runExit = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff);

const mkDeps = () => {
  const paths = loadoutHome({ home: tmpHome });
  const adapters = [
    createClaudeAdapter({ home: tmpHome }),
    createCodexAdapter({ home: tmpHome }),
    createAgentsAdapter({ home: tmpHome }),
  ];
  return { paths, adapters };
};

describe("setMd / showMd / unsetMd", () => {
  it("setMd creates a new MD and showMd reads it back", async () => {
    const { paths } = mkDeps();
    const setResult = await run(
      setMd({ paths, mode: "coding", harness: "claude", content: "# c\n" }),
    );
    expect(setResult.created).toBe(true);
    const show = await run(showMd({ paths, mode: "coding", harness: "claude" }));
    expect(show.content).toBe("# c\n");
  });

  it("setMd marks created=false when the file already existed", async () => {
    const { paths } = mkDeps();
    await run(setMd({ paths, mode: "x", harness: "claude", content: "v1" }));
    const second = await run(
      setMd({ paths, mode: "x", harness: "claude", content: "v2" }),
    );
    expect(second.created).toBe(false);
    const show = await run(showMd({ paths, mode: "x", harness: "claude" }));
    expect(show.content).toBe("v2");
  });

  it("showMd fails with MdNotFound when the file is absent", async () => {
    const { paths } = mkDeps();
    const exit = await runExit(
      showMd({ paths, mode: "ghost", harness: "claude" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause.toJSON())).toContain("MdNotFound");
    }
  });

  it("unsetMd removes an existing MD", async () => {
    const { paths } = mkDeps();
    await run(setMd({ paths, mode: "x", harness: "claude", content: "v1" }));
    const result = await run(unsetMd({ paths, mode: "x", harness: "claude" }));
    expect(result.removed).toBe(true);
    const exit = await runExit(showMd({ paths, mode: "x", harness: "claude" }));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("unsetMd is a no-op when the file is absent", async () => {
    const { paths } = mkDeps();
    const result = await run(unsetMd({ paths, mode: "x", harness: "claude" }));
    expect(result.removed).toBe(false);
  });
});

describe("adoptBaseline", () => {
  it("snapshots existing live instruction files into baseline", async () => {
    const { paths, adapters } = mkDeps();
    await fs.mkdir(path.join(tmpHome, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(tmpHome, ".claude/CLAUDE.md"),
      "# existing\n",
    );
    const report = await run(adoptBaseline({ paths, adapters }));
    expect(report.adopted.map((a) => a.harness)).toContain("claude");
    const baselined = await run(
      showMd({ paths, mode: "baseline", harness: "claude" }),
    );
    expect(baselined.content).toBe("# existing\n");
  });

  it("skips harnesses with no live instruction file", async () => {
    const { paths, adapters } = mkDeps();
    const report = await run(adoptBaseline({ paths, adapters }));
    expect(report.adopted).toEqual([]);
    expect(report.skipped.find((s) => s.harness === "claude")?.reason).toMatch(
      /no live instruction file/,
    );
  });

  it("skips harnesses without an instruction file path (agents)", async () => {
    const { paths, adapters } = mkDeps();
    const report = await run(adoptBaseline({ paths, adapters }));
    expect(report.skipped.find((s) => s.harness === "agents")?.reason).toMatch(
      /no instruction file/,
    );
  });

  it("refuses to overwrite an existing baseline unless --force", async () => {
    const { paths, adapters } = mkDeps();
    await fs.mkdir(path.join(tmpHome, ".claude"), { recursive: true });
    await fs.writeFile(path.join(tmpHome, ".claude/CLAUDE.md"), "# v1\n");
    await run(adoptBaseline({ paths, adapters }));

    // Change the live file; without --force, the existing baseline should stay.
    await fs.writeFile(path.join(tmpHome, ".claude/CLAUDE.md"), "# v2\n");
    const second = await run(adoptBaseline({ paths, adapters }));
    expect(second.adopted).toEqual([]);
    expect(second.skipped.find((s) => s.harness === "claude")?.reason).toMatch(
      /already exists/,
    );

    const third = await run(adoptBaseline({ paths, adapters, force: true }));
    expect(third.adopted.map((a) => a.harness)).toContain("claude");
    const show = await run(
      showMd({ paths, mode: "baseline", harness: "claude" }),
    );
    expect(show.content).toBe("# v2\n");
  });
});

describe("captureLiveMdsForMode", () => {
  it("captures live MDs into a mode's slot", async () => {
    const { paths, adapters } = mkDeps();
    await fs.mkdir(path.join(tmpHome, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(tmpHome, ".claude/CLAUDE.md"),
      "# live\n",
    );
    const report = await run(
      captureLiveMdsForMode({ paths, adapters, mode: "coding" }),
    );
    expect(report.captured.map((c) => c.harness)).toContain("claude");
    const show = await run(
      showMd({ paths, mode: "coding", harness: "claude" }),
    );
    expect(show.content).toBe("# live\n");
  });

  it("reports skipped harnesses with no live file", async () => {
    const { paths, adapters } = mkDeps();
    const report = await run(
      captureLiveMdsForMode({ paths, adapters, mode: "coding" }),
    );
    expect(report.captured).toEqual([]);
    expect(report.skipped.find((s) => s.harness === "claude")?.reason).toMatch(
      /no live instruction file/,
    );
  });
});
