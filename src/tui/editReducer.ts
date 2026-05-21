export interface SkillRow {
  readonly name: string;
  readonly harnesses: ReadonlyArray<string>;
  readonly orphan: boolean;
}

export interface EditState {
  readonly rows: ReadonlyArray<SkillRow>;
  readonly selected: ReadonlySet<string>;
  readonly initial: ReadonlySet<string>;
  readonly filter: string;
  readonly filterFocused: boolean;
  readonly selectedOnly: boolean;
  readonly cursor: number;
}

export type EditAction =
  | { readonly _tag: "MoveUp" }
  | { readonly _tag: "MoveDown" }
  | { readonly _tag: "ToggleCurrent" }
  | { readonly _tag: "SelectAllVisible" }
  | { readonly _tag: "DeselectAllVisible" }
  | { readonly _tag: "ToggleSelectedOnly" }
  | { readonly _tag: "FocusFilter" }
  | { readonly _tag: "BlurFilter" }
  | { readonly _tag: "FilterAppend"; readonly char: string }
  | { readonly _tag: "FilterBackspace" }
  | { readonly _tag: "FilterClear" };

export const buildRows = (
  pool: ReadonlySet<string>,
  modeSkills: ReadonlyArray<string>,
  harnessIndex: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<SkillRow> => {
  const inMode = new Set(modeSkills);
  const all = new Set<string>();
  for (const s of pool) all.add(s);
  for (const s of inMode) all.add(s);
  return [...all]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      harnesses: harnessIndex.get(name) ?? [],
      orphan: !pool.has(name),
    }));
};

export const initialState = (input: {
  readonly rows: ReadonlyArray<SkillRow>;
  readonly modeSkills: ReadonlyArray<string>;
}): EditState => {
  const initial = new Set(input.modeSkills);
  return {
    rows: input.rows,
    selected: new Set(initial),
    initial,
    filter: "",
    filterFocused: false,
    selectedOnly: false,
    cursor: 0,
  };
};

const matchesFilter = (name: string, filter: string): boolean =>
  filter === "" || name.toLowerCase().includes(filter.toLowerCase());

export const visibleRows = (s: EditState): ReadonlyArray<SkillRow> =>
  s.rows.filter(
    (r) =>
      matchesFilter(r.name, s.filter) &&
      (!s.selectedOnly || s.selected.has(r.name)),
  );

const clampCursor = (s: EditState, next: number): number => {
  const len = visibleRows(s).length;
  if (len === 0) return 0;
  if (next < 0) return 0;
  if (next >= len) return len - 1;
  return next;
};

const withCursorReclamped = (s: EditState): EditState => ({
  ...s,
  cursor: clampCursor(s, s.cursor),
});

const toggle = (set: ReadonlySet<string>, name: string): Set<string> => {
  const next = new Set(set);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  return next;
};

export const reduce = (s: EditState, a: EditAction): EditState => {
  switch (a._tag) {
    case "MoveUp":
      return { ...s, cursor: clampCursor(s, s.cursor - 1) };
    case "MoveDown":
      return { ...s, cursor: clampCursor(s, s.cursor + 1) };
    case "ToggleCurrent": {
      const visible = visibleRows(s);
      const row = visible[s.cursor];
      if (!row) return s;
      const nextSelected = toggle(s.selected, row.name);
      const nextState: EditState = { ...s, selected: nextSelected };
      // If we're in "selected only" view and just unchecked the current row,
      // it falls out of view — reclamp the cursor so we don't drift past the end.
      return s.selectedOnly ? withCursorReclamped(nextState) : nextState;
    }
    case "SelectAllVisible": {
      const next = new Set(s.selected);
      for (const r of visibleRows(s)) next.add(r.name);
      return { ...s, selected: next };
    }
    case "DeselectAllVisible": {
      const next = new Set(s.selected);
      for (const r of visibleRows(s)) next.delete(r.name);
      return withCursorReclamped({ ...s, selected: next });
    }
    case "ToggleSelectedOnly":
      return withCursorReclamped({
        ...s,
        selectedOnly: !s.selectedOnly,
        cursor: 0,
      });
    case "FocusFilter":
      return { ...s, filterFocused: true };
    case "BlurFilter":
      return { ...s, filterFocused: false };
    case "FilterAppend":
      return withCursorReclamped({
        ...s,
        filter: s.filter + a.char,
        cursor: 0,
      });
    case "FilterBackspace":
      return withCursorReclamped({
        ...s,
        filter: s.filter.slice(0, -1),
        cursor: 0,
      });
    case "FilterClear":
      return withCursorReclamped({ ...s, filter: "", cursor: 0 });
  }
};

export interface EditDiff {
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

export const diff = (s: EditState): EditDiff => ({
  added: [...s.selected]
    .filter((n) => !s.initial.has(n))
    .sort((a, b) => a.localeCompare(b)),
  removed: [...s.initial]
    .filter((n) => !s.selected.has(n))
    .sort((a, b) => a.localeCompare(b)),
});
