// Traceability wiring for milestone 45 / story 04, task 01 —
// `stories/04_story_advertised-entry-points/tasks/01_in-app-cross-links.feature`
// (@executable). Every Scenario and every Scenario-Outline ROW is covered here.
//
// THE CHANNEL, taken from the feature's LITMUS verbatim: these three links DO have a
// black-box runtime channel and it is already built. `test/support/board-app-harness.mjs`
// and `test/support/fleet-app-harness.mjs` esbuild the REAL, unmodified `Board.tsx` /
// `Fleet.tsx` and mount them headlessly against a REAL running face, over a minimal React
// with a controllable clock and an instrumented `fetch`. `findAll(tree, …)` walks the
// RENDERED tree, so every href below is read out of production render output — never out
// of a source file, never out of a bundle grep, never off a pure helper called directly.
// m38/STATE F-38.06e is why that matters: *"a state satisfied by calling the reducer
// directly proved nothing, because production could never drive it."*
//
// REACHING EACH STATE IS THE REAL WORK, and each is driven through a production door:
//   · the dead-server banner needs `serverGone`, which flips after THREE consecutive
//     SILENT load failures. The lane makes the REAL face refuse `/api/work/list` and then
//     presses the board's OWN `⟳ sync` control three times — the same `load({silent:true})`
//     the poll calls, driven through the affordance an operator can press.
//   · the watch link needs an item with `execution.active === true`, a holding node and NO
//     `execution.sessionId`. That overlay comes from the board face's own `/api/work/list`
//     envelope, so the lane mints a REAL assignment record through the production
//     assembler + state writer (`withBoardFace(...).dispatched`) and lets the real route
//     map it.
//   · the fleet's drill-in splits on `board.local`, which is minted by the REAL
//     `mesh:status` boards projection off a REAL group registry (see the note below).
//
// ── ONE FEASIBILITY DEVIATION, STATED RATHER THAN PAPERED OVER (F-45-04-DEV-1) ──────
// The feature's feasibility note says both branches of `BoardDrillIn` are "reachable from
// the fleet face's `/api/mesh/status` boards aggregate". Measured at HEAD, they are not
// reachable through `serveMeshUi`: since m34/ADR-006 that route answers
// `queryGlobalMeshStatus`, whose payload has NO `boards` key at all
// (`src/global-mesh-query.mjs` returns scope/workspaceId/stalenessSeconds/workspaces/
// items/nodes/diagnostics), so `status?.boards ?? []` is ALWAYS empty on that face and
// `BoardsRegion` always renders its "No boards registered in the group yet" placeholder.
// The `boards` aggregate is real and still produced — by `aof mesh status --json`
// (`src/commands/mesh-identity.mjs`'s `boardsProjection`), which is the producer
// `ui/src/fleet/api.ts` documents the local `MeshStatus` shape against ("deep-equal to
// `aof mesh status --json` for the same fixture").
//
// So the fleet lanes below are PRODUCER-FED rather than face-fed: a REAL group registry
// on disk → the REAL `mesh:status` command → its REAL payload served verbatim from a real
// 127.0.0.1 origin → the REAL `<Fleet/>` fetching it over HTTP. Nothing about the payload
// is hand-painted; the `local` marker in particular is computed by production code from
// the registry's roster and this node's configured `mesh.nodeId`. That is the m38/ADR-008
// producer-fed rule applied where the two real halves have drifted apart. The DRIFT
// itself is pre-existing, is not this story's to repair (a URL migration that also
// reconnected a data path would be two changes in one diff), and is reported as a finding.
//
// NOT ASSERTED HERE:
//   · "no `?mode=` literal survives in ui/src" — a PLACEMENT invariant owned by
//     `test/arch/acd-no-surface-mode-url-literal.test.mjs`. What IS asserted below is its
//     behavioural neighbour, which the arch gate cannot see: no RENDERED anchor names
//     `mode`, in any state these lanes drive. A link composed at RUNTIME from a variable
//     would pass the gate and fail here.
//   · what `/fleet` and `/board` RENDER — 45/03's shell and entry.
//   · a live fetch of `http://127.0.0.1:4181/fleet`. 4181 is the fleet's FIXED port and is
//     held by the operator's live daemon on the control node; a lane that bound it would
//     be flaky by construction. The last lane cross-checks the link against the fleet's
//     OWN advertisement instead (`aof mesh ui --json`) — the property that actually
//     matters, and it needs no fixed port.
//
// OBSERVED, DEFERRED, DELIBERATELY NOT CHANGED (QA F-45-04-1): `Fleet.tsx`'s local-board
// drill-in href is RELATIVE, so on the fleet origin it resolves to :4181, which 404s
// `/api/work` — the board surface loads but cannot load its stream. That is TODAY's
// behaviour for `?mode=board`, and this story reproduces it EXACTLY, one character
// narrower. The lane pins the relative form on purpose; milestone 47 owns the fix.
//
// Run focused and isolated (hook-enforced):
//   AOF_GLOBAL_HOME=$(mktemp -d) node --test test/in-app-cross-links.test.mjs
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, nodeRecordPath, presenceRecordPath } from "../src/mesh-store.mjs";
import { registryPath, registryDir, emptyRegistry, admitNode, registerBoard } from "../src/mesh-registry.mjs";
import { withBoardFace } from "./support/board-face-fixture.mjs";
import { withBoardApp } from "./support/board-app-harness.mjs";
import { withFleetApp } from "./support/fleet-app-harness.mjs";
import { findAll, textOf, visibleTextOf } from "./support/mini-react.mjs";
import { spawnCliAsync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// The Background's work stream: one milestone "34" with story "34/01".
const STREAM = {
  milestone: { number: "34", slug: "global-mesh", title: "Global Mesh", status: "in-progress" },
  stories: [{ number: "01", slug: "the-story", title: "The story", status: "in-progress" }],
};

const NOW = "2026-07-01T12:00:00.000Z";
const LOCAL_NODE = "aof-control";
const PEER_NODE = "umairs-mac-mini";

// --- reading the RENDERED tree ------------------------------------------------

// Every anchor in a rendered tree, as { href, node }. The sweep lane counts these, so it
// is deliberately BROAD: any `<a>`, wherever it renders, whatever built it.
function anchorsIn(tree) {
  return findAll(tree, (node) => node.type === "a").map((node) => ({ node, href: node.props?.href }));
}

// The one anchor whose visible text contains `text` — addressed the way the reader
// addresses it, never by index.
function anchorByText(tree, text) {
  return anchorsIn(tree).find((anchor) => visibleTextOf(anchor.node).includes(text)) ?? null;
}

// The board's dead-server banner: the `role="alert"` strip the surface contributes into
// the notice rail. Found by its ROLE in the a11y tree, not by its copy.
function banner(tree) {
  return findAll(tree, (node) => node.props?.role === "alert")[0] ?? null;
}

// The board's own `⟳ sync` control — the production door a silent refresh comes through.
function syncControl(tree) {
  return findAll(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "Sync work stream")[0] ?? null;
}

// The shared advertised-URL Thens, read through `new URL` and never as a substring: a
// query glued onto a path parses as a PATHNAME that contains the parameters as text, and
// every `includes` check in the world accepts it (task 00's trap 1).
function assertLinkPath(href, { path: expectedPath, scope = "absent", label }) {
  const url = new URL(href);
  assert.equal(url.pathname, expectedPath, `${label}: the href's pathname is exactly ${expectedPath} (got ${href})`);
  assert.equal(url.searchParams.get("mode"), null, `${label}: …and it names no \`mode\` parameter (got ${href})`);
  assert.equal(
    url.searchParams.get("scope"),
    scope === "absent" ? null : scope,
    `${label}: …its \`scope\` parameter, read via searchParams.get, is ${scope} (got ${href})`,
  );
  assert.ok(!url.pathname.includes("&"), `${label}: the pathname contains no "&" (got ${href})`);
  assert.ok(!url.pathname.includes("?"), `${label}: the pathname contains no "?" (got ${href})`);
  return url;
}

// "not one of them names a `mode` parameter, in its query or ANYWHERE else" — so the test
// is on the raw href string, not only on its parsed search. A relative href gets a
// throwaway base so it parses at all; the base is never asserted against.
function namesMode(href) {
  if (typeof href !== "string") return false;
  if (/[?&]mode=/.test(href)) return true;
  const url = new URL(href, "http://127.0.0.1:1/");
  return url.searchParams.has("mode") || url.pathname.includes("mode=");
}

// --- the fleet substrate (see the DEVIATION note in the header) ----------------

async function makeMeshRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-cross-links-fleet-"));
  await mkdir(path.join(repo, "wiki", "work"), { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId: LOCAL_NODE } }, null, 2)}\n`,
    "utf8",
  );
  return repo;
}

async function seedNode(workspace, id) {
  await mkdir(path.join(meshDir(workspace), "nodes"), { recursive: true });
  await writeFile(
    nodeRecordPath(workspace, id),
    JSON.stringify({ nodeId: id, host: id, os: "linux", runtimes: ["claude"], skills: [], aofVersion: "0.1.0", publishedAt: NOW }, null, 2),
    "utf8",
  );
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(
    presenceRecordPath(workspace, id),
    JSON.stringify({ nodeId: id, heartbeatAt: NOW, activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8",
  );
}

// withFleetBoards({ local, peer }, fn) — the REAL `mesh:status` payload for a registry
// holding the named boards, served verbatim from a real 127.0.0.1 origin, with the REAL
// <Fleet/> mounted against it. `local` is the board this node owns (the projection marks
// it `local: true`); `peer` is a board owned by another node (no marker at all).
async function withFleetBoards({ local = null, peer = null, search = "?scope=global" }, fn) {
  const repo = await makeMeshRepo();
  const previousHome = process.env.AOF_GLOBAL_HOME;
  const home = path.join(repo, "global-home");
  process.env.AOF_GLOBAL_HOME = home;
  let server;
  try {
    const workspace = await loadWorkspace(repo);
    let registry = emptyRegistry();
    if (local) {
      await seedNode(workspace, LOCAL_NODE);
      registry = admitNode(registry, { nodeId: LOCAL_NODE, admittedAt: NOW, boards: [local] });
      registry = registerBoard(registry, local);
    }
    if (peer) {
      await seedNode(workspace, PEER_NODE);
      registry = admitNode(registry, { nodeId: PEER_NODE, admittedAt: NOW, boards: [peer] });
      registry = registerBoard(registry, peer);
    }
    await mkdir(registryDir(workspace), { recursive: true });
    await writeFile(registryPath(workspace), JSON.stringify(registry, null, 2), "utf8");

    // THE PRODUCER. Nothing below paints a payload — this is `aof mesh status --json`'s
    // own result, `local` marker and all.
    const payload = await invoke("mesh:status", { now: NOW }, { workspace });
    assert.ok(Array.isArray(payload.boards), "the REAL mesh:status producer answers a boards aggregate");
    if (local) {
      assert.equal(
        payload.boards.find((board) => board.ref === local)?.local,
        true,
        "…marking the board this node owns `local: true` (computed by production, never painted here)",
      );
    }
    if (peer) {
      assert.equal(
        Object.hasOwn(payload.boards.find((board) => board.ref === peer) ?? {}, "local"),
        false,
        "…and omitting the marker entirely for a peer board (the absent-not-false idiom)",
      );
    }

    server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/api/mesh/status") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Not found", code: "not-found" }));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    return await withFleetApp({ url, search }, (app) => fn(app, { repo }));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousHome === undefined) delete process.env.AOF_GLOBAL_HOME;
    else process.env.AOF_GLOBAL_HOME = previousHome;
    await rm(repo, { recursive: true, force: true });
  }
}

// `aof <verb> --json` through the REAL CLI — task 00's channel, reused here so the two
// sides of the cross-check lane are the two REAL faces and not one fact read twice.
async function probe(cwd, args) {
  const result = await spawnCliAsync(process.execPath, [cliPath, ...args, "--json"], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  assert.equal(result.status, 0, `\`aof ${args.join(" ")} --json\` exits 0 (stderr: ${result.stderr})`);
  return JSON.parse(result.stdout);
}

