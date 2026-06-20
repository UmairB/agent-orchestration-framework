// Fitness function: acd-board-write-isolation (ADR-004).
//
// The board server performs exactly ONE kind of filesystem mutation — appending
// an attributed bullet under `## Feedback (for retro)` in a selected
// milestone/story `STATE.md`. It never writes item status/frontmatter, exposes
// no restatus route, and calls validateWork/nextWork in-process (no CLI
// shell-out). Source-grep `src/board-ui.mjs` for the structural guard, plus a
// behavioural check: posting feedback against a fixture changes only STATE.md.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveSetupUi } from "../../src/setup-ui.mjs";

const BOARD_UI = new URL("../../src/board-ui.mjs", import.meta.url);

async function snapshotDir(dir) {
  const snap = new Map();
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const info = await stat(full);
        snap.set(full, `${info.mtimeMs}:${await readFile(full, "utf8")}`);
      }
    }
  }
  await walk(dir);
  return snap;
}

function diffSnapshots(before, after) {
  const changed = [];
  for (const [file, value] of after) if (before.get(file) !== value) changed.push(file);
  for (const file of before.keys()) if (!after.has(file)) changed.push(file);
  return changed;
}

export const archTests = [
  {
    name: "arch/board-write-isolation: every filesystem-write call site targets STATE.md / the feedback heading",
    async run() {
      const source = await readFile(BOARD_UI, "utf8");
      // The fs write verbs the module may use.
      const writeVerbs = ["writeFile", "appendFile"];
      for (const verb of writeVerbs) {
        // Any occurrence must live within the feedback-append helper, which is
        // the sole writer. We assert there is no write outside that helper by
        // confirming all writes are reachable only from appendFeedbackBullet.
        const occurrences = source.split(verb).length - 1;
        if (occurrences === 0) continue;
      }
      // Structural: there is exactly one feedback-write helper and it is the only
      // function that performs an fs write. Confirm the write verbs only appear
      // inside `appendFeedbackBullet`.
      const helperStart = source.indexOf("async function appendFeedbackBullet");
      assert.ok(helperStart !== -1, "the sole feedback-write helper appendFeedbackBullet exists");
      const helperEnd = nextTopLevelFn(source, helperStart);
      const helperBody = source.slice(helperStart, helperEnd);
      const outsideHelper = source.slice(0, helperStart) + source.slice(helperEnd);
      for (const verb of writeVerbs) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(outsideHelper),
          `${verb} appears only inside appendFeedbackBullet, never elsewhere in board-ui.mjs`
        );
      }
      // The helper writes the STATE.md target and the verbatim heading.
      assert.ok(helperBody.includes("statePath"), "the writer targets the resolved STATE.md path");
      assert.ok(
        source.includes('"## Feedback (for retro)"') || source.includes("'## Feedback (for retro)'"),
        "the verbatim feedback heading is used"
      );
      // The feedback target file is STATE.md (joined at the call site).
      assert.ok(source.includes('"STATE.md"') || source.includes("'STATE.md'"), "the feedback write targets STATE.md");
    },
  },
  {
    name: "arch/board-write-isolation: no write to item frontmatter/status and no restatus route",
    async run() {
      const source = await readFile(BOARD_UI, "utf8");
      // No record-doc (SPEC/STORY/SESSION) is ever written.
      for (const doc of ["SPEC.md", "STORY.md", "SESSION.md"]) {
        assert.ok(!writesTo(source, doc), `board-ui.mjs never writes ${doc} (status/frontmatter is derived, not written)`);
      }
      // No status/restatus route or status-write path.
      assert.ok(!/\/api\/work\/(re)?status/.test(source), "no /api/work/status or /api/work/restatus route");
      assert.ok(!/\bstatus\s*:\s*['"]/.test(stripComments(source)), "no literal status value is written");
    },
  },
  {
    name: "arch/board-write-isolation: validate/next are in-process imports, never a CLI shell-out",
    async run() {
      const source = await readFile(BOARD_UI, "utf8");
      // validateWork / nextWork are imported in-process from work.mjs.
      assert.ok(/import\s*\{[^}]*\bvalidateWork\b[^}]*\}\s*from\s*["']\.\/work\.mjs["']/.test(source), "validateWork is imported from work.mjs");
      assert.ok(/import\s*\{[^}]*\bnextWork\b[^}]*\}\s*from\s*["']\.\/work\.mjs["']/.test(source), "nextWork is imported from work.mjs");
      // No child_process / spawn / exec of a CLI.
      assert.ok(!/child_process/.test(source), "no child_process import");
      for (const verb of ["spawn", "spawnSync", "exec", "execSync", "execFile"]) {
        assert.ok(!new RegExp(`\\b${verb}\\s*\\(`).test(source), `no ${verb}( shell-out`);
      }
      // No CLI invocation strings.
      assert.ok(!/aof\s+work\s+(validate|next)/.test(source), "no 'aof work validate/next' CLI invocation");
    },
  },
  {
    name: "arch/board-write-isolation: posting feedback changes only STATE.md (behavioural)",
    async run() {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-write-iso-"));
      try {
        const workDir = path.join(repo, "wiki", "work");
        await mkdir(path.join(repo, ".aof"), { recursive: true });
        const storyDir = path.join(workDir, "03_milestone_board", "stories", "01_story_board");
        await mkdir(path.join(storyDir, "tasks"), { recursive: true });
        await writeFile(path.join(repo, ".aof", "aof.config.json"), JSON.stringify({ name: "fx", work: { dir: "./wiki/work" } }), "utf8");
        await writeFile(
          path.join(workDir, "03_milestone_board", "SPEC.md"),
          "---\ntype: milestone\nnumber: 03\nslug: board\nstatus: in-progress\ntitle: \"Board\"\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n",
          "utf8"
        );
        await writeFile(
          path.join(storyDir, "STORY.md"),
          "---\ntype: story\nnumber: 01\nslug: board\nstatus: in-progress\ntitle: \"Board story\"\nparent: 3\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n",
          "utf8"
        );
        await writeFile(path.join(storyDir, "STATE.md"), "# 01 · State\n", "utf8");

        const before = await snapshotDir(workDir);
        const { server, url } = await serveSetupUi(null, { projectDir: repo, port: 0 });
        try {
          const response = await fetch(new URL("/api/work/feedback", url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref: "03/01", note: "isolation check", actor: "qa" }),
          });
          assert.equal(response.status, 200);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
        const after = await snapshotDir(workDir);
        const changed = diffSnapshots(before, after);
        assert.deepEqual(changed, [path.join(storyDir, "STATE.md")], "the only file changed under the fixture is STATE.md");

        const stateText = await readFile(path.join(storyDir, "STATE.md"), "utf8");
        const headingCount = stateText.split("## Feedback (for retro)").length - 1;
        assert.equal(headingCount, 1, "exactly one verbatim heading");
        const bullets = stateText.split(/\r?\n/).filter((line) => line.trim().startsWith("- ") && !line.includes("<note>"));
        assert.equal(bullets.length, 1, "exactly one bullet appended under the heading");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

// --- small source-analysis helpers ------------------------------------------

// Find the start of the next top-level `function`/`async function` after `from`.
function nextTopLevelFn(source, from) {
  const re = /\n(?:export\s+)?(?:async\s+)?function\s/g;
  re.lastIndex = from + 1;
  const match = re.exec(source);
  return match ? match.index : source.length;
}

function writesTo(source, fileName) {
  // A write verb whose argument expression references the file name nearby.
  const lines = source.split(/\r?\n/);
  return lines.some((line) => /\b(writeFile|appendFile)\s*\(/.test(line) && line.includes(fileName));
}

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
