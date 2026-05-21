import * as readline from "node:readline";
import { Args, Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { createClaudeAdapter } from "../adapters/claude/index.js";
import { createCodexAdapter } from "../adapters/codex/index.js";
import { loadoutHome } from "../paths.js";
import { VERSION } from "../index.js";
import { doctor, renderDoctor } from "./commands/doctor.js";
import { edit, renderEdit } from "./commands/edit.js";
import { init } from "./commands/init.js";
import { list, renderList } from "./commands/list.js";
import {
  addSkill,
  deleteMode,
  newMode,
  renderManifestEdit,
  rmSkill,
} from "./commands/manifest.js";
import { renderStatus, status } from "./commands/status.js";
import { off, on, renderSwap, use } from "./commands/swap.js";
import type { SwapInput } from "./commands/swap.js";
import { renderUninstall, uninstall } from "./commands/uninstall.js";

const allAdapters = () => [createClaudeAdapter(), createCodexAdapter()];

const describeError = (err: unknown): string => {
  if (err === null || err === undefined) return String(err);
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.toString();
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (e["_tag"] === "SwapModeNotFound") {
      const known = (e["knownModes"] as string[] | undefined) ?? [];
      return `unknown mode '${e["mode"]}'. known modes: ${known.length === 0 ? "(none)" : known.join(", ")}`;
    }
    if (e["_tag"] === "SwapNothingToRollback") {
      return `--rollback used but no operation is in progress`;
    }
    if (e["_tag"] === "ManifestModeAlreadyExists") {
      return `mode '${e["mode"]}' already exists in modes.yaml`;
    }
    if (e["_tag"] === "ManifestModeNotFound") {
      const known = (e["knownModes"] as string[] | undefined) ?? [];
      return `unknown mode '${e["mode"]}'. known modes: ${known.length === 0 ? "(none)" : known.join(", ")}`;
    }
    if (e["_tag"] === "ManifestModeInUse") {
      return `mode '${e["mode"]}' is currently active. run \`loadout off ${e["mode"]}\` first, then delete`;
    }
    if (e["_tag"] === "ManifestSkillNotKnown") {
      return `skill '${e["skill"]}' not found in any harness pool or active dir`;
    }
    if (e["_tag"] === "ManifestSkillNotInMode") {
      return `skill '${e["skill"]}' is not in mode '${e["mode"]}'`;
    }
    if (e["_tag"] === "UninstallInProgress") {
      return `cannot uninstall while a swap is in progress (${e["op"]} ${e["mode"]}). resolve with \`loadout ${e["op"]} ${e["mode"]}\` or \`loadout ${e["op"]} ${e["mode"]} --rollback\`, or re-run with --force`;
    }
    if (typeof e["message"] === "string") return e["message"];
    if (typeof e["_tag"] === "string") {
      try {
        return `${e["_tag"]}: ${JSON.stringify(err)}`;
      } catch {
        return String(e["_tag"]);
      }
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
};

const failWith = (label: string) =>
  Effect.catchAll((err: unknown) =>
    Effect.sync(() => {
      process.stderr.write(`${label} failed: ${describeError(err)}\n`);
      process.exit(1);
    }),
  );

const root = Command.make("loadout", {}, () =>
  Console.log(
    `loadout v${VERSION} — swap groups of AI skills in/out of your harness.\n` +
      `\nRun \`loadout --help\` to see available commands.`,
  ),
);

const modeArg = Args.text({ name: "mode" });
const dryRunOpt = Options.boolean("dry-run");
const rollbackOpt = Options.boolean("rollback");

const swapConfig = {
  mode: modeArg,
  dryRun: dryRunOpt,
  rollback: rollbackOpt,
};

type SwapHandler = (
  input: Omit<SwapInput, "op">,
) => ReturnType<typeof on>;

const swapCmd = (
  name: "on" | "off" | "use",
  handler: SwapHandler,
) =>
  Command.make(
    name,
    swapConfig,
    ({ mode, dryRun, rollback }) =>
      Effect.gen(function* () {
        const paths = loadoutHome();
        const report = yield* handler({
          paths,
          adapters: allAdapters(),
          mode,
          dryRun,
          rollback,
        });
        yield* Console.log(renderSwap(report));
      }).pipe(failWith(`loadout ${name}`)),
  );

const onCmd = swapCmd("on", on).pipe(
  Command.withDescription(
    "Activate a mode (stacks on top of currently active modes).",
  ),
);
const offCmd = swapCmd("off", off).pipe(
  Command.withDescription(
    "Deactivate a mode (other active modes remain).",
  ),
);
const useCmd = swapCmd("use", use).pipe(
  Command.withDescription(
    "Replace all active modes with this single mode.",
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
).pipe(
  Command.withDescription(
    "Discover skills, create modes.yaml + state.json, seed the 'default' mode.",
  ),
);

const statusCmd = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const paths = loadoutHome();
    const report = yield* status({ paths, adapters: allAdapters() });
    yield* Console.log(renderStatus(report));
  }).pipe(failWith("loadout status")),
).pipe(
  Command.withDescription(
    "Show active modes, in-progress swaps, and per-harness skill counts.",
  ),
);

