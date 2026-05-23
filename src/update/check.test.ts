import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdate,
  isVersionGreater,
  updateCheckCachePath,
} from "./check.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "loadout-update-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const jsonResponse = (version: string): Response =>
  ({
    ok: true,
    json: async () => ({ version }),
  }) as Response;

const fetchVersion = (version: string): typeof fetch =>
  vi.fn(async () => jsonResponse(version)) as unknown as typeof fetch;

describe("version comparison", () => {
  it("detects only greater semver versions", () => {
    expect(isVersionGreater("0.3.2", "0.3.1")).toBe(true);
    expect(isVersionGreater("0.4.0", "0.3.9")).toBe(true);
    expect(isVersionGreater("1.0.0", "0.9.9")).toBe(true);
    expect(isVersionGreater("0.3.1", "0.3.1")).toBe(false);
    expect(isVersionGreater("0.3.0", "0.3.1")).toBe(false);
    expect(isVersionGreater("not-semver", "0.3.1")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("returns updateAvailable when npm latest is newer", async () => {
    const result = await checkForUpdate({
      paths: { root: tmpRoot },
      currentVersion: "0.3.1",
      fetch: fetchVersion("0.3.2"),
      now: () => Date.parse("2026-05-23T00:00:00.000Z"),
    });

    expect(result).toEqual({
      updateAvailable: true,
      currentVersion: "0.3.1",
      latestVersion: "0.3.2",
    });
  });

  it("returns no update for equal or older npm latest", async () => {
    await expect(
      checkForUpdate({
        paths: { root: tmpRoot },
        currentVersion: "0.3.1",
        fetch: fetchVersion("0.3.1"),
      }),
    ).resolves.toMatchObject({ updateAvailable: false, latestVersion: "0.3.1" });

    await fs.rm(updateCheckCachePath({ root: tmpRoot }), { force: true });

    await expect(
      checkForUpdate({
        paths: { root: tmpRoot },
        currentVersion: "0.3.1",
        fetch: fetchVersion("0.3.0"),
      }),
    ).resolves.toMatchObject({ updateAvailable: false, latestVersion: "0.3.0" });
  });

  it("silently returns no update when npm check fails", async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    await expect(
      checkForUpdate({
        paths: { root: tmpRoot },
        currentVersion: "0.3.1",
        fetch: failingFetch,
      }),
    ).resolves.toEqual({ updateAvailable: false, currentVersion: "0.3.1" });
  });

  it("uses a fresh cache without calling npm", async () => {
    await fs.mkdir(tmpRoot, { recursive: true });
    await fs.writeFile(
      updateCheckCachePath({ root: tmpRoot }),
      JSON.stringify({
        packageName: "@ivcota/loadout",
        currentVersion: "0.3.0",
        latestVersion: "0.3.2",
        checkedAt: "2026-05-23T00:00:00.000Z",
      }),
    );
    const fetchSpy = fetchVersion("0.3.3");

    const result = await checkForUpdate({
      paths: { root: tmpRoot },
      currentVersion: "0.3.1",
      fetch: fetchSpy,
      now: () => Date.parse("2026-05-23T12:00:00.000Z"),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      updateAvailable: true,
      currentVersion: "0.3.1",
      latestVersion: "0.3.2",
    });
  });

  it("refreshes a stale cache", async () => {
    await fs.mkdir(tmpRoot, { recursive: true });
    await fs.writeFile(
      updateCheckCachePath({ root: tmpRoot }),
      JSON.stringify({
        packageName: "@ivcota/loadout",
        currentVersion: "0.3.0",
        latestVersion: "0.3.1",
        checkedAt: "2026-05-21T00:00:00.000Z",
      }),
    );
    const fetchSpy = fetchVersion("0.3.3");

    const result = await checkForUpdate({
      paths: { root: tmpRoot },
      currentVersion: "0.3.1",
      fetch: fetchSpy,
      now: () => Date.parse("2026-05-23T12:00:00.000Z"),
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({
      updateAvailable: true,
      currentVersion: "0.3.1",
      latestVersion: "0.3.3",
    });
  });
});
