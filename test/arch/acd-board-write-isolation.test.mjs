// Fitness function: acd-board-write-isolation (ADR-004, milestone 03; re-anchored
// by milestone 08's command-core migration).
//
// The board surface performs exactly ONE kind of filesystem mutation — appending
// an attributed bullet under `## Feedback (for retro)` in a selected
// milestone/story `STATE.md`. It never writes item status/frontmatter, exposes no
// restatus route, and runs the operation in-process (no CLI shell-out).
//
// Milestone 08 (ADR-002/003) re-homed that sole write OUT of `board-ui.mjs` and
// INTO the `work:feedback` command (`src/commands/feedback.mjs`): `board-ui.mjs`
// is now a thin face that `invoke`s the command through the registry and itself
// performs NO fs write. The write-isolation GUARANTEE is unchanged — it has only
// moved with the code — so this fitness function now anchors the "sole writer"
// lens at the command's new home while still proving `board-ui.mjs` writes nothing
// and shells out to nothing, plus the unchanged behavioural end-to-end (posting
// feedback over the migrated seam changes only STATE.md).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveSetupUi } from "../../src/setup-ui.mjs";

const BOARD_UI = new URL("../../src/board-ui.mjs", import.meta.url);
const FEEDBACK_COMMAND = new URL("../../src/commands/feedback.mjs", import.meta.url);

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
    name: "arch/board-write-isolation: the sole feedback-write helper lives in the work:feedback command and targets STATE.md / the verbatim heading",
    async run() {
      // Milestone 08 re-homed the write: board-ui.mjs itself performs NO fs write
      // (the face only invokes the command), so the "sole writer" lens now points
      // at src/commands/feedback.mjs — the command core's ONLY mutation.
      const board = await readFile(BOARD_UI, "utf8");
      for (const verb of ["writeFile", "appendFile"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(stripComments(board)),
          `board-ui.mjs performs no ${verb}( — the write moved into the work:feedback command`
        );
      }

      const source = await readFile(FEEDBACK_COMMAND, "utf8");
      // Structural: there is exactly one feedback-write helper and it is the only
      // function in the command that performs an fs write.
      const helperStart = source.indexOf("async function appendFeedbackBullet");
      assert.ok(helperStart !== -1, "the sole feedback-write helper appendFeedbackBullet exists in the command");
      const helperEnd = nextTopLevelFn(source, helperStart);
      const helperBody = source.slice(helperStart, helperEnd);
      const outsideHelper = source.slice(0, helperStart) + source.slice(helperEnd);
      for (const verb of ["writeFile", "appendFile"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(stripComments(outsideHelper)),
          `${verb} appears only inside appendFeedbackBullet, never elsewhere in the feedback command`
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
    name: "arch/board-write-isolation: no write to item frontmatter/status and no restatus route (board face + feedback command)",
    async run() {
      const board = await readFile(BOARD_UI, "utf8");
      const command = await readFile(FEEDBACK_COMMAND, "utf8");
      // No record-doc (SPEC/STORY/SESSION) is ever written by either the face or
      // the sole writer — status/frontmatter is derived, never written.
      for (const [label, source] of [["board-ui.mjs", board], ["commands/feedback.mjs", command]]) {
        for (const doc of ["SPEC.md", "STORY.md", "SESSION.md"]) {
          assert.ok(!writesTo(source, doc), `${label} never writes ${doc} (status/frontmatter is derived, not written)`);
        }
        assert.ok(!/\bstatus\s*:\s*['"]/.test(stripComments(source)), `${label} writes no literal status value`);
      }
      // No status/restatus route or status-write path on the board face.
      assert.ok(!/\/api\/work\/(re)?status/.test(board), "no /api/work/status or /api/work/restatus route");
    },
  },
  {
    name: "arch/board-write-isolation: the board runs the operation in-process via the registry, never a CLI shell-out",
    async run() {
      const source = await readFile(BOARD_UI, "utf8");
      // The board face invokes operations in-process THROUGH the command registry
      // (the only door, ADR-004 inv. 3) — never a per-request subprocess.
      assert.ok(
        /import\s*\{[^}]*\binvoke\b[^}]*\}\s*from\s*["']\.\/command-core\.mjs["']/.test(source),
        "board-ui.mjs invokes operations in-process through ./command-core.mjs"
      );
      // No child_process / spawn / exec of a CLI.
      assert.ok(!/child_process/.test(source), "no child_process import");
      for (const verb of ["spawn", "spawnSync", "exec", "execSync", "execFile"]) {
        assert.ok(!new RegExp(`\\b${verb}\\s*\\(`).test(stripComments(source)), `no ${verb}( shell-out`);
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
