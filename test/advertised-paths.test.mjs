// Traceability wiring for milestone 45 / story 04, task 00 —
// `stories/04_story_advertised-entry-points/tasks/00_servers-advertise-paths.feature`
// (@executable). Every Scenario and every Scenario-Outline ROW of that feature is
// covered here, one exported entry per Scenario/Outline, the Examples tables carried as
// literal tables so the file reads as the spec it implements.
//
// THE CHANNEL, taken from the feature's LITMUS verbatim: "every Then is confirmable by an
// outsider with a shell and `curl`". So the lanes below read only what these producers
// already publish:
//   `aof work ui --json`   → `boardUrl`   (the non-blocking probe, board-serve.mjs)
//   `aof mesh ui --json`   → `fleetUrl`   (mesh-ui-serve.mjs's meshUiProbe)
//   `aof assets ui --json` → `uiUrl`      (commands/assets-ui.mjs's run)
//   each launcher's own stdout `Open this URL in your browser: <url>` line
//   `GET /api/mesh/board-url?workspaceId=…&ref=…` — a real HTTP read
//   real `GET`s against the real started servers
// The three `--json` rows spawn the REAL CLI (`bin/aof.mjs`), because the probe and the
// launch body are SEPARATE strings that can drift apart, and only the published face can
// tell them apart. No lane here reads a source file or imports a production URL literal.
//
// WHAT IS DELIBERATELY NOT HERE, so the same fact is never claimed twice:
//   · "no `?mode=` literal survives in src/" is a PLACEMENT invariant owned in full by
//     `test/arch/acd-no-surface-mode-url-literal.test.mjs`. A producer that emitted the
//     right path from a hand-rolled second copy would pass every lane below and fail that
//     gate; that division is the design, not a gap.
//   · WHAT each legacy URL translates INTO is 45/01's `legacyRedirectFor`
//     (`test/app-routes.test.mjs`), and a fragment never reaches a server at all — so no
//     lane below claims a redirect. What IS claimed is narrower and is this story's own:
//     every legacy address these producers USED to hand out still gets a 200 and the app
//     shell from the very server that used to hand it out.
//   · the extension-less fallback RULE is 45/02's (`test/static-serve-fallback.test.mjs`).
//     Here it is only CONSUMED — STORY.md names "an advertised URL that 404s" as a worse
//     regression than the one the milestone fixes, so every advertised address is fetched.
//
// TWO TRAPS, both measured at HEAD, both given their own assertions:
//   1. `src/commands/mesh-ui.mjs` composed its announce as `${fleetUrl}&scope=${scope}`,
//      with the `&` hard-coded on the assumption that `fleetUrl` already carried a query.
//      Against a PATH url that same untouched line yields `…/fleet&scope=global` — a
//      pathname of `/fleet&scope=global` with NO `scope` parameter, which
//      `includes("scope=")` happily accepts. Every scope assertion below therefore reads
//      `new URL(...).searchParams.get("scope")`, and every path assertion additionally
//      pins that the pathname contains no "&" and no "?".
//   2. `mode` is ALSO a legitimate ENVELOPE key on all three probes (`{ mode: "board" }`,
//      `{ mode: "fleet" }`, `{ mode: "assets-ui" }`) — a probe discriminator, not a URL
//      selector, and outside the arch gate's `[?&]mode=` pattern. Deleting it to "satisfy
//      the gate" would break every probe consumer. It is asserted PRESENT and unchanged.
//
// Run focused and isolated (hook-enforced):
//   AOF_GLOBAL_HOME=$(mktemp -d) node --test test/advertised-paths.test.mjs
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveBoard, boardUiDist } from "../src/board-serve.mjs";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "../src/global-node-registry.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
import { spawnCliAsync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// --- the Background, on disk -------------------------------------------------

// "an isolated global mesh store (a fresh AOF_GLOBAL_HOME) holding one published
// workspace whose work stream contains milestone 34". Mirrors mesh-ui-serve.test.mjs's
// own fixture — this suite extends that existing substrate rather than inventing one.
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-advertised-paths-"));
  const workDir = path.join(repo, "wiki", "work");
  const globalHome = path.join(repo, "global-home");
  const milestoneDir = path.join(workDir, "34_milestone_global-mesh");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 34\nslug: global-mesh\nstatus: in-progress\ntitle: Global Mesh\n---\n",
    "utf8",
  );
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", runtimes: ["claude"], work: { dir: "./wiki/work" }, mesh: { enabled: true } }, null, 2),
    "utf8",
  );

  const globalStoreOptions = { env: { AOF_GLOBAL_HOME: globalHome } };
  const workspace = await loadWorkspace(repo, undefined, globalStoreOptions);
  await publishNodeRecord(workspace, "mac-studio", {
    nodeId: "mac-studio",
    host: "mac-studio",
    os: "darwin",
    runtimes: ["claude"],
    skills: ["a"],
    aofVersion: "0.1.0",
    publishedAt: "2026-06-29T00:00:00.000Z",
  });
  const store = await openGlobalWorkProjectionStore(globalStoreOptions);
  try {
    await store.publishWorkspaceSnapshot(workspace, { now: "2026-07-04T10:05:00.000Z" });
    await publishGlobalRegistryDescriptorsToStore(store, workspace, { now: "2026-07-04T10:05:00.000Z" });
  } finally {
    store.close();
  }
  return { repo, globalHome, globalStoreOptions };
}

