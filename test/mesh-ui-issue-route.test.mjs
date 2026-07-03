// Traceability wiring for milestone 27 / story 02 — the FIRST write route on the
// fleet face (tasks/00_fleet-ui-issue-route.feature, ADR-006.1).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 00_fleet-ui-issue-route.feature. Driven via the REAL serveMeshUi harness (the
// m25 story-02 idiom, port 0) stood up against a REAL LOCAL bare git remote + one
// clone (the m26/m27 buildFixture/clonePeer idiom, mesh-cross-node-issuance-kr3.
// test.mjs) so mesh:issue's own default-root sync (ADR-002.4) succeeds honestly
// with NO network — the mutation-without-a-remote lever the task's RESOLVED note
// confirms. Every request carries a matching Origin + application/json (task 01
// owns the guard matrix); this file isolates the route MECHANICS.
//
//   00_fleet-ui-issue-route.feature —
//     - a same-origin JSON POST reaches mesh:issue and returns the directive (200);
//     - the body's `to` rides through to the target union (any/node/capability);
//     - a malformed/missing body is a coded envelope, no directive written;
//     - GET /api/mesh/status still answers and mutates nothing;
//     - a non-issue write method/route is still refused;
//     - a ref-not-found from mesh:issue surfaces faithfully, tree byte-unchanged;
//     - a coded error does not crash the face — the next request still answers.
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

// Build a REAL bare remote + one working clone (mesh-cross-node-issuance-kr3's
// buildFixture pattern) — the clone is the fleet server's projectDir, so
// mesh:issue's default-root sync succeeds honestly with no network.
async function buildFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-issue-route-"));
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

