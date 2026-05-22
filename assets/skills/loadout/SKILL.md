---
name: loadout
description: Manage the user's installed AI skills with the `loadout` CLI — switch which skills are visible to the harness by task ("product", "design", "coding", etc.), stack and unstack mode groups, snapshot the current active set, and recover from a broken state. Use when the user mentions "loadout", "switch modes", "swap skills", "too many skills", "hide some skills", "/loadout", or when the user describes shifting between kinds of work (e.g. "I'm moving to design work now") and you want to suggest narrowing the visible skill set.
---

# loadout

`loadout` is a CLI installed on this machine. It keeps every AI skill installed but only shows a chosen subset to the harness. A *mode* is a named subset of skill folder names, and optionally a per-harness instruction file (`CLAUDE.md` / `AGENTS.md`). Activating a mode moves its skills from a *pool* into the *active* dir and materializes its instruction file at the harness's canonical path; deactivating moves skills back. All swaps are atomic, lockfile-guarded, and resume-on-interrupt.

You manage this for the user by running `loadout` commands through the shell tool. **Never edit `~/.loadout/modes.yaml` or `~/.loadout/state.json` directly** — always go through the CLI so the lockfile, in-progress block, and crash-safe swap planner stay correct.

## When to suggest a mode swap

- User says they're switching focus ("moving to design work", "let's do some research", "back to coding") → suggest `loadout use <mode>` if a matching mode exists. If you're unsure which mode, run `loadout list` first.
- User complains a skill they expect isn't being picked up → run `loadout status`; if the skill is pooled, it's hidden — suggest `loadout on <mode>` for whichever mode references it.
- User says "I have too many skills" or the harness is dropping skills → propose modes that group their work, then `loadout new <mode>` + `loadout add <mode> <skill>` or `loadout edit <mode>` to populate.
- User experiments with someone else's skill pack ("try gstack", "load this dotfile pack") → suggest `loadout save mine` first to snapshot, then install the pack, then `loadout save theirs`. Now `loadout use mine` / `loadout use theirs` flip between them.
- Something looks wrong (skills missing, half-applied swap, "no such mode") → start with `loadout doctor`. If it reports issues, `loadout doctor --fix --dry-run` previews the repair; `loadout doctor --fix` applies it.
- User wants a mode to also carry harness instructions (a CLAUDE.md or AGENTS.md that should be installed alongside its skills) → `loadout md-set <mode> <harness> <path>`. Or have them tune the live file by hand, then `loadout save <mode> --md` to snapshot it.

Default to `--dry-run` for any destructive op the first time, then apply.

## Command reference

### Read-only — safe to run anytime

| Command | Purpose |
|---|---|
| `loadout status` | Active modes, in-progress swap (if any), per-harness skill counts. Start here. |
| `loadout list` | Every mode in `modes.yaml` with skill counts. |
| `loadout doctor` | Report manifest/state/filesystem invariant violations. Exit code = issue count. |

### Mode swaps

| Command | Effect |
|---|---|
| `loadout use <mode>` | Replace all active modes with `<mode>`. The big "switch context" hammer. |
| `loadout on <mode>` | Stack `<mode>` on top of currently active modes. |
| `loadout off <mode>` | Drop `<mode>`; other active modes stay. |

All three accept `--dry-run` (preview moves, change nothing) and `--rollback` (revert an in-progress op of that kind).

### Manifest edits (don't move files)

| Command | Effect |
|---|---|
| `loadout new <mode>` | Create an empty mode in `modes.yaml`. |
| `loadout delete <mode>` | Remove a mode (must not be active — `loadout off <mode>` first). |
| `loadout add <mode> <skill>` | Add a skill name to a mode. |
| `loadout rm <mode> <skill>` | Remove a skill name from a mode. |
| `loadout sync <mode>` | Add every currently-installed skill (active + pool) to a mode. |
| `loadout edit <mode>` | Open an interactive Ink checkbox TUI. **Don't run this for the user** — it needs a real terminal. Tell them to run it themselves. |
| `loadout save <mode>` | Snapshot whatever is currently active across harnesses into `<mode>`. `--force` overwrites. Pass `--md` to also snapshot each harness's live instruction file into the mode. |

