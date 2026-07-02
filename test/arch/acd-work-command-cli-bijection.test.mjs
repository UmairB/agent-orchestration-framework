// Fitness function for milestone 08 / ADR-004 inv. 2, GENERALISED by milestone 15
// / ADR-005 from "exactly six" to REGISTRY-DERIVED (command → CLI injection):
// "Every registry work:* command has a non-null `cli` adapter (`cli.argv`/
//  `cli.render` are functions) AND a reachable `aof work <sub>` dispatch branch,
//  AND `aof work <sub> --json` runs cleanly + emits parseable JSON. The sub set is
//  DERIVED from listCommands() (NOT the hard-coded SUBCOMMANDS), so work:doctor /
//  any future work:* is covered with no edit ('no new door')."
//
// Three proofs, over the registry-derived work:* sub set:
//   (a) import the registry; assert each work:* command's `cli` adapter is present
//       with `argv`/`render` functions;
//   (b) source-grep `workCommand` in `cli.mjs` for a reachable dispatch branch per
//       subcommand (`subcommand === "<sub>"`, comments discounted);
//   (c) CLI spawn-and-parse: build a fixture stream and `spawnSync` each
//       `aof work <sub> --json` with sensible args, asserting a clean run +
//       parseable JSON. feedback WRITES, so its args target a real fixture item and
//       it must succeed + append. doctor (like validate) may exit 0 OR non-zero
//       cleanly (a warn/error finding can gate) — accept [0,1] for both.
import assert from "node:assert/strict";
import { spawnCliSync } from "../support/cli-spawn.mjs";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCommands } from "../../src/command-core.mjs";
import { startRun } from "../../src/run-store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");
const CLI_MJS = path.join(repoRoot, "src", "cli.mjs");

// The work-surface subcommands DERIVED from the registry — every work:* command's
// op segment. (NOT a hard-coded literal: a new work:* command is covered with no
// edit. graph:*/project:*/import:* are non-work and correctly excluded.)
const subcommands = () =>
  listCommands()
    .filter((command) => command.id.startsWith("work:"))
    .map((command) => command.id.slice("work:".length))
    .sort();

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Isolate the `workCommand` function body so the dispatch grep cannot be satisfied
// by a `subcommand === "<sub>"` that belongs to some OTHER command's dispatcher.
function workCommandBody(source) {
  const start = source.search(/(?:async\s+)?function\s+workCommand\s*\(/);
  if (start === -1) return "";
  // Walk to the next top-level `function ` declaration after the start.
  const re = /\n(?:export\s+)?(?:async\s+)?function\s/g;
  re.lastIndex = start + 1;
  const next = re.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

// --- the CLI fixture stream (mirrors acd-work-list-contract's builder) --------

const FIXTURE_ITEMS = [
  { ref: "03", type: "milestone", slug: "board", status: "in-progress", title: "Board" },
  { ref: "03/01", type: "story", slug: "board-ui", status: "in-progress", title: "Board UI" },
];

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-cli-bijection-"));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  await mkdir(aofDir, { recursive: true });
  const milestoneDir = path.join(workDir, "03_milestone_board");
  const storyDir = path.join(milestoneDir, "stories", "01_story_board-ui");
  const tasksDir = path.join(storyDir, "tasks");
  await mkdir(tasksDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "03", slug: "board", status: "in-progress", title: '"Board"', created: "2026-06-19", updated: "2026-06-19" }),
    "utf8"
  );
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter({ type: "story", number: "01", slug: "board-ui", parent: "03", status: "in-progress", title: '"Board UI"', created: "2026-06-19", updated: "2026-06-19" }),
    "utf8"
  );
  await writeFile(path.join(storyDir, "STATE.md"), "# 03/01 · State\n", "utf8");
  // One task feature so `work tasks 03/01` parses a real scenario (not just []).
  await writeFile(
    path.join(tasksDir, "01_probe.feature"),
    "Feature: Probe\n\n  @executable\n  Scenario: it runs\n    Given a thing\n    When it happens\n    Then it works\n",
    "utf8"
  );
  // milestone 19 — seed ONE running run under 03/01 (a discrete runs/<id>.json,
  // the ADR-002 layout) so `aof work run-complete 03/01 --outcome done` finds
  // exactly one in-flight run and exits 0. The subs run alphabetically, so
  // run-complete runs BEFORE run-start while only this seed exists; run-start then
  // mints a second running run (exit 0). Without this seed run-complete would hit
  // no-running-run → exit 1 → the smoke would RED (Build note, LOAD-BEARING).
  await startRun({ ref: "03/01", dir: storyDir }, { sessionId: null, brief: {} });
  // milestone 20 — seed a retryable FAILED run under MILESTONE 03 directly so
  // `aof work run-retry 03` resolves a retryable prior and resumes it (exit 0). It
  // lives on the milestone (not 03/01) so the alphabetical run-complete/run-start on
  // 03/01 leave it untouched. 20/ADR-006 dedup forbids minting a second non-terminal
  // run via the store, so this failed precondition is written directly as a fixture.
  const milestoneRuns = path.join(milestoneDir, "runs");
  await mkdir(milestoneRuns, { recursive: true });
  await writeFile(
    path.join(milestoneRuns, "20260629T000000000Z-0000.json"),
    `${JSON.stringify({ runId: "20260629T000000000Z-0000", itemRef: "03", state: "failed", attempt: 1, outcome: "failed", sessionId: "sess-bij", brief: {}, createdAt: "2026-06-29T00:00:00.000Z", updatedAt: "2026-06-29T00:00:00.000Z", failureReason: "timeout", heartbeatAt: null, retryOf: null, reclaimedAt: null }, null, 2)}\n`,
    "utf8"
  );
  return root;
}

