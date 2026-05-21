import { Box, Text, render, useApp, useInput } from "ink";
import React, { useMemo, useState } from "react";
import {
  INITIAL_MODE_SKILLS,
  MODE_NAME,
  printResult,
  skillRows,
  type Harness,
} from "./data.js";

const VISIBLE_ROWS = 16;
const ROWS = skillRows();

type GroupKey = Harness | "both" | "orphans";

interface FlatRow {
  readonly kind: "header" | "skill";
  readonly group: GroupKey;
  readonly name: string;
  readonly orphan?: boolean;
  readonly harnesses?: ReadonlyArray<Harness>;
}

const groupOf = (r: (typeof ROWS)[number]): GroupKey => {
  if (r.orphan) return "orphans";
  if (r.harnesses.length === 2) return "both";
  return r.harnesses[0] ?? "orphans";
};

const GROUP_ORDER: GroupKey[] = ["claude", "codex", "both", "orphans"];
const GROUP_LABEL: Record<GroupKey, string> = {
  claude: "claude",
  codex: "codex",
  both: "claude + codex",
  orphans: "orphans",
};

const App: React.FC = () => {
  const { exit } = useApp();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(INITIAL_MODE_SKILLS),
  );
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(() => new Set());
  const [cursor, setCursor] = useState(1); // skip first header
  const [filter, setFilter] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [done, setDone] = useState<null | "saved" | "cancelled">(null);

  const flat: FlatRow[] = useMemo(() => {
    type Row = (typeof ROWS)[number];
    const buckets = new Map<GroupKey, Row[]>();
    for (const r of ROWS) {
      const g = groupOf(r);
      const arr = buckets.get(g) ?? [];
      if (
        filter === "" ||
        r.name.toLowerCase().includes(filter.toLowerCase())
      ) {
        arr.push(r);
      }
      buckets.set(g, arr);
    }
    const out: FlatRow[] = [];
    for (const g of GROUP_ORDER) {
      const rows = buckets.get(g) ?? [];
      if (rows.length === 0) continue;
      out.push({ kind: "header", group: g, name: GROUP_LABEL[g] });
      if (!collapsed.has(g)) {
        for (const r of rows) {
          out.push({
            kind: "skill",
            group: g,
            name: r.name,
            orphan: r.orphan,
            harnesses: r.harnesses,
          });
        }
      }
    }
    return out;
  }, [collapsed, filter]);

  const safeCursor = Math.min(cursor, Math.max(0, flat.length - 1));
  const top = Math.max(
    0,
    Math.min(safeCursor - Math.floor(VISIBLE_ROWS / 2), flat.length - VISIBLE_ROWS),
  );
  const window = flat.slice(top, top + VISIBLE_ROWS);

  const moveCursor = (dir: -1 | 1) => {
    let next = safeCursor + dir;
    while (next >= 0 && next < flat.length) {
      if (flat[next]) break;
      next += dir;
    }
    if (next < 0) next = 0;
    if (next >= flat.length) next = flat.length - 1;
    setCursor(next);
  };

  const toggleCollapse = (g: GroupKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
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
      moveCursor(-1);
      return;
    }
    if (key.downArrow || input === "j") {
      moveCursor(1);
      return;
    }
    const row = flat[safeCursor];
    if (!row) return;
    if (key.leftArrow || key.rightArrow) {
      if (row.kind === "header") toggleCollapse(row.group);
      return;
    }
    if (input === " ") {
      if (row.kind === "header") {
        toggleCollapse(row.group);
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(row.name)) next.delete(row.name);
        else next.add(row.name);
        return next;
      });
    }
  });

  React.useEffect(() => {
    if (done) printResult("C-grouped", done === "saved", selected);
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
        {window.map((r, i) => {
          const absoluteIdx = top + i;
          const focused = absoluteIdx === safeCursor;
          if (r.kind === "header") {
            const isCollapsed = collapsed.has(r.group);
            return (
              <Box key={`h-${r.group}`}>
                <Text color={focused ? "cyan" : undefined}>
                  {focused ? ">" : " "}
                </Text>
                <Text bold color={focused ? "cyan" : "magenta"}>
                  {" "}
                  {isCollapsed ? "▶" : "▼"} {r.name}
                </Text>
              </Box>
            );
          }
          const checked = selected.has(r.name);
          const mark = r.orphan ? "!" : checked ? "x" : " ";
          const color = r.orphan ? "yellow" : focused ? "cyan" : undefined;
          return (
            <Box key={`s-${r.name}`}>
              <Text color={focused ? "cyan" : undefined}>
                {focused ? "  > " : "    "}
              </Text>
              <Text color={color}>[{mark}] </Text>
              <Text color={color}>{r.name}</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {filterMode
            ? "[enter] done filtering   [esc] exit filter"
            : "[space] toggle / collapse   [←/→] collapse   [/] filter   [enter] save   [esc/q] quit"}
        </Text>
      </Box>
    </Box>
  );
};

render(<App />);
