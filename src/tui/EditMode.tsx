import { Box, Text, useApp, useInput } from "ink";
import React, { useEffect, useReducer } from "react";
import {
  diff,
  initialState,
  reduce,
  visibleRows,
  type EditState,
  type SkillRow,
} from "./editReducer.js";

const VISIBLE_ROWS = 14;

const colorProp = (
  c: string | undefined,
): { color?: string } => (c === undefined ? {} : { color: c });

export interface EditModeProps {
  readonly modeName: string;
  readonly rows: ReadonlyArray<SkillRow>;
  readonly modeSkills: ReadonlyArray<string>;
  readonly onDone: (result: {
    readonly saved: boolean;
    readonly selected: ReadonlySet<string>;
  }) => void;
}

export const EditMode: React.FC<EditModeProps> = ({
  modeName,
  rows,
  modeSkills,
  onDone,
}) => {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(
    reduce,
    { rows, modeSkills },
    initialState,
  );
  const [done, setDone] = React.useState<null | "saved" | "cancelled">(null);

  useInput((input, key) => {
    if (done) return;

    if (state.filterFocused) {
      if (key.return || key.escape) {
        dispatch({ _tag: "BlurFilter" });
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ _tag: "FilterBackspace" });
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        dispatch({ _tag: "FilterAppend", char: input });
      }
      return;
    }

    if (key.escape || input === "q") {
      setDone("cancelled");
      setTimeout(() => exit(), 0);
      return;
    }
    if (key.return) {
      setDone("saved");
      setTimeout(() => exit(), 0);
      return;
    }
    if (input === "/") {
      dispatch({ _tag: "FocusFilter" });
      return;
    }
    if (key.upArrow || input === "k") {
      dispatch({ _tag: "MoveUp" });
      return;
    }
    if (key.downArrow || input === "j") {
      dispatch({ _tag: "MoveDown" });
      return;
    }
    if (input === " ") {
      dispatch({ _tag: "ToggleCurrent" });
      return;
    }
    if (input === "a") {
      dispatch({ _tag: "SelectAllVisible" });
      return;
    }
    if (input === "n") {
      dispatch({ _tag: "DeselectAllVisible" });
      return;
    }
    if (input === "t") {
      dispatch({ _tag: "ToggleSelectedOnly" });
    }
  });

  useEffect(() => {
    if (done) onDone({ saved: done === "saved", selected: state.selected });
  }, [done, state.selected, onDone]);

  if (done) return null;
  return <EditView state={state} modeName={modeName} />;
};

const EditView: React.FC<{ state: EditState; modeName: string }> = ({
  state,
  modeName,
}) => {
  const visible = visibleRows(state);
  const cursor = Math.min(state.cursor, Math.max(0, visible.length - 1));
  const top = Math.max(
    0,
    Math.min(
      cursor - Math.floor(VISIBLE_ROWS / 2),
      visible.length - VISIBLE_ROWS,
    ),
  );
  const window = visible.slice(Math.max(0, top), Math.max(0, top) + VISIBLE_ROWS);
  const { added, removed } = diff(state);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>edit mode: </Text>
        <Text bold color="cyan">
          {modeName}
        </Text>
        <Text>
          {"   "}
          {state.selected.size} of {state.rows.length} skills
        </Text>
        {added.length > 0 || removed.length > 0 ? (
          <Text dimColor>
            {"   "}+{added.length} -{removed.length}
          </Text>
        ) : null}
        {state.selectedOnly ? (
          <Text color="magenta">{"   "}[selected-only]</Text>
        ) : null}
      </Box>
      <Box>
        <Text dimColor>filter: </Text>
        <Text {...colorProp(state.filterFocused ? "yellow" : undefined)}>
          {state.filter ||
            (state.filterFocused ? "" : "(press / to filter, t to toggle selected-only)")}
        </Text>
        {state.filterFocused ? <Text color="yellow">█</Text> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {visible.length === 0 ? (
          <Text dimColor>no matches</Text>
        ) : (
          window.map((r, i) => {
            const absoluteIdx = Math.max(0, top) + i;
            const focused = absoluteIdx === cursor;
            const checked = state.selected.has(r.name);
            const mark = r.orphan ? "!" : checked ? "x" : " ";
            const color = r.orphan
              ? "yellow"
              : focused
                ? "cyan"
                : undefined;
            return (
              <Box key={r.name}>
                <Text {...colorProp(focused ? "cyan" : undefined)}>
                  {focused ? "> " : "  "}
                </Text>
                <Text {...colorProp(color)}>[{mark}] </Text>
                <Text {...colorProp(color)}>{r.name.padEnd(34)}</Text>
                <Text dimColor>
                  {r.orphan ? "(not on disk)" : r.harnesses.join("+")}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {state.filterFocused
            ? "[enter] done filtering  [esc] exit filter"
            : "[space] toggle  [a] all  [n] none  [t] selected-only  [/] filter  [enter] save  [esc/q] quit"}
        </Text>
      </Box>
    </Box>
  );
};