// Sensible args per subcommand against the fixture above. Reads resolve `03/01`;
// feedback writes to the milestone/story STATE.md with a real note.
function argsFor(sub) {
  switch (sub) {
    case "list": return ["work", "list", "--json"];
    case "doc": return ["work", "doc", "03", "SPEC", "--json"];
    case "tasks": return ["work", "tasks", "03/01", "--json"];
    case "validate": return ["work", "validate", "--json"];
    case "doctor": return ["work", "doctor", "--json"];
    case "next": return ["work", "next", "--json"];
    case "feedback": return ["work", "feedback", "03/01", "--note", "bijection probe", "--actor", "arch-test", "--json"];
    // milestone 19 — the three work:run-* verbs. Subs run alphabetically, so
    // run-complete runs BEFORE run-start: it completes buildFixture()'s seeded
    // running run on 03/01 (exit 0), then run-start mints a fresh running run on
    // 03/01 (exit 0). run-status reads the milestone 03 (empty history → exit 0).
    case "run-complete": return ["work", "run-complete", "03/01", "--outcome", "done", "--json"];
    case "run-start": return ["work", "run-start", "03/01", "--json"];
    case "run-status": return ["work", "run-status", "03", "--json"];
    // milestone 20 — run-retry resumes the seeded retryable failed run on milestone 03
    // (exit 0). The switch THROWS on an unmapped sub (19/R1), so this case is required.
    case "run-retry": return ["work", "run-retry", "03", "--json"];
    default: throw new Error(`unmapped subcommand ${sub}`);
  }
}

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const archTests = [
  {
    name: "arch/15 ADR-005: every registered work:* command carries a non-null cli adapter (argv + render functions)",
    run: async () => {
      const commands = listCommands();
      assert.ok(commands.length > 0, "the registry is non-empty");
      for (const command of commands) {
        assert.ok(command.cli != null, `${command.id} has a non-null cli adapter`);
        assert.equal(typeof command.cli.argv, "function", `${command.id} cli.argv is a function`);
        assert.equal(typeof command.cli.render, "function", `${command.id} cli.render is a function`);
      }
    },
  },
  {
    name: "arch/15 ADR-005: workCommand in cli.mjs has a reachable dispatch branch per registry-derived work:* subcommand",
    run: async () => {
      const body = workCommandBody(stripComments(await readFile(CLI_MJS, "utf8")));
      assert.ok(body.length > 0, "workCommand is defined in cli.mjs");
      for (const sub of subcommands()) {
        assert.ok(
          new RegExp(`subcommand\\s*===\\s*["']${sub}["']`).test(body),
          `workCommand dispatches \`subcommand === "${sub}"\` (no command the CLI cannot run)`
        );
      }
    },
  },
  {
    name: "arch/15 ADR-005: aof work <sub> --json runs cleanly and emits parseable JSON for every registry-derived work:* subcommand",
    run: async () => {
      const root = await buildFixture();
      try {
        for (const sub of subcommands()) {
          const result = runCli(root, argsFor(sub));
          // `validate` and `doctor` are the reads that DESIGN to exit 1 when
          // findings exist (validate on any finding; doctor on an error or a
          // warn-under-strict) — both 0 and 1 are clean runs for them; every other
          // op exits 0. None may crash (>1 or a null status from a thrown error).
          const acceptable = sub === "validate" || sub === "doctor" ? [0, 1] : [0];
          assert.ok(
            acceptable.includes(result.status),
            `aof ${argsFor(sub).join(" ")} exits ${acceptable.join("/")} (got ${result.status}; stderr: ${result.stderr})`
          );
          // The --json face emits a single parseable JSON document on stdout.
          let parsed;
          assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `aof ${argsFor(sub).join(" ")} emits parseable JSON (stdout: ${result.stdout.slice(0, 200)})`);
          assert.ok(parsed !== undefined, `aof ${argsFor(sub).join(" ")} produced a JSON value`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/ADR-004 inv.2: aof work feedback --json writes exactly one bullet to the target STATE.md",
    run: async () => {
      const root = await buildFixture();
      try {
        const statePath = path.join(root, "wiki", "work", "03_milestone_board", "stories", "01_story_board-ui", "STATE.md");
        const before = await readFile(statePath, "utf8");
        assert.ok(!before.includes("## Feedback (for retro)"), "fixture STATE.md starts with no feedback heading");

        const result = runCli(root, argsFor("feedback"));
        assert.equal(result.status, 0, `aof work feedback exits 0 (stderr: ${result.stderr})`);
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.ok, true, "the feedback result envelope is { ok: true, … }");

        const after = await readFile(statePath, "utf8");
        const headingCount = after.split("## Feedback (for retro)").length - 1;
        assert.equal(headingCount, 1, "exactly one verbatim feedback heading after the write");
        assert.ok(after.includes("bijection probe"), "the appended bullet carries the note");
        const bullets = after.split(/\r?\n/).filter((line) => line.trim().startsWith("- "));
        assert.equal(bullets.length, 1, "exactly one bullet appended under the heading");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
