import { Box, Text, render, useApp, useInput } from "ink";
import React, { useMemo, useState } from "react";
import {
  INITIAL_MODE_SKILLS,
  MODE_NAME,
  printResult,
  skillRows,
} from "./data.js";

const VISIBLE_ROWS = 14;
const ROWS = skillRows();

type Pane = "available" | "selected";

const App: React.FC = () => {
  const { exit } = useApp();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(INITIAL_MODE_SKILLS),
  );
  const [pane, setPane] = useState<Pane>("available");
  const [leftCursor, setLeftCursor] = useState(0);
  const [rightCursor, setRightCursor] = useState(0);
  const [filter, setFilter] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [done, setDone] = useState<null | "saved" | "cancelled">(null);

  const match = (name: string): boolean =>
    filter === "" || name.toLowerCase().includes(filter.toLowerCase());

  const available = useMemo(
    () => ROWS.filter((r) => !selected.has(r.name) && match(r.name)),
    [selected, filter],
  );
  const inMode = useMemo(
    () =>
      ROWS.filter((r) => selected.has(r.name) && match(r.name)).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [selected, filter],
  );

  const safeLeft = Math.min(leftCursor, Math.max(0, available.length - 1));
  const safeRight = Math.min(rightCursor, Math.max(0, inMode.length - 1));

  const moveToMode = (name: string) => {
    setSelected((prev) => new Set(prev).add(name));
  };
  const removeFromMode = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  useInput((input, key) => {
    if (done) return;

    if (filterMode) {
      if (key.return || key.escape) {
        setFilterMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setFilter((f) => f.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFilter((f) => f + input);
        return;
      }
      return;
    }

    if (key.escape || input === "q") {
      setDone("cancelled");
      setTimeout(() => exit(), 0);
      return;
    }
    if (input === "s") {
      setDone("saved");
      setTimeout(() => exit(), 0);
      return;
    }
    if (input === "/") {
      setFilterMode(true);
      return;
    }
    if (key.tab || key.leftArrow || key.rightArrow) {
      setPane((p) => (p === "available" ? "selected" : "available"));
      return;
    }
    if (key.upArrow || input === "k") {
      if (pane === "available") setLeftCursor((c) => Math.max(0, c - 1));
      else setRightCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      if (pane === "available")
        setLeftCursor((c) => Math.min(available.length - 1, c + 1));
      else setRightCursor((c) => Math.min(inMode.length - 1, c + 1));
      return;
    }
    if (key.return || input === " ") {
      if (pane === "available") {
        const row = available[safeLeft];
        if (row) moveToMode(row.name);
      } else {
        const row = inMode[safeRight];
        if (row) removeFromMode(row.name);
      }
      return;
    }
  });

  React.useEffect(() => {
    if (done) printResult("B-two-pane", done === "saved", selected);
  }, [done, selected]);

  if (done) return null;

  const renderColumn = (
    rows: typeof ROWS,
    cursor: number,
    active: boolean,
    side: "left" | "right",
  ) => {
    const top = Math.max(
      0,
      Math.min(cursor - Math.floor(VISIBLE_ROWS / 2), rows.length - VISIBLE_ROWS),
    );
    const window = rows.slice(Math.max(0, top), Math.max(0, top) + VISIBLE_ROWS);
    if (rows.length === 0) {
      return <Text dimColor>(empty)</Text>;
    }
    return (
      <>
        {window.map((r, i) => {
          const absoluteIdx = Math.max(0, top) + i;
          const focused = active && absoluteIdx === cursor;
          const arrow = side === "left" ? "→ " : "← ";
          return (
            <Box key={r.name}>
              <Text color={focused ? "cyan" : undefined}>
                {focused ? arrow : "  "}
              </Text>
              <Text color={r.orphan ? "yellow" : focused ? "cyan" : undefined}>
                {r.name.padEnd(26)}
              </Text>
              <Text dimColor>
                {r.orphan ? "!disk" : r.harnesses.join("+")}
              </Text>
            </Box>
          );
        })}
      </>
    );
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>edit mode: </Text>
        <Text bold color="cyan">{MODE_NAME}</Text>
        <Text>   ({selected.size} in mode, {ROWS.length - selected.size} available)</Text>
      </Box>
      <Box>
        <Text dimColor>filter: </Text>
        <Text color={filterMode ? "yellow" : undefined}>
          {filter || (filterMode ? "" : "(press / to filter)")}
        </Text>
        {filterMode ? <Text color="yellow">█</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Box flexDirection="column" width={38} marginRight={2}>
          <Text bold underline color={pane === "available" ? "cyan" : undefined}>
            available ({available.length})
          </Text>
          {renderColumn(available, safeLeft, pane === "available", "left")}
        </Box>
        <Box flexDirection="column" width={38}>
          <Text bold underline color={pane === "selected" ? "cyan" : undefined}>
            in mode ({inMode.length})
          </Text>
          {renderColumn(inMode, safeRight, pane === "selected", "right")}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {filterMode
            ? "[enter] done filtering   [esc] exit filter"
            : "[enter] move   [tab/←/→] switch pane   [/] filter   [s] save   [esc/q] quit"}
        </Text>
      </Box>
    </Box>
  );
};

render(<App />);