### Mode instruction files (CLAUDE.md / AGENTS.md)

A mode can bundle a per-harness instruction file (Claude reads `~/.claude/CLAUDE.md`, Codex reads `~/.codex/AGENTS.md`; shared `agents` has no convention and is skipped). When the user activates a mode, loadout writes that mode's MD to the harness's canonical path. Resolution across stacked modes is **last-applied-wins**: the last mode in `active_modes` that supplies an MD for a given harness wins. If none do, loadout restores the `baseline` MD snapshotted at `loadout init`.

| Command | Effect |
|---|---|
| `loadout md-show <mode> <harness>` | Print a mode's stored MD for a harness. |
| `loadout md-set <mode> <harness> <path>` | Store the contents of `<path>` as the mode's MD for that harness. Creates or overwrites. |
| `loadout md-unset <mode> <harness>` | Remove a mode's stored MD for a harness. |
| `loadout save <mode> --md` | Snapshot whatever is currently live at each harness's instruction-file path into the mode. |

After a swap, loadout prints a one-line "restart your harness session" hint if the instruction file changed — relay that to the user, since the running session won't pick up the new MD until restart.

### Recovery

| Command | Effect |
|---|---|
| `loadout doctor --fix` | Auto-repair safe invariant violations. Preview with `--fix --dry-run`. |
| `loadout <use\|on\|off> <mode> --rollback` | Revert an in-progress swap. |
| `loadout restore-all` | Move every pool skill back to active; clear `active_modes`. Keeps `modes.yaml`. |
| `loadout uninstall` | `restore-all` + remove `~/.loadout`. Prompts unless `--yes`. |

## Typical interactions

**"Switch me to product mode."**
```
loadout use product
```

**"Also load design — I'm pairing with a designer."**
```
loadout on design
```

**"What's loaded right now?"**
```
loadout status
```

**"Save what I have right now as 'deep-work'."**
```
loadout save deep-work
# include the live CLAUDE.md/AGENTS.md too:
loadout save deep-work --md
```

**"Give 'coding' mode its own CLAUDE.md."**
```
loadout md-set coding claude ./CLAUDE.coding.md
# or, after hand-tuning the live file:
loadout save coding --md
```

**"I think a skill is missing."**
1. `loadout status` — confirm what's active.
2. `loadout doctor` — check for invariant violations.
3. If `doctor` reports `missing-active-skill`: `loadout doctor --fix`.
4. If the skill simply isn't in the active mode: `loadout on <mode-that-has-it>` or `loadout add <active-mode> <skill>` then re-`use` the mode.

**"Something's wrong, get me back to a clean state."**
```
loadout restore-all --dry-run    # show what would move
loadout restore-all              # apply
```

## Gotchas

- A swap that's interrupted (Ctrl-C, crash) leaves an `in_progress` block in `state.json`. **The next command drains it first** — you don't need to do anything special, just re-run the command. To explicitly undo: pass `--rollback`.
- Cross-filesystem moves automatically fall back to copy-then-delete. No action needed.
- The `loadout` skill itself (this file) is reserved — it's hidden from every mode and never enters the pool. You can't accidentally swap it out from under yourself. It's removed by `loadout uninstall`.
- Claude Code (`~/.claude/skills/`), Codex (`~/.codex/skills/`), and shared agents (`~/.agents/skills/`) are managed separately. A mode's skill list applies to whichever harness has that skill installed.
- Instruction files only update on the next swap. If the user hand-edits `~/.claude/CLAUDE.md` and then runs `loadout doctor`, expect a `md-drift` warning — that's working as intended. Resolve by either `loadout save <active-mode> --md` (keep the edits) or re-activating the mode (discard them).

## Don't

- Don't hand-edit `~/.loadout/modes.yaml` or `~/.loadout/state.json`.
- Don't run `loadout edit` non-interactively — it's a TUI.
- Don't suggest `loadout uninstall` casually. It's a real uninstall, not a reset; use `restore-all` for "get me back to normal".
