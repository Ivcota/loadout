import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { VERSION } from "../index.js";

const root = Command.make("loadout", {}, () =>
  Console.log(
    `loadout v${VERSION} — swap groups of AI skills in/out of your harness.\n` +
      `\nv1 commands (not yet implemented):\n` +
      `  init, on, off, use, status, list, edit, add, rm, new, delete, uninstall, doctor\n`,
  ),
);

const cli = Command.run(root, {
  name: "loadout",
  version: VERSION,
});

cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
