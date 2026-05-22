# Changelog

## Unreleased

### Fixed
- `DirectoryAdapter.snapshot` now ignores hidden directories (names starting with `.`) when listing active and pool skills. Codex creates `.system/` to hold its bundled system skills (`imagegen`, `skill-creator`, etc.); previously loadout treated it as a user skill and tried to swap it in/out, which failed with `ENOTEMPTY` whenever a stale copy already existed in the pool.

## 0.3.0 - 2026-05-22

### Added
- Mode instruction files: each mode can now bundle a per-harness CLAUDE.md / AGENTS.md alongside its skills. Activating a mode materializes the right file at the harness's canonical path; the last active mode with an MD wins.
- `loadout md-show <mode> <harness>`, `loadout md-set <mode> <harness> <path>`, `loadout md-unset <mode> <harness>` to author mode MDs from the CLI.
- `loadout save <mode> --md` snapshots whatever instruction file is currently live for each harness into the mode's MD slot.
- `loadout init` now adopts whatever lives at each harness's instruction-file path as a `baseline` MD, used as the fallback when no active mode supplies one. Re-running is a no-op unless you pass `--force`.
- Two new `loadout doctor` invariants: `md-drift` (live instruction file disagrees with the recorded sha) and `missing-mode-md` (`state.live_mds` points to a mode MD that no longer exists on disk).
- `state.json` now records `live_mds: { <harness>: { mode, sha256 } }` to detect drift between materializations.

### Changed
- `HarnessAdapter` gained `instructionFilePath`, `readInstructionFile`, and `writeInstructionFile`. Claude uses `~/.claude/CLAUDE.md`, Codex uses `~/.codex/AGENTS.md`, shared `agents` has no convention and returns `null`.
- Writes to instruction files are atomic (tmp + rename, with EXDEV fallback) so a crash mid-write can't leave a half-written CLAUDE.md.
- Swap reports now include `mdNotices`; the CLI prints a one-line "restart your harness session" hint when a harness's instruction file changes.
## 0.2.3 - 2026-05-21

### Added
- Documented the manual release policy.
- Added local release automation for future releases.

### Changed
- Bumped package version from 0.2.2 to 0.2.3.
