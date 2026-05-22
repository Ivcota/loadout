# Releasing Loadout

Loadout uses manual, disciplined releases with local automation. Every npm publish must have a matching git tag and GitHub Release.

## Version policy

- **Patch**: bug fixes, docs-only releases, internal refactors, packaging fixes.
- **Minor**: new commands, new flags, new harness support, additive config fields, non-breaking UX improvements.
- **Major**: breaking CLI behavior, renamed or removed commands/flags, incompatible manifest or state changes, changed filesystem layout, lowered compatibility guarantees.

Changes to `~/.loadout/modes.yaml`, `state.json`, or harness directory semantics may require a major version if existing users need migration.

## Normal release

1. Add human-readable notes under `## Unreleased` in `CHANGELOG.md`.
2. Commit all intended code and documentation changes.
3. Run the release script:

   ```sh
   npm run release -- patch
   npm run release -- minor
   npm run release -- major
   ```

The script will:

1. require a clean git working tree,
2. check `git`, `npm`, and authenticated `gh`,
3. run `npm run typecheck`, `npm test`, and `npm run build`,
4. move `CHANGELOG.md` notes from `Unreleased` to `X.Y.Z - YYYY-MM-DD`,
5. bump `package.json` and `package-lock.json`,
6. create a `Release vX.Y.Z` commit and `vX.Y.Z` tag,
7. push the commit and tag,
8. ask for confirmation,
9. publish to npm,
10. create the GitHub Release from the changelog notes.

## Dry run

Preview a release without modifying files or publishing:

```sh
npm run release -- patch --dry-run
```

Dry runs still check tools and run the quality gates.

## Hotfixes

Hotfixes follow the same process. Keep the scope small, add the fix notes under `Unreleased`, and run a patch release.

## Transitional 0.2.3 release

Version `0.2.3` was bumped before this release process existed. Treat it as the transitional manual release. Future releases should use `npm run release -- <patch|minor|major>`.
