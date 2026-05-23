#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type Bump = "patch" | "minor" | "major";

const bump = process.argv.find((arg): arg is Bump =>
  arg === "patch" || arg === "minor" || arg === "major",
);
const dryRun = process.argv.includes("--dry-run");

if (!bump) {
  fail("Usage: npm run release -- <patch|minor|major> [--dry-run]");
}

function run(command: string, args: string[], options: { capture?: boolean } = {}): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    fail(stderr ? `${command} ${args.join(" ")} failed:\n${stderr}` : `${command} ${args.join(" ")} failed`);
  }

  return result.stdout?.trim() ?? "";
}

function fail(message: string): never {
  console.error(`\nRelease failed: ${message}`);
  process.exit(1);
}

function getPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    fail("package.json is missing a string version");
  }
  return packageJson.version;
}

function bumpVersion(version: string, level: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    fail(`package version must be plain SemVer x.y.z, got ${version}`);
  }

  const [, majorPart, minorPart, patchPart] = match;
  let major = Number(majorPart);
  let minor = Number(minorPart);
  let patch = Number(patchPart);

  if (level === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractUnreleased(changelog: string): { notes: string; start: number; end: number } {
  const heading = /^## Unreleased\s*$/m.exec(changelog);
  if (!heading || heading.index === undefined) {
    fail("CHANGELOG.md must contain an '## Unreleased' section");
  }

  const start = heading.index + heading[0].length;
  const rest = changelog.slice(start);
  const nextHeading = /^## /m.exec(rest);
  const end = nextHeading?.index === undefined ? changelog.length : start + nextHeading.index;
  const notes = changelog.slice(start, end).trim();

  if (!/^[-*]\s+\S/m.test(notes)) {
    fail("CHANGELOG.md '## Unreleased' must contain at least one bullet before releasing");
  }

  return { notes, start, end };
}

function releaseChangelog(version: string): string {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const { notes, start, end } = extractUnreleased(changelog);
  const releaseSection = `\n\n## ${version} - ${today()}\n\n${notes}\n`;
  writeFileSync("CHANGELOG.md", `${changelog.slice(0, start).trimEnd()}\n${releaseSection}${changelog.slice(end).replace(/^\n+/, "\n")}`);
  return notes;
}

async function confirmPublish(version: string, notes: string): Promise<void> {
  console.log(`\nReady to publish @ivcota/loadout@${version}`);
  console.log("\nRelease notes:\n");
  console.log(notes);

  const rl = createInterface({ input, output });
  const answer = await rl.question(`\nPublish @ivcota/loadout@${version} to npm and create GitHub Release? [y/N] `);
  rl.close();

  if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
    fail("publish cancelled; version commit and tag were already created and pushed");
  }
}

function assertCleanGitTree(): void {
  const status = run("git", ["status", "--porcelain"], { capture: true });
  if (status.length > 0) {
    fail("git working tree must be clean before releasing");
  }
}

function assertTools(): void {
  run("git", ["--version"], { capture: true });
  run("npm", ["--version"], { capture: true });
  run("gh", ["--version"], { capture: true });
  run("gh", ["auth", "status"], { capture: true });
}

function createGitHubRelease(tag: string, notes: string): void {
  const dir = mkdtempSync(join(tmpdir(), "loadout-release-"));
  const notesFile = join(dir, "notes.md");

  try {
    writeFileSync(notesFile, notes);
    run("gh", ["release", "create", tag, "--title", tag, "--notes-file", notesFile]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const currentVersion = getPackageVersion();
  const nextVersion = bumpVersion(currentVersion, bump);
  const tag = `v${nextVersion}`;
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const { notes } = extractUnreleased(changelog);

  console.log(`${dryRun ? "Dry run:" : "Release:"} ${currentVersion} -> ${nextVersion}`);

  assertCleanGitTree();
  assertTools();

  run("npm", ["run", "typecheck"]);
  run("npm", ["test"]);
  run("npm", ["run", "build"]);

  if (dryRun) {
    console.log("\nWould run:");
    console.log(`- update CHANGELOG.md with ${nextVersion} - ${today()}`);
    console.log(`- npm version ${bump} --no-git-tag-version`);
    console.log("- git add package.json package-lock.json CHANGELOG.md");
    console.log(`- git commit -m \"Release ${tag}\"`);
    console.log(`- git tag -a ${tag} -m \"Release ${tag}\"`);
    console.log("- git push --follow-tags");
    console.log("- npm publish --access public");
    console.log(`- gh release create ${tag} --title ${tag} --notes-file <release-notes>`);
    return;
  }

  const releaseNotes = releaseChangelog(nextVersion);
  run("npm", ["version", bump, "--no-git-tag-version"]);

  const bumpedVersion = getPackageVersion();
  if (bumpedVersion !== nextVersion) {
    fail(`expected npm version to produce ${nextVersion}, got ${bumpedVersion}`);
  }

  run("git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
  run("git", ["commit", "-m", `Release ${tag}`]);
  run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
  run("git", ["push", "--follow-tags"]);

  await confirmPublish(nextVersion, releaseNotes);

  run("npm", ["publish", "--access", "public"]);
  createGitHubRelease(tag, releaseNotes);

  console.log(`\nReleased @ivcota/loadout@${nextVersion}`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
