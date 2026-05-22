# Mode Instruction Files use whole-file last-applied-wins, not fragment composition

When a **Mode** carries instruction-file content for a **Harness Adapter**, that content is the *entire* **Instruction File** for the harness, not a fragment composed with other modes' fragments. When multiple active modes supply an instruction file for the same harness, the most-recently-activated mode wins; the others are not merged in. When no active mode supplies one, the **Baseline Instruction File** is live.

We chose this over fragment composition (named, shared, concatenated snippets — the shape **Mode** uses for skills) because instruction text is small and prose-like: the indirection of named fragments, an `add` / `rm` surface for them, and a merge order would cost more than the duplication it saves. The whole-file model keeps the user's mental model tight ("a mode bundles a skill list and some instruction files") and makes the authoring workflow obvious (edit the live file, then `loadout save <mode> --md`). The accepted cost is that content common to many modes — e.g. shared house rules — must be duplicated into each mode's instruction file rather than factored into a shared fragment.

## Considered options

- **Fragment composition** — modes reference named instruction-file fragments stored separately; active modes' fragments are concatenated. Rejected: too much machinery for text that's usually short and rarely shared across many modes.
- **Concatenate whole files in mode-stack order** — keep whole-file authoring but concatenate when multiple modes are active. Rejected: drags the fragment-composition mental model back in through the side door; ordering rules become a recurring source of confusion.
- **Reject stacking when multiple modes supply an instruction file** — force the user to deactivate first. Rejected: too rigid; `loadout on` is meant to be casual.

## Consequences

- `Mode` gains an optional per-harness instruction-file slot; modes.yaml and the harness adapter contract grow accordingly.
- `state.json` tracks `live_mds: { <harness>: { mode, sha256 } }` so swaps can detect out-of-band edits to the live instruction file and so `loadout doctor` can report drift.
- The `agents` **Harness Adapter** has no canonical instruction file and is excluded from this feature.
- Instruction-file changes do not affect the current session — only the next harness session start. Loadout prints a one-line notice when a swap actually changes the live instruction-file content.
