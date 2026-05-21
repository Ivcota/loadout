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

const App: React.FC = () => {
  const { exit } = useApp();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(INITIAL_MODE_SKILLS),
  );
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [done, setDone] = useState<null | "saved" | "cancelled">(null);

  const filtered = useMemo(
    () =>
      ROWS.filter(
        (r) => filter === "" || r.name.toLowerCase().includes(filter.toLowerCase()),
      ),
    [filter],
  );
  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));
  const top = Math.max(
    0,
    Math.min(safeCursor - Math.floor(VISIBLE_ROWS / 2), filtered.length - VISIBLE_ROWS),
  );
  const window = filtered.slice(top, top + VISIBLE_ROWS);

  useInput((input, key) => {
    if (done) return;

    if (filterMode) {
      if (key.return || key.escape) {
        setFilterMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setFilter((f) => f.slice(0, -1));
        setCursor(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFilter((f) => f + input);
        setCursor(0);
        return;
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
      setFilterMode(true);
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
      return;
    }
    if (input === " ") {
      const row = filtered[safeCursor];
      if (!row) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(row.name)) next.delete(row.name);
        else next.add(row.name);
        return next;
      });
      return;
    }
    if (input === "a") {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of filtered) next.add(r.name);
        return next;
      });
      return;
    }
    if (input === "n") {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of filtered) next.delete(r.name);
        return next;
      });
      return;
    }
  });

  React.useEffect(() => {
    if (done) {
      printResult("A-flat", done === "saved", selected);
    }
  }, [done, selected]);

  if (done) return null;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>edit mode: </Text>
        <Text bold color="cyan">{MODE_NAME}</Text>
        <Text>   ({selected.size} of {ROWS.length} skills)</Text>
      </Box>
      <Box>
        <Text dimColor>filter: </Text>
        <Text color={filterMode ? "yellow" : undefined}>
          {filter || (filterMode ? "" : "(press / to filter)")}
        </Text>
        {filterMode ? <Text color="yellow">█</Text> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {window.length === 0 ? (
          <Text dimColor>no matches</Text>
        ) : (
          window.map((r, i) => {
            const absoluteIdx = top + i;
            const focused = absoluteIdx === safeCursor;
            const checked = selected.has(r.name);
            const mark = r.orphan ? "!" : checked ? "x" : " ";
            const color = r.orphan ? "yellow" : focused ? "cyan" : undefined;
            return (
              <Box key={r.name}>
                <Text color={focused ? "cyan" : undefined}>
                  {focused ? "> " : "  "}
                </Text>
                <Text color={color}>[{mark}] </Text>
                <Text color={color}>{r.name.padEnd(34)}</Text>
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
          {filterMode
            ? "[enter] done filtering   [esc] exit filter"
            : "[space] toggle  [a] all  [n] none  [/] filter  [enter] save  [esc/q] quit"}
        </Text>
      </Box>
    </Box>
  );
};

render(<App />);
