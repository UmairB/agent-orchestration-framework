// Traceability wiring for milestone 03 / story 01 (the work board).
//
// Covers EVERY @executable scenario across the five task features, exercising
// the REAL server-side `/api/work*` endpoints (board-ui.mjs wired into
// serveSetupUi) against temp fixture repos — never the UI, never a mock server.
//
//   00_board-renders-stream.feature  — list serves the flat 7-field contract
//   01_detail-shows-records.feature  — doc returns body / absent-not-error
//   02_add-feedback.feature          — one bullet / verbatim heading / refs /
//        second beneath first / only-STATE.md changes / routes milestone+story
//   03_validate-stream.feature       — findings / clean→empty / scoped /
//        changes-no-files
//   04_next-item.feature             — ready/blocked/done / waitingOn /
//        changes-no-files
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveSetupUi } from "../src/setup-ui.mjs";

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-board-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  return { repo, workDir };
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function milestone(workDir, { number, slug, status, title, depends }) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPEC.md"),
    frontmatter({
      type: "milestone",
      number,
      slug,
      status,
      title: `"${title}"`,
      created: "2026-06-19",
      updated: "2026-06-19",
      schema: 1,
      ...(depends ? { depends: `[${depends}]` } : {}),
    }) + `# ${number} · ${title}\n`,
    "utf8"
  );
  return dir;
}

async function story(workDir, milestoneFolder, { number, slug, status, title, parent }) {
  const dir = path.join(workDir, milestoneFolder, "stories", `${number}_story_${slug}`);
  await mkdir(path.join(dir, "tasks"), { recursive: true });
  await writeFile(
    path.join(dir, "STORY.md"),
    frontmatter({
      type: "story",
      number,
      slug,
      status,
      title: `"${title}"`,
      parent,
      created: "2026-06-19",
      updated: "2026-06-19",
      schema: 1,
    }) + `# ${number} · ${title}\n`,
    "utf8"
  );
  return dir;
}

// --- server harness ----------------------------------------------------------

