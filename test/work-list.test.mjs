// Traceability wiring for milestone 03 / story 00 `aof work list`.
//
// Covers every @executable scenario (and every Scenario-Outline Examples row)
// across the story's two task features:
//
//   00_list-json-contract.feature — `aof work list --json` emits the frozen flat
//        array (the WHOLE stream), pure JSON on stdout (no human chrome), parent
//        links resolve, every type present, deterministic order, empty → []
//   01_list-human-output.feature  — the bare command prints a readable depth-
//        indented listing (ref · type · status · title); a scope ref narrows to a
//        subtree; an empty scope is a "nothing in scope" line, not an error;
//        --json and the bare command render the same data two ways
//
// Pure-data assertions call `listStream(workDir)` directly. The CLI-behaviour
// assertions (pure-JSON stdout, no chrome, exit codes, scope narrowing) invoke
// the REAL command via child process — `node bin/aof.mjs work list ...` — against
// a temp fixture repo whose `.aof/aof.config.json` `work.dir` points at the
// fixture work folder. The fixture matches the feature Backgrounds: milestone 03
// (+ stories 03/00, 03/01) and the top-level uat session 04.
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listStream } from "../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// ----------------------------------------------------------- fixtures ----

// The feature Background as data: a milestone, its two stories, a top-level uat.
const FIXTURE_ITEMS = [
  { ref: "03", type: "milestone", slug: "work-board-ui", status: "in-progress", title: "Work Board UI" },
  { ref: "03/00", type: "story", slug: "work-list-json", status: "done", title: "work list --json" },
  { ref: "03/01", type: "story", slug: "board-tree", status: "in-progress", title: "The work board" },
  { ref: "04", type: "uat", slug: "acceptance-session", status: "not-started", title: "Acceptance session" }
];

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function recordDoc(type) {
  if (type === "milestone") return "SPEC.md";
  if (type === "story") return "STORY.md";
  if (type === "uat") return "SESSION.md";
  return null;
}

// Build a temp repo whose `.aof/aof.config.json` points work.dir at `wiki/work`,
// then populate the work folder from `items`. Returns { root, workDir }.
async function buildFixture(items, prefix = "aof-work-list-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  await mkdir(aofDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );

  for (const item of items) {
    const [milestoneNum, storyNum] = item.ref.split("/");
    if (item.type === "story") {
      // A story lives under its milestone's stories/ folder.
      const milestone = items.find((candidate) => candidate.type === "milestone" && candidate.ref === milestoneNum);
      const milestoneSlug = milestone ? milestone.slug : "milestone";
      const milestoneDir = path.join(workDir, `${milestoneNum}_milestone_${milestoneSlug}`);
      const storyDir = path.join(milestoneDir, "stories", `${storyNum}_story_${item.slug}`);
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        path.join(storyDir, "STORY.md"),
        frontmatter({
          type: "story",
          number: storyNum,
          slug: item.slug,
          parent: milestoneNum,
          status: item.status,
          title: `"${item.title}"`,
          created: "2026-06-19",
          updated: "2026-06-19"
        }),
        "utf8"
      );
      continue;
    }

    // A top-level driver (milestone / uat).
    const dir = path.join(workDir, `${milestoneNum}_${item.type}_${item.slug}`);
    await mkdir(dir, { recursive: true });
    const doc = recordDoc(item.type);
    await writeFile(
      path.join(dir, doc),
      frontmatter({
        type: item.type,
        number: milestoneNum,
        slug: item.slug,
        status: item.status,
        title: `"${item.title}"`,
        created: "2026-06-19",
        updated: "2026-06-19"
      }),
      "utf8"
    );
  }

  return { root, workDir };
}