// "a repo root with a built `ui/dist`" — the launchers refuse with `ui-build-missing`
// otherwise, and that refusal is unchanged by this story.
async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "  <head>",
      "    <meta charset=\"UTF-8\" />",
      "    <script type=\"module\" crossorigin src=\"/assets/index-abc123.js\"></script>",
      "  </head>",
      "  <body><div id=\"root\"></div></body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
  return dir;
}

// ONE repoRoot serves both origins: boardUiDist(root) and meshUiDist(root) are the same
// `<root>/ui/dist`, so the board and the fleet in a lane serve the SAME bytes and "the
// body is byte-identical to what GET / returns" is a claim about the fallback, not about
// two different fixtures.
async function makeRepoRootWithDist() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-advertised-paths-root-"));
  await writeDist(boardUiDist(root));
  return root;
}

// "every port used below is an ephemeral free port the lane picked, never a fixed one" —
// reserve one by binding :0, reading the port back, and releasing it.
function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// --- the published faces -----------------------------------------------------

// `aof <verb> --json` through the REAL CLI, parsed. The probe never binds and never
// launches (the launcher seam's `--json` rule), so this is safe against a machine whose
// default ports are already held by the operator's own daemons.
async function probe(cwd, args, env = {}) {
  const result = await spawnCliAsync(process.execPath, [cliPath, ...args, "--json"], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1", ...env },
  });
  assert.equal(result.status, 0, `\`aof ${args.join(" ")} --json\` exits 0 (stderr: ${result.stderr})`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`\`aof ${args.join(" ")} --json\` did not print JSON: ${JSON.stringify(result.stdout.slice(0, 400))}`);
  }
}

