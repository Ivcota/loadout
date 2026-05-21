// Subprocess used by test/swap-sigint.test.ts.
//
// Args (env):
//   LOADOUT_ROOT  — directory for ~/.loadout-equivalent
//   ACTIVE_DIR    — fake harness active dir
//   POOL_DIR      — fake harness pool dir
//   MOVE_DELAY_MS — sleep per move (default 50)
//   SKILLS        — comma-separated skill names to activate
//
// Behavior: applies an "on default" plan, sleeping MOVE_DELAY_MS before each
// move. Designed to be killed mid-flight via SIGINT from the parent.

import { Effect } from "effect";
import { DirectoryAdapter } from "../src/adapters/DirectoryAdapter.js";
import { pathsFor } from "../src/state/manager.js";
import { execute, plan } from "../src/swap/engine.js";
import type { ModesManifest } from "../src/manifest/schema.js";
import { initialState } from "../src/state/schema.js";

const root = process.env["LOADOUT_ROOT"];
const activeDir = process.env["ACTIVE_DIR"];
const poolDir = process.env["POOL_DIR"];
const skills = (process.env["SKILLS"] ?? "").split(",").filter((s) => s.length > 0);
const delay = Number(process.env["MOVE_DELAY_MS"] ?? "50");

if (!root || !activeDir || !poolDir) {
  console.error("missing required env vars");
  process.exit(2);
}

// Slow adapter: wraps real DirectoryAdapter, sleeps before each apply.
class SlowAdapter extends DirectoryAdapter {
  override apply(move: import("../src/state/schema.js").PlannedMove) {
    return Effect.gen(function* () {
      yield* Effect.sleep(`${delay} millis`);
      yield* DirectoryAdapter.prototype.apply.call(adapter, move) as Effect.Effect<void, import("../src/adapters/HarnessAdapter.js").AdapterError>;
    }) as Effect.Effect<void, import("../src/adapters/HarnessAdapter.js").AdapterError>;
  }
}

const adapter = new SlowAdapter("claude", activeDir, poolDir);

const manifest: ModesManifest = {
  version: 1,
  modes: { default: { skills } },
};

const program = Effect.gen(function* () {
  const snap = yield* adapter.snapshot();
  const result = plan({
    op: "on",
    mode: "default",
    manifest,
    activeModes: [],
    harnesses: [snap],
  });
  process.stdout.write("READY\n");
  yield* execute(initialState, "on", "default", result, {
    paths: pathsFor(root),
    adapters: [adapter],
  });
});

Effect.runPromise(program).then(
  () => process.exit(0),
  (err) => {
    console.error(String(err));
    process.exit(1);
  },
);
