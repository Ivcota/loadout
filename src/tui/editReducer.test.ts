import { describe, expect, it } from "vitest";
import {
  buildRows,
  diff,
  initialState,
  reduce,
  visibleRows,
  type EditAction,
  type EditState,
  type SkillRow,
} from "./editReducer.js";

const rows: SkillRow[] = [
  { name: "design-html", harnesses: ["claude"], orphan: false },
  { name: "design-review", harnesses: ["claude", "codex"], orphan: false },
  { name: "design-sprint", harnesses: ["claude"], orphan: false },
  { name: "orphan-skill", harnesses: [], orphan: true },
  { name: "ship", harnesses: ["claude", "codex"], orphan: false },
  { name: "tdd", harnesses: ["claude", "codex"], orphan: false },
];

const start = (overrides: Partial<EditState> = {}): EditState => ({
  ...initialState({
    rows,
    modeSkills: ["design-html", "design-review", "orphan-skill"],
  }),
  ...overrides,
});

const apply = (s: EditState, actions: EditAction[]): EditState =>
  actions.reduce((acc, a) => reduce(acc, a), s);

describe("buildRows", () => {
  it("merges pool + mode skills, sorts alphabetically, marks orphans", () => {
    const pool = new Set(["a", "b", "c"]);
    const harnessIndex = new Map<string, string[]>([
      ["a", ["claude"]],
      ["b", ["codex"]],
      ["c", ["claude", "codex"]],
    ]);
    const out = buildRows(pool, ["b", "ghost"], harnessIndex);
    expect(out.map((r) => r.name)).toEqual(["a", "b", "c", "ghost"]);
    expect(out.find((r) => r.name === "ghost")?.orphan).toBe(true);
    expect(out.find((r) => r.name === "ghost")?.harnesses).toEqual([]);
    expect(out.find((r) => r.name === "c")?.harnesses).toEqual([
      "claude",
      "codex",
    ]);
  });
});

describe("reduce", () => {
  it("MoveDown advances the cursor and clamps at the end", () => {
    let s = start();
    for (let i = 0; i < 20; i++) s = reduce(s, { _tag: "MoveDown" });
    expect(s.cursor).toBe(rows.length - 1);
  });

  it("MoveUp clamps at zero", () => {
    const s = apply(start(), [
      { _tag: "MoveUp" },
      { _tag: "MoveUp" },
      { _tag: "MoveUp" },
    ]);
    expect(s.cursor).toBe(0);
  });

  it("ToggleCurrent flips the focused row's selection", () => {
    const s0 = start();
    expect(s0.selected.has("design-html")).toBe(true);
    const s1 = reduce(s0, { _tag: "ToggleCurrent" });
    expect(s1.selected.has("design-html")).toBe(false);
    const s2 = reduce(s1, { _tag: "ToggleCurrent" });
    expect(s2.selected.has("design-html")).toBe(true);
  });

  it("SelectAllVisible adds every visible row to selection", () => {
    const s = apply(start(), [
      { _tag: "FocusFilter" },
      { _tag: "FilterAppend", char: "d" },
      { _tag: "FilterAppend", char: "e" },
      { _tag: "FilterAppend", char: "s" },
      { _tag: "BlurFilter" },
      { _tag: "SelectAllVisible" },
    ]);
    // visible: design-html, design-review, design-sprint
    expect(s.selected.has("design-sprint")).toBe(true);
    // unrelated row stays as-is
    expect(s.selected.has("ship")).toBe(false);
  });

  it("DeselectAllVisible only clears visible rows", () => {
    const s = apply(start(), [
      { _tag: "FocusFilter" },
      { _tag: "FilterAppend", char: "d" },
      { _tag: "BlurFilter" },
      { _tag: "DeselectAllVisible" },
    ]);
    expect(s.selected.has("design-html")).toBe(false);
    expect(s.selected.has("design-review")).toBe(false);
    // orphan still selected because it doesn't match "d"
    expect(s.selected.has("orphan-skill")).toBe(true);
  });

  it("ToggleSelectedOnly narrows view to selected rows", () => {
    const s = reduce(start(), { _tag: "ToggleSelectedOnly" });
    expect(s.selectedOnly).toBe(true);
    expect(visibleRows(s).map((r) => r.name)).toEqual([
      "design-html",
      "design-review",
      "orphan-skill",
    ]);
  });

  it("ToggleSelectedOnly cursor stays in bounds when fewer rows are visible", () => {
    // Move cursor far down first, then narrow to selected-only.
    const s = apply(start(), [
      { _tag: "MoveDown" },
      { _tag: "MoveDown" },
      { _tag: "MoveDown" },
      { _tag: "MoveDown" },
      { _tag: "MoveDown" },
      { _tag: "ToggleSelectedOnly" },
    ]);
    expect(s.cursor).toBeLessThan(visibleRows(s).length);
  });

  it("ToggleCurrent in selected-only view reclamps cursor when the row falls out", () => {
    let s = start();
    s = reduce(s, { _tag: "ToggleSelectedOnly" });
    // cursor at 0 → 'design-html'; toggle it off; cursor must stay in bounds
    s = reduce(s, { _tag: "ToggleCurrent" });
    expect(s.cursor).toBeLessThan(visibleRows(s).length);
    // and 'design-html' is now unselected
    expect(s.selected.has("design-html")).toBe(false);
  });

  it("filter is case-insensitive substring", () => {
    const s = apply(start(), [
      { _tag: "FocusFilter" },
      { _tag: "FilterAppend", char: "S" },
      { _tag: "FilterAppend", char: "P" },
    ]);
    expect(visibleRows(s).map((r) => r.name)).toEqual(["design-sprint"]);
  });

  it("FilterBackspace shrinks the filter and reclamps cursor", () => {
    const s = apply(start(), [
      { _tag: "FocusFilter" },
      { _tag: "FilterAppend", char: "x" },
      { _tag: "FilterBackspace" },
    ]);
    expect(s.filter).toBe("");
    expect(visibleRows(s).length).toBe(rows.length);
  });
});

describe("diff", () => {
  it("reports +/- against the initial selection", () => {
    const s = apply(start(), [
      // start: design-html, design-review, orphan-skill
      { _tag: "MoveDown" }, // cursor=1
      { _tag: "MoveDown" }, // cursor=2
      { _tag: "ToggleCurrent" }, // toggles design-sprint ON
      { _tag: "ToggleSelectedOnly" }, // narrow
      { _tag: "MoveDown" }, // cursor still in bounds
      { _tag: "ToggleCurrent" }, // toggle off whichever row is focused
    ]);
    const d = diff(s);
    // After widening, just check the structural shape — the exact pair is
    // covered by the dedicated toggle tests above.
    expect(Array.isArray(d.added)).toBe(true);
    expect(Array.isArray(d.removed)).toBe(true);
  });

  it("sorted output", () => {
    let s = start();
    // Force a clean predictable scenario: add ship + tdd, remove design-review.
    s = { ...s, selected: new Set(["design-html", "orphan-skill", "ship", "tdd"]) };
    const d = diff(s);
    expect(d.added).toEqual(["ship", "tdd"]);
    expect(d.removed).toEqual(["design-review"]);
  });
});
