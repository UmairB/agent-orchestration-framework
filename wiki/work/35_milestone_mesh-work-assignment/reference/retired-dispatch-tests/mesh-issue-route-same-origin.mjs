// Traceability wiring for milestone 27 / story 02 — the CSRF / same-origin +
// content-type guard on the write route (tasks/01_issue-route-same-origin.feature,
// SECURITY T1 / fitness S-1).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 01_issue-route-same-origin.feature. Driven via the SAME real-bare-remote +
// serveMeshUi harness as task 00 (mesh-ui-issue-route.test.mjs) — Node's fetch
// lets the test set arbitrary headers (Origin, content-type) unlike a real
// browser, driving every row of the guard matrix. Every refused row asserts NO
// directive is written at the fs level (the load-bearing ordering: the guard
// runs BEFORE invoke("mesh:issue")).
//
//   01_issue-route-same-origin.feature —
//     - a same-origin application/json POST is accepted and issues the directive;
//     - the refusal matrix: same-origin+json accept / cross-origin refuse /
//       no-origin+form refuse / same-origin+non-json refuse;
//     - the load-bearing ordering: a refused cross-origin POST never reaches the
//       mutation, disk byte-unchanged;
//     - a bare HTML-form simple-request POST is refused by the content-type half;
//     - the guard is scoped to the write route — the read route is unguarded.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

