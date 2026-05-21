import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyManifest,
  exists,
  load,
  manifestPathsFor,
  save,
} from "./loader.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-manifest-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const runExit = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff);

describe("manifest loader", () => {
  it("load() returns emptyManifest when modes.yaml does not exist", async () => {
    const paths = manifestPathsFor(tmp);
    const m = await run(load(paths));
    expect(m).toEqual(emptyManifest);
  });

  it("exists() is false for missing file, true after save", async () => {
    const paths = manifestPathsFor(tmp);
    expect(await run(exists(paths))).toBe(false);
    await run(save(paths, { version: 1, modes: { default: { skills: ["a"] } } }));
    expect(await run(exists(paths))).toBe(true);
  });

  it("save() then load() round-trips a manifest with multiple modes", async () => {
    const paths = manifestPathsFor(tmp);
    const written = {
      version: 1 as const,
      modes: {
        default: { skills: ["qa", "review"] },
        product: { skills: ["plan-ceo-review", "office-hours"] },
      },
    };
    await run(save(paths, written));
    const loaded = await run(load(paths));
    expect(loaded.version).toBe(1);
    expect(loaded.modes["default"]?.skills).toEqual(["qa", "review"]);
    expect(loaded.modes["product"]?.skills).toEqual([
      "plan-ceo-review",
      "office-hours",
    ]);
  });

  it("load() rejects malformed yaml with ManifestParseError", async () => {
    const paths = manifestPathsFor(tmp);
    await fs.writeFile(paths.manifestFile, "version: 1\nmodes: { default: [unterminated");
    const exit = await runExit(load(paths));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("ManifestParseError");
    }
  });

  it("load() rejects version != 1 with ManifestVersionError", async () => {
    const paths = manifestPathsFor(tmp);
    await fs.writeFile(paths.manifestFile, "version: 2\nmodes: {}\n");
    const exit = await runExit(load(paths));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("ManifestVersionError");
    }
  });

  it("load() rejects a manifest missing version via schema decode", async () => {
    const paths = manifestPathsFor(tmp);
    await fs.writeFile(paths.manifestFile, "modes: {}\n");
    const exit = await runExit(load(paths));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("ManifestParseError");
    }
  });

  it("load() surfaces ManifestIOError when modes.yaml is a directory (EISDIR)", async () => {
    const paths = manifestPathsFor(tmp);
    await fs.mkdir(paths.manifestFile);
    const exit = await runExit(load(paths));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("ManifestIOError");
    }
  });

  it("save() creates parent dir if missing", async () => {
    const paths = manifestPathsFor(path.join(tmp, "nested", "loadout"));
    await run(save(paths, { version: 1, modes: {} }));
    const stat = await fs.stat(paths.manifestFile);
    expect(stat.isFile()).toBe(true);
  });
});
