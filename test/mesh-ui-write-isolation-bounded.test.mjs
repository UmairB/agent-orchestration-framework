// Traceability wiring for milestone 27 / story 02 — the BEHAVIOURAL half of
// fitness #7, the bounded-write posture over the wire
// (tasks/03_write-isolation-bounded.feature, ADR-006.2).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 03_write-isolation-bounded.feature. Driven via the SAME real-bare-remote +
// serveMeshUi harness as tasks 00/01 for the ONE accepted write row; the refusal
// rows need no mutation to succeed (they refuse BEFORE any write), so they run
// against a plain fixture with no remote at all.
//
//   03_write-isolation-bounded.feature —
//     - POST /api/mesh/issue is the ONE accepted mutation route;
//     - every other write method/route is refused, no state change, server survives;
//     - the fleet face serves no /api/work write route (disjoint namespace holds);
//     - no /ws/terminal — every upgrade is refused;
//     - the single 127.0.0.1 server is unchanged (no second server/port);
//     - serving the read view (no issue POST) changes no files.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
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

// A real bare remote + one clone (for the ONE accepted write-row scenario, whose
// mesh:issue push must succeed honestly with no network).
async function buildRemoteFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-bounded-write-"));
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

// A plain (no-remote) fixture — sufficient for every refusal row: they refuse
// BEFORE any write is attempted, so they need no mutation to succeed.
async function makePlainRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-bounded-plain-"));
  const workDir = path.join(repo, "wiki", "work");
  const meshDir = path.join(repo, ".aof", "mesh");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(path.join(meshDir, "nodes"), { recursive: true });
  await mkdir(path.join(meshDir, "presence"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(meshDir, "nodes", "n1.json"),
    JSON.stringify({ nodeId: "n1", host: "n1", os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" }, null, 2),
    "utf8"
  );
  return { repo, workDir };
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

async function withPlainFleetServer(fn) {
  const { repo, workDir } = await makePlainRepo();
  const distRoot = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-bounded-plain-dist-"));
  await writeDist(meshUiDist(distRoot));
  let server;
  try {
    let url;
    ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: distRoot }));
    await fn({ server, url, workDir, repo });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(repo, { recursive: true, force: true });
    await rm(distRoot, { recursive: true, force: true });
  }
}