const listCmd = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const paths = loadoutHome();
    const report = yield* list({ paths });
    yield* Console.log(renderList(report));
  }).pipe(failWith("loadout list")),
).pipe(
  Command.withDescription("List all modes and their skill counts."),
);

const newCmd = Command.make(
  "new",
  { mode: Args.text({ name: "mode" }) },
  ({ mode }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const report = yield* newMode({ paths, mode });
      yield* Console.log(renderManifestEdit(report));
    }).pipe(failWith("loadout new")),
).pipe(
  Command.withDescription("Create a new empty mode in modes.yaml."),
);

const deleteCmd = Command.make(
  "delete",
  { mode: Args.text({ name: "mode" }) },
  ({ mode }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const report = yield* deleteMode({ paths, mode });
      yield* Console.log(renderManifestEdit(report));
    }).pipe(failWith("loadout delete")),
).pipe(
  Command.withDescription(
    "Remove a mode from modes.yaml (mode must not be active).",
  ),
);

const addCmd = Command.make(
  "add",
  {
    mode: Args.text({ name: "mode" }),
    skill: Args.text({ name: "skill" }),
  },
  ({ mode, skill }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const report = yield* addSkill({
        paths,
        adapters: allAdapters(),
        mode,
        skill,
      });
      yield* Console.log(renderManifestEdit(report));
    }).pipe(failWith("loadout add")),
).pipe(
  Command.withDescription("Add a skill to a mode in modes.yaml."),
);

const rmCmd = Command.make(
  "rm",
  {
    mode: Args.text({ name: "mode" }),
    skill: Args.text({ name: "skill" }),
  },
  ({ mode, skill }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const report = yield* rmSkill({ paths, mode, skill });
      yield* Console.log(renderManifestEdit(report));
    }).pipe(failWith("loadout rm")),
).pipe(
  Command.withDescription("Remove a skill from a mode in modes.yaml."),
);

const editCmd = Command.make(
  "edit",
  { mode: Args.text({ name: "mode" }) },
  ({ mode }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const report = yield* edit({ paths, adapters: allAdapters(), mode });
      yield* Console.log(renderEdit(report));
    }).pipe(failWith("loadout edit")),
).pipe(
  Command.withDescription(
    "Open an interactive checkbox UI for choosing which skills belong to a mode.",
  ),
);

const doctorCmd = Command.make("doctor", {}, () =>
  Effect.gen(function* () {
    const paths = loadoutHome();
    const report = yield* doctor({ paths, adapters: allAdapters() });
    yield* Console.log(renderDoctor(report));
    if (report.issues.length > 0) {
      // Exit code = issue count, clamped to [1, 125] to stay in shell-safe range.
      const code = Math.min(report.issues.length, 125);
      yield* Effect.sync(() => process.exit(code));
    }
  }).pipe(failWith("loadout doctor")),
).pipe(
  Command.withDescription(
    "Verify manifest/state/filesystem invariants. Exit code = issue count.",
  ),
);

const promptYesNo = (question: string): Effect.Effect<boolean> =>
  Effect.promise(
    () =>
      new Promise<boolean>((resolve) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question(question, (answer) => {
          rl.close();
          resolve(/^(y|yes)$/i.test(answer.trim()));
        });
      }),
  );

const uninstallCmd = Command.make(
  "uninstall",
  {
    yes: Options.boolean("yes"),
    force: Options.boolean("force"),
    dryRun: Options.boolean("dry-run"),
  },
  ({ yes, force, dryRun }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      if (!yes && !dryRun) {
        const confirmed = yield* promptYesNo(
          `loadout uninstall will move every pool skill back to its active dir and remove ${paths.root}.\nproceed? (yes/no) `,
        );
        if (!confirmed) {
          yield* Console.log(`aborted.`);
          return;
        }
      }
      const report = yield* uninstall({
        paths,
        adapters: allAdapters(),
        force,
        dryRun,
      });
      yield* Console.log(renderUninstall(report));
    }).pipe(failWith("loadout uninstall")),
).pipe(
  Command.withDescription(
    "Move every pool skill back to its active dir and remove ~/.loadout.",
  ),
);

const cli = Command.run(
  root.pipe(
    Command.withSubcommands([
      initCmd,
      statusCmd,
      listCmd,
      onCmd,
      offCmd,
      useCmd,
      newCmd,
      deleteCmd,
      addCmd,
      rmCmd,
      editCmd,
      doctorCmd,
      uninstallCmd,
    ]),
  ),
  {
    name: "loadout",
    version: VERSION,
  },
);

cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  (effect) => NodeRuntime.runMain(effect, { disableErrorReporting: true }),
);