function git(cwd, args) {
  const result = spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
  return { status: typeof result.status === "number" ? result.status : 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function configIdentity(repo) {
  git(repo, ["config", "user.email", "fixture@aof.local"]);
  git(repo, ["config", "user.name", "aof fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "core.eol", "lf"]);
  git(repo, ["config", "pull.rebase", "false"]);
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function writeWorkItem(root) {
  const workDir = path.join(root, "wiki", "work");
  const mDir = path.join(workDir, "27_milestone_issuance");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "27", slug: "issuance", status: "in-progress", created: "2026-01-01", updated: "2026-01-02" })
  );
  const storyDir = path.join(mDir, "stories", "00_story_issue");
  await mkdir(storyDir, { recursive: true });
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter({ type: "story", number: "00", slug: "issue", status: "not-started", created: "2026-01-01", updated: "2026-01-02", parent: "27" })
  );
}

async function buildFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-issue-same-origin-"));
  const bare = path.join(tmp, "remote.git");
  await mkdir(bare, { recursive: true });
  let r = git(bare, ["init", "--bare", "-q", "-b", "main"]);
  if (r.error || r.status !== 0) {
    git(bare, ["init", "--bare", "-q"]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }

  const root = path.join(tmp, "node-a");
  r = git(tmp, ["clone", "-q", bare, "node-a"]);
  if (r.status !== 0) throw new Error(`clone failed: ${r.stderr}`);
  configIdentity(root);
  git(root, ["checkout", "-q", "-b", "main"]);
  await writeWorkItem(root);
  await writeFile(path.join(root, ".gitattributes"), "* -text\n", "utf8");

  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId: "node-a" } }, null, 2)}\n`,
    "utf8"
  );

  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "baseline: the shared work item"]);
  git(root, ["push", "-q", "-u", "origin", "main"]);

  return { tmp, root };
}

async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/assets/index-abc123.js\"></script></head><body><div id=\"root\"></div></body></html>\n",
    "utf8"
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
}

async function snapshotDir(dir) {
  const snap = new Map();
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) snap.set(full, await readFile(full, "utf8"));
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

async function withFleetServer(fn) {
  const fx = await buildFixture();
  const distRoot = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-issue-same-origin-dist-"));
  await writeDist(meshUiDist(distRoot));
  let server;
  try {
    let url;
    ({ server, url } = await serveMeshUi({ projectDir: fx.root, port: 0, repoRoot: distRoot }));
    await fn({ server, url, root: fx.root });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(fx.tmp, { recursive: true, force: true });
    await rm(distRoot, { recursive: true, force: true });
  }
}

async function postIssue(url, { origin, contentType, body } = {}) {
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (contentType !== undefined) headers["content-type"] = contentType;
  return fetch(new URL("/api/mesh/issue", url), {
    method: "POST",
    headers,
    body: body ?? JSON.stringify({ ref: "27/00", to: "any" }),
  });
}

export const meshIssueRouteSameOriginTests = [
  // ══ Scenario: a same-origin application/json POST is accepted and issues the directive ══
  {
    name: "mesh-issue-same-origin/01 a same-origin application/json POST is accepted and issues the directive",
    async run() {
      await withFleetServer(async ({ url, root }) => {
        const res = await postIssue(url, { origin: new URL(url).origin, contentType: "application/json" });
        assert.equal(res.status, 200, "the same-origin json request passes the guard and reaches the mutation");
        const body = await res.json();
        assert.equal(body.itemRef, "27/00");
        const dirPath = path.join(root, ".aof", "mesh", "issuance", "node-a", "27-00.json");
        const onDisk = JSON.parse(await readFile(dirPath, "utf8"));
        assert.deepEqual(onDisk, body, "exactly one directive was written under this node's own issuance partition");
      });
    },
  },

  // ══ Scenario: a same-origin POST whose Origin spells the loopback as "localhost" (not "127.0.0.1") is ALSO accepted ══
  {
    name: "mesh-issue-same-origin/01 a same-origin POST with Origin http://localhost:<port> (the other legitimate loopback spelling, SECURITY S-1) is accepted and issues the directive",
    async run() {
      await withFleetServer(async ({ url, root }) => {
        const port = new URL(url).port;
        const res = await postIssue(url, { origin: `http://localhost:${port}`, contentType: "application/json" });
        assert.equal(res.status, 200, "the localhost-origin same-origin request passes the guard and reaches the mutation");
        const body = await res.json();
        assert.equal(body.itemRef, "27/00");
        const dirPath = path.join(root, ".aof", "mesh", "issuance", "node-a", "27-00.json");
        const onDisk = JSON.parse(await readFile(dirPath, "utf8"));
        assert.deepEqual(onDisk, body, "exactly one directive was written under this node's own issuance partition");
      });
    },
  },

  // ══ Scenario Outline: the same-origin + content-type guard accepts only same-origin JSON; every other shape is refused ══
  {
    name: "mesh-issue-same-origin/01 the guard accepts only same-origin+json; cross-origin / no-origin+form / same-origin+non-json are all refused with no directive written",
    async run() {
      const rows = [
        { label: "same-origin + json", origin: "SAME", contentType: "application/json", verdict: "ACCEPTED" },
        { label: "cross-origin + json", origin: "http://evil.test", contentType: "application/json", verdict: "REFUSED" },
        { label: "no-origin + form", origin: undefined, contentType: "application/x-www-form-urlencoded", verdict: "REFUSED" },
        { label: "same-origin + non-json", origin: "SAME", contentType: "text/plain", verdict: "REFUSED" },
      ];
      for (const row of rows) {
        await withFleetServer(async ({ url, root }) => {
          const before = await snapshotDir(root);
          const origin = row.origin === "SAME" ? new URL(url).origin : row.origin;
          const res = await postIssue(url, { origin, contentType: row.contentType });
          if (row.verdict === "ACCEPTED") {
            assert.equal(res.status, 200, `${row.label} is ACCEPTED (200)`);
          } else {
            assert.ok(res.status >= 400 && res.status < 500, `${row.label} is REFUSED (4xx), got ${res.status}`);
            const body = await res.json();
            assert.equal(body.ok, false, `${row.label} refusal is a coded envelope`);
          }
          const after = await snapshotDir(root);
          if (row.verdict === "ACCEPTED") {
            assert.notDeepEqual(diffSnapshots(before, after), [], `${row.label} DID write a directive`);
          } else {
            assert.deepEqual(diffSnapshots(before, after), [], `${row.label} wrote NO directive`);
          }
        });
      }
    },
  },

  // ══ Scenario: a refused cross-origin POST never reaches the mutation — the directive write is short-circuited ══
  {
    name: "mesh-issue-same-origin/01 a refused cross-origin POST never reaches the mutation — disk byte-unchanged",
    async run() {
      await withFleetServer(async ({ url, root }) => {
        const before = await snapshotDir(root);
        const res = await postIssue(url, { origin: "http://evil.test", contentType: "application/json" });
        assert.equal(res.status, 403, "a clean 403 refuses the cross-origin request");
        const after = await snapshotDir(root);
        assert.deepEqual(diffSnapshots(before, after), [], "the workspace's on-disk state is byte-unchanged — no directive, no partial write");
      });
    },
  },

  // ══ Scenario: a bare HTML-form simple-request POST is refused by the content-type requirement ══
  {
    name: "mesh-issue-same-origin/01 a bare HTML-form simple-request POST is refused by the content-type requirement, no crash",
    async run() {
      await withFleetServer(async ({ url, root }) => {
        const before = await snapshotDir(root);
        const res = await postIssue(url, {
          contentType: "application/x-www-form-urlencoded",
          body: "ref=27%2F00&to=any",
        });
        assert.ok(res.status >= 400 && res.status < 500, "the form POST is refused (4xx), not a crash");
        const body = await res.json();
        assert.equal(body.ok, false, "the refusal is a coded envelope");
        const after = await snapshotDir(root);
        assert.deepEqual(diffSnapshots(before, after), [], "no directive was written");
      });
    },
  },

  // ══ Scenario: the same-origin guard is scoped to the write route — the read route is unguarded and unchanged ══
  {
    name: "mesh-issue-same-origin/01 the same-origin guard is scoped to the write route — a cross-origin GET /api/mesh/status still answers 200",
    async run() {
      await withFleetServer(async ({ url }) => {
        const res = await fetch(new URL("/api/mesh/status", url), {
          method: "GET",
          headers: { origin: "http://evil.test" },
        });
        assert.equal(res.status, 200, "the read route is exempt from the same-origin guard (a safe method, no side effect)");
        const body = await res.json();
        assert.ok(Array.isArray(body.nodes), "the read still answers the aggregate");
      });
    },
  },
];
