# loadout

> Keep hundreds of AI skills installed without overwhelming your agent. Switch the visible set by task — product, design, research, coding — crash-safe, one-command rollback.

**Status:** v0.0.0 — CLI surface lands incrementally per the build plan.

## The problem

You've collected a lot of AI skills. `~/.claude/skills/` is full. Codex too. Past a certain count, your harness silently drops some — they're installed, but invisible to the model. You end up:

- Manually moving folders in and out of `skills/`
- Tolerating the clutter and hoping the model picks the right one
- Keeping fewer skills installed than you actually want

`loadout` fixes this without deleting anything. Every skill stays installed. Only the *active set* is visible to the harness; the rest sits in a **pool** ready to swap in.

```
~/.claude/skills/           ← active set: what the harness sees
~/.loadout/pool/claude/     ← pool: installed but hidden
~/.loadout/modes.yaml       ← named subsets ("product", "design", ...)
~/.loadout/state.json       ← which modes are active right now
```

A *mode* is a named subset of skills. Activating a mode moves its skills from pool → active. Deactivating moves them back. Files are moved with atomic renames and a lockfile — if a swap is interrupted, the next command resumes it.

## Why use it

- **You keep every skill.** Nothing is deleted; everything is reversible.
- **Crash-safe.** Atomic moves, lockfile, resume-on-interrupt. `Ctrl-C` mid-swap is fine.
- **One escape hatch.** `loadout restore-all` puts everything back where the harness can see it.
- **Multi-harness.** Claude Code and Codex out of the box; one manifest covers both.

> **Trying someone else's setup?** Want to play with a curated skill pack (gstack, a friend's dotfiles, anything) without their skills cluttering yours? Run `loadout save mine` to snapshot what you already have, install the pack, then `loadout save theirs`. Now `loadout use mine` and `loadout use theirs` flip between the two — borrow setups freely, your workflow stays intact.

## Install & first run

```sh
npm install -g @ivcota/loadout
loadout init              # scan harnesses, seed 'default' mode with everything
loadout status            # show active modes + per-harness skill counts
```

`init` writes `~/.loadout/modes.yaml` and `~/.loadout/state.json`. It does **not** move any files.

## Daily workflow

```sh
# I'm switching to product work — collapse my visible skills to just product
loadout use product

# Need design skills too for this session — stack them on
loadout on design

# Done with design — drop it, keep product
loadout off design

# Where am I right now?
loadout status

# I've manually tuned my active set and want to save it as 'deep-work'
loadout save deep-work

# Pick skills for a mode in an interactive checkbox UI
loadout edit research

# Quick edits to modes.yaml without the TUI
loadout new   research
loadout add   research investigate
loadout rm    research old-skill
loadout sync  default     # add newly installed skills to a mode
loadout delete throwaway
```

### Task presets

```sh
# Coding session
loadout use coding
loadout on tdd

# Writing / marketing
loadout use marketing
loadout on hormozi-ad-factory

# Research dive
loadout use research
```

## Safety & escape hatches

You can preview any destructive command:

```sh
loadout use product   --dry-run    # show planned moves, change nothing
loadout restore-all   --dry-run
loadout uninstall     --dry-run
```

If something feels off:

```sh
loadout doctor              # report invariant violations (manifest/state/fs)
loadout doctor --fix        # auto-repair safe issues (preview with --fix --dry-run)
loadout restore-all         # move every pool skill back to active; keep modes.yaml
loadout uninstall           # restore-all + remove ~/.loadout entirely
```

If a swap is mid-flight when you re-run any command, loadout drains it first. To undo it explicitly:

```sh
loadout use product --rollback   # revert the in-progress op
```

## What `doctor` catches (and `--fix` resolves)

| Issue | Severity | Auto-fix |
|---|---|---|
| `missing-active-skill` — mode expects skill in active, but it's in pool | error | ✓ moves it back |
| `unknown-active-mode` — `state.json` names a mode missing from `modes.yaml` | error | ✓ drops it |
| `stale-lock` — orphaned lock from a crashed process | warn | ✓ clears it |
| `unknown-skill` — mode references a skill not installed anywhere | warn | manual |
| `orphan-pool-skill` — pool has a skill no mode references | warn | manual |

`doctor` exits with code = remaining-issue-count, so it's CI-friendly.

## How it works (one paragraph)

Each harness adapter owns an *active dir* (e.g. `~/.claude/skills`) and a *pool dir* (`~/.loadout/pool/claude/`). A mode is a list of skill folder names. Activating a mode plans a set of `activate` moves (pool → active) for skills not yet active; deactivating plans `deactivate` moves. Plans are written to `state.json` as an `in_progress` block before any rename, then drained one move at a time. On crash, the next command sees `in_progress` and resumes. Cross-filesystem renames fall back to copy-then-delete.

## Design

See the design doc at `~/.gstack/projects/skill-mode/iversondiles-main-design-20260520-162620.md` (gstack artifact) for the full architecture, eng review, and build order.

## Stack

- TypeScript (Node 20+, ESM)
- Effect-TS runtime (`effect`, `@effect/cli`, `@effect/platform`)
- Ink for the TUI
- `proper-lockfile`, `write-file-atomic`, `fs-extra` for crash-safe swaps
- Vitest + `@effect/vitest` + `fast-check` for tests
- tsup for build

## Dev

```sh
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js --help
```

## License

MIT
