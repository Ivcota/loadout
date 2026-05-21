export type Harness = "claude" | "codex";

export interface Skill {
  readonly name: string;
  readonly harnesses: ReadonlyArray<Harness>;
}

const claudeOnly = (names: string[]): Skill[] =>
  names.map((name) => ({ name, harnesses: ["claude"] as const }));

const codexOnly = (names: string[]): Skill[] =>
  names.map((name) => ({ name, harnesses: ["codex"] as const }));

const both = (names: string[]): Skill[] =>
  names.map((name) => ({ name, harnesses: ["claude", "codex"] as const }));

export const SKILLS: ReadonlyArray<Skill> = [
  ...claudeOnly([
    "breakthrough-advertising",
    "clean-code",
    "contagious",
    "design-consultation",
    "design-everyday-things",
    "design-html",
    "design-shotgun",
    "design-sprint",
    "design-review",
    "drive-motivation",
    "good-strategy-bad-strategy",
    "hooked-ux",
    "hormozi-ad-factory",
    "hundred-million-leads",
    "hundred-million-offers",
    "improve-retention",
    "influence-psychology",
    "jobs-to-be-done",
    "lean-startup",
    "made-to-stick",
    "microinteractions",
    "mom-test",
    "obviously-awesome",
    "office-hours",
    "pragmatic-programmer",
    "readable-code",
    "refactoring-ui",
    "storybrand-messaging",
    "the-one-thing",
    "value-equation",
    "win-friends-influence-people",
    "zero-to-one",
  ]),
  ...codexOnly(["hexagonal-architecture", "responsibility-driven-design"]),
  ...both(["browse", "code-review", "ship", "tdd"]),
].sort((a, b) => a.name.localeCompare(b.name));

export const INITIAL_MODE_SKILLS: ReadonlyArray<string> = [
  "design-html",
  "design-review",
  "design-sprint",
  "made-to-stick",
  "microinteractions",
  "obviously-awesome",
  "refactoring-ui",
  "storybrand-messaging",
  "obsolete-skill-from-last-year",
];

export const MODE_NAME = "design";

export const skillRows = (): ReadonlyArray<{
  readonly name: string;
  readonly harnesses: ReadonlyArray<Harness>;
  readonly orphan: boolean;
}> => {
  const byName = new Map(SKILLS.map((s) => [s.name, s] as const));
  const rows: {
    name: string;
    harnesses: ReadonlyArray<Harness>;
    orphan: boolean;
  }[] = [];
  for (const s of SKILLS) {
    rows.push({ name: s.name, harnesses: s.harnesses, orphan: false });
  }
  for (const m of INITIAL_MODE_SKILLS) {
    if (!byName.has(m)) {
      rows.push({ name: m, harnesses: [], orphan: true });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
};

export const printResult = (
  prototype: string,
  saved: boolean,
  selected: ReadonlySet<string>,
): void => {
  const beforeSet = new Set(INITIAL_MODE_SKILLS);
  const added = [...selected].filter((s) => !beforeSet.has(s)).sort();
  const removed = [...beforeSet].filter((s) => !selected.has(s)).sort();
  // eslint-disable-next-line no-console
  console.log(
    `\n[${prototype}] ${saved ? "SAVED" : "CANCELLED"} — ${selected.size} skill(s) in '${MODE_NAME}'` +
      (saved ? `  (+${added.length} -${removed.length})` : ""),
  );
  if (saved && (added.length > 0 || removed.length > 0)) {
    if (added.length > 0) console.log(`  + ${added.join(", ")}`);
    if (removed.length > 0) console.log(`  - ${removed.join(", ")}`);
  }
};
