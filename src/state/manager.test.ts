import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateParseError, StateVersionError } from "./errors.js";
import { acquireLock, load, pathsFor, save } from "./manager.js";
import { initialState } from "./schema.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-state-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const runExit = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff);

describe("StateManager", () => {
  it("load() returns initialState when state.json does not exist", async () => {
    const paths = pathsFor(tmp);
    const state = await run(load(paths));
    expect(state).toEqual(initialState);
  });

  it("save() then load() round-trips", async () => {
    const paths = pathsFor(tmp);
    const written = {
      version: 1 as const,
      active_modes: ["default", "product"],
      in_progress: null,
    };
    await run(save(paths, written));
    const loaded = await run(load(paths));
    expect(loaded.version).toBe(1);
    expect(loaded.active_modes).toEqual(["default", "product"]);
    expect(loaded.in_progress).toBeNull();
  });

  it("save() persists an in_progress snapshot losslessly", async () => {
    const paths = pathsFor(tmp);
    const move = {
      harness: "claude",
      skill: "qa",
      op: "activate" as const,
      source_path: "/pool/claude/qa",
      dest_path: "/active/claude/qa",
    };
    await run(
      save(paths, {
        version: 1,
        active_modes: ["product"],
        in_progress: {
          op: "on",
          mode: "design",
          completed: [move],
          pending: [],
        },
      }),
    );
    const loaded = await run(load(paths));
    expect(loaded.in_progress?.op).toBe("on");
    expect(loaded.in_progress?.mode).toBe("design");
    expect(loaded.in_progress?.completed[0]).toEqual(move);
  });

  it("load() reads a legacy state.json without live_mds", async () => {
    const paths = pathsFor(tmp);
    await fs.mkdir(paths.root, { recursive: true });
    await fs.writeFile(
      paths.stateFile,
      JSON.stringify({ version: 1, active_modes: [], in_progress: null }),
    );
    const loaded = await run(load(paths));
    expect(loaded.live_mds).toBeUndefined();
  });

  it("save() persists live_mds and load() round-trips it", async () => {
    const paths = pathsFor(tmp);
    await run(
      save(paths, {
        version: 1,
        active_modes: ["coding"],
        in_progress: null,
        live_mds: { claude: { mode: "coding", sha256: "abc" } },
      }),
    );
    const loaded = await run(load(paths));
    expect(loaded.live_mds.claude).toEqual({ mode: "coding", sha256: "abc" });
  });

  it("load() rejects corrupt JSON with StateParseError", async () => {
    const paths = pathsFor(tmp);
    await fs.mkdir(paths.root, { recursive: true });
    await fs.writeFile(paths.stateFile, "{not valid json");
    const exit = await runExit(load(paths));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const cause = exit.cause;
      expect(String(cause)).toContain("StateParseError");
    }
  });

  it("load() rejects version != 1 with StateVersionError", async () => {
    const paths = pathsFor(tmp);
    await fs.mkdir(paths.root, { recursive: true });
    await fs.writeFile(
      paths.stateFile,
      JSON.stringify({ version: 2, active_modes: [], in_progress: null }),
    );
    const exit = await runExit(load(paths));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("StateVersionError");
    }
  });

  it("load() rejects a state with no version field via schema decode", async () => {
    const paths = pathsFor(tmp);
    await fs.mkdir(paths.root, { recursive: true });
    await fs.writeFile(
      paths.stateFile,
      JSON.stringify({ active_modes: [], in_progress: null }),
    );
    const exit = await runExit(load(paths));
    expect(exit._tag).toBe("Failure");
  });

  it("load() surfaces StateIOError when state.json is not readable as a file (EISDIR)", async () => {
    const paths = pathsFor(tmp);
    // Make state.json a directory so fs.readFile errors with EISDIR.
    await fs.mkdir(paths.stateFile, { recursive: true });
    const exit = await runExit(load(paths));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("StateIOError");
    }
  });

  it("save() surfaces StateParseError when encoding rejects an invalid state shape", async () => {
    const paths = pathsFor(tmp);
    // Bypass TS to feed a structurally invalid value into encode().
    const bogus = {
      version: 1,
      active_modes: [123 as unknown as string],
      in_progress: null,
    } as unknown as Parameters<typeof save>[1];
    const exit = await runExit(save(paths, bogus));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("StateParseError");
    }
  });

  it("acquireLock() prevents a second concurrent acquire", async () => {
    const paths = pathsFor(tmp);
    const first = await run(acquireLock(paths));
    const exit = await runExit(acquireLock(paths));
    expect(exit._tag).toBe("Failure");
    await first.release();
    const second = await run(acquireLock(paths));
    await second.release();
  });
});
