# Loadout

Loadout manages which AI skills are visible to each supported harness by moving skill folders between active directories and per-harness pools.

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
A named set of skill names that Loadout makes visible across every harness adapter where those skills exist.
_Avoid_: Profile, preset, harness-specific mode

## Relationships

- A **Harness Adapter** owns exactly one **Active Directory** and one **Pool Directory**.
- A **Mode** is not scoped to a single **Harness Adapter**.
- The `claude` **Harness Adapter** uses `~/.claude/skills` as its **Active Directory** and `~/.loadout/pool/claude` as its **Pool Directory**.
- The `codex` **Harness Adapter** uses `~/.codex/skills` as its **Active Directory** and `~/.loadout/pool/codex` as its **Pool Directory**.
- The `agents` **Harness Adapter** uses `~/.agents/skills` as its **Active Directory** and `~/.loadout/pool/agents` as its **Pool Directory**.

## Example dialogue

> **Dev:** "Should Codex keep reading from the shared agents skills directory?"
> **Domain expert:** "No — Codex has its own **Active Directory** at `~/.codex/skills`; shared tools use the `agents` **Harness Adapter** for `~/.agents/skills`."

## Flagged ambiguities

- ".agent" was used to refer to the shared agents directory — resolved: the canonical path is `~/.agents/skills` and the canonical harness name is `agents`.
- The old `codex` **Harness Adapter** used `~/.agents/skills` — resolved: `codex` now means `~/.codex/skills`; `agents` means `~/.agents/skills`.
