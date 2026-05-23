import * as readline from "node:readline";
import { Args, Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Option } from "effect";
import { load as loadManifest } from "../manifest/loader.js";
import { createAgentsAdapter } from "../adapters/agents/index.js";
import { createClaudeAdapter } from "../adapters/claude/index.js";
import { createCodexAdapter } from "../adapters/codex/index.js";
import { loadoutHome } from "../paths.js";
import { VERSION } from "../index.js";
import { checkForUpdate, renderUpdateNotice } from "../update/check.js";
import {
  doctor,
  doctorFix,
  renderDoctor,
  renderDoctorFix,
} from "./commands/doctor.js";
import { edit, renderEdit } from "./commands/edit.js";
import { init } from "./commands/init.js";
import { list, renderList } from "./commands/list.js";
import {
  addSkill,
  deleteMode,
  newMode,
  renderManifestEdit,
  rmSkill,
  syncMode,
} from "./commands/manifest.js";
import { renderRestoreAll, restoreAll } from "./commands/restore-all.js";
import {
  renderMdSet,
  renderMdShow,
  renderMdUnset,
  setMd,
  showMd,
  unsetMd,
} from "./commands/mds.js";
import { renderSave, save } from "./commands/save.js";
import { renderStatus, status } from "./commands/status.js";
import { off, on, renderSwap, use } from "./commands/swap.js";
import type { SwapInput } from "./commands/swap.js";
import { renderUninstall, uninstall } from "./commands/uninstall.js";

const allAdapters = () => [
  createClaudeAdapter(),
  createCodexAdapter(),
  createAgentsAdapter(),
];

interface DefaultModeMissing {
  readonly _tag: "DefaultModeMissing";
  readonly op: "reset" | "sync";
  readonly knownModes: ReadonlyArray<string>;
}

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
    if (e["_tag"] === "SaveModeExists") {
      return `mode '${e["mode"]}' already exists. re-run with --force to overwrite`;
    }
    if (e["_tag"] === "SaveEmpty") {
      return `no active skills found to capture — activate a skill or use \`loadout new <mode>\` for an empty mode`;
    }
    if (e["_tag"] === "RestoreInProgress") {
      return `cannot restore-all while a swap is in progress (${e["op"]} ${e["mode"]}). resolve with \`loadout ${e["op"]} ${e["mode"]}\` or \`loadout ${e["op"]} ${e["mode"]} --rollback\`, or re-run with --force`;
    }
    if (e["_tag"] === "DefaultModeMissing") {
      const known = (e["knownModes"] as string[] | undefined) ?? [];
      const op = (e["op"] as string | undefined) ?? "sync";
      return `no 'default' mode found in modes.yaml. ${
        known.length === 0
          ? `run \`loadout init\` to seed it`
          : `pass an explicit mode: \`loadout ${op} <mode>\` (known: ${known.join(", ")})`
      }`;
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
      `\n  loadout status   see what's active right now` +
      `\n  loadout reset    return to the default mode` +
      `\n  loadout --help   list every command`,
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

