import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LoadoutHome } from "../paths.js";

export const LOADOUT_PACKAGE_NAME = "@ivcota/loadout";

export interface UpdateAvailable {
  readonly updateAvailable: true;
  readonly currentVersion: string;
  readonly latestVersion: string;
}

export interface UpdateUnavailable {
  readonly updateAvailable: false;
  readonly currentVersion: string;
  readonly latestVersion?: string;
}

export type UpdateCheckResult = UpdateAvailable | UpdateUnavailable;

export interface UpdateCheckOptions {
  readonly paths: Pick<LoadoutHome, "root">;
  readonly currentVersion: string;
  readonly packageName?: string;
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly fetch?: typeof fetch;
}

interface UpdateCheckCache {
  readonly packageName: string;
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly checkedAt: string;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 1_000;

export const updateCheckCachePath = (paths: Pick<LoadoutHome, "root">): string =>
  path.join(paths.root, "update-check.json");

const parseVersion = (version: string): readonly [number, number, number] | null => {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return [major, minor, patch] as const;
};

export const isVersionGreater = (candidate: string, current: string): boolean => {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);
  if (!candidateParts || !currentParts) return false;
  for (let i = 0; i < 3; i += 1) {
    const candidatePart = candidateParts[i] ?? 0;
    const currentPart = currentParts[i] ?? 0;
    if (candidatePart > currentPart) return true;
    if (candidatePart < currentPart) return false;
  }
  return false;
};

const readFreshCache = async (
  cacheFile: string,
  packageName: string,
  nowMs: number,
  ttlMs: number,
): Promise<UpdateCheckCache | null> => {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile, "utf8")) as Partial<UpdateCheckCache>;
    if (
      parsed.packageName !== packageName ||
      typeof parsed.latestVersion !== "string" ||
      typeof parsed.currentVersion !== "string" ||
      typeof parsed.checkedAt !== "string"
    ) {
      return null;
    }
    const checkedAtMs = Date.parse(parsed.checkedAt);
    if (!Number.isFinite(checkedAtMs)) return null;
    if (nowMs - checkedAtMs >= ttlMs) return null;
    return {
      packageName: parsed.packageName,
      currentVersion: parsed.currentVersion,
      latestVersion: parsed.latestVersion,
      checkedAt: parsed.checkedAt,
    };
  } catch {
    return null;
  }
};

const fetchLatestVersion = async (
  packageName: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const encodedPackageName = encodeURIComponent(packageName).replace("%40", "@");
    const response = await fetchImpl(`https://registry.npmjs.org/${encodedPackageName}/latest`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export const checkForUpdate = async (
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult> => {
  const packageName = options.packageName ?? LOADOUT_PACKAGE_NAME;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const cacheFile = updateCheckCachePath(options.paths);
  const nowMs = now();

  const cached = await readFreshCache(cacheFile, packageName, nowMs, ttlMs);
  if (cached) {
    return {
      updateAvailable: isVersionGreater(cached.latestVersion, options.currentVersion),
      currentVersion: options.currentVersion,
      latestVersion: cached.latestVersion,
    };
  }

  if (typeof fetchImpl !== "function") {
    return { updateAvailable: false, currentVersion: options.currentVersion };
  }

  const latestVersion = await fetchLatestVersion(packageName, fetchImpl, timeoutMs);
  if (!latestVersion) {
    return { updateAvailable: false, currentVersion: options.currentVersion };
  }

  try {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    const cache: UpdateCheckCache = {
      packageName,
      currentVersion: options.currentVersion,
      latestVersion,
      checkedAt: new Date(nowMs).toISOString(),
    };
    await fs.writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  } catch {
    // Cache writes are best-effort; never fail the command because of them.
  }

  return {
    updateAvailable: isVersionGreater(latestVersion, options.currentVersion),
    currentVersion: options.currentVersion,
    latestVersion,
  };
};

export const renderUpdateNotice = (result: UpdateCheckResult): string | null => {
  if (!result.updateAvailable) return null;
  return `update available: ${result.currentVersion} → ${result.latestVersion}\n  npm install -g ${LOADOUT_PACKAGE_NAME}`;
};
