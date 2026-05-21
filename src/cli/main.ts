import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { createClaudeAdapter } from "../adapters/claude/index.js";
import { createCodexAdapter } from "../adapters/codex/index.js";
import { loadoutHome } from "../paths.js";
import { VERSION } from "../index.js";
import { init } from "./commands/init.js";
import { list, renderList } from "./commands/list.js";
import { renderStatus, status } from "./commands/status.js";

const allAdapters = () => [createClaudeAdapter(), createCodexAdapter()];

const failWith = (label: string) =>
  Effect.catchAll((err: unknown) =>
    Console.error(`${label} failed: ${String(err)}`).pipe(
      Effect.zipRight(Effect.sync(() => process.exit(1))),
    ),
  );

const root = Command.make("loadout", {}, () =>
  Console.log(
    `loadout v${VERSION} — swap groups of AI skills in/out of your harness.\n` +
      `\nv1 commands: init, status, list  (on/off/use/edit/add/rm/new/delete/uninstall/doctor pending)\n`,
  ),
);

const initCmd = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const paths = loadoutHome();
    const report = yield* init({ paths, adapters: allAdapters() });

    const lines: string[] = [];
    lines.push(`loadout init — root: ${paths.root}`);
    for (const d of report.discovered) {
      lines.push(`  ${d.harness}: ${d.skills.length} active skill(s) discovered`);
    }
    lines.push(
      report.manifestWritten
        ? `  ✓ wrote ${paths.manifest.manifestFile} (mode "default" seeded with ${report.manifest.modes["default"]?.skills.length ?? 0} skill(s))`
        : `  · ${paths.manifest.manifestFile} already exists — left untouched`,
    );
    lines.push(
      report.stateWritten
        ? `  ✓ wrote ${paths.state.stateFile} (active_modes=${JSON.stringify(report.state.active_modes)})`
        : `  · ${paths.state.stateFile} already initialized — left untouched`,
    );
    lines.push(`  no files moved.`);
    yield* Console.log(lines.join("\n"));
  }).pipe(failWith("loadout init")),
);

const statusCmd = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const paths = loadoutHome();
    const report = yield* status({ paths, adapters: allAdapters() });
    yield* Console.log(renderStatus(report));
  }).pipe(failWith("loadout status")),
);

const listCmd = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const paths = loadoutHome();
    const report = yield* list({ paths });
    yield* Console.log(renderList(report));
  }).pipe(failWith("loadout list")),
);

const cli = Command.run(
  root.pipe(Command.withSubcommands([initCmd, statusCmd, listCmd])),
  {
    name: "loadout",
    version: VERSION,
  },
);

cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
