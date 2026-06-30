// CLI-face contract — milestone 08 / story 01 (ADR-002/003).
//
// One @executable scenario (and every Scenario-Outline Examples row) across the
// story's three task features, wired against the REAL CLI:
//
//   00_new-read-subcommands.feature — `aof work doc <ref> <DOC>` and
//        `aof work tasks <ref>`, each argv → command → result → render/--json;
//        absent-not-error (present:false / empty list, exit 0); invalid-doc and
//        ref-not-found rejections (non-zero exit + stderr).
//   01_feedback-subcommand.feature  — `aof work feedback <ref> --note … [--actor]
//        [--refs]`: one attributed bullet under the verbatim heading; --refs
//        verbatim; the command's EXACT-only resolver (a non-exact ref fails, never
//        writes the wrong item); missing-note rejected before any write; the
//        default actor "you".
//   02_rewire-byte-for-byte.feature — `work list`/`validate`/`next` rewired through
//        the registry, output byte-for-byte unchanged (list whole-stream pretty
//        2-space --json; validate's BARE array + cwd-relative OS-sep paths +
//        non-zero exit on a finding; validate human PASS-line vs numbered issues;
//        next cwd-relative path, pretty 2-space).
//
// Mirrors test/arch/acd-work-list-contract.test.mjs: build a temp fixture
// work-stream (`.aof/aof.config.json` + `wiki/work/...`), `spawnSync` the real CLI
// (`bin/aof.mjs`) with cwd = the fixture root, and assert exit code + stdout/stderr.
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// ----------------------------------------------------------- fixtures ----

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// A minimal aof workspace whose work.dir points at wiki/work. Returns the root.
async function makeRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const aofDir = path.join(root, ".aof");
  await mkdir(aofDir, { recursive: true });
  await mkdir(path.join(root, "wiki", "work"), { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return root;
}

function workDir(root) {
  return path.join(root, "wiki", "work");
}

// Write a milestone folder NN_milestone_slug with the given record-doc files.
// `docs` maps a record filename (e.g. "SPEC.md") to its body. Frontmatter fields
// default to a well-formed milestone; pass `fields` to override.
async function writeMilestone(root, { number, slug, status = "in-progress", title = "Milestone", docs = {}, fields = {} } = {}) {
  const dir = path.join(workDir(root), `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  const fm = frontmatter({
    type: "milestone",
    number,
    slug,
    status,
    title: `"${title}"`,
    created: "2026-06-19",
    updated: "2026-06-19",
    ...fields,
  });
  // The SPEC.md always carries the frontmatter (the record doc); its body is the
  // frontmatter plus any supplied SPEC body.
  const specBody = docs.SPEC != null ? `${fm}\n${docs.SPEC}` : fm;
  await writeFile(path.join(dir, "SPEC.md"), specBody, "utf8");
  for (const [name, body] of Object.entries(docs)) {
    if (name === "SPEC") continue;
    await writeFile(path.join(dir, `${name}.md`), body, "utf8");
  }
  return dir;
}

// Write a story folder under its milestone. `features` is a map of filename →
// body written under tasks/; pass `noTasksDir:true` to omit the tasks dir
// entirely. `state` (if given) writes STATE.md verbatim.
async function writeStory(root, { milestone, number, slug, status = "in-progress", title = "Story", features = null, noTasksDir = false, state = null } = {}) {
  const milestoneDir = path.join(workDir(root), `${milestone.number}_milestone_${milestone.slug}`);
  const storyDir = path.join(milestoneDir, "stories", `${number}_story_${slug}`);
  await mkdir(storyDir, { recursive: true });
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter({
      type: "story",
      number,
      slug,
      parent: milestone.number,
      status,
      title: `"${title}"`,
      created: "2026-06-19",
      updated: "2026-06-19",
    }),
    "utf8"
  );
  if (!noTasksDir) {
    const tasksDir = path.join(storyDir, "tasks");
    await mkdir(tasksDir, { recursive: true });
    for (const [name, body] of Object.entries(features ?? {})) {
      await writeFile(path.join(tasksDir, name), body, "utf8");
    }
  }
  if (state != null) {
    await writeFile(path.join(storyDir, "STATE.md"), state, "utf8");
  }
  return storyDir;
}

// Write a top-level uat session NN_uat_slug.
async function writeUat(root, { number, slug, status = "not-started", title = "Acceptance" } = {}) {
  const dir = path.join(workDir(root), `${number}_uat_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SESSION.md"),
    frontmatter({ type: "uat", number, slug, status, title: `"${title}"`, created: "2026-06-19", updated: "2026-06-19" }),
    "utf8"
  );
  return dir;
}

// Spawn the real CLI against the fixture root (cwd = root so loadWorkspace finds
// .aof/aof.config.json). Returns { status, stdout, stderr }.
function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const SPEC_BODY = "# Milestone 08 — CLI Command Core\n\nThe load-bearing spec body the doc subcommand must surface verbatim.\n";

const FEATURE_A = "@executable\nFeature: Alpha\n\n  Scenario: alpha does a thing\n    When x\n    Then y\n";
const FEATURE_B = "@executable\nFeature: Beta\n\n  Scenario: beta does a thing\n    When x\n    Then y\n";

const M08 = { number: "08", slug: "cli-command-core" };
const FEEDBACK_HEADING = "## Feedback (for retro)";

// The Background for the read + feedback features: milestone 08 (SPEC.md, no
// RETROSPECTIVE.md) and story 08/00 with two .feature files. Used by most tests.
async function buildReadFixture(prefix, { storyState = null, storyFeatures = { "00_a.feature": FEATURE_A, "01_b.feature": FEATURE_B }, extraStory = null } = {}) {
  const root = await makeRoot(prefix);
  await writeMilestone(root, { ...M08, slug: "cli-command-core", docs: { SPEC: SPEC_BODY } });
  await writeStory(root, { milestone: M08, number: "00", slug: "command-core", features: storyFeatures, state: storyState });
  if (extraStory) await writeStory(root, { milestone: M08, ...extraStory });
  return root;
}

// ----------------------------------------------------------- tests ----

export const cliFaceContractTests = [
  // =====================================================================
  // 00_new-read-subcommands.feature — aof work doc
  // =====================================================================

  // Scenario: aof work doc prints a present doc body
  {
    name: "cli/doc: aof work doc prints a present doc body (exit 0)",
    run: async () => {
      const root = await buildReadFixture("aof-cli-doc-present-");
      try {
        const r = runCli(root, ["work", "doc", "08", "SPEC"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        assert.ok(r.stdout.includes("The load-bearing spec body the doc subcommand must surface verbatim."), "stdout carries the SPEC.md body");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: aof work doc --json emits the command result as pure JSON
  {
    name: "cli/doc: --json emits { ref, doc, present:true } as pure parseable JSON (exit 0)",
    run: async () => {
      const root = await buildReadFixture("aof-cli-doc-json-");
      try {
        const r = runCli(root, ["work", "doc", "08", "SPEC", "--json"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        const parsed = JSON.parse(r.stdout);
        assert.equal(parsed.ref, "08", "reports ref 08");
        assert.equal(parsed.doc, "SPEC", "reports doc SPEC");
        assert.equal(parsed.present, true, "reports present true");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: aof work doc on an absent doc reports present:false and exits 0
  {
    name: "cli/doc: absent doc reports present:false with empty body, exit 0",
    run: async () => {
      const root = await buildReadFixture("aof-cli-doc-absent-");
      try {
        const r = runCli(root, ["work", "doc", "08", "RETROSPECTIVE", "--json"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        const parsed = JSON.parse(r.stdout);
        assert.equal(parsed.present, false, "present false");
        assert.equal(parsed.body, "", "empty body");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: aof work doc rejects an unknown doc name
  {
    name: "cli/doc: an unknown DOC name exits non-zero and stderr names the unknown document",
    run: async () => {
      const root = await buildReadFixture("aof-cli-doc-unknown-");
      try {
        const r = runCli(root, ["work", "doc", "08", "NONSENSE"]);
        assert.notEqual(r.status, 0, "exits non-zero");
        assert.match(r.stderr, /Unknown document "NONSENSE"/, "stderr names the unknown document");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // =====================================================================
  // 00_new-read-subcommands.feature — aof work tasks
  // =====================================================================

  // Scenario: aof work tasks --json lists a story's tasks
  {
    name: "cli/tasks: --json lists one entry per .feature file (exit 0)",
    run: async () => {
      const root = await buildReadFixture("aof-cli-tasks-json-");
      try {
        const r = runCli(root, ["work", "tasks", "08/00", "--json"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        const parsed = JSON.parse(r.stdout);
        assert.equal(parsed.ref, "08/00", "reports ref 08/00");
        assert.ok(Array.isArray(parsed.tasks), "tasks is an array");
        assert.equal(parsed.tasks.length, 2, "one entry per .feature file (two)");
        assert.deepEqual(parsed.tasks.map((t) => t.file).sort(), ["00_a.feature", "01_b.feature"], "both feature files listed");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: aof work tasks on a story with no tasks dir is an empty list, exit 0
  {
    name: "cli/tasks: a resolved story with no tasks dir is an empty list, exit 0",
    run: async () => {
      const root = await buildReadFixture("aof-cli-tasks-empty-", {
        extraStory: { number: "01", slug: "cli-face", noTasksDir: true },
      });
      try {
        const r = runCli(root, ["work", "tasks", "08/01", "--json"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        const parsed = JSON.parse(r.stdout);
        assert.equal(parsed.ref, "08/01", "reports the resolved ref");
        assert.deepEqual(parsed.tasks, [], "empty tasks list");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: aof work tasks on an unresolved ref exits non-zero
  {
    name: "cli/tasks: an unresolved ref exits non-zero, stderr reports no item resolves to the ref",
    run: async () => {
      const root = await buildReadFixture("aof-cli-tasks-unresolved-");
      try {
        const r = runCli(root, ["work", "tasks", "99"]);
        assert.notEqual(r.status, 0, "exits non-zero");
        assert.match(r.stderr, /No item resolves to ref "99"/, "stderr reports no item resolves to the ref");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // =====================================================================
  // 01_feedback-subcommand.feature
  // =====================================================================

  // Scenario: aof work feedback appends one attributed bullet
  {
    name: "cli/feedback: appends exactly one attributed bullet under the verbatim heading (exit 0)",
    run: async () => {
      const root = await buildReadFixture("aof-cli-fb-bullet-", { storyState: `${FEEDBACK_HEADING}\n` });
      const statePath = path.join(workDir(root), "08_milestone_cli-command-core", "stories", "00_story_command-core", "STATE.md");
      try {
        const r = runCli(root, ["work", "feedback", "08/00", "--note", "spec was thin on the empty state", "--actor", "qa"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        const text = await readFile(statePath, "utf8");
        const bullets = text.split(/\r?\n/).filter((line) => line.startsWith("- "));
        assert.equal(bullets.length, 1, "exactly one new bullet appended");
        assert.equal(bullets[0], "- spec was thin on the empty state — Raised by: qa", "the canonical attributed bullet form");
        assert.ok(text.includes(FEEDBACK_HEADING), "the verbatim heading is present");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: --refs is recorded verbatim on the bullet
  {
    name: "cli/feedback: --refs is recorded verbatim, the bullet ends with Refs: …",
    run: async () => {
      const root = await buildReadFixture("aof-cli-fb-refs-", { storyState: `${FEEDBACK_HEADING}\n` });
      const statePath = path.join(workDir(root), "08_milestone_cli-command-core", "stories", "00_story_command-core", "STATE.md");
      try {
        const r = runCli(root, ["work", "feedback", "08/00", "--note", "revisit the ramp", "--actor", "qa", "--refs", "ADR-002"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        const text = await readFile(statePath, "utf8");
        const bullet = text.split(/\r?\n/).find((line) => line.startsWith("- "));
        assert.ok(bullet, "a bullet was appended");
        assert.ok(bullet.endsWith("Refs: ADR-002"), `the bullet ends with "Refs: ADR-002": ${JSON.stringify(bullet)}`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: a non-exact ref fails rather than writing to a slug-matched item
  {
    name: "cli/feedback: a non-exact ref fails (exit non-zero, stderr) and appends NO bullet anywhere",
    run: async () => {
      // The story slug contains "command"; "cli-command" is a free-text slug-ish
      // ref that does NOT exactly match any item's ref. resolveItemExact must
      // return null → ref-not-found, never appending to a slug match.
      const root = await buildReadFixture("aof-cli-fb-nonexact-", { storyState: `${FEEDBACK_HEADING}\n` });
      const statePath = path.join(workDir(root), "08_milestone_cli-command-core", "stories", "00_story_command-core", "STATE.md");
      const before = await readFile(statePath, "utf8");
      try {
        const r = runCli(root, ["work", "feedback", "cli-command", "--note", "should not land", "--actor", "qa"]);
        assert.notEqual(r.status, 0, "exits non-zero");
        assert.match(r.stderr, /No item resolves to ref "cli-command"/, "stderr reports no item resolves to the ref");
        const after = await readFile(statePath, "utf8");
        assert.equal(after, before, "no bullet appended to any item (STATE.md unchanged)");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: a missing note is rejected before any write
  {
    name: "cli/feedback: a missing --note exits non-zero, stderr reports a note is required, no file changed",
    run: async () => {
      const root = await buildReadFixture("aof-cli-fb-nonote-", { storyState: `${FEEDBACK_HEADING}\n` });
      const statePath = path.join(workDir(root), "08_milestone_cli-command-core", "stories", "00_story_command-core", "STATE.md");
      const before = await readFile(statePath, "utf8");
      try {
        const r = runCli(root, ["work", "feedback", "08/00", "--actor", "qa"]);
        assert.notEqual(r.status, 0, "exits non-zero");
        assert.match(r.stderr, /Feedback note is required/, "stderr reports that a note is required");
        const after = await readFile(statePath, "utf8");
        assert.equal(after, before, "no file changed");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: an omitted --actor attributes the bullet to the default actor "you"
  {
    name: "cli/feedback: an omitted --actor attributes the bullet to the default actor 'you'",
    run: async () => {
      const root = await buildReadFixture("aof-cli-fb-defaultactor-", { storyState: `${FEEDBACK_HEADING}\n` });
      const statePath = path.join(workDir(root), "08_milestone_cli-command-core", "stories", "00_story_command-core", "STATE.md");
      try {
        const r = runCli(root, ["work", "feedback", "08/00", "--note", "no actor given"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        const text = await readFile(statePath, "utf8");
        const bullet = text.split(/\r?\n/).find((line) => line.startsWith("- "));
        assert.ok(bullet, "a bullet was appended");
        assert.ok(bullet.endsWith("Raised by: you"), `attributed to the default actor "you": ${JSON.stringify(bullet)}`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // =====================================================================
  // 02_rewire-byte-for-byte.feature
  // =====================================================================

  // Scenario: work list --json still satisfies its committed contract after the rewire
  {
    name: "cli/rewire: work list --json is the whole stream as pretty 2-space JSON (satisfies acd-work-list-contract)",
    run: async () => {
      const root = await makeRoot("aof-cli-rewire-list-");
      await writeMilestone(root, { number: "08", slug: "cli-command-core", docs: { SPEC: SPEC_BODY } });
      await writeStory(root, { milestone: M08, number: "00", slug: "command-core", features: { "00_a.feature": FEATURE_A } });
      await writeStory(root, { milestone: M08, number: "01", slug: "cli-face", features: { "00_a.feature": FEATURE_A } });
      await writeUat(root, { number: "09", slug: "acceptance" });
      try {
        const r = runCli(root, ["work", "list", "--json"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        const parsed = JSON.parse(r.stdout);
        // acd-work-list-contract invariants: flat array, exactly the seven fields,
        // parent the only tree edge.
        assert.ok(Array.isArray(parsed), "a flat array, not a nested tree");
        const CONTRACT_FIELDS = ["ref", "type", "slug", "status", "title", "parent", "dir"].sort();
        for (const el of parsed) {
          assert.ok(!("children" in el), `${el.ref} carries no nested children`);
          assert.deepEqual(Object.keys(el).sort(), CONTRACT_FIELDS, `${el.ref} has exactly the seven contract fields`);
        }
        const refs = new Set(parsed.map((el) => el.ref));
        for (const el of parsed) {
          if (["milestone", "uat"].includes(el.type)) assert.ok(el.parent == null, `depth-0 ${el.ref} has null parent`);
          else assert.ok(refs.has(String(el.parent)), `${el.ref}'s parent resolves in the stream`);
        }
        // Pretty 2-space JSON: re-stringifying the parse with 2-space indent
        // reproduces stdout (trimmed) — the whole-stream pretty contract.
        assert.equal(r.stdout.trim(), JSON.stringify(parsed, null, 2), "stdout is pretty 2-space JSON");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: work validate --json keeps its bare-array shape and cwd-relative paths
  {
    name: "cli/rewire: work validate --json is a BARE array of {path,problem} with cwd-relative OS-sep paths, non-zero exit on a finding",
    run: async () => {
      const root = await makeRoot("aof-cli-rewire-validate-");
      // One malformed item: frontmatter slug differs from the folder slug.
      await writeMilestone(root, { number: "08", slug: "cli-command-core", fields: { slug: "wrong-slug" } });
      try {
        const r = runCli(root, ["work", "validate", "--json"]);
        assert.notEqual(r.status, 0, "exits non-zero because there is a finding");
        const parsed = JSON.parse(r.stdout);
        assert.ok(Array.isArray(parsed), "stdout is a BARE JSON array, not a { findings } envelope");
        assert.ok(!("findings" in parsed), "not wrapped in a findings envelope");
        assert.ok(parsed.length >= 1, "at least one finding");
        for (const entry of parsed) {
          assert.deepEqual(Object.keys(entry).sort(), ["path", "problem"], "each entry is { path, problem }");
          assert.ok(!path.isAbsolute(entry.path), `path is cwd-relative, not absolute: ${entry.path}`);
          // cwd-relative with OS separators: on the fixture the path begins with
          // the relativised wiki/work segment using the platform separator.
          assert.ok(entry.path.includes(`wiki${path.sep}work`), `path uses OS separators: ${entry.path}`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario Outline: aof work validate human output renders as before
  //   | well-formed | the PASS well-formed line |
  {
    name: "cli/rewire: validate human (well-formed) prints the PASS well-formed line, exit 0",
    run: async () => {
      const root = await makeRoot("aof-cli-rewire-validate-pass-");
      await writeMilestone(root, { number: "08", slug: "cli-command-core" });
      try {
        const r = runCli(root, ["work", "validate"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        assert.match(r.stdout, /^PASS — work stream is well-formed\.$/m, "the PASS well-formed line");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  //   | malformed | the numbered issue list |
  {
    name: "cli/rewire: validate human (malformed) prints the numbered issue list, exit non-zero",
    run: async () => {
      const root = await makeRoot("aof-cli-rewire-validate-fail-");
      await writeMilestone(root, { number: "08", slug: "cli-command-core", fields: { slug: "wrong-slug" } });
      try {
        const r = runCli(root, ["work", "validate"]);
        assert.notEqual(r.status, 0, "exits non-zero");
        assert.match(r.stdout, /^\d+ issue\(s\):$/m, "a numbered issue header");
        assert.doesNotMatch(r.stdout, /^PASS/m, "not the PASS line");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: work next --json keeps its cwd-relative path and pretty 2-space shape
  {
    name: "cli/rewire: work next --json is pretty 2-space JSON with a cwd-relative path (exit 0)",
    run: async () => {
      const root = await makeRoot("aof-cli-rewire-next-");
      await writeMilestone(root, { number: "08", slug: "cli-command-core", status: "not-started" });
      try {
        const r = runCli(root, ["work", "next", "--json"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        const parsed = JSON.parse(r.stdout);
        assert.equal(r.stdout.trim(), JSON.stringify(parsed, null, 2), "pretty 2-space JSON");
        assert.equal(parsed.ref, "08", "carries the next item");
        assert.ok(typeof parsed.path === "string", "carries a path");
        assert.ok(!path.isAbsolute(parsed.path), `path is cwd-relative, not absolute: ${parsed.path}`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario Outline: each rewired command keeps its committed CLI contract green
  //   | aof work list --json | aof work validate --json | aof work next --json |
  {
    name: "cli/rewire: each rewired command stays a clean, parseable --json face (list/validate/next)",
    run: async () => {
      const root = await makeRoot("aof-cli-rewire-all-");
      await writeMilestone(root, { number: "08", slug: "cli-command-core", status: "not-started" });
      await writeStory(root, { milestone: M08, number: "00", slug: "command-core", features: { "00_a.feature": FEATURE_A } });
      try {
        // list --json: exit 0, parseable array.
        const list = runCli(root, ["work", "list", "--json"]);
        assert.equal(list.status, 0, `list exit 0 (stderr: ${list.stderr})`);
        assert.ok(Array.isArray(JSON.parse(list.stdout)), "list --json parses to an array");

        // validate --json: clean stream → empty bare array, exit 0.
        const validate = runCli(root, ["work", "validate", "--json"]);
        assert.equal(validate.status, 0, `validate exit 0 on a clean stream (stderr: ${validate.stderr})`);
        assert.deepEqual(JSON.parse(validate.stdout), [], "validate --json is an empty bare array on a clean stream");

        // next --json: exit 0, parseable object with the next item.
        const next = runCli(root, ["work", "next", "--json"]);
        assert.equal(next.status, 0, `next exit 0 (stderr: ${next.stderr})`);
        const nextParsed = JSON.parse(next.stdout);
        assert.ok(nextParsed && typeof nextParsed === "object" && !Array.isArray(nextParsed), "next --json parses to an object");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // =====================================================================
  // 00_new-read-subcommands.feature — the slug-tolerant READ resolver, on the
  // CLI face (the asymmetry that makes the read/write distinction meaningful: a
  // free-text slug a read tolerates is exactly what the feedback WRITE rejects).
  // =====================================================================
  {
    name: "cli/doc: a free-text slug resolves the READ to the matching item (exit 0, ref 08)",
    run: async () => {
      const root = await buildReadFixture("aof-cli-doc-slug-");
      try {
        // "cli-command-core" is the milestone folder slug, not an exact ref — the
        // read resolver (resolveItem) tolerates the slug fallback and resolves it
        // to milestone 08. (The feedback write would reject the same non-exact ref.)
        const r = runCli(root, ["work", "doc", "cli-command-core", "SPEC", "--json"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        const parsed = JSON.parse(r.stdout);
        assert.equal(parsed.ref, "08", "the free-text slug resolves to the 08 milestone");
        assert.equal(parsed.present, true, "present true");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // =====================================================================
  // 02_rewire-byte-for-byte.feature — the human-render projections the --json
  // tests don't reach: the per-finding line's cwd-relative OS-sep path + the
  // trailing traceability note, and the scope-aware PASS / done lines.
  // =====================================================================

  // The malformed human body: each finding renders `  <cwd-rel OS-sep path> — <problem>`
  // (the human path projection, distinct from the --json one) plus the trailing Note.
  {
    name: "cli/rewire: validate human (malformed) renders cwd-relative OS-sep finding lines + the trailing traceability note",
    run: async () => {
      const root = await makeRoot("aof-cli-rewire-validate-body-");
      await writeMilestone(root, { number: "08", slug: "cli-command-core", fields: { slug: "wrong-slug" } });
      try {
        const r = runCli(root, ["work", "validate"]);
        assert.notEqual(r.status, 0, "exits non-zero");
        assert.match(
          r.stdout,
          new RegExp(`^ {2}wiki\\${path.sep}work\\${path.sep}.* — .+$`, "m"),
          "a finding line is two-space-indented with a cwd-relative OS-separator path and its problem"
        );
        assert.match(r.stdout, /^Note: test-traceability /m, "the trailing test-traceability note line is preserved");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // The scope-aware PASS line: `aof work validate <scope>` on a clean scope names
  // the scope ("PASS — 08 is well-formed."), not the unscoped "work stream is …".
  {
    name: "cli/rewire: validate human (clean, scoped) prints the scope-aware PASS line",
    run: async () => {
      const root = await makeRoot("aof-cli-rewire-validate-scoped-");
      await writeMilestone(root, { number: "08", slug: "cli-command-core" });
      try {
        const r = runCli(root, ["work", "validate", "08"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        assert.match(r.stdout, /^PASS — 08 is well-formed\.$/m, "the scope-aware PASS line names the scope");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // The scope-aware next done line: `aof work next <scope>` when the scope is fully
  // done names the scope ("Nothing actionable in 08 — everything is done.").
  {
    name: "cli/rewire: next human (scoped, done) prints the scope-aware nothing-actionable line",
    run: async () => {
      const root = await makeRoot("aof-cli-rewire-next-scoped-");
      await writeMilestone(root, { number: "08", slug: "cli-command-core", status: "done" });
      try {
        const r = runCli(root, ["work", "next", "08"]);
        assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
        assert.match(r.stdout, /^Nothing actionable in 08 — everything is done\.$/m, "the done line names the scope");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