async function seedNodeRecord(root, nodeId, { runtimes = [], skills = [] } = {}) {
  const dir = path.join(root, ".aof", "mesh", "nodes");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${nodeId}.json`),
    JSON.stringify({ nodeId, host: "h", os: "linux", runtimes, skills, aofVersion: "0.1.0", publishedAt: "2026-07-03T00:00:00.000Z" }, null, 2),
    "utf8"
  );
}

async function withFleetServer(fn) {
  const fx = await buildFixture();
  const distRoot = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-issue-route-dist-"));
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

function sameOriginHeaders(url, extra = {}) {
  return { origin: new URL(url).origin, "content-type": "application/json", ...extra };
}

async function postIssue(url, body, headers) {
  return fetch(new URL("/api/mesh/issue", url), {
    method: "POST",
    headers: headers ?? sameOriginHeaders(url),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export const meshUiIssueRouteTests = [
  // ══ Scenario: a same-origin POST /api/mesh/issue with a JSON body issues a directive and returns it ══
  {
    name: "mesh-ui-issue-route/00 a same-origin POST /api/mesh/issue with a JSON body issues a directive and returns it (reaches the mutation through invoke, never a direct mesh-issuance import)",
    async run() {
      await withFleetServer(async ({ url, root }) => {
        const res = await postIssue(url, { ref: "27/00", to: "any" });
        assert.equal(res.status, 200, "the response is 200");
        const body = await res.json();
        assert.equal(body.itemRef, "27/00", "the directive carries the issued item ref");
        assert.equal(body.issuer, "node-a", "the directive carries this node as issuer");
        assert.equal(body.state, "issued", "the directive state is issued");

        const dirPath = path.join(root, ".aof", "mesh", "issuance", "node-a", "27-00.json");
        const onDisk = JSON.parse(await readFile(dirPath, "utf8"));
        assert.deepEqual(onDisk, body, "exactly one directive was written under this node's own issuance partition");
      });
    },
  },

  // ══ Scenario Outline: the body's `to` rides through to mesh:issue's target union ══
  {
    name: "mesh-ui-issue-route/00 the body's to rides through to mesh:issue's target union (any / absent / node / capability)",
    async run() {
      const rows = [
        { to: "any", kind: "any" },
        { to: undefined, kind: "any" },
        { to: "mac-studio", kind: "node" },
        { to: "codex", kind: "capability" },
      ];
      for (const row of rows) {
        await withFleetServer(async ({ url, root }) => {
          if (row.kind === "node") await seedNodeRecord(root, "mac-studio");
          const bodyIn = row.to === undefined ? { ref: "27/00" } : { ref: "27/00", to: row.to };
          const res = await postIssue(url, bodyIn);
          assert.equal(res.status, 200, `to="${row.to}" is accepted`);
          const body = await res.json();
          assert.equal(body.target.kind, row.kind, `to="${row.to}" resolves to target kind ${row.kind}`);
        });
      }
    },
  },

  // ══ Scenario Outline: a malformed or missing body is a coded error and writes no directive ══
  {
    name: "mesh-ui-issue-route/00 a malformed or missing body is a coded { ok:false, error, code } envelope and writes no directive (byte-unchanged on-disk)",
    async run() {
      const rows = [
        { body: "", status: 400 },
        { body: "not-json-at-all", status: 400 },
        { body: JSON.stringify({ to: "any" }), status: [400, 404] },
        { body: JSON.stringify({ ref: "" }), status: [400, 404] },
        { body: JSON.stringify({ ref: 42 }), status: [400, 404] },
      ];
      for (const row of rows) {
        await withFleetServer(async ({ url, root }) => {
          const before = await snapshotDir(root);
          const res = await postIssue(url, row.body, sameOriginHeaders(url));
          const expectedStatuses = Array.isArray(row.status) ? row.status : [row.status];
          assert.ok(expectedStatuses.includes(res.status), `body ${JSON.stringify(row.body)} -> status ${res.status} is one of ${expectedStatuses}`);
          const payload = await res.json();
          assert.equal(payload.ok, false, "the envelope is ok:false");
          assert.ok(typeof payload.code === "string" && payload.code.length > 0, "the envelope carries a code");
          const after = await snapshotDir(root);
          assert.deepEqual(diffSnapshots(before, after), [], `no directive was written for body ${JSON.stringify(row.body)}`);
        });
      }
    },
  },

  // ══ Scenario: GET /api/mesh/status still answers the aggregate and still mutates nothing ══
  {
    name: "mesh-ui-issue-route/00 GET /api/mesh/status still answers the aggregate and still mutates nothing",
    async run() {
      await withFleetServer(async ({ url, root }) => {
        const before = await snapshotDir(root);
        const res = await fetch(new URL("/api/mesh/status", url));
        assert.equal(res.status, 200, "the aggregate read answers 200");
        const body = await res.json();
        assert.ok(Array.isArray(body.nodes), "the aggregate carries nodes");
        const after = await snapshotDir(root);
        assert.deepEqual(diffSnapshots(before, after), [], "the read route mutates nothing");
      });
    },
  },

  // ══ Scenario Outline: a non-issue write method/route is still refused ══
  {
    name: "mesh-ui-issue-route/00 a non-issue write method/route is still refused with no state change",
    async run() {
      // review fix (QA F3): pin the exact status + code + (for the 405 rows)
      // the exact per-route Allow header, replacing the status===405||404
      // OR-assertion. Behaviour unchanged; the assertion is tightened.
      const rows = [
        { method: "POST", route: "/api/mesh/status", status: 405, code: "method-not-allowed", allow: "GET, HEAD" },
        { method: "PUT", route: "/api/mesh/issue", status: 405, code: "method-not-allowed", allow: "POST" },
        { method: "DELETE", route: "/api/mesh/issue", status: 405, code: "method-not-allowed", allow: "POST" },
        { method: "POST", route: "/api/mesh/assign", status: 404, code: "not-found", allow: null },
        { method: "POST", route: "/api/mesh/revoke", status: 404, code: "not-found", allow: null },
      ];
      await withFleetServer(async ({ url, root }) => {
        const before = await snapshotDir(root);
        for (const { method, route, status, code, allow } of rows) {
          const res = await fetch(new URL(route, url), { method, headers: sameOriginHeaders(url) });
          assert.equal(res.status, status, `${method} ${route} is refused with the exact expected status`);
          const body = await res.json();
          assert.equal(body.code, code, `${method} ${route} refuses with the exact expected code`);
          if (allow !== null) {
            assert.equal(res.headers.get("allow"), allow, `${method} ${route} carries the exact per-route Allow header`);
          }
        }
        const after = await snapshotDir(root);
        assert.deepEqual(diffSnapshots(before, after), [], "no refused write changed any file");
      });
    },
  },

  // ══ Scenario: a ref-not-found from mesh:issue surfaces as a coded error and issues nothing ══
  {
    name: "mesh-ui-issue-route/00 a ref-not-found from mesh:issue surfaces as a 404-class coded error and issues nothing",
    async run() {
      await withFleetServer(async ({ url, root }) => {
        const before = await snapshotDir(root);
        const res = await postIssue(url, { ref: "99/00-typo", to: "any" });
        assert.equal(res.status, 404, "a typo'd ref surfaces as 404");
        const body = await res.json();
        assert.equal(body.ok, false, "ok:false");
        assert.equal(body.code, "ref-not-found", "the code is ref-not-found, mesh:issue's own error surfaced faithfully");
        const after = await snapshotDir(root);
        assert.deepEqual(diffSnapshots(before, after), [], "no directive was written for any item");
      });
    },
  },

  // ══ Scenario: a coded error does not crash the face — the next request still answers ══
  {
    name: "mesh-ui-issue-route/00 a coded error does not crash the face — the next request still answers 200",
    async run() {
      await withFleetServer(async ({ url }) => {
        const errored = await postIssue(url, { ref: "99/00-typo", to: "any" });
        assert.equal(errored.status, 404, "the previous POST returned a coded error");
        const survive = await fetch(new URL("/api/mesh/status", url));
        assert.equal(survive.status, 200, "the coded error did not crash the server");
      });
    },
  },
];