// Drive the board into `serverGone`: make the REAL face refuse the list, then press the
// board's OWN `⟳ sync` control three times (three consecutive SILENT load failures).
async function driveServerGone(face, app) {
  face.failListWith(503, "Board face refused the list");
  for (let press = 0; press < 3; press += 1) {
    const sync = syncControl(app.tree());
    assert.ok(sync, "the board renders its own `⟳ sync` control — the production door a silent refresh comes through");
    await sync.props.onClick({ stopPropagation() {}, preventDefault() {} });
    await app.flush();
  }
}

export const inAppCrossLinksTests = [
  // ══════════════════════════════════════════════════════════════════════════
  // Scenario: the board's dead-server banner links the fleet at a path, on the fleet's
  // own fixed origin.
  //
  // The banner exists because a board server dies with every daemon restart and its port
  // is ephemeral; the fleet's port is FIXED, which is the whole reason this link is
  // absolute and hard-coded. The migration must keep that.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "in-app-cross-links/01 the board's dead-server banner links the fleet at a PATH, on the fleet's own fixed origin (01 scenario 1)",
    async run() {
      await withBoardFace(async (face) => {
        await withBoardApp({ url: face.url, search: "" }, async (app) => {
          assert.ok(app.laneCards().length > 0 || app.overviewCards().length > 0, "the board loaded its stream first");
          assert.equal(banner(app.tree()), null, "…and no dead-server banner stands while the face is healthy");

          await driveServerGone(face, app);

          const strip = banner(app.tree());
          assert.ok(strip, "after three consecutive silent refresh failures the dead-server banner renders");

          const link = anchorByText(strip, "the fleet");
          assert.ok(link, "…carrying a \"the fleet\" anchor");
          const href = assertLinkPath(link.href, { path: "/fleet", scope: "absent", label: "the banner's fleet link" });
          assert.equal(href.hostname, "127.0.0.1", "its host is 127.0.0.1");
          assert.equal(href.port, "4181", "…and its port is 4181 — the fleet's FIXED port, unchanged, because a board port is ephemeral and a fleet port is not");
          assert.equal(href.search, "", "it carries no `scope` parameter — this link never had one, and the migration must not invent one");

          // A URL change, not a copy change.
          assert.equal(textOf(link.node).trim(), "the fleet", "the anchor's own words are unchanged");
          assert.match(String(link.node.props?.className ?? ""), /\bunderline\b/, "…and its `underline` affordance is unchanged");
          const strip_text = visibleTextOf(strip).replace(/\s+/g, " ");
          assert.match(strip_text, /This board's server is gone/, "the banner's sentence is unchanged…");
          assert.match(strip_text, /Reopen the board from the fleet/, "…including the clause the link sits inside");
        });
      }, { stream: STREAM });
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario: the detail panel's "watch on the fleet" link is a path that still carries
  // `scope=global`.
  //
  // The one in-app link carrying a query payload, and the shape ADR-003 names as the
  // bookmarked form that must survive intact.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "in-app-cross-links/01 the detail panel's \"watch on the fleet\" link is a PATH that still carries scope=global, and is still absent once a session exists (01 scenario 2)",
    async run() {
      // (a) active, held by another node, NO sessionId — the state the link renders in.
      await withBoardFace(async (face) => {
        await face.dispatched("34/01", { node: PEER_NODE, state: "running", sessionId: null, at: NOW });
        await withBoardApp({ url: face.url, hash: "#34/01", search: "" }, async (app) => {
          const detail = app.detail();
          assert.ok(detail, "the detail panel is open on 34/01");
          assert.match(detail.title ?? "", /The story/, "…on the item the lane deep-linked to");

          const link = anchorByText(detail.panel, "watch on the fleet");
          assert.ok(link, "the \"watch on the fleet\" anchor renders for an ACTIVE item with no session");
          assertLinkPath(link.href, { path: "/fleet", scope: "global", label: "the watch link" });
          assert.equal(new URL(link.href).hostname, "127.0.0.1", "…on the fleet's own fixed origin");
          assert.equal(new URL(link.href).port, "4181", "…at its fixed port");

          assert.equal(link.node.props?.target, "_blank", "its `target` is _blank — unchanged");
          assert.equal(link.node.props?.rel, "noreferrer", "its `rel` is noreferrer — unchanged");
          assert.match(String(link.node.props?.title ?? ""), new RegExp(PEER_NODE), "…and its title still names the holding node");
        });
      }, { stream: STREAM });

      // (b) the SAME item once it reports a sessionId — the pre-existing condition, which
      // the migration must leave untouched.
      await withBoardFace(async (face) => {
        await face.dispatched("34/01", { node: PEER_NODE, state: "running", sessionId: "sess-abc123", at: NOW });
        await withBoardApp({ url: face.url, hash: "#34/01", search: "" }, async (app) => {
          const detail = app.detail();
          assert.ok(detail, "the detail panel is open on 34/01");
          assert.equal(
            anchorByText(detail.panel, "watch on the fleet"),
            null,
            "the link is absent when the same item reports `execution.sessionId` — the pre-existing condition is untouched by the migration",
          );
        });
      }, { stream: STREAM });
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario: the fleet's local-board drill-in is a RELATIVE path, and the peer-board
  // control still has no href at all.
  //
  // The peer branch is here because a rewrite that "made both links paths" would turn a
  // deliberate copy-control into a dead href — exactly what the two-case split prevents.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "in-app-cross-links/01 the fleet's local-board drill-in is a RELATIVE /board, and the peer-board control still carries no href at all (01 scenario 3)",
    async run() {
      await withFleetBoards({ local: "let-shield", peer: "voice-vox-web" }, async (app) => {
        const tree = app.tree();
        const drillIns = findAll(
          tree,
          (node) => (node.type === "a" || node.type === "button") && visibleTextOf(node).includes("Open board"),
        );
        assert.equal(drillIns.length, 2, "both boards render an `Open board →` control");

        const anchor = drillIns.filter((node) => node.type === "a");
        const control = drillIns.filter((node) => node.type === "button");
        assert.equal(anchor.length, 1, "exactly ONE of them is an anchor — the LOCAL board's");
        assert.equal(control.length, 1, "…and exactly one is not");

        assert.equal(
          anchor[0].props?.href,
          "/board",
          "the local board's `Open board →` href is exactly \"/board\" — RELATIVE, with no scheme, no host and no port",
        );
        assert.equal(namesMode(anchor[0].props.href), false, "…it names no `mode` parameter");
        assert.equal(
          new URL(anchor[0].props.href, "http://127.0.0.1:1/").searchParams.get("scope"),
          null,
          "…and no `scope` parameter",
        );

        assert.equal(control[0].props?.href, undefined, "the peer board's control carries NO href at all");
        assert.equal(control[0].type, "button", "…because it is not an anchor — it is a copy control");
        assert.match(
          String(control[0].props?.title ?? ""),
          /aof work ui/,
          "…which still copies the `aof work ui` command…",
        );
        assert.match(String(control[0].props?.title ?? ""), new RegExp(PEER_NODE), "…attributed to its owner node");

        for (const node of drillIns) {
          assert.equal(visibleTextOf(node).trim(), "Open board →", "both still read \"Open board →\" (mock parity is unchanged by the migration)");
        }
      });
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario Outline: across every state these lanes drive, no anchor either surface
  // renders names a `mode` parameter. (6 rows)
  //
  // The behavioural neighbour of the arch gate, and the half the gate cannot see: a
  // `mode` parameter composed at RUNTIME from a variable leaves no literal in source.
  //
  // ── F-45-04-DEV-2, a feature defect FLAGGED rather than fixed ─────────────────────
  // The outline's last Then — "at least one anchor was collected, so the sweep is
  // non-vacuous" — is UNSATISFIABLE for three of its own six rows, measured against the
  // real surfaces at HEAD. `ui/src/board/` renders exactly TWO anchors in total (the
  // banner's and the detail panel's, both conditional) and `ui/src/fleet/` renders
  // exactly ONE (the local-board drill-in). So `the board, healthy` (0), `the board,
  // deep-linked by hash` (0 — the panel opens, but the watch link needs an ACTIVE
  // assignment with no session, which that row does not state) and `the fleet, a peer
  // board` (0 — the peer branch is a `<button>` by design, which is the very split
  // scenario 3 exists to protect) each render no anchor at all.
  //
  // The clause's INTENT is a non-vacuity guard, and it is honoured here at the level
  // where it is both true and load-bearing: the anchor count of EVERY row is pinned as a
  // measured table, so a state that stops rendering an anchor it used to render fails
  // loudly (which is strictly stronger than `> 0`), and the sweep as a whole is asserted
  // to have collected anchors. Every row is still swept for the `mode` and off-machine
  // properties, which is the scenario's actual subject.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "in-app-cross-links/01 across every state these lanes drive, NO anchor either surface renders names a `mode` parameter (01 scenario 4, all six rows)",
    async run() {
      const collected = [];

      const sweep = (label, tree) => {
        const anchors = anchorsIn(tree);
        for (const anchor of anchors) {
          assert.equal(namesMode(anchor.href), false, `${label}: no rendered anchor names a \`mode\` parameter (got ${anchor.href})`);
          if (typeof anchor.href === "string" && /^[a-z]+:\/\//i.test(anchor.href)) {
            assert.equal(new URL(anchor.href).hostname, "127.0.0.1", `${label}: every ABSOLUTE href names host 127.0.0.1 — no link points off-machine (got ${anchor.href})`);
          }
        }
        collected.push({ label, hrefs: anchors.map((anchor) => anchor.href) });
      };

      // ── the board, healthy ────────────────────────────────────────────────
      await withBoardFace(async (face) => {
        await withBoardApp({ url: face.url, search: "" }, async (app) => {
          sweep("the board, healthy", app.tree());

          // ── the board, server gone ──────────────────────────────────────
          await driveServerGone(face, app);
          assert.ok(banner(app.tree()), "the server-gone state really was reached");
          sweep("the board, server gone", app.tree());
        });
      }, { stream: STREAM });

      // ── the board, detail panel open on an item held by another node ──────
      await withBoardFace(async (face) => {
        await face.dispatched("34/01", { node: PEER_NODE, state: "running", sessionId: null, at: NOW });
        await withBoardApp({ url: face.url, hash: "#34/01", search: "" }, async (app) => {
          assert.ok(app.detail(), "the detail panel really is open");
          sweep("the board, detail panel open", app.tree());
        });
      }, { stream: STREAM });

      // ── the board, deep-linked by hash (the drill-in's own landing state) ──
      await withBoardFace(async (face) => {
        await withBoardApp({ url: face.url, hash: "#34/01", search: "" }, async (app) => {
          sweep("the board, deep-linked by hash", app.tree());
        });
      }, { stream: STREAM });

      // ── the fleet, a local board ──────────────────────────────────────────
      await withFleetBoards({ local: "let-shield" }, async (app) => {
        sweep("the fleet, a local board", app.tree());
      });

      // ── the fleet, a peer board and no local board ────────────────────────
      await withFleetBoards({ peer: "voice-vox-web", local: null }, async (app) => {
        // The peer branch renders a BUTTON and this state renders NO anchor at all —
        // a PINNED-ZERO row (see the counts table below): it proves the count, and the
        // mode-sweep clause is knowingly vacuous here. The feature records the same.
        sweep("the fleet, a peer board", app.tree());
      });

      assert.equal(collected.length, 6, "all six states were driven and swept");

      // The non-vacuity guard, at the level where it is true (see F-45-04-DEV-2 above):
      // the sweep as a whole collected anchors…
      const everyHref = collected.flatMap((row) => row.hrefs);
      assert.ok(everyHref.length > 0, "the sweep collected anchors — it is not vacuous as a whole");
      // …and each row's anchor COUNT is pinned, so a state that stops rendering a link it
      // renders today fails here rather than passing an emptier sweep.
      assert.deepEqual(
        collected.map((row) => [row.label, row.hrefs.length]),
        [
          // The board renders exactly two anchors in total, both conditional…
          ["the board, healthy", 0],
          ["the board, server gone", 1],
          ["the board, detail panel open", 1],
          ["the board, deep-linked by hash", 0],
          // …and the fleet exactly one, on the LOCAL branch only.
          ["the fleet, a local board", 1],
          ["the fleet, a peer board", 0],
        ],
        "each state renders exactly the anchors it renders today — a link that appears or disappears is caught here",
      );
      assert.deepEqual(
        [...new Set(everyHref)].sort(),
        ["/board", "http://127.0.0.1:4181/fleet", "http://127.0.0.1:4181/fleet?scope=global"],
        "…and the whole set of hrefs these two surfaces can render is exactly the three this story migrated",
      );
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario Outline: each in-app link names the same path the corresponding server
  // advertises for itself. (3 rows)
  //
  // Two independently edited sites agreeing is what stops the board pointing at `/fleet`
  // while the fleet advertises `/fleet-view`. The third row compares a RELATIVE href with
  // an ABSOLUTE advertised URL, so it compares PATHNAMES only — comparing whole strings
  // would fail for the correct implementation, and that is the trap this note disarms.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "in-app-cross-links/01 each in-app link names the SAME path the corresponding server advertises for itself (01 scenario 5, all three rows)",
    async run() {
      let bannerHref;
      let watchHref;
      let drillInHref;
      let fleetProbe;
      let boardProbe;

      await withBoardFace(async (face) => {
        await face.dispatched("34/01", { node: PEER_NODE, state: "running", sessionId: null, at: NOW });
        await withBoardApp({ url: face.url, hash: "#34/01", search: "" }, async (app) => {
          watchHref = anchorByText(app.detail().panel, "watch on the fleet")?.href;
          await driveServerGone(face, app);
          bannerHref = anchorByText(banner(app.tree()), "the fleet")?.href;
        });
        // The probes run in the SAME workspace the surfaces were mounted against, and
        // INSIDE the fixture's lifetime — `withBoardFace` removes its temp repo on the
        // way out, and a CLI spawned with a cwd that no longer exists never runs at all.
        fleetProbe = await probe(face.root, ["mesh", "ui"]);
        boardProbe = await probe(face.root, ["work", "ui"]);
      }, { stream: STREAM });

      await withFleetBoards({ local: "let-shield" }, async (app) => {
        drillInHref = findAll(app.tree(), (node) => node.type === "a" && visibleTextOf(node).includes("Open board"))[0]?.props?.href;
      });

      assert.ok(bannerHref, "the banner link rendered");
      assert.ok(watchHref, "the watch link rendered");
      assert.ok(drillInHref, "the drill-in rendered");

      const rows = [
        { case: "the banner link vs the fleet", href: bannerHref, advertised: fleetProbe.fleetUrl },
        { case: "the watch link vs the fleet", href: watchHref, advertised: fleetProbe.fleetUrl },
        // A RELATIVE href — compared by pathname, which is the whole claim.
        { case: "the drill-in vs the board", href: drillInHref, advertised: boardProbe.boardUrl },
      ];

      for (const row of rows) {
        const linkPath = new URL(row.href, "http://127.0.0.1:1/").pathname;
        const advertisedPath = new URL(row.advertised).pathname;
        assert.equal(
          linkPath,
          advertisedPath,
          `${row.case}: the pathname of the rendered href and the pathname of the probe's advertised URL are the same string`,
        );
        assert.equal(namesMode(row.href), false, `${row.case}: the rendered href names no \`mode\` parameter`);
        assert.equal(namesMode(row.advertised), false, `${row.case}: …and neither does the advertised URL`);
      }
    },
  },
];