async function withRemoteFleetServer(fn) {
  const fx = await buildRemoteFixture();
  const distRoot = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-bounded-remote-dist-"));
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

export const meshUiWriteIsolationBoundedTests = [
  // ══ Scenario: POST /api/mesh/issue is the one accepted mutation route on the fleet face ══
  {
    name: "mesh-ui-bounded-write/03 POST /api/mesh/issue is the one accepted mutation route on the fleet face",
    async run() {
      await withRemoteFleetServer(async ({ url, root }) => {
        const res = await fetch(new URL("/api/mesh/issue", url), {
          method: "POST",
          headers: sameOriginHeaders(url),
          body: JSON.stringify({ ref: "27/00", to: "any" }),
        });
        assert.equal(res.status, 200, "the write route accepts and reaches the mutation");
        const body = await res.json();
        assert.equal(body.state, "issued");
        const dirPath = path.join(root, ".aof", "mesh", "issuance", "node-a", "27-00.json");
        const onDisk = JSON.parse(await readFile(dirPath, "utf8"));
        assert.equal(onDisk.itemRef, "27/00", "a directive was issued");
      });
    },
  },

  // ══ Scenario Outline: a write method/route that is not POST /api/mesh/issue is refused with no state change ══
  {
    name: "mesh-ui-bounded-write/03 every write method/route that is not POST /api/mesh/issue is refused with no state change, and the server survives",
    async run() {
      // review fix (QA F3): pin the EXACT status + code per row (405
      // method-not-allowed on the existing /api/mesh/status and /api/mesh/issue
      // routes vs 404 not-found on the never-existing assign/route/revoke/
      // /api/work/* routes) instead of the status===405||status===404
      // OR-assertion, AND assert the exact per-route Allow header the 405 rows
      // carry — "GET, HEAD" on /api/mesh/status, "POST" on /api/mesh/issue.
      // Behaviour is unchanged; only the assertion is tightened.
      const rows = [
        { method: "POST", route: "/api/mesh/status", status: 405, code: "method-not-allowed", allow: "GET, HEAD" },
        { method: "PUT", route: "/api/mesh/status", status: 405, code: "method-not-allowed", allow: "GET, HEAD" },
        { method: "PATCH", route: "/api/mesh/status", status: 405, code: "method-not-allowed", allow: "GET, HEAD" },
        { method: "DELETE", route: "/api/mesh/status", status: 405, code: "method-not-allowed", allow: "GET, HEAD" },
        { method: "PUT", route: "/api/mesh/issue", status: 405, code: "method-not-allowed", allow: "POST" },
        { method: "PATCH", route: "/api/mesh/issue", status: 405, code: "method-not-allowed", allow: "POST" },
        { method: "DELETE", route: "/api/mesh/issue", status: 405, code: "method-not-allowed", allow: "POST" },
        { method: "POST", route: "/api/mesh/assign", status: 404, code: "not-found", allow: null },
        { method: "POST", route: "/api/mesh/route", status: 404, code: "not-found", allow: null },
        { method: "POST", route: "/api/mesh/revoke", status: 404, code: "not-found", allow: null },
        { method: "POST", route: "/api/work/feedback", status: 404, code: "not-found", allow: null },
      ];
      await withPlainFleetServer(async ({ url, repo }) => {
        const before = await snapshotDir(repo);
        for (const { method, route, status, code, allow } of rows) {
          const res = await fetch(new URL(route, url), { method, headers: sameOriginHeaders(url) });
          assert.equal(res.status, status, `${method} ${route} is refused with the exact expected status`);
          const body = await res.json();
          assert.equal(body.code, code, `${method} ${route} refuses with the exact expected code`);
          if (allow !== null) {
            assert.equal(res.headers.get("allow"), allow, `${method} ${route} carries the exact per-route Allow header`);
          }
          const followUp = await fetch(new URL("/api/mesh/status", url));
          assert.equal(followUp.status, 200, `after ${method} ${route}, /api/mesh/status still answers (no crash)`);
        }
        const after = await snapshotDir(repo);
        assert.deepEqual(diffSnapshots(before, after), [], "no refused write changed any file");
      });
    },
  },

  // ══ Scenario: the fleet face serves no /api/work write route (the disjoint namespace holds) ══
  {
    name: "mesh-ui-bounded-write/03 the fleet face serves no /api/work write route — a POST /api/work/feedback is a clean 404, no board data proxied",
    async run() {
      await withPlainFleetServer(async ({ url }) => {
        const res = await fetch(new URL("/api/work/feedback", url), {
          method: "POST",
          headers: sameOriginHeaders(url),
          body: JSON.stringify({ ref: "x", note: "y" }),
        });
        assert.equal(res.status, 404, "no board write is proxied through the fleet face");
      });
    },
  },

  // ══ Scenario Outline: the fleet face serves no terminal websocket — every upgrade is refused ══
  {
    name: "mesh-ui-bounded-write/03 the fleet face serves no terminal websocket — every upgrade attempt is refused, no session opens",
    async run() {
      const paths = ["/ws/terminal", "/", "/api/mesh"];
      await withPlainFleetServer(async ({ url }) => {
        for (const p of paths) {
          const wsUrl = new URL(p, url).toString().replace(/^http/, "ws");
          const attempt = await new Promise((resolve) => {
            const ws = new WebSocket(wsUrl);
            let opened = false;
            ws.on("open", () => {
              opened = true;
              resolve({ opened, ws });
            });
            ws.on("error", () => resolve({ opened, ws: null }));
            ws.on("close", () => resolve({ opened, ws: null }));
            setTimeout(() => resolve({ opened, ws: opened ? ws : null }), 800);
          });
          assert.equal(attempt.opened, false, `no WebSocket opens against ${p} (the upgrade is refused)`);
          if (attempt.ws) {
            try {
              attempt.ws.close();
            } catch {
              /* noop */
            }
          }
        }
      });
    },
  },

  // ══ Scenario: the write route is on the same single 127.0.0.1 server — no second server, no second port ══
  {
    name: "mesh-ui-bounded-write/03 the write route is on the same single 127.0.0.1 server — no second server or port",
    async run() {
      await withRemoteFleetServer(async ({ server, url }) => {
        const address = server.address();
        assert.equal(address.address, "127.0.0.1", "the fleet server binds 127.0.0.1");
        const statusRes = await fetch(new URL("/api/mesh/status", url));
        assert.equal(statusRes.status, 200, "GET /api/mesh/status is served off this one server");
        const issueRes = await fetch(new URL("/api/mesh/issue", url), {
          method: "POST",
          headers: sameOriginHeaders(url),
          body: JSON.stringify({ ref: "27/00", to: "any" }),
        });
        assert.equal(issueRes.status, 200, "POST /api/mesh/issue is served off the SAME one server");
      });
    },
  },

  // ══ Scenario: serving and rendering the fleet view (no issue POST) changes no files ══
  {
    name: "mesh-ui-bounded-write/03 serving and rendering the fleet view (no issue POST) changes no files",
    async run() {
      await withPlainFleetServer(async ({ url, repo }) => {
        const before = await snapshotDir(repo);
        await fetch(new URL("/", url));
        for (let i = 0; i < 3; i += 1) {
          const res = await fetch(new URL("/api/mesh/status", url));
          assert.equal(res.status, 200, "the aggregate read answers");
        }
        const after = await snapshotDir(repo);
        assert.deepEqual(diffSnapshots(before, after), [], "rendering writes nothing — only the issue route mutates");
      });
    },
  },
];