async function withServer(repo, body) {
  const { server, url } = await serveSetupUi(null, { projectDir: repo, port: 0 });
  try {
    return await body(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const getJson = async (url, route) => {
  const response = await fetch(new URL(route, url));
  return { status: response.status, body: await response.json() };
};

// --- snapshot helper (for "changes-no-files" scenarios) ----------------------

async function snapshotDir(dir) {
  const snap = new Map();
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
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
  for (const [file, value] of after) {
    if (before.get(file) !== value) changed.push(file);
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changed.push(file);
  }
  return changed;
}

// --- bullets under the feedback heading --------------------------------------

function bulletsUnderHeading(stateText) {
  const lines = stateText.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## Feedback (for retro)");
  if (headingIndex === -1) return [];
  const bullets = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    const line = lines[i];
    // Skip the template's placeholder/comment bullet and HTML comment lines.
    if (line.trim().startsWith("- ") && !line.includes("<note>")) bullets.push(line);
  }
  return bullets;
}

export const boardApiTests = [
  // ===================== 00_board-renders-stream.feature =====================
  {
    name: "board-api/00 the list endpoint serves the flat work-list contract",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const m00 = await milestone(workDir, { number: "00", slug: "work-cli", status: "done", title: "The work CLI" });
        const m03 = await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        await milestone(workDir, { number: "04", slug: "work-memory", status: "not-started", title: "Work memory" });
        await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        void m00; void m03;

        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/list");
          assert.equal(status, 200);
          // a flat JSON array, not a nested tree
          assert.ok(Array.isArray(body), "the response is a flat JSON array, not a nested tree");
          assert.ok(!body.some((item) => "children" in item), "no element carries a nested children edge");
          // every element carries exactly the seven contract fields
          const expected = ["ref", "type", "slug", "status", "title", "parent", "dir"].sort();
          for (const item of body) {
            assert.deepEqual(Object.keys(item).sort(), expected, `element ${item.ref} carries exactly the 7 contract fields`);
          }
          // depth-0 items 00, 03, 04 have a null/absent parent
          for (const ref of ["00", "03", "04"]) {
            const item = body.find((entry) => entry.ref === ref);
            assert.ok(item, `depth-0 item ${ref} present`);
            assert.equal(item.parent, null, `depth-0 item ${ref} has a null parent`);
          }
          // 03/01 carries a parent that resolves to another element's ref
          const child = body.find((entry) => entry.ref === "03/01");
          assert.ok(child, "story 03/01 present");
          assert.equal(child.parent, "03");
          assert.ok(body.some((entry) => entry.ref === child.parent), "parent 03 resolves to another element's ref");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ===================== 01_detail-shows-records.feature =====================
  {
    name: "board-api/01 the doc endpoint returns the requested document body",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const m = await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        const storyDir = await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        void m;
        const storyBody = await readFile(path.join(storyDir, "STORY.md"), "utf8");
        await writeFile(path.join(storyDir, "VERIFICATION.md"), "# verification\n", "utf8");

        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/doc?ref=03/01&doc=STORY");
          assert.equal(status, 200);
          assert.equal(body.present, true);
          assert.equal(body.body, storyBody, "the response carries the body of STORY.md from the item directory");
          assert.equal(body.ref, "03/01");
          assert.equal(body.doc, "STORY");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/01 a document the item lacks is reported as absent, not an error",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        // no RETROSPECTIVE.md written

        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/doc?ref=03/01&doc=RETROSPECTIVE");
          assert.equal(status, 200, "the response is not an error");
          assert.equal(body.present, false, "the response indicates the document is absent");
          assert.equal(body.body, "");
          assert.notEqual(body.ok, false, "no error envelope");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ===================== 02_add-feedback.feature =============================
  {
    name: "board-api/02 the feedback endpoint appends one attributed bullet in the documented format",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        const storyDir = await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        // STATE.md already has the heading with no entries
        await writeFile(path.join(storyDir, "STATE.md"), "# 01 · State\n\n## Feedback (for retro)\n\n", "utf8");

        await withServer(repo, async (url) => {
          const response = await fetch(new URL("/api/work/feedback", url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref: "03/01", note: "spec was ambiguous on the empty state", actor: "qa" }),
          });
          const body = await response.json();
          assert.equal(response.status, 200);
          assert.equal(body.ok, true);

          const stateText = await readFile(path.join(storyDir, "STATE.md"), "utf8");
          const bullets = bulletsUnderHeading(stateText);
          assert.equal(bullets.length, 1, "exactly one new bullet is appended under the heading");
          assert.equal(bullets[0], "- spec was ambiguous on the empty state — Raised by: qa", "bullet reads in the documented format");
          assert.ok(bullets[0].includes("Raised by: qa"), "the bullet is attributed to the qa actor");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/02 the feedback append creates the heading verbatim when it is absent",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        const storyDir = await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        // STATE.md with no feedback heading
        await writeFile(path.join(storyDir, "STATE.md"), "# 01 · State\n\n## Progress\n\n- [ ] something\n", "utf8");

        await withServer(repo, async (url) => {
          const response = await fetch(new URL("/api/work/feedback", url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref: "03/01", note: "the loading copy reads oddly", actor: "qa" }),
          });
          assert.equal(response.status, 200);

          const stateText = await readFile(path.join(storyDir, "STATE.md"), "utf8");
          assert.ok(stateText.includes("## Feedback (for retro)"), "a verbatim heading is created");
          assert.ok(stateText.includes("## Progress"), "the existing body is preserved");
          const bullets = bulletsUnderHeading(stateText);
          assert.equal(bullets.length, 1, "exactly one bullet is appended under it");
          assert.equal(bullets[0], "- the loading copy reads oddly — Raised by: qa");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/02 a supplied Refs pointer is recorded verbatim on the bullet",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        const storyDir = await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        await writeFile(path.join(storyDir, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");

        await withServer(repo, async (url) => {
          const response = await fetch(new URL("/api/work/feedback", url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref: "03/01", note: "revisit the chip ramp", actor: "qa", refs: "DESIGN §1" }),
          });
          assert.equal(response.status, 200);

          const stateText = await readFile(path.join(storyDir, "STATE.md"), "utf8");
          const bullets = bulletsUnderHeading(stateText);
          assert.equal(bullets.length, 1);
          assert.ok(bullets[0].endsWith("Refs: DESIGN §1"), "the appended bullet ends with the verbatim Refs pointer");
          // three spaces before Refs, em-dash, matching the canonical template
          assert.equal(bullets[0], "- revisit the chip ramp — Raised by: qa   Refs: DESIGN §1");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/02 a second note appends beneath the first without disturbing it",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        const storyDir = await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        const firstBullet = "- existing note — Raised by: developer";
        await writeFile(path.join(storyDir, "STATE.md"), `## Feedback (for retro)\n\n${firstBullet}\n`, "utf8");

        await withServer(repo, async (url) => {
          const response = await fetch(new URL("/api/work/feedback", url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref: "03/01", note: "second note", actor: "qa" }),
          });
          assert.equal(response.status, 200);

          const stateText = await readFile(path.join(storyDir, "STATE.md"), "utf8");
          const bullets = bulletsUnderHeading(stateText);
          assert.equal(bullets.length, 2, "there are now two bullets under the heading");
          assert.equal(bullets[0], firstBullet, "the existing bullet is unchanged");
          assert.equal(bullets[1], "- second note — Raised by: qa", "the new bullet appears beneath it");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/02 posting feedback writes only the STATE.md and never the item status",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        const storyDir = await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        await writeFile(path.join(storyDir, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");

        const before = await snapshotDir(workDir);
        await withServer(repo, async (url) => {
          const response = await fetch(new URL("/api/work/feedback", url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref: "03/01", note: "only-write check", actor: "qa" }),
          });
          assert.equal(response.status, 200);
        });
        const after = await snapshotDir(workDir);
        const changed = diffSnapshots(before, after);
        assert.deepEqual(changed, [path.join(storyDir, "STATE.md")], "the only file changed is STATE.md");

        // record-doc frontmatter + status unchanged
        const storyBefore = before.get(path.join(storyDir, "STORY.md"));
        const storyAfter = after.get(path.join(storyDir, "STORY.md"));
        assert.equal(storyBefore, storyAfter, "the item's record-doc frontmatter and status are unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/02 feedback routes to a milestone STATE log",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const mDir = await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        await writeFile(path.join(mDir, "STATE.md"), "# 03 · State\n", "utf8");

        await withServer(repo, async (url) => {
          const response = await fetch(new URL("/api/work/feedback", url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref: "03", note: "a note", actor: "qa" }),
          });
          assert.equal(response.status, 200);
          const stateText = await readFile(path.join(mDir, "STATE.md"), "utf8");
          assert.ok(stateText.includes("## Feedback (for retro)"), "the note lands under the heading in the milestone STATE.md");
          assert.equal(bulletsUnderHeading(stateText).length, 1);
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/02 feedback routes to a story STATE log",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        const storyDir = await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        await writeFile(path.join(storyDir, "STATE.md"), "# 01 · State\n", "utf8");

        await withServer(repo, async (url) => {
          const response = await fetch(new URL("/api/work/feedback", url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref: "03/01", note: "a note", actor: "qa" }),
          });
          assert.equal(response.status, 200);
          const stateText = await readFile(path.join(storyDir, "STATE.md"), "utf8");
          assert.ok(stateText.includes("## Feedback (for retro)"), "the note lands under the heading in the story STATE.md");
          assert.equal(bulletsUnderHeading(stateText).length, 1);
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ===================== /api/work/tasks (story TASKS tab) ==================
  {
    name: "board-api/tasks the tasks endpoint parses a story's tasks/*.feature with lanes + counts",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        const storyDir = await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        // Two task features. 02 sorts after 01; the endpoint sorts by filename.
        // Feature carries @executable; the @manual scenario has NO competing
        // feature-level verification tag of its own — but feature @executable IS
        // in scope for it, so this file scopes lanes per-scenario instead.
        await writeFile(
          path.join(storyDir, "tasks", "01_list-endpoint.feature"),
          [
            "Feature: list endpoint",
            "",
            "  @executable",
            "  Scenario: serves the flat contract",
            "    Given a stream",
            "",
            "  @manual",
            "  Scenario: a hand-checked thing",
            "    Given something",
            "",
            "  @executable",
            "  Scenario Outline: each row",
            "    Given <x>",
          ].join("\n"),
          "utf8"
        );
        await writeFile(
          path.join(storyDir, "tasks", "02_uat-walkthrough.feature"),
          ["@uat", "Feature: walkthrough", "", "  Scenario: operator walks the board", "    Given the board"].join("\n"),
          "utf8"
        );

        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/tasks?ref=03/01");
          assert.equal(status, 200);
          assert.equal(body.ref, "03/01");
          assert.equal(body.tasks.length, 2, "both task features are returned");
          // sorted by filename
          assert.deepEqual(body.tasks.map((t) => t.file), ["01_list-endpoint.feature", "02_uat-walkthrough.feature"]);

          const first = body.tasks[0];
          assert.equal(first.feature, "list endpoint");
          assert.equal(first.scenarios.length, 3);
          // feature-level @executable applies; the @manual scenario overrides via its own tag
          assert.equal(first.scenarios[0].lane, "executable");
          assert.equal(first.scenarios[1].lane, "manual");
          assert.equal(first.scenarios[2].lane, "executable");
          assert.equal(first.scenarios[2].outline, true, "the Scenario Outline is flagged");
          assert.deepEqual(first.counts, { executable: 2, manual: 1, uat: 0 });

          const second = body.tasks[1];
          assert.equal(second.feature, "walkthrough");
          assert.equal(second.scenarios[0].lane, "uat");
          assert.deepEqual(second.counts, { executable: 0, manual: 0, uat: 1 });
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/tasks a story with no tasks/ dir returns an empty list, not an error",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const mDir = await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        // A milestone has no tasks/ dir of its own.
        void mDir;

        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/tasks?ref=03");
          assert.equal(status, 200, "the response is not an error");
          assert.deepEqual(body, { ref: "03", tasks: [] }, "absent tasks/ → empty list");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/tasks the tasks endpoint changes no files (read-only)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        const storyDir = await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });
        await writeFile(
          path.join(storyDir, "tasks", "01_thing.feature"),
          "@executable\nFeature: thing\n\n  Scenario: does\n    Given x\n",
          "utf8"
        );

        const before = await snapshotDir(workDir);
        await withServer(repo, async (url) => {
          const { status } = await getJson(url, "/api/work/tasks?ref=03/01");
          assert.equal(status, 200);
        });
        const after = await snapshotDir(workDir);
        assert.deepEqual(diffSnapshots(before, after), [], "no file in the work stream is changed");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ===================== 03_validate-stream.feature =========================
  {
    name: "board-api/03 the validate endpoint returns the validator's findings",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        // story folder slug disagrees with its frontmatter slug
        const storyDir = path.join(workDir, "03_milestone_work-board", "stories", "01_story_folder-slug");
        await mkdir(path.join(storyDir, "tasks"), { recursive: true });
        await writeFile(
          path.join(storyDir, "STORY.md"),
          frontmatter({
            type: "story",
            number: "01",
            slug: "frontmatter-slug", // disagrees with folder "folder-slug"
            status: "in-progress",
            title: '"Mismatched"',
            parent: "3",
            created: "2026-06-19",
            updated: "2026-06-19",
          }),
          "utf8"
        );

        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/validate");
          assert.equal(status, 200);
          assert.ok(Array.isArray(body.findings), "the response is a list of findings");
          assert.ok(body.findings.length >= 1, "at least one finding");
          const slugFinding = body.findings.find((f) => /slug/.test(f.problem));
          assert.ok(slugFinding, "one finding names the slug problem");
          assert.ok(slugFinding.path.includes("STORY.md"), "the finding names the offending document path");
          assert.ok(!slugFinding.path.includes("\\"), "the path is forward-slashed");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/03 a clean stream returns no findings",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });

        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/validate");
          assert.equal(status, 200);
          assert.deepEqual(body.findings, [], "the response is an empty list of findings");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/03 validate scoped to a selection reports only in-scope findings",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // milestone 03 with a malformed story; milestone 04 with a malformed story
        await milestone(workDir, { number: "03", slug: "m-three", status: "in-progress", title: "Three" });
        await milestone(workDir, { number: "04", slug: "m-four", status: "in-progress", title: "Four" });
        const badThree = path.join(workDir, "03_milestone_m-three", "stories", "01_story_bad-three");
        const badFour = path.join(workDir, "04_milestone_m-four", "stories", "01_story_bad-four");
        for (const [dir, slug, parent] of [[badThree, "wrong-three", "3"], [badFour, "wrong-four", "4"]]) {
          await mkdir(path.join(dir, "tasks"), { recursive: true });
          await writeFile(
            path.join(dir, "STORY.md"),
            frontmatter({ type: "story", number: "01", slug, status: "in-progress", title: '"Bad"', parent, created: "2026-06-19", updated: "2026-06-19" }),
            "utf8"
          );
        }

        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/validate?scope=03");
          assert.equal(status, 200);
          assert.ok(body.findings.length >= 1, "in-scope findings reported");
          assert.ok(body.findings.every((f) => f.path.includes("m-three")), "only findings under milestone 03 are reported");
          assert.ok(!body.findings.some((f) => f.path.includes("m-four")), "findings under milestone 04 are not reported");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/03 validate changes no files",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });

        const before = await snapshotDir(workDir);
        await withServer(repo, async (url) => {
          const { status } = await getJson(url, "/api/work/validate");
          assert.equal(status, 200);
        });
        const after = await snapshotDir(workDir);
        assert.deepEqual(diffSnapshots(before, after), [], "no file in the work stream is changed");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ===================== 04_next-item.feature ===============================
  {
    name: "board-api/04 next returns 'ready' carrying the next item's ref",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });

        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/next");
          assert.equal(status, 200);
          assert.equal(body.state, "ready");
          assert.ok(typeof body.ref === "string" && body.ref.length > 0, "the next item's ref is carried");
          if (typeof body.path === "string") assert.ok(!body.path.includes("\\"), "path is forward-slashed");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/04 next returns 'blocked' carrying a waitingOn list",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // 03 not done, 04 depends on 03 → 04 is blocked, but 03 is ready first;
        // to isolate a pure-blocked stream, make 03 done with no stories and 04
        // depend on a NOT-done driver 05.
        await milestone(workDir, { number: "03", slug: "m-three", status: "done", title: "Three" });
        await milestone(workDir, { number: "05", slug: "m-five", status: "in-progress", title: "Five" });
        await milestone(workDir, { number: "04", slug: "m-four", status: "in-progress", title: "Four", depends: "5" });

        // scope to just 04 so only the blocked driver is in range
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/next?scope=04");
          assert.equal(status, 200);
          assert.equal(body.state, "blocked");
          assert.ok(Array.isArray(body.waitingOn), "a waitingOn list of what it needs is carried");
          assert.ok(body.waitingOn.includes("5"), "waitingOn names the unmet driver");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/04 next returns 'done' with no ref when every driver is done",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "m-three", status: "done", title: "Three" });
        await milestone(workDir, { number: "04", slug: "m-four", status: "done", title: "Four" });

        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/next");
          assert.equal(status, 200);
          assert.equal(body.state, "done");
          assert.equal(body.ref, undefined, "done carries no ref");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/04 a blocked result names the unmet dependencies it waits on",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // milestone 04 depends on milestone 03, and 03 is not done
        await milestone(workDir, { number: "03", slug: "m-three", status: "in-progress", title: "Three" });
        await milestone(workDir, { number: "04", slug: "m-four", status: "in-progress", title: "Four", depends: "3" });

        await withServer(repo, async (url) => {
          // scope to 04 so 03's own readiness doesn't preempt the blocked answer
          const { status, body } = await getJson(url, "/api/work/next?scope=04");
          assert.equal(status, 200);
          assert.equal(body.state, "blocked");
          assert.ok(body.waitingOn.includes("3"), "the waitingOn list contains 03's driver number");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "board-api/04 next changes no files",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "03", slug: "work-board", status: "in-progress", title: "The work board UI" });
        await story(workDir, "03_milestone_work-board", { number: "01", slug: "work-board", status: "in-progress", title: "The work board", parent: "3" });

        const before = await snapshotDir(workDir);
        await withServer(repo, async (url) => {
          const { status } = await getJson(url, "/api/work/next");
          assert.equal(status, 200);
        });
        const after = await snapshotDir(workDir);
        assert.deepEqual(diffSnapshots(before, after), [], "no file in the work stream is changed");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