// Launch a long-lived launcher and read its `Open this URL in your browser: <url>` line —
// the line an operator actually copies out of a terminal, which is a DIFFERENT string
// from the probe's and can therefore drift alone. The caller stop()s it (SIGTERM → the
// launch body's own shutdown, which also kills the config editor's vite child).
function launchAndAnnounce(cwd, args, { env = {}, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, NODE_NO_WARNINGS: "1", ...env },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const stop = () => new Promise((res) => {
      child.on("close", () => res());
      try { child.kill("SIGTERM"); } catch { res(); }
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGTERM"); } catch { /* noop */ }
      reject(new Error(`\`aof ${args.join(" ")}\` never announced a URL; stdout=<${stdout}> stderr=<${stderr}>`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/Open this URL in your browser:\s*(\S+)/);
      if (!settled && match) {
        settled = true;
        clearTimeout(timer);
        resolve({ url: match[1], get stdout() { return stdout; }, stop });
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`\`aof ${args.join(" ")}\` exited before announcing; stdout=<${stdout}> stderr=<${stderr}>`));
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

// --- the shared Thens --------------------------------------------------------

// "<url> parses with `new URL(...)` and its pathname is exactly <path>", "its search
// names no `mode` parameter", "its `scope` parameter … is <scope>", and "its pathname
// contains no '&' and no '?'". The last clause is trap 1's detector: a query glued onto
// a path parses as a pathname that CONTAINS the parameters as text, and every substring
// check in the world accepts it.
function assertAdvertised(rawUrl, { path: expectedPath, scope, label }) {
  const url = new URL(rawUrl);
  assert.equal(url.pathname, expectedPath, `${label}: the pathname is exactly ${expectedPath} (got ${rawUrl})`);
  assert.equal(url.searchParams.get("mode"), null, `${label}: the search names no \`mode\` parameter (got ${rawUrl})`);
  assert.equal(
    url.searchParams.get("scope"),
    scope === "absent" ? null : scope,
    `${label}: \`scope\` read via searchParams.get is ${scope} (got ${rawUrl})`,
  );
  assert.ok(!url.pathname.includes("&"), `${label}: the pathname contains no "&" — a query glued onto a path is caught here (got ${rawUrl})`);
  assert.ok(!url.pathname.includes("?"), `${label}: the pathname contains no "?" (got ${rawUrl})`);
  return url;
}

// How many TCP LISTENERS this process holds right now. `getActiveResourcesInfo()` names a
// listening server `TCPServerWrap` and a connected socket `TCPWrap`, so counting only the
// former is exactly "how many servers are listening" — which is how "no board server was
// launched for the refused request (no new listener appears)" is measured rather than
// assumed. The board servers a drill-in lazily launches live INSIDE this process (the
// fleet face's own `boardServers` map), so they are visible here.
function listenerCount() {
  return process.getActiveResourcesInfo().filter((resource) => /^TCPServerWrap$/i.test(resource)).length;
}

async function readBody(response) {
  return await response.text();
}

// Stand up the fleet face over the published fixture, run `fn`, tear everything down.
async function withFleetFace(fn) {
  const { repo, globalStoreOptions } = await makeRepo();
  const root = await makeRepoRootWithDist();
  let server;
  try {
    const started = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, globalStoreOptions });
    server = started.server;
    const workspaceId = await publishedWorkspaceId(globalStoreOptions);
    return await fn({ url: started.url, fleetUrl: started.fleetUrl, workspaceId, repo, root });
  } finally {
    if (server) await closeServer(server);
    await rm(repo, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}

// The published workspace's id, read back through the same projection the face reads.
async function publishedWorkspaceId(globalStoreOptions) {
  const { queryGlobalMeshStatus } = await import("../src/global-mesh-query.mjs");
  const status = await queryGlobalMeshStatus({ ...globalStoreOptions });
  const id = (status.workspaces ?? [])[0]?.workspaceId;
  assert.ok(id, "the fixture publishes exactly one workspace into the isolated projection");
  return id;
}

export const advertisedPathsTests = [
  // ══════════════════════════════════════════════════════════════════════════
  // Scenario Outline: each launcher's `--json` probe advertises its ADR-002 path, with
  // its payload intact and its envelope otherwise unchanged. (6 rows)
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "advertised-paths/00 each launcher's `--json` probe advertises its ADR-002 path, with its payload intact and its envelope otherwise unchanged (00 scenario 1, all six rows)",
    async run() {
      const { repo } = await makeRepo();
      const boardPort = await reserveFreePort();
      const configPort = await reserveFreePort();
      try {
        const rows = [
          {
            case: "the board probe",
            args: ["work", "ui"],
            key: "boardUrl",
            path: "/board",
            scope: "absent",
            envelopeMode: "board",
            // The HEAD envelope's own keys — captured, so a key SILENTLY added, renamed
            // or dropped alongside the URL change fails here rather than at a consumer.
            keys: ["mode", "port", "projectDir", "uiDist", "uiBuildPresent", "boardUrl"],
            expect: (envelope) => {
              assert.equal(envelope.port, 4180, "the board probe's documented default port is unchanged");
              // realpath on both sides: macOS resolves the temp dir through /private, so
              // comparing raw strings would measure the platform, not the envelope.
              assert.equal(realpathSync(envelope.projectDir), realpathSync(repo), "…and it names the resolved project dir");
              assert.equal(envelope.uiDist, path.join(repoRoot, "ui", "dist"), "…and the dist it would serve");
              assert.equal(typeof envelope.uiBuildPresent, "boolean", "…and whether that build is present");
            },
          },
          {
            case: "the board probe on a chosen port",
            args: ["work", "ui", "--port", String(boardPort)],
            key: "boardUrl",
            path: "/board",
            scope: "absent",
            envelopeMode: "board",
            keys: ["mode", "port", "projectDir", "uiDist", "uiBuildPresent", "boardUrl"],
            expect: (envelope) => {
              assert.equal(envelope.port, boardPort, "the chosen port rides the envelope");
              assert.equal(new URL(envelope.boardUrl).port, String(boardPort), "…and the advertised URL names it");
            },
          },
          {
            case: "the fleet probe, default scope",
            args: ["mesh", "ui"],
            key: "fleetUrl",
            path: "/fleet",
            scope: "global",
            envelopeMode: "fleet",
            keys: ["mode", "scope", "port", "projectDir", "uiDist", "uiBuildPresent", "relayConfigured", "fleetUrl"],
            expect: (envelope) => {
              assert.equal(envelope.scope, "global", "the fleet probe's own `scope` key is unchanged");
              assert.equal(envelope.port, 4181, "…as is its documented default port");
              assert.equal(envelope.relayConfigured, false, "…and its relay posture for this fixture");
            },
          },
          {
            case: "the fleet probe, --local",
            args: ["mesh", "ui", "--local"],
            key: "fleetUrl",
            path: "/fleet",
            scope: "local",
            envelopeMode: "fleet",
            keys: ["mode", "scope", "port", "projectDir", "uiDist", "uiBuildPresent", "relayConfigured", "fleetUrl"],
            expect: (envelope) => {
              assert.equal(envelope.scope, "local", "--local rides the envelope's own scope key…");
            },
          },
          {
            case: "the config-editor probe",
            args: ["assets", "ui"],
            key: "uiUrl",
            path: "/config",
            scope: "absent",
            envelopeMode: "assets-ui",
            keys: ["mode", "uiPort", "apiPort", "projectDir", "uiUrl"],
            expect: (envelope) => {
              assert.equal(envelope.uiPort, 4177, "the config editor's documented default frontend port");
              assert.equal(envelope.apiPort, 4178, "…and its default API port (frontend + 1)");
            },
          },
          {
            case: "the config-editor probe on a port",
            args: ["assets", "ui", "--port", String(configPort)],
            key: "uiUrl",
            path: "/config",
            scope: "absent",
            envelopeMode: "assets-ui",
            keys: ["mode", "uiPort", "apiPort", "projectDir", "uiUrl"],
            expect: (envelope) => {
              assert.equal(envelope.uiPort, configPort, "the chosen frontend port rides the envelope");
              assert.equal(envelope.apiPort, configPort + 1, "…and the API port still defaults to frontend + 1");
              assert.equal(new URL(envelope.uiUrl).port, String(configPort), "…and the advertised URL names it");
            },
          },
        ];

        for (const row of rows) {
          const envelope = await probe(repo, row.args);
          assertAdvertised(envelope[row.key], { path: row.path, scope: row.scope, label: row.case });
          // Trap 2 — `mode` is the probe DISCRIMINATOR, not a URL selector. It is
          // asserted PRESENT: deleting it "to satisfy the gate" would break every probe
          // consumer, and it is outside that gate's `[?&]mode=` pattern anyway.
          assert.equal(envelope.mode, row.envelopeMode, `${row.case}: the envelope still carries its own \`mode\` key as ${row.envelopeMode}`);
          assert.deepEqual(
            Object.keys(envelope).sort(),
            [...row.keys].sort(),
            `${row.case}: the envelope's keys are exactly what they were at HEAD — this story renames the URL and nothing else`,
          );
          row.expect(envelope);
        }

        // The ADR-002 divergence, observable exactly here and nowhere else: the verb is
        // `assets`, the command id is `assets:ui`, the legacy mode value was `assets` —
        // and the PATH is `/config`, because `/assets` is the built bundle's OWN asset
        // directory (`ui/dist/assets/index-*.js`). A row asserting `/assets` would be
        // asserting a route that cannot exist.
        const config = await probe(repo, ["assets", "ui"]);
        assert.equal(new URL(config.uiUrl).pathname, "/config", "the config editor's path is /config, never /assets");

        // The fleet rows are the ONLY ones carrying `scope`; a board or config URL that
        // grew one would be inventing a parameter no consumer reads.
        const board = await probe(repo, ["work", "ui"]);
        assert.equal(new URL(board.boardUrl).search, "", "the board URL carries no query at all — it never had one");
        assert.equal(new URL(config.uiUrl).search, "", "…and neither does the config editor's");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario Outline: each launched server announces its path on stdout, as a URL and
  // not as a path with a stray "&" glued to it. (4 rows)
  //
  // The LAUNCHED servers, not the probes — the human line an operator copies out of a
  // terminal. This is where trap 1 lives, and the serve-side literal is a DIFFERENT
  // string from the probe's, so it can drift alone.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "advertised-paths/00 each launched server announces its path on stdout, as a URL and not a path with a stray \"&\" glued to it (00 scenario 2, all four rows)",
    async run() {
      const { repo } = await makeRepo();
      try {
        const rows = [
          { case: "the board launcher", verb: ["work", "ui"], path: "/board", scope: "absent" },
          { case: "the fleet launcher, global", verb: ["mesh", "ui"], path: "/fleet", scope: "global" },
          { case: "the fleet launcher, --local", verb: ["mesh", "ui"], extra: ["--local"], path: "/fleet", scope: "local" },
          // FEASIBILITY (from the feature): `aof assets ui` spawns a REAL vite child. The
          // announce line is printed immediately after the API server binds and BEFORE
          // vite is ready, so this lane reads the line and kills the child without ever
          // waiting on a bundle. It is also why this row does NOT fetch its own URL: the
          // config origin is a vite dev server, not one of this repo's Node servers.
          { case: "the config-editor launcher", verb: ["assets", "ui"], apiPort: true, path: "/config", scope: "absent" },
        ];

        for (const row of rows) {
          const port = await reserveFreePort();
          const args = [...row.verb, "--port", String(port), ...(row.extra ?? [])];
          if (row.apiPort) args.push("--api-port", String(await reserveFreePort()));
          const launched = await launchAndAnnounce(repo, args);
          try {
            const url = assertAdvertised(launched.url, { path: row.path, scope: row.scope, label: row.case });
            assert.equal(url.hostname, "127.0.0.1", `${row.case}: the announced host is 127.0.0.1`);
            assert.equal(url.port, String(port), `${row.case}: the announced port is the port the launcher was given`);
          } finally {
            await launched.stop();
          }
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario Outline: each Node server serves what it now advertises AND what it used to
  // advertise. (7 rows)
  //
  // The composition STORY.md names as the worse regression — an advertised URL that
  // 404s — plus its other half: what the producer STOPS emitting must not stop working.
  //
  // NO fragment row exists here ON PURPOSE. A fragment is never sent to a server, so
  // `/?mode=board#34/01` and `/board#34/01` are indistinguishable over HTTP. The
  // fragment's survival is asserted where it is MINTED (the board-url lanes below) and
  // end to end by task 02's browser census.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "advertised-paths/00 each Node server serves what it NOW advertises and what it USED to advertise, with the app shell either way (00 scenario 3, all seven rows)",
    async run() {
      const { repo, globalStoreOptions } = await makeRepo();
      const root = await makeRepoRootWithDist();
      let board;
      let fleet;
      try {
        board = await serveBoard({ projectDir: repo, port: 0, repoRoot: root, spawn: () => ({ pid: 1, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) });
        fleet = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, globalStoreOptions });

        const origins = {
          "`aof work ui`": board.url,
          "`aof mesh ui`": fleet.url,
        };
        // The app shell each origin answers for its own `GET /` — the byte reference
        // every row below is compared against.
        const shellOf = {};
        for (const [label, origin] of Object.entries(origins)) {
          const response = await fetch(new URL("/", origin));
          assert.equal(response.status, 200, `${label}: GET / answers 200`);
          shellOf[label] = await readBody(response);
          assert.ok(shellOf[label].includes("<div id=\"root\">"), `${label}: …with the app shell`);
        }

        const rows = [
          { case: "the board's new address", server: "`aof work ui`", request: "/board" },
          { case: "the board's legacy address", server: "`aof work ui`", request: "/?mode=board" },
          { case: "the fleet's new address", server: "`aof mesh ui`", request: "/fleet" },
          { case: "the fleet's new address carrying scope", server: "`aof mesh ui`", request: "/fleet?scope=global" },
          { case: "the fleet's legacy address", server: "`aof mesh ui`", request: "/?mode=fleet" },
          { case: "the fleet's legacy address with scope", server: "`aof mesh ui`", request: "/?mode=fleet&scope=global" },
          { case: "the fleet's legacy address, local scope", server: "`aof mesh ui`", request: "/?mode=fleet&scope=local" },
        ];

        for (const row of rows) {
          const response = await fetch(new URL(row.request, origins[row.server]));
          assert.equal(response.status, 200, `${row.case}: ${row.request} answers 200 on ${row.server}'s own origin`);
          assert.match(
            response.headers.get("content-type") ?? "",
            /^text\/html/,
            `${row.case}: …with Content-Type: text/html`,
          );
          const body = await readBody(response);
          assert.equal(
            body,
            shellOf[row.server],
            `${row.case}: …and the body is byte-identical to that server's own GET / — the built app shell, never a 404 page and never a JSON error envelope`,
          );
        }
      } finally {
        if (board) await closeServer(board.server);
        if (fleet) await closeServer(fleet.server);
        await rm(repo, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario Outline: the drill-in URL is a path on the workspace's OWN board origin,
  // and it keeps its `#ref` verbatim. (5 rows)
  //
  // `#ref` is a live deep-link contract (`Board.tsx` reads it back), so it is asserted
  // per ref SHAPE — a ref with slashes is exactly what a careless `encodeURIComponent`
  // mangles. The last two rows pin the falsy-ref branch: a bare `/board` with no
  // trailing `#`, and a body `ref` of null rather than "".
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "advertised-paths/00 the drill-in URL is a PATH on the workspace's own board origin and keeps its `#ref` verbatim (00 scenario 4, all five rows)",
    async run() {
      await withFleetFace(async ({ url, workspaceId }) => {
        const fleetPort = new URL(url).port;
        const rows = [
          { case: "a milestone ref", ref: "34", hash: "#34", bodyRef: "34" },
          { case: "a story ref (one slash)", ref: "34/01", hash: "#34/01", bodyRef: "34/01" },
          { case: "a task ref (two slashes)", ref: "34/01/02", hash: "#34/01/02", bodyRef: "34/01/02" },
          { case: "the ref parameter omitted", ref: null, hash: "", bodyRef: null },
          { case: "the ref parameter empty", ref: "", hash: "", bodyRef: null },
        ];

        for (const row of rows) {
          const query = new URLSearchParams({ workspaceId });
          if (row.ref !== null) query.set("ref", row.ref);
          const response = await fetch(new URL(`/api/mesh/board-url?${query.toString()}`, url));
          assert.equal(response.status, 200, `${row.case}: the board-url route answers 200`);
          const body = await response.json();
          const drillIn = new URL(body.url);
          assert.equal(drillIn.pathname, "/board", `${row.case}: the drill-in's pathname is exactly /board`);
          assert.equal(drillIn.searchParams.get("mode"), null, `${row.case}: …and it names no \`mode\` parameter`);
          assert.equal(drillIn.hash, row.hash, `${row.case}: …its hash is ${row.hash === "" ? "empty — no fragment at all" : row.hash}`);
          assert.equal(drillIn.hostname, "127.0.0.1", `${row.case}: …on a 127.0.0.1 origin`);
          assert.notEqual(drillIn.port, fleetPort, `${row.case}: …whose port is NOT the fleet's — the workspace's own board server`);
          assert.equal(body.ref, row.bodyRef, `${row.case}: the body's \`ref\` is ${JSON.stringify(row.bodyRef)}`);
        }
      });
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario: the board-url response body keeps its exact key shape, and leaves room for
  // milestone 46's additive field.
  //
  // Spike 44 (done) settled that 46 adds an `origin` field to THIS body over THIS
  // lazy-launch seam. Changing the URL must not narrow, rename or reorder the keys
  // around it, or 46's additive change becomes a breaking one.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "advertised-paths/00 the board-url response body keeps its exact key shape and leaves room for milestone 46's additive `origin` field (00 scenario 5)",
    async run() {
      await withFleetFace(async ({ url, workspaceId }) => {
        const response = await fetch(new URL(`/api/mesh/board-url?workspaceId=${encodeURIComponent(workspaceId)}&ref=34`, url));
        assert.equal(response.status, 200, "the board-url route answers 200");
        const body = await response.json();
        assert.deepEqual(
          Object.keys(body).sort(),
          ["ref", "url", "workspaceId"],
          "the body's own keys are exactly `url`, `workspaceId`, `ref` — nothing added, renamed or removed by this story",
        );
        assert.equal(body.workspaceId, workspaceId, "`workspaceId` is the id that was asked for");
        assert.equal(body.ref, "34", "…and `ref` is \"34\"");
        assert.equal(
          Object.hasOwn(body, "origin"),
          false,
          "no key named `origin` is present — 46 adds it, and this story must neither pre-empt it nor make room for it by moving anything else",
        );
        assert.equal(typeof body, "object", "the body is an object…");
        assert.equal(Array.isArray(body), false, "…not an array…");
        assert.notEqual(body, null, "…and not null, so a sibling key added later is an ADDITION rather than a shape change");
      });
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario: the drill-in URL still points at the selected workspace's real board
  // server, and a second drill-in reuses it.
  //
  // Exactly what a rewrite that built the path against the WRONG base would break:
  // `new URL("/board", url)` against a bare origin discards nothing, but against the
  // wrong base it discards the port — and only these Thens would notice.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "advertised-paths/00 the drill-in URL still points at the workspace's REAL board server, a second drill-in reuses it, and the fleet is never a proxy (00 scenario 6)",
    async run() {
      await withFleetFace(async ({ url, workspaceId }) => {
        const ask = () => fetch(new URL(`/api/mesh/board-url?workspaceId=${encodeURIComponent(workspaceId)}&ref=34`, url));

        const first = await (await ask()).json();
        const boardList = await fetch(new URL("/api/work/list", first.url));
        assert.equal(boardList.status, 200, "the returned `url`'s origin answers GET /api/work/list");
        const items = (await boardList.json()).items;
        assert.ok(
          items.some((item) => item.ref === "34"),
          "…with THAT workspace's own work stream (the item \"34\" is in it)",
        );

        const second = await (await ask()).json();
        assert.equal(second.url, first.url, "the second response's `url` is byte-identical to the first — the board server is reused, not relaunched per click");

        // "a `GET` of that `url` (fragment stripped, as a browser sends it)". A browser
        // never puts the fragment on the wire, so strip it here for the same reason.
        const asABrowserSendsIt = new URL(first.url);
        asABrowserSendsIt.hash = "";
        const page = await fetch(asABrowserSendsIt);
        assert.equal(page.status, 200, "a GET of that url (fragment stripped) answers 200");
        assert.ok((await readBody(page)).includes("<div id=\"root\">"), "…with the app shell");

        const onTheFleet = await fetch(new URL("/api/work/list", url));
        assert.equal(onTheFleet.status, 404, "the fleet origin itself still answers GET /api/work/list with a 404 — the drill-in is a navigation, never a proxy");
      });
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario Outline: the board-url route's refusals are byte-unchanged by the URL
  // migration. (4 rows)
  //
  // Rewriting the URL a handler returns is the classic moment its refusals get rewritten
  // with it. Each row holds every other input valid and flips exactly one.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: "advertised-paths/00 the board-url route's refusals are byte-unchanged by the URL migration, and none of them launches a board server (00 scenario 7, all four rows)",
    async run() {
      await withFleetFace(async ({ url, workspaceId }) => {
        const rows = [
          { case: "no workspaceId at all", method: "GET", target: "/api/mesh/board-url", status: 400, code: "invalid-workspace" },
          { case: "a whitespace-only workspaceId", method: "GET", target: "/api/mesh/board-url?workspaceId=%20&ref=34", status: 400, code: "invalid-workspace" },
          { case: "a workspaceId not in the projection", method: "GET", target: "/api/mesh/board-url?workspaceId=nope&ref=34", status: 404, code: "workspace-not-found" },
          { case: "a POST to the route", method: "POST", target: `/api/mesh/board-url?workspaceId=${encodeURIComponent(workspaceId)}&ref=34`, status: 405, code: "method-not-allowed" },
        ];

        const before = listenerCount();
        for (const row of rows) {
          const response = await fetch(new URL(row.target, url), { method: row.method });
          assert.equal(response.status, row.status, `${row.case}: the response status is ${row.status}`);
          const body = await response.json();
          assert.equal(body.code, row.code, `${row.case}: …and its envelope's \`code\` is ${row.code}`);
          if (row.status === 405) {
            // Named here so the read-only posture is re-checked in the same change that
            // rewrites the handler's happy path (the assertion
            // test/mesh-ui-assignment-read-only.test.mjs already makes).
            assert.equal(response.headers.get("allow"), "GET, HEAD", `${row.case}: …carrying \`Allow: GET, HEAD\`, unchanged`);
          }
          assert.equal(
            listenerCount(),
            before,
            `${row.case}: no board server was launched for the refused request — no new listener appears`,
          );
        }

        // …and a FOLLOWING valid drill-in still launches exactly one.
        const first = await (await fetch(new URL(`/api/mesh/board-url?workspaceId=${encodeURIComponent(workspaceId)}&ref=34`, url))).json();
        assert.equal(listenerCount(), before + 1, "a following valid drill-in launches exactly ONE board server");
        const second = await (await fetch(new URL(`/api/mesh/board-url?workspaceId=${encodeURIComponent(workspaceId)}&ref=34`, url))).json();
        assert.equal(second.url, first.url, "…and a second one reuses it rather than launching another");
        assert.equal(listenerCount(), before + 1, "…so the listener count is unmoved by the second drill-in");
      });
    },
  },
];
