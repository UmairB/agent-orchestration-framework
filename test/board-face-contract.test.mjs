// Traceability wiring for milestone 08 / story 02 (the board face).
//
// Covers EVERY @executable scenario across the three task features, exercising
// the REAL migrated `/api/work*` seam (board-ui.mjs reduced to route → invoke →
// projection, wired into serveSetupUi) against temp fixture repos — never the
// UI, never a mock server, never the command modules directly. Mirrors
// test/board-api.test.mjs (the milestone-03 byte-for-byte oracle): build temp
// fixtures, stand up serveSetupUi(null, { projectDir, port:0 }), fetch the
// routes, assert.
//
//   00_routes-byte-for-byte.feature        — each read route's m03 success
//        envelope, validate/next path projection, absent-doc/absent-tasks,
//        feedback POST → { ok:true, bullet } + one bullet
//   01_error-envelope-and-status.feature   — the { ok:false, error, code }
//        envelope, status mapping (400/404/413), unknown-route 404,
//        empty/malformed-JSON 400, envelope keys exactly { ok, error, code }
//   02_resolver-distinction-preserved.feature — read (slug-fallback) vs
//        feedback-write (exact-only); a non-exact ref reads but never writes
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveSetupUi } from "../src/setup-ui.mjs";

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-board-face-"));
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

