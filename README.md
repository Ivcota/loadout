# loadout

> Swap groups of AI skills in/out of your harness. One manifest, fast toggles, crash-safe.

**Status:** v0.0.0 — scaffold only. CLI surface lands incrementally per the build plan.

## What it does

You have many AI skills installed under `~/.claude/skills/` (and similar paths for Codex). When the count grows large, the harness starts dropping some — they go invisible to the model. `loadout` lets you define **modes** ("product", "research", "design"), tag skills into them, and toggle so the harness only sees the active set.

```sh
loadout init             # scan your harnesses, seed a 'default' mode with everything
loadout use product      # replace active modes with just 'product'
loadout on design        # also turn on 'design' (stacks)
loadout off design       # back to just 'product'
loadout edit design      # Ink TUI: checkbox-select skills for this mode
loadout doctor           # verify invariants
```

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
