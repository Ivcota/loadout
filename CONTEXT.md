# Loadout

Loadout manages which AI skills and harness instruction files are visible to each supported harness by swapping skill folders and instruction files between active locations and Loadout-owned storage.

## Language

**Harness Adapter**:
A Loadout integration that manages one harness-visible skills directory and its corresponding pool.
_Avoid_: Adapter, integration, connector

**Active Directory**:
The skills directory currently visible to a harness.
_Avoid_: Installed directory, live folder

**Pool Directory**:
The Loadout-managed holding directory for skills that remain installed but are not currently visible to a harness.
_Avoid_: Archive, backup, stash

**Shared Agents Harness**:
The harness adapter for tools that read skills from `~/.agents/skills`.
_Avoid_: Codex, .agent, generic agent

**Mode**:
A named set of skill names — and optionally per-harness instruction-file content — that Loadout makes visible across every harness adapter where those skills exist.
_Avoid_: Profile, preset, harness-specific mode

**Instruction File**:
The single file each harness reads at session start to load behavioral instructions — `CLAUDE.md` for the `claude` harness, `AGENTS.md` for the `codex` harness. The `agents` harness has no canonical instruction file and does not participate.
_Avoid_: CLAUDE.md (when speaking generically), system prompt, rules file

**Mode Instruction File**:
The instruction-file content a **Mode** carries for a specific **Harness Adapter**. Optional per (mode, harness). Stored at `~/.loadout/mds/<mode>/<harness>.md`.
_Avoid_: Mode CLAUDE.md, mode prompt

**Baseline Instruction File**:
The user's original **Instruction File** content for a harness, snapshotted on first adoption. Used as the live content whenever no active **Mode** supplies a **Mode Instruction File** for that harness. Stored at `~/.loadout/mds/baseline/<harness>.md`.
_Avoid_: Default CLAUDE.md, fallback prompt

## Relationships

- A **Harness Adapter** owns exactly one **Active Directory** and one **Pool Directory**.
- A **Harness Adapter** that has an **Instruction File** owns exactly one **Baseline Instruction File**.
- A **Mode** is not scoped to a single **Harness Adapter**.
- A **Mode** may have at most one **Mode Instruction File** per **Harness Adapter**; the slot is optional.
- When multiple active **Modes** supply a **Mode Instruction File** for the same **Harness Adapter**, the most-recently-activated **Mode** wins (last-applied semantics); the others are not composed.
- When no active **Mode** supplies a **Mode Instruction File** for a harness, the **Baseline Instruction File** is live.
- The `claude` **Harness Adapter** uses `~/.claude/skills` as its **Active Directory**, `~/.loadout/pool/claude` as its **Pool Directory**, and `~/.claude/CLAUDE.md` as its **Instruction File** location.
- The `codex` **Harness Adapter** uses `~/.codex/skills` as its **Active Directory**, `~/.loadout/pool/codex` as its **Pool Directory**, and the codex `AGENTS.md` location as its **Instruction File** location.
- The `agents` **Harness Adapter** uses `~/.agents/skills` as its **Active Directory** and `~/.loadout/pool/agents` as its **Pool Directory**. It has no **Instruction File** and does not support **Mode Instruction Files**.

## Example dialogue

> **Dev:** "Should Codex keep reading from the shared agents skills directory?"
> **Domain expert:** "No — Codex has its own **Active Directory** at `~/.codex/skills`; shared tools use the `agents` **Harness Adapter** for `~/.agents/skills`."

> **Dev:** "If `daily` and `engineering` are both active and both define a claude **Mode Instruction File**, do they get concatenated into `~/.claude/CLAUDE.md`?"
> **Domain expert:** "No — last-applied wins. Whichever **Mode** was activated most recently has its **Mode Instruction File** live; turning that **Mode** off restores the prior active **Mode**'s file, or the **Baseline Instruction File** if none."

## Flagged ambiguities

- ".agent" was used to refer to the shared agents directory — resolved: the canonical path is `~/.agents/skills` and the canonical harness name is `agents`.
- The old `codex` **Harness Adapter** used `~/.agents/skills` — resolved: `codex` now means `~/.codex/skills`; `agents` means `~/.agents/skills`.
- "CLAUDE.md" was used to refer to the concept of per-harness instruction files generally — resolved: the generic concept is **Instruction File**; `CLAUDE.md` refers specifically to the `claude` harness's file.