const resetCmd = Command.make(
  "reset",
  { dryRun: dryRunOpt, rollback: rollbackOpt },
  ({ dryRun, rollback }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const manifest = yield* loadManifest(paths.manifest);
      if (!("default" in manifest.modes)) {
        return yield* Effect.fail({
          _tag: "DefaultModeMissing" as const,
          op: "reset" as const,
          knownModes: Object.keys(manifest.modes).sort(),
        } satisfies DefaultModeMissing);
      }
      const report = yield* use({
        paths,
        adapters: allAdapters(),
        mode: "default",
        dryRun,
        rollback,
      });
      yield* Console.log(renderSwap(report));
    }).pipe(failWith("loadout reset")),
).pipe(
  Command.withDescription(
    "Return to the default mode (alias for `loadout use default`).",
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
    for (const r of report.reservedInstalled) {
      lines.push(`  ✓ installed reserved skill '${r.skill}' → ${r.path}`);
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
    for (const a of report.baseline.adopted) {
      lines.push(`  ✓ adopted ${a.harness} instruction file as baseline (${a.bytes} bytes)`);
    }
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
    const updateNotice = yield* Effect.promise(() =>
      checkForUpdate({ paths, currentVersion: VERSION }).then(renderUpdateNotice),
    );
    yield* Console.log(renderStatus(report, updateNotice));
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

const syncCmd = Command.make(
  "sync",
  { mode: Args.optional(Args.text({ name: "mode" })) },
  ({ mode }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const explicit = Option.isSome(mode);
      const modeName = Option.getOrElse(mode, () => "default");
      if (!explicit) {
        const manifest = yield* loadManifest(paths.manifest);
        if (!("default" in manifest.modes)) {
          return yield* Effect.fail({
            _tag: "DefaultModeMissing" as const,
            op: "sync" as const,
            knownModes: Object.keys(manifest.modes).sort(),
          } satisfies DefaultModeMissing);
        }
      }
      const report = yield* syncMode({
        paths,
        adapters: allAdapters(),
        mode: modeName,
      });
      yield* Console.log(renderManifestEdit(report));
    }).pipe(failWith("loadout sync")),
).pipe(
  Command.withDescription(
    "Add every installed skill to a mode (defaults to 'default'). Does not move files.",
  ),
);

const saveCmd = Command.make(
  "save",
  {
    mode: Args.text({ name: "mode" }),
    force: Options.boolean("force"),
    md: Options.boolean("md"),
  },
  ({ mode, force, md }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const report = yield* save({
        paths,
        adapters: allAdapters(),
        mode,
        force,
        md,
      });
      yield* Console.log(renderSave(report));
    }).pipe(failWith("loadout save")),
).pipe(
  Command.withDescription(
    "Snapshot the current active skill set into <mode>. Pass --md to also capture live instruction files.",
  ),
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

const mdShowCmd = Command.make(
  "md-show",
  {
    mode: Args.text({ name: "mode" }),
    harness: Args.text({ name: "harness" }),
  },
  ({ mode, harness }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const report = yield* showMd({ paths, mode, harness });
      yield* Console.log(renderMdShow(report));
    }).pipe(failWith("loadout md-show")),
).pipe(
  Command.withDescription(
    "Print the instruction file content stored for <mode> + <harness>.",
  ),
);

const mdSetCmd = Command.make(
  "md-set",
  {
    mode: Args.text({ name: "mode" }),
    harness: Args.text({ name: "harness" }),
    path: Args.file({ name: "path" }),
  },
  ({ mode, harness, path: filePath }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const content = yield* Effect.tryPromise({
        try: () => import("node:fs/promises").then((m) => m.readFile(filePath, "utf8")),
        catch: (cause) => ({
          _tag: "MdSetReadError" as const,
          path: filePath,
          cause,
        }),
      });
      const report = yield* setMd({ paths, mode, harness, content });
      yield* Console.log(renderMdSet(report));
    }).pipe(failWith("loadout md-set")),
).pipe(
  Command.withDescription(
    "Set <mode>'s instruction file for <harness> to the contents of <path>.",
  ),
);

const mdUnsetCmd = Command.make(
  "md-unset",
  {
    mode: Args.text({ name: "mode" }),
    harness: Args.text({ name: "harness" }),
  },
  ({ mode, harness }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const report = yield* unsetMd({ paths, mode, harness });
      yield* Console.log(renderMdUnset(report));
    }).pipe(failWith("loadout md-unset")),
).pipe(
  Command.withDescription(
    "Remove the stored instruction file for <mode> + <harness>.",
  ),
);

const doctorCmd = Command.make(
  "doctor",
  {
    fix: Options.boolean("fix"),
    dryRun: Options.boolean("dry-run"),
  },
  ({ fix, dryRun }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      if (fix) {
        const fixReport = yield* doctorFix({
          paths,
          adapters: allAdapters(),
          dryRun,
        });
        yield* Console.log(renderDoctorFix(fixReport));
        const remaining = dryRun
          ? fixReport.before.issues.length
          : fixReport.after.issues.length;
        if (remaining > 0) {
          const code = Math.min(remaining, 125);
          yield* Effect.sync(() => process.exit(code));
        }
        return;
      }
      const report = yield* doctor({ paths, adapters: allAdapters() });
      yield* Console.log(renderDoctor(report));
      if (report.issues.length > 0) {
        const code = Math.min(report.issues.length, 125);
        yield* Effect.sync(() => process.exit(code));
      }
    }).pipe(failWith("loadout doctor")),
).pipe(
  Command.withDescription(
    "Verify manifest/state/filesystem invariants. Pass --fix to auto-repair safe issues (preview with --fix --dry-run). Exit code = remaining issue count.",
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

const restoreAllCmd = Command.make(
  "restore-all",
  {
    force: Options.boolean("force"),
    dryRun: Options.boolean("dry-run"),
  },
  ({ force, dryRun }) =>
    Effect.gen(function* () {
      const paths = loadoutHome();
      const report = yield* restoreAll({
        paths,
        adapters: allAdapters(),
        force,
        dryRun,
      });
      yield* Console.log(renderRestoreAll(report));
    }).pipe(failWith("loadout restore-all")),
).pipe(
  Command.withDescription(
    "Safety escape hatch: move every pool skill back to its active dir and clear active_modes. Keeps modes.yaml. Preview with --dry-run.",
  ),
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
    "Move every pool skill back to its active dir and remove ~/.loadout. Preview with --dry-run; skip the prompt with --yes.",
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
      resetCmd,
      newCmd,
      deleteCmd,
      addCmd,
      rmCmd,
      syncCmd,
      saveCmd,
      editCmd,
      mdShowCmd,
      mdSetCmd,
      mdUnsetCmd,
      doctorCmd,
      restoreAllCmd,
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