async function story(workDir, milestoneFolder, { number, slug, status, title, parent, withTasksDir = true }) {
  const dir = path.join(workDir, milestoneFolder, "stories", `${number}_story_${slug}`);
  await mkdir(withTasksDir ? path.join(dir, "tasks") : dir, { recursive: true });
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

// A top-level uat session folder (`NN_uat_slug/SESSION.md`) — a feedback target
// that is neither a milestone nor a story, so the write rejects unsupported-target.
async function uat(workDir, { number, slug, status, title }) {
  const dir = path.join(workDir, `${number}_uat_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SESSION.md"),
    frontmatter({
      type: "uat",
      number,
      slug,
      status,
      title: `"${title}"`,
      created: "2026-06-19",
      updated: "2026-06-19",
    }) + `# ${number} · ${title}\n`,
    "utf8"
  );
  return dir;
}

// A story whose FOLDER slug disagrees with its frontmatter slug — the validator's
// canonical "one malformed item" (mirrors board-api.test.mjs's slug-mismatch fixture).
async function malformedStory(workDir, milestoneFolder, { number, folderSlug, frontmatterSlug, parent }) {
  const dir = path.join(workDir, milestoneFolder, "stories", `${number}_story_${folderSlug}`);
  await mkdir(path.join(dir, "tasks"), { recursive: true });
  await writeFile(
    path.join(dir, "STORY.md"),
    frontmatter({
      type: "story",
      number,
      slug: frontmatterSlug,
      status: "in-progress",
      title: '"Mismatched"',
      parent,
      created: "2026-06-19",
      updated: "2026-06-19",
    }),
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

const postJson = async (url, route, payload, { raw } = {}) => {
  const response = await fetch(new URL(route, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw !== undefined ? raw : JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
};

// --- snapshot helper (for the "appends nothing" scenarios) -------------------

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

function changedFiles(before, after) {
  const changed = [];
  for (const [file, value] of after) {
    if (before.get(file) !== value) changed.push(file);
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changed.push(file);
  }
  return changed;
}

function bulletsUnderHeading(stateText) {
  const lines = stateText.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## Feedback (for retro)");
  if (headingIndex === -1) return [];
  const bullets = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    const line = lines[i];
    if (line.trim().startsWith("- ") && !line.includes("<note>")) bullets.push(line);
  }
  return bullets;
}

// A standard milestone-08 fixture stream: milestone 08 (folder slug
// "cli-command-core") with stories 08/00 and 08/01, plus a sibling milestone so
// list/validate/next have a stream to range over. Each builder returns the dirs
// callers need to seed/inspect STATE.md.
async function eightStream(workDir) {
  const m08 = await milestone(workDir, {
    number: "08",
    slug: "cli-command-core",
    status: "in-progress",
    title: "CLI Command Core",
  });
  const s00 = await story(workDir, "08_milestone_cli-command-core", {
    number: "00",
    slug: "command-core",
    status: "done",
    title: "The command core",
    parent: "8",
  });
  const s01 = await story(workDir, "08_milestone_cli-command-core", {
    number: "01",
    slug: "cli-face",
    status: "in-progress",
    title: "The CLI face",
    parent: "8",
  });
  return { m08, s00, s01 };
}

export const boardFaceContractTests = [
  // ============== 00_routes-byte-for-byte.feature ==========================

  // Scenario Outline: each /api/work read route returns its milestone-03 success
  // envelope (list / doc / tasks / validate / next).
  {
    name: "face/00 the list route returns the milestone-03 ListRow[] success envelope",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/list");
          assert.equal(status, 200);
          assert.ok(Array.isArray(body), "list is a flat JSON array");
          const expected = ["ref", "type", "slug", "status", "title", "parent", "dir"].sort();
          for (const item of body) {
            assert.deepEqual(Object.keys(item).sort(), expected, `${item.ref} carries the 7 contract fields`);
            assert.ok(!String(item.dir).includes("\\"), "dir is forward-slashed");
          }
          assert.ok(body.some((r) => r.ref === "08"), "milestone 08 present");
          assert.ok(body.some((r) => r.ref === "08/00"), "story 08/00 present");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/00 the doc route returns the milestone-03 { ref, doc, present, body } envelope",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { m08 } = await eightStream(workDir);
        const specBody = await readFile(path.join(m08, "SPEC.md"), "utf8");
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/doc?ref=08&doc=SPEC");
          assert.equal(status, 200);
          assert.deepEqual(Object.keys(body).sort(), ["body", "doc", "present", "ref"]);
          assert.equal(body.ref, "08");
          assert.equal(body.doc, "SPEC");
          assert.equal(body.present, true);
          assert.equal(body.body, specBody, "the verbatim SPEC.md body is returned");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/00 the tasks route returns the milestone-03 { ref, tasks } envelope",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { s00 } = await eightStream(workDir);
        await writeFile(
          path.join(s00, "tasks", "00_routes.feature"),
          "@executable\nFeature: routes\n\n  Scenario: serves\n    Given x\n",
          "utf8"
        );
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/tasks?ref=08/00");
          assert.equal(status, 200);
          assert.deepEqual(Object.keys(body).sort(), ["ref", "tasks"]);
          assert.equal(body.ref, "08/00");
          assert.ok(Array.isArray(body.tasks), "tasks is an array");
          assert.equal(body.tasks.length, 1);
          assert.equal(body.tasks[0].file, "00_routes.feature");
          assert.equal(body.tasks[0].feature, "routes");
          assert.deepEqual(body.tasks[0].counts, { executable: 1, manual: 0, uat: 0 });
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/00 the validate route returns the milestone-03 { findings } envelope",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/validate");
          assert.equal(status, 200);
          assert.deepEqual(Object.keys(body), ["findings"], "a { findings } envelope");
          assert.ok(Array.isArray(body.findings), "findings is an array");
          // a clean stream → empty findings (the m03 success envelope)
          assert.deepEqual(body.findings, []);
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/00 the next route returns the milestone-03 NextResult envelope",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/next");
          assert.equal(status, 200);
          assert.ok(typeof body.state === "string", "carries a state");
          if (typeof body.ref === "string") assert.ok(body.ref.length > 0, "a ready/blocked ref is non-empty");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Scenario: the validate route projects finding paths to projectRoot-relative
  // forward-slashed.
  {
    name: "face/00 validate projects finding paths to projectRoot-relative + forward-slashed",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI Command Core" });
        await malformedStory(workDir, "08_milestone_cli-command-core", {
          number: "00",
          folderSlug: "folder-slug",
          frontmatterSlug: "frontmatter-slug",
          parent: "8",
        });
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/validate");
          assert.equal(status, 200);
          assert.deepEqual(Object.keys(body), ["findings"], "a { findings } envelope");
          assert.ok(body.findings.length >= 1, "the malformed item yields a finding");
          for (const finding of body.findings) {
            assert.ok(!finding.path.includes("\\"), "the path is forward-slashed");
            assert.ok(!path.isAbsolute(finding.path), "the path is projectRoot-RELATIVE, not absolute");
            // projectRoot-relative means it starts at the work dir, not a drive root.
            assert.ok(
              finding.path.startsWith("wiki/work/"),
              "the path is relative to the project root (begins at the configured work dir)"
            );
          }
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Scenario: the next route projects the next item's path to projectRoot-rel
  // forward-slashed.
  {
    name: "face/00 next projects the next item's path to projectRoot-relative + forward-slashed",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/next");
          assert.equal(status, 200);
          assert.ok(typeof body.path === "string", "a ready/blocked next item carries a path");
          assert.ok(!body.path.includes("\\"), "the path is forward-slashed");
          assert.ok(!path.isAbsolute(body.path), "the path is projectRoot-RELATIVE, not absolute");
          assert.ok(body.path.startsWith("wiki/work/"), "the path is relative to the project root");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Scenario: an absent doc returns present:false with a 200, unchanged.
  {
    name: "face/00 an absent doc returns present:false with a 200",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        // milestone 08 has no RETROSPECTIVE.md
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/doc?ref=08&doc=RETROSPECTIVE");
          assert.equal(status, 200, "absent is not an error");
          assert.equal(body.present, false, "present is false");
          assert.equal(body.body, "", "an empty body");
          assert.notEqual(body.ok, false, "no error envelope");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Scenario: an absent tasks dir returns an empty tasks list with a 200, unchanged.
  {
    name: "face/00 an absent tasks dir returns an empty tasks list with a 200",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI Command Core" });
        // story 08/01 with NO tasks dir at all
        await story(workDir, "08_milestone_cli-command-core", {
          number: "01",
          slug: "no-tasks",
          status: "in-progress",
          title: "No tasks",
          parent: "8",
          withTasksDir: false,
        });
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/tasks?ref=08/01");
          assert.equal(status, 200, "absent tasks/ is not an error");
          assert.deepEqual(body, { ref: "08/01", tasks: [] }, "absent tasks/ → empty list");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Scenario: the feedback route returns { ok:true, bullet } and appends one bullet.
  {
    name: "face/00 feedback returns { ok:true, bullet } and appends exactly one bullet",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { s00 } = await eightStream(workDir);
        // story 08/00 STATE.md with the heading and no entries
        await writeFile(path.join(s00, "STATE.md"), "# 00 · State\n\n## Feedback (for retro)\n\n", "utf8");
        await withServer(repo, async (url) => {
          const { status, body } = await postJson(url, "/api/work/feedback", {
            ref: "08/00",
            note: "a note",
            actor: "qa",
          });
          assert.equal(status, 200);
          assert.equal(body.ok, true, "{ ok:true }");
          assert.ok(typeof body.bullet === "string" && body.bullet.length > 0, "carries the appended bullet");

          const stateText = await readFile(path.join(s00, "STATE.md"), "utf8");
          const bullets = bulletsUnderHeading(stateText);
          assert.equal(bullets.length, 1, "exactly one bullet under the heading");
          assert.equal(bullets[0], body.bullet, "the returned bullet is the appended line");
          assert.equal(bullets[0], "- a note — Raised by: qa");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/00 feedback with no actor defaults the attribution to 'you' (default now in the command)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { s00 } = await eightStream(workDir);
        await writeFile(path.join(s00, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
        await withServer(repo, async (url) => {
          // no actor field — the command supplies the "you" default
          const { status, body } = await postJson(url, "/api/work/feedback", { ref: "08/00", note: "a note" });
          assert.equal(status, 200);
          assert.equal(body.bullet, "- a note — Raised by: you", "the command's default actor is applied");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ============== 01_error-envelope-and-status.feature =====================

  // Scenario Outline: each error case returns its milestone-03 status and code.
  {
    name: "face/01 doc with an unknown doc name → 400 invalid-doc",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/doc?ref=08&doc=NONSENSE");
          assert.equal(status, 400);
          assert.equal(body.ok, false);
          assert.equal(body.code, "invalid-doc");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/01 doc with an unresolved ref → 404 ref-not-found",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/doc?ref=99&doc=SPEC");
          assert.equal(status, 404);
          assert.equal(body.ok, false);
          assert.equal(body.code, "ref-not-found");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/01 feedback with no note → 400 missing-note",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await postJson(url, "/api/work/feedback", { ref: "08/00" });
          assert.equal(status, 400);
          assert.equal(body.ok, false);
          assert.equal(body.code, "missing-note");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/01 feedback with no ref → 400 missing-ref",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await postJson(url, "/api/work/feedback", { note: "a note" });
          assert.equal(status, 400);
          assert.equal(body.ok, false);
          assert.equal(body.code, "missing-ref");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/01 feedback targeting a uat session 09 → 400 unsupported-target",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        // the Background's top-level uat session "09"
        await uat(workDir, { number: "09", slug: "graphify-acceptance", status: "not-started", title: "Graphify acceptance" });
        await withServer(repo, async (url) => {
          const { status, body } = await postJson(url, "/api/work/feedback", { ref: "09", note: "a note" });
          assert.equal(status, 400);
          assert.equal(body.ok, false);
          assert.equal(body.code, "unsupported-target");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/01 an unknown /api/work route → 404 not-found",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/nope");
          assert.equal(status, 404);
          assert.equal(body.ok, false);
          assert.equal(body.code, "not-found", "the board face owns the unknown-route 404");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Scenario: an oversized feedback body is rejected with 413 payload-too-large.
  {
    name: "face/01 an oversized feedback body → 413 payload-too-large",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          // > 1_000_000 bytes — over the body reader's size cap
          const oversized = JSON.stringify({ ref: "08/00", note: "x".repeat(1_000_001) });
          const { status, body } = await postJson(url, "/api/work/feedback", null, { raw: oversized });
          assert.equal(status, 413);
          assert.equal(body.ok, false);
          assert.equal(body.code, "payload-too-large");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Scenario Outline: an empty or malformed feedback body is a 400.
  {
    name: "face/01 an empty feedback body → 400 empty-json",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await postJson(url, "/api/work/feedback", null, { raw: "" });
          assert.equal(status, 400);
          assert.equal(body.ok, false);
          assert.equal(body.code, "empty-json");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/01 a malformed feedback body → 400 malformed-json",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await postJson(url, "/api/work/feedback", null, { raw: "{not json" });
          assert.equal(status, 400);
          assert.equal(body.ok, false);
          assert.equal(body.code, "malformed-json");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Scenario: the error envelope keys are exactly { ok, error, code }.
  {
    name: "face/01 the error envelope keys are exactly { ok, error, code } and ok is false",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/doc?ref=08&doc=NONSENSE");
          assert.equal(status, 400);
          assert.deepEqual(Object.keys(body).sort(), ["code", "error", "ok"], "exactly { ok, error, code }");
          assert.equal(body.ok, false);
          assert.ok(typeof body.error === "string" && body.error.length > 0, "error is a message");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ============== 02_resolver-distinction-preserved.feature ================

  // Scenario Outline: a read route resolves a free-text slug to the matching item.
  {
    name: "face/02 doc resolves the free-text slug 'cli-command-core' to the 08 milestone (200)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/doc?ref=cli-command-core&doc=SPEC");
          assert.equal(status, 200);
          assert.equal(body.ref, "08", "the slug resolves to the 08 milestone");
          assert.equal(body.present, true);
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "face/02 tasks resolves the free-text slug 'cli-command-core' to the 08 milestone (200)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await eightStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/tasks?ref=cli-command-core");
          assert.equal(status, 200);
          assert.equal(body.ref, "08", "the slug resolves to the 08 milestone");
          // a milestone has no tasks/ dir of its own → absent-not-error → []
          assert.deepEqual(body.tasks, []);
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Scenario: the feedback write rejects a non-exact ref and appends nothing.
  {
    name: "face/02 feedback rejects a non-exact ref (404 ref-not-found) and appends nothing",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { m08, s00 } = await eightStream(workDir);
        await writeFile(path.join(m08, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
        await writeFile(path.join(s00, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
        await withServer(repo, async (url) => {
          const before = await snapshotDir(workDir);
          // "cli-command" is a partial slug a READ would match, but the exact
          // resolver finds no row whose ref === "cli-command" → 404.
          const { status, body } = await postJson(url, "/api/work/feedback", {
            ref: "cli-command",
            note: "should not land",
          });
          assert.equal(status, 404);
          assert.equal(body.ok, false);
          assert.equal(body.code, "ref-not-found");
          const after = await snapshotDir(workDir);
          assert.deepEqual(changedFiles(before, after), [], "no STATE.md in the stream gained a bullet");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Scenario: the same non-exact ref reads but does not write.
  {
    name: "face/02 the same non-exact ref reads 200 but writes 404",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { m08 } = await eightStream(workDir);
        await writeFile(path.join(m08, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
        await withServer(repo, async (url) => {
          // READ with the free-text slug → 200 (slug-fallback tolerated)
          const read = await getJson(url, "/api/work/doc?ref=cli-command-core&doc=SPEC");
          assert.equal(read.status, 200, "the read succeeds via slug-fallback");
          assert.equal(read.body.ref, "08");

          // WRITE with the SAME non-exact slug → 404 (exact-only, no fallback)
          const before = await snapshotDir(workDir);
          const write = await postJson(url, "/api/work/feedback", { ref: "cli-command-core", note: "a note" });
          assert.equal(write.status, 404, "the write fails — exact-only resolver");
          assert.equal(write.body.code, "ref-not-found");
          const after = await snapshotDir(workDir);
          assert.deepEqual(changedFiles(before, after), [], "the write appended nothing");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
