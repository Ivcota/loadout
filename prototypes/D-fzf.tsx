import { Box, Text, render, useApp, useInput } from "ink";
import React, { useMemo, useState } from "react";
import {
  INITIAL_MODE_SKILLS,
  MODE_NAME,
  printResult,
  skillRows,
} from "./data.js";

const VISIBLE_ROWS = 12;
const ROWS = skillRows();

const fuzzyScore = (query: string, name: string): number | null => {
  if (query === "") return 0;
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] === q[qi]) {
      qi++;
      streak++;
      score += streak * 2;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : null;
};

const App: React.FC = () => {
  const { exit } = useApp();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(INITIAL_MODE_SKILLS),
  );
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);
  const [done, setDone] = useState<null | "saved" | "cancelled">(null);

  const filtered = useMemo(() => {
    if (filter === "") return [...ROWS];
    const scored = ROWS.map((r) => ({ r, s: fuzzyScore(filter, r.name) }))
      .filter((x): x is { r: (typeof ROWS)[number]; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s);
    return scored.map((x) => x.r);
  }, [filter]);

  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));
  const top = Math.max(
    0,
    Math.min(safeCursor - Math.floor(VISIBLE_ROWS / 2), filtered.length - VISIBLE_ROWS),
  );
  const window = filtered.slice(Math.max(0, top), Math.max(0, top) + VISIBLE_ROWS);

  useInput((input, key) => {
    if (done) return;
    if (key.ctrl && (input === "c" || input === "q")) {
      setDone("cancelled");
      setTimeout(() => exit(), 0);
      return;
    }
    if (key.return) {
      setDone("saved");
      setTimeout(() => exit(), 0);
      return;
    }
    if (key.escape) {
      if (filter !== "") {
        setFilter("");
        setCursor(0);
        return;
      }
      setDone("cancelled");
      setTimeout(() => exit(), 0);
      return;
    }
    if (key.upArrow || (key.ctrl && input === "k") || (key.ctrl && input === "p")) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || (key.ctrl && input === "j") || (key.ctrl && input === "n")) {
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
      return;
    }
    if (key.tab) {
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
    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setCursor(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setFilter((f) => f + input);
      setCursor(0);
    }
  });

  React.useEffect(() => {
    if (done) printResult("D-fzf", done === "saved", selected);
  }, [done, selected]);

  if (done) return null;

  const before = new Set(INITIAL_MODE_SKILLS);
  const added = [...selected].filter((s) => !before.has(s)).length;
  const removed = [...before].filter((s) => !selected.has(s)).length;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">❯ </Text>
        <Text>{filter}</Text>
        <Text color="cyan">█</Text>
        <Text dimColor>
          {"   "}
          {filtered.length}/{ROWS.length}  ·  {selected.size} selected  ·  +{added} -{removed}
        </Text>
      </Box>
      <Box>
        <Text dimColor>{"─".repeat(70)}</Text>
      </Box>
      <Box flexDirection="column">
        {window.length === 0 ? (
          <Text dimColor>  no matches</Text>
        ) : (
          window.map((r, i) => {
            const absoluteIdx = Math.max(0, top) + i;
            const focused = absoluteIdx === safeCursor;
            const checked = selected.has(r.name);
            const dot = r.orphan ? "✗" : checked ? "◉" : "◯";
            const color = r.orphan
              ? "yellow"
              : checked
                ? "green"
                : focused
                  ? "cyan"
                  : undefined;
            return (
              <Box key={r.name}>
                <Text color={focused ? "cyan" : undefined}>
                  {focused ? "▎ " : "  "}
                </Text>
                <Text color={color}>{dot} </Text>
                <Text color={focused ? "cyan" : color}>
                  {r.name.padEnd(32)}
                </Text>
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
          type to filter  ·  ↑↓ move  ·  tab toggle  ·  ⏎ save  ·  esc clear/quit
        </Text>
      </Box>
    </Box>
  );
};

render(<App />);
