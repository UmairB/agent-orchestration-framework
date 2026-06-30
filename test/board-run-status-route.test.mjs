// Traceability wiring for milestone 21 / story 00 — the run READ route.
//
// Covers the SERVER-side @executable scenarios of
// tasks/00_runs-render-from-run-status.feature, exercising the REAL
// `/api/work/run-status` endpoint (the new board-ui.mjs route wired into
// serveSetupUi) against temp fixture repos — never the UI, never a mock server.
// The route is the thinnest of the /api/work family (ARCHITECTURE 21/ADR-001):
// HTTP → invoke("work:run-status",{ref}) → the { ref, runs[] } envelope, with ZERO
// operation logic and no path projection (the records carry refs).
//
//   the run-status route returns the item's runs through the registry
//   an item with no runs is reported as an empty history, not an error
//   a ref that resolves to no item is a not-found, not a crash
//   reading the run history changes no files
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveSetupUi } from "../src/setup-ui.mjs";
import { loadWorkspace } from "../src/command-core.mjs";
import { invoke } from "../src/command-core.mjs";

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-run-route-"));
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

// The milestone-21 fixture: milestone 21 with story 21/00 (three runs #1,#2,#3) and
// story 21/01 (never run — no runs/ log). Mirrors the feature Background.
async function buildStream(workDir) {
  const mDir = path.join(workDir, "21_milestone_board-run-observability");
  const s00 = path.join(mDir, "stories", "00_story_run-observability");
  const s01 = path.join(mDir, "stories", "01_story_rerun-affordance");
  await mkdir(s00, { recursive: true });
  await mkdir(s01, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "21", slug: "board-run-observability", status: "in-progress", title: '"Board Run Observability"', created: "2026-06-30", updated: "2026-06-30" }) + "# 21\n",
    "utf8"
  );
  await writeFile(
    path.join(s00, "STORY.md"),
    frontmatter({ type: "story", number: "00", slug: "run-observability", parent: "21", status: "in-progress", title: '"Run observability"', created: "2026-06-30", updated: "2026-06-30" }) + "# 00\n",
    "utf8"
  );
  await writeFile(
    path.join(s01, "STORY.md"),
    frontmatter({ type: "story", number: "01", slug: "rerun-affordance", parent: "21", status: "in-progress", title: '"Rerun affordance"', created: "2026-06-30", updated: "2026-06-30" }) + "# 01\n",
    "utf8"
  );
  // Seed 21/00's runs/ with three records (attempts #1,#2,#3), written directly —
  // a derived log of per-run JSON files (19/ADR-002). createdAt ascending so the
  // runIds sort chronologically.
  const runsDir = path.join(s00, "runs");
  await mkdir(runsDir, { recursive: true });
  const seed = (runId, attempt, state, createdAt) => ({
    runId, itemRef: "21/00", state, attempt, outcome: state === "running" ? null : state,
    sessionId: `sess-${attempt}abcd`, brief: {}, createdAt, updatedAt: createdAt,
    failureReason: null, heartbeatAt: null, retryOf: null, reclaimedAt: null,
  });
  const records = [
    seed("20260630T000001000Z-0000", 1, "done", "2026-06-30T00:00:01.000Z"),
    seed("20260630T000002000Z-0001", 2, "failed", "2026-06-30T00:00:02.000Z"),
    seed("20260630T000003000Z-0002", 3, "running", "2026-06-30T00:00:03.000Z"),
  ];
  for (const record of records) {
    await writeFile(path.join(runsDir, `${record.runId}.json`), JSON.stringify(record, null, 2), "utf8");
  }
  return { mDir, s00, s01 };
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

export const boardRunStatusRouteTests = [
  // ===== the run-status route returns the item's runs through the registry =====
  {
    name: "board-run-status/00 the run-status route returns the item's runs through the registry",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await buildStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/run-status?ref=21/00");
          assert.equal(status, 200, "the read is not an error");
          assert.equal(body.ref, "21/00", "the response carries the ref 21/00");
          assert.ok(Array.isArray(body.runs), "and a list of that item's runs");
          assert.equal(body.runs.length, 3, "all three runs are returned");

          // The runs are EXACTLY the records work:run-status returns for 21/00 —
          // the route is a pass-through of the registered command (no reshape).
          const ctx = { workspace: await loadWorkspace(repo) };
          const direct = await invoke("work:run-status", { ref: "21/00" }, ctx);
          assert.deepEqual(body, direct, "the route serialises work:run-status's { ref, runs[] } unchanged");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ===== an item with no runs is reported as an empty history, not an error =====
  {
    name: "board-run-status/00 an item with no runs is reported as an empty history, not an error",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await buildStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/run-status?ref=21/01");
          assert.equal(status, 200, "the response is not an error");
          assert.equal(body.ref, "21/01", "the response carries the ref 21/01");
          assert.deepEqual(body.runs, [], "and an empty list of runs (absent ⇒ [], not an error)");
          assert.notEqual(body.ok, false, "no error envelope");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ===== a ref that resolves to no item is a not-found, not a crash =====
  {
    name: "board-run-status/00 a ref that resolves to no item is a not-found, not a server error",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await buildStream(workDir);
        await withServer(repo, async (url) => {
          const { status, body } = await getJson(url, "/api/work/run-status?ref=99/99");
          assert.equal(status, 404, "the response is a not-found, not a server error");
          assert.equal(body.ok, false, "an error envelope");
          assert.equal(body.code, "ref-not-found", "the ref could not be resolved");
        });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ===== reading the run history changes no files =====
  {
    name: "board-run-status/00 reading the run history changes no files",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await buildStream(workDir);
        const before = await snapshotDir(workDir);
        await withServer(repo, async (url) => {
          const { status } = await getJson(url, "/api/work/run-status?ref=21/00");
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