// Invoke the real CLI against the fixture repo (cwd = repo root so loadWorkspace
// finds .aof/aof.config.json).
function runList(root, args = []) {
  const result = spawnCliSync(process.execPath, [cliPath, "work", "list", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" }
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

// Refs present in a human listing — lines that start (after indent) with a ref token.
function listedRefs(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0])
    .filter((token) => /^\d+(\/\d+)?$/.test(token));
}

// ----------------------------------------------------------- tests ----

export const workListTests = [
  // --- 00_list-json-contract.feature ---------------------------------------

  {
    name: "work list --json: emits the whole stream as a JSON array (one element per item)",
    run: async () => {
      const { root, workDir } = await buildFixture(FIXTURE_ITEMS);
      try {
        const result = runList(root, ["--json"]);
        assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
        const parsed = JSON.parse(result.stdout);
        assert.ok(Array.isArray(parsed), "parses to an array");
        const expected = await listStream(workDir);
        assert.equal(parsed.length, expected.length, "one element per item");
        assert.equal(parsed.length, FIXTURE_ITEMS.length, "matches the fixture item count");
        const refs = parsed.map((row) => row.ref).sort();
        assert.deepEqual(refs, ["03", "03/00", "03/01", "04"], "milestone, both stories, and the uat session present");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work list --json: stdout is pure JSON with no human chrome; diagnostics off stdout",
    run: async () => {
      const { root } = await buildFixture(FIXTURE_ITEMS);
      try {
        const result = runList(root, ["--json"]);
        assert.equal(result.status, 0);
        // The entire stdout parses in one pass — no preamble/boundary/header/tip.
        assert.doesNotThrow(() => JSON.parse(result.stdout), "entire stdout parses as JSON");
        // No human chrome markers leaked onto stdout.
        for (const marker of ["PASS", "Note:", "Nothing", "—", "milestone "]) {
          assert.ok(!result.stdout.includes(marker), `stdout free of human chrome marker "${marker}"`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work list --json: each item carries ref, type, status, title, dir, parent",
    run: async () => {
      const { workDir } = await buildFixture(FIXTURE_ITEMS);
      const rows = await listStream(workDir);
      for (const row of rows) {
        assert.ok(typeof row.ref === "string" && row.ref.length > 0, "reports a ref identity");
        assert.ok(typeof row.type === "string" && row.type.length > 0, "reports a type");
        assert.ok("status" in row, "reports a derived status");
        assert.ok("title" in row, "reports a title");
        assert.ok(typeof row.dir === "string" && row.dir.length > 0, "reports a dir locating the folder");
        assert.ok("parent" in row, "reports a parent link");
      }
    }
  },

  {
    name: "work list --json: parent links place each item at its depth (Scenario Outline rows)",
    run: async () => {
      const { workDir } = await buildFixture(FIXTURE_ITEMS);
      const rows = await listStream(workDir);
      const parentOf = (ref) => rows.find((row) => row.ref === ref)?.parent ?? null;
      // | ref | parent |  (none → null)
      assert.equal(parentOf("03"), null, "03 has no parent");
      assert.equal(parentOf("04"), null, "04 (uat, depth-0) has no parent");
      assert.equal(parentOf("03/00"), "03", "03/00 parents to 03");
      assert.equal(parentOf("03/01"), "03", "03/01 parents to 03");
    }
  },

  {
    name: "work list --json: every item type in the stream is emitted with its type (Scenario Outline rows)",
    run: async () => {
      const { workDir } = await buildFixture(FIXTURE_ITEMS);
      const rows = await listStream(workDir);
      const typeOf = (ref) => rows.find((row) => row.ref === ref)?.type;
      assert.equal(typeOf("03"), "milestone");
      assert.equal(typeOf("03/00"), "story");
      assert.equal(typeOf("03/01"), "story");
      assert.equal(typeOf("04"), "uat");
    }
  },

  {
    name: "work list --json: the emitted order is byte-identical across two consecutive runs",
    run: async () => {
      const { root } = await buildFixture(FIXTURE_ITEMS);
      try {
        const first = runList(root, ["--json"]);
        const second = runList(root, ["--json"]);
        assert.equal(first.status, 0);
        assert.equal(second.status, 0);
        assert.equal(first.stdout, second.stdout, "two runs produce byte-identical JSON");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work list --json: an empty work-stream yields an empty JSON array, exit 0",
    run: async () => {
      const { root } = await buildFixture([]);
      try {
        const result = runList(root, ["--json"]);
        assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
        const parsed = JSON.parse(result.stdout);
        assert.ok(Array.isArray(parsed), "parses to an array");
        assert.equal(parsed.length, 0, "an empty array");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  // --- 01_list-human-output.feature ----------------------------------------

  {
    name: "work list: with no flag prints a readable listing (ref, type, status, title), not JSON",
    run: async () => {
      const { root } = await buildFixture(FIXTURE_ITEMS);
      try {
        const result = runList(root, []);
        assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
        // Human-readable, not JSON.
        assert.throws(() => JSON.parse(result.stdout), "output is not JSON");
        // Every item appears with ref + type + status + title.
        for (const item of FIXTURE_ITEMS) {
          const line = result.stdout.split(/\r?\n/).find((row) => row.trim().startsWith(item.ref));
          assert.ok(line, `a line for ${item.ref}`);
          assert.ok(line.includes(item.type), `${item.ref} reports its type`);
          assert.ok(line.includes(item.status), `${item.ref} reports its status`);
          assert.ok(line.includes(item.title), `${item.ref} reports its title`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work list: the listing is indented by depth — milestone/uat flush, stories indented",
    run: async () => {
      const { root } = await buildFixture(FIXTURE_ITEMS);
      try {
        const result = runList(root, []);
        const lines = result.stdout.split(/\r?\n/).filter(Boolean);
        const lineFor = (ref) => lines.find((line) => line.trim().startsWith(ref));
        const milestone = lineFor("03");
        const uat = lineFor("04");
        const story0 = lineFor("03/00");
        const story1 = lineFor("03/01");
        assert.ok(/^03\b/.test(milestone), "milestone 03 is un-indented (flush)");
        assert.ok(/^04\b/.test(uat), "uat 04 is un-indented (flush)");
        assert.ok(/^\s+03\/00\b/.test(story0), "story 03/00 is indented");
        assert.ok(/^\s+03\/01\b/.test(story1), "story 03/01 is indented");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work list 03: a scope ref lists only that subtree (milestone + its stories, uat omitted)",
    run: async () => {
      const { root } = await buildFixture(FIXTURE_ITEMS);
      try {
        const result = runList(root, ["03"]);
        assert.equal(result.status, 0);
        const refs = listedRefs(result.stdout);
        assert.deepEqual(refs.sort(), ["03", "03/00", "03/01"], "milestone 03 and its two stories");
        assert.ok(!refs.includes("04"), "uat 04 omitted");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work list 04: scoping to a leaf driver lists only that item",
    run: async () => {
      const { root } = await buildFixture(FIXTURE_ITEMS);
      try {
        const result = runList(root, ["04"]);
        assert.equal(result.status, 0);
        const refs = listedRefs(result.stdout);
        assert.deepEqual(refs, ["04"], "only the uat session 04");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work list <scope>: the scope argument selects which items are included (Scenario Outline rows)",
    run: async () => {
      const { root } = await buildFixture(FIXTURE_ITEMS);
      try {
        const cases = [
          { scope: [], included: ["03", "03/00", "03/01", "04"] },
          { scope: ["03"], included: ["03", "03/00", "03/01"] },
          { scope: ["04"], included: ["04"] }
        ];
        for (const { scope, included } of cases) {
          const result = runList(root, scope);
          assert.equal(result.status, 0, `exit 0 for scope "${scope.join(" ")}"`);
          assert.deepEqual(listedRefs(result.stdout).sort(), [...included].sort(), `scope "${scope.join(" ")}" lists exactly ${included.join(", ")}`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work list vs --json: render the same data two ways, neither mixes the other's presentation",
    run: async () => {
      const { root } = await buildFixture(FIXTURE_ITEMS);
      try {
        const human = runList(root, []);
        const json = runList(root, ["--json"]);
        const humanRefs = listedRefs(human.stdout).sort();
        const jsonRefs = JSON.parse(json.stdout).map((row) => row.ref).sort();
        assert.deepEqual(humanRefs, jsonRefs, "same set of items");
        // The human run prints indented text; the JSON run prints a parseable array.
        assert.throws(() => JSON.parse(human.stdout), "human run is not JSON");
        assert.ok(/^\s+03\/00\b/m.test(human.stdout), "human run prints indented text");
        assert.ok(Array.isArray(JSON.parse(json.stdout)), "JSON run prints a parseable array");
        // Neither blends the other's presentation.
        assert.ok(!human.stdout.includes("{"), "human view has no JSON braces");
        assert.ok(!/^\s{2,}\S/m.test(json.stdout.replace(/^\[|\]$/g, "")) || json.stdout.trim().startsWith("["), "json view is a JSON document, not indented chrome");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work list 99: a scope matching nothing is an empty listing (exit 0, nothing-in-scope line, no item lines)",
    run: async () => {
      const { root } = await buildFixture(FIXTURE_ITEMS);
      try {
        const result = runList(root, ["99"]);
        assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
        assert.match(result.stdout, /nothing in scope/i, "reports nothing falls in that scope");
        assert.equal(listedRefs(result.stdout).length, 0, "no item lines printed");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
];
