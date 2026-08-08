// Traceability wiring for milestone 45 / story 02 (ADR-004) — the three @executable
// task features of `02_story_static-serve-history-fallback`:
//
//   · tasks/00_one-traversal-guard.feature      → the `static-serve/00 …` entries below
//   · tasks/01_history-fallback.feature         → the `static-serve/01 …` entries below
//   · tasks/02_missing-asset-still-404s.feature → the `static-serve/02 …` entries below
//
// EVERY Scenario and EVERY Scenario-Outline row of all three features is covered here,
// one exported entry per Scenario/Outline, the Outline's Examples table carried as a
// literal table so the file reads as the spec it implements.
//
// THE LITMUS, taken from the features verbatim: "every Then is a real HTTP request
// against a started server, asserting the status line, the `content-type` header, and the
// body". So this suite starts the REAL `serveBoard`, `serveSetupUi` and `serveMeshUi` on
// ephemeral ports against a real fixture bundle on disk and `fetch`es them. Nothing here
// calls `shouldServeAppShell`, `safeStaticPath` or `contentType` directly — those are
// PLACEMENT invariants and belong to `test/arch/acd-spa-fallback-never-masks.test.mjs`,
// which asserts the single definition, the pure-leaf import rule and the ordering triple.
// A server that kept its own hand-rolled copy would pass this file and fail that one;
// that is the intended division of labour, not a gap.
//
// THE THREE ORIGINS, and why they are three and not two. `src/board-serve.mjs:20` hands
// the board origin to the SAME handler the config editor runs (`serveSetupUi`), so those
// two are ONE handler observed twice — several scenarios exist purely to prove that by
// observation rather than take the delegation on trust. The fleet origin
// (`serveMeshUi`) is a genuinely separate server, and it is the one this story TIGHTENS:
// its `catch -> index.html` was UNCONDITIONAL, so a missing `/assets/index-abc123.js`
// answered `200 text/html` there (measured 2026-08-06 at `eacbd57`). All three serve the
// SAME fixture bundle here, because "the same request, the same answer, whichever origin
// you ask" is the story's whole claim.
//
// Run focused and isolated (hook-enforced):
//   AOF_GLOBAL_HOME=$(mktemp -d) node --test test/static-serve-fallback.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveSetupUi } from "../src/setup-ui.mjs";
import { serveBoard, boardUiDist } from "../src/board-serve.mjs";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";

// --- fixtures ----------------------------------------------------------------

// The marker every `..` row in task 00 names. It lives in a file OUTSIDE the served
// root, so a 200 carrying this text could only have come from outside the bundle.
const MARKER = "OUTSIDE-THE-ROOT";
// The app shell's own tell, and the `<script>` the built bundle really emits.
const ROOT_DIV = '<div id="root">';
const SHELL_SCRIPT = '<script type="module" src="/assets/index-abc123.js">';

// A repo whose .aof config points work.dir at wiki/work with one milestone, so
// `/api/work/list` answers a non-empty `items` array (mirrors board-serve.test's
// makeRepo — this suite extends that existing black-box channel rather than inventing
// one).
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-static-serve-repo-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(path.join(workDir, "45_milestone_ui-app-shell-routing"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(workDir, "45_milestone_ui-app-shell-routing", "SPEC.md"),
    "---\ntype: milestone\nnumber: \"45\"\nslug: ui-app-shell-routing\nstatus: in-progress\ntitle: \"UI app shell\"\ncreated: 2026-08-06\nupdated: 2026-08-06\n---\n# 45\n",
    "utf8",
  );
  return repo;
}

// The Background of all three features, on disk: a BUILT bundle holding index.html (the
// app shell), the hashed .js and .css, and — task 02's Background — an unreferenced
// decoy asset named by nothing the shell links to.
async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "  <head>",
      "    <meta charset=\"UTF-8\" />",
      `    ${SHELL_SCRIPT}</script>`,
      "    <link rel=\"stylesheet\" href=\"/assets/index-abc123.css\" />",
      "  </head>",
      `  <body>${ROOT_DIV}</div></body>`,
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
  await writeFile(path.join(dir, "assets", "index-abc123.css"), ":root { --aof: 1; }\n", "utf8");
  await writeFile(path.join(dir, "assets", "decoy-9f9f.js"), "export const decoy = 1;\n", "utf8");
  return dir;
}

// A stub spawn so serveBoard's terminal WS attaches without touching node-pty.
function stubSpawn() {
  return () => ({
    pid: 1,
    onData() { return { dispose() {} }; },
    onExit() { return { dispose() {} }; },
    write() {},
    resize() {},
    kill() {},
  });
}

// The Background's three origins, all serving the SAME bundle.
//
// ONE repoRoot serves all three because `boardUiDist(root)` and `meshUiDist(root)` are
// the same `<root>/ui/dist` — which also gives the features' "a file named package.json
// one directory ABOVE that bundle" exactly one home (`<root>/ui/package.json`) instead of
// three, so every origin's `..` row aims at the same target.
async function startOrigins() {
  const repo = await makeRepo();
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-static-serve-root-"));
  const dist = await writeDist(meshUiDist(root));
  assert.equal(dist, boardUiDist(root), "the board and the fleet resolve the SAME ui/dist off one repoRoot");
  // The marker file, one directory ABOVE the served bundle. The served bundle has no
  // package.json of its own, so a 200 carrying MARKER could only have escaped the root.
  await writeFile(path.join(root, "ui", "package.json"), `{ "marker": "${MARKER}" }\n`, "utf8");

  const globalHome = await mkdtemp(path.join(os.tmpdir(), "aof-static-serve-gh-"));
  const globalStoreOptions = { env: { AOF_GLOBAL_HOME: globalHome } };

  const board = await serveBoard({ projectDir: repo, port: 0, repoRoot: root, spawn: stubSpawn(), recordSessions: false });
  const config = await serveSetupUi(null, { projectDir: repo, port: 0, uiRoot: dist, recordSessions: false });
  const fleet = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, globalStoreOptions });

  const origins = [
    { name: "the board origin", url: board.url, envelope: "text" },
    { name: "the config-editor origin", url: config.url, envelope: "text" },
    { name: "the fleet origin", url: fleet.url, envelope: "json" },
  ];
  return {
    origins,
    board: origins[0],
    config: origins[1],
    fleet: origins[2],
    dist,
    root,
    repo,
    async close() {
      for (const { server } of [board, config, fleet]) {
        await new Promise((resolve) => server.close(resolve));
      }
      await rm(repo, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
      await rm(globalHome, { recursive: true, force: true });
    },
  };
}

// --- request helpers ---------------------------------------------------------

// A REAL HTTP request against a started server, returning the status line, the
// content-type header and BOTH the decoded text and the raw bytes (some scenarios assert
// byte-identity, others assert a substring).
async function get(origin, target) {
  // A target beginning "//" must reach the server VERBATIM. `new URL(target, base)`
  // re-resolves it as protocol-relative — the host becomes "api" and the request never
  // touches the origin under test, which is the very parse the double-slash rows exist
  // to catch. Pathname ASSIGNMENT keeps the origin and serialises the path as given.
  let requestUrl;
  if (target.startsWith("//")) {
    requestUrl = new URL(origin.url);
    const q = target.indexOf("?");
    requestUrl.pathname = q === -1 ? target : target.slice(0, q);
    if (q !== -1) requestUrl.search = target.slice(q);
  } else {
    requestUrl = new URL(target, origin.url);
  }
  const response = await fetch(requestUrl);
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    origin,
    target,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    bytes,
    text: bytes.toString("utf8"),
  };
}

function where(result) {
  return `GET ${result.target} on ${result.origin.name}`;
}

function isHtml(result) {
  return result.contentType.includes("text/html");
}

// "no response body contains a stack trace, an error class name, or the served bundle's
// absolute directory path" — task 00 scenarios 4 and 6. A refusal must name its own
// cause and NOTHING else about the machine it runs on.
function assertLeaksNothing(result, dist) {
  assert.ok(!result.text.includes(dist), `${where(result)} does not leak the served bundle's absolute directory path`);
  assert.ok(!/\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(result.text), `${where(result)} carries no stack trace`);
  assert.ok(
    !/\b(TypeError|RangeError|ReferenceError|SyntaxError|ENOENT|EISDIR|ERR_[A-Z_]+)\b/.test(result.text),
    `${where(result)} names no error class or errno`,
  );
  assert.ok(!/(^|[^/\w])(\/Users\/|\/etc\/|\/var\/folders\/|\/root\/|[A-Z]:\\)/.test(result.text), `${where(result)} carries no OS path prefix`);
}

// The refusal ENVELOPE is per-origin and this story deliberately does not unify it
// (task 00 scenario 4 pins each as-is, so a later unification is a decision rather than
// an accident): the board/config origin answers `404 text/plain "Not found"`, the fleet
// origin answers its coded `{ ok:false, error, code:"not-found" }` JSON.
function assertNotFoundEnvelope(result) {
  assert.equal(result.status, 404, `${where(result)} is a 404`);
  if (result.origin.envelope === "json") {
    assert.ok(result.contentType.includes("application/json"), `${where(result)} answers the fleet's JSON envelope`);
    const body = JSON.parse(result.text);
    assert.equal(body.ok, false, `${where(result)} — the envelope's ok is false`);
    assert.equal(body.code, "not-found", `${where(result)} — the envelope's code is "not-found"`);
  } else {
    assert.ok(result.contentType.includes("text/plain"), `${where(result)} answers text/plain`);
    assert.equal(result.text, "Not found", `${where(result)} answers the body "Not found"`);
  }
}

function assertServesShell(result) {
  assert.equal(result.status, 200, `${where(result)} serves the app shell (status 200)`);
  assert.ok(isHtml(result), `${where(result)} carries content-type: text/html`);
  assert.ok(result.text.includes(ROOT_DIV), `${where(result)} — the body contains ${ROOT_DIV}`);
}

// The load-bearing NEGATIVE of both the traversal task and the missing-asset task:
// "200 with the wrong body" is exactly the failure they exist to make impossible.
function assertNotTheShell(result) {
  assert.ok(!isHtml(result), `${where(result)} does NOT carry content-type: text/html`);
  assert.ok(!result.text.includes(ROOT_DIV), `${where(result)} — the body does NOT contain ${ROOT_DIV}`);
}

function assertNoMarker(result) {
  assert.ok(!result.text.includes(MARKER), `${where(result)} returned no byte from outside the served root (no "${MARKER}")`);
}

// The "the refusal did not damage the server" check every feature ends its tables with.
async function assertStillServing(origins, { shell = false } = {}) {
  for (const origin of origins) {
    const asset = await get(origin, "/assets/index-abc123.js");
    assert.equal(asset.status, 200, `${where(asset)} still answers 200 afterwards`);
    assert.ok(asset.contentType.includes("text/javascript"), `${where(asset)} still answers text/javascript`);
    if (!shell) continue;
    const index = await get(origin, "/");
    assert.equal(index.status, 200, `${where(index)} still answers 200 afterwards`);
    assert.ok(isHtml(index), `${where(index)} still answers text/html`);
    assert.ok(index.text.includes(ROOT_DIV), `${where(index)} still serves the app shell`);
  }
}

// --- the Examples tables, carried verbatim from the features ------------------

// task 00, scenario 1
const TRAVERSAL_ROWS = [
  ["encoded dot-dot with an encoded slash", "/%2e%2e%2fpackage.json"],
  ["a partly-encoded two-level escape", "/..%2f..%2fetc%2fhosts"],
  ["the mixed separator (backslash), extensioned", "/%2e%2e%5cpackage.json"],
  ["an encoded ABSOLUTE path", "/%2fetc%2fhosts"],
  ["a Windows drive-letter absolute path", "/C:/Windows/win.ini"],
  ["an encoded absolute path to a dotfile dir", "/%2fUsers%2fnobody%2f.ssh%2fknown_hosts"],
  ["double encoding is not a second decode pass", "/%252e%252e%252fpackage.json"],
  ["a malformed percent-escape", "/%E0%A4%A"],
  ["an invalid percent-escape", "/%ZZ"],
  ["dots that are not a dot segment", "/....//package.json"],
];

// task 00, scenario 2 — the ORDERING rows: each is refused by the guard AND would be
// accepted by the fallback predicate on its own, so which runs first decides the answer.
const EXTENSIONLESS_ESCAPE_ROWS = [
  ["an extension-less escape, one level", "/%2e%2e%2fpackage"],
  ["an extension-less escape, six levels", "/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd"],
  ["an encoded absolute, extension-less", "/%2fetc%2fpasswd"],
  ["a partly-encoded escape, extension-less", "/..%2f..%2fetc%2fshadow"],
];

// task 00, scenario 5 — what the URL parser has already flattened before the handler
// sees it. `what the handler actually receives` is the third column of the feature's own
// table, asserted here rather than trusted.
const FLATTENED_ROWS = [
  ["an unencoded parent escape", "/../package.json", "/package.json"],
  ["an unencoded escape from a subdirectory", "/assets/../../package.json", "/package.json"],
  ["whole-segment encoded dot segments", "/%2e%2e/%2e%2e/package.json", "/package.json"],
];

// task 00, scenario 6
const MALFORMED_ROWS = [
  ["an invalid percent-escape", "/%ZZ"],
  ["a truncated UTF-8 escape", "/%E0%A4%A"],
  ["an encoded NUL byte", "/%00"],
  ["a NUL byte inside a filename", "/index%00.html"],
];

// task 01, scenario 1
const SHELL_ROWS = [
  ["the fleet route", "/fleet"],
  ["the board route", "/board"],
  ["the config route", "/config"],
  ["bare root", "/"],
  ["a route with a trailing slash", "/board/"],
  ["a deep path no route table has yet", "/some/future/deep/path"],
  ["a typo — the shell renders its own not-found", "/typo-not-a-route"],
  ["a dot in an EARLIER segment, not the last", "/.well-known/acme-challenge/tok"],
  ["the asset DIRECTORY itself, not a file in it", "/assets"],
  ["the asset directory with a trailing slash", "/assets/"],
  ["the bare `/api` prefix, no trailing slash", "/api"],
];

// task 01, scenario 3
const FLEET_SHELL_ROWS = [
  ["the fleet route itself", "/fleet"],
  ["the board route on this origin", "/board"],
  ["the config route on this origin", "/config"],
  ["bare root", "/"],
  ["a route with a trailing slash", "/fleet/"],
  ["a deep path no route table has", "/some/future/deep/path"],
];

// task 01, scenario 4
const API_NOT_FOUND_ROWS = [
  ["an unknown api leaf", "/api/nope"],
  ["an unknown api path, several segments", "/api/unknown/deep/path"],
  ["the bare api prefix with a trailing slash", "/api/"],
  ["an extension-less api path", "/api/work/does-not-exist"],
  ["an api path whose last segment has a dot", "/api/mesh/not.a.route"],
  // Added at review (QA F-2): a "//x" target parses as protocol-relative, so before the
  // leading-slash collapse the /api guard never fired and these were answered with HTML.
  ["a stray DOUBLE slash before the prefix", "//api/nope"],
  ["a triple slash before the prefix", "///api/nope"],
];

// task 01, scenario 6 — the negative half of the discriminator.
const DOTTED_LAST_SEGMENT_ROWS = [
  ["a route-shaped path with a version dot", "/board.v2"],
  ["a route-shaped path with a decimal", "/release-1.2"],
  ["a dotfile at the root", "/.env"],
  ["a dotfile in a subdirectory", "/x/.gitignore"],
  ["a mistyped html extension", "/index.htm"],
];

// task 01, scenario 8
const LEGACY_URL_ROWS = [
  ["the fleet's own advertised URL", "/?mode=fleet"],
  ["the desktop app's compiled constant", "/?mode=fleet&scope=global"],
  ["what `/api/mesh/board-url` returns", "/?mode=board"],
  ["the config editor's advertised URL", "/?mode=assets"],
  ["a canonical path carrying a live parameter", "/fleet?scope=global"],
];

// task 02, scenarios 1 and 2 — deliberately the SAME list on both, because "the same
// request, the same answer, whichever origin you ask" is the claim.
const MISSING_FILE_ROWS = [
  ["a missing hashed JavaScript bundle", "/assets/index-missing.js"],
  ["a missing hashed stylesheet", "/assets/index-missing.css"],
  ["a sourcemap the build never emitted", "/assets/index-abc123.js.map"],
  ["a near-miss on a real asset's name", "/assets/index-abc124.js"],
  ["a near-miss on a real extension", "/assets/index-abc123.jsx"],
  ["a favicon that is not in the bundle", "/favicon.ico"],
  ["a crawler probe", "/robots.txt"],
  ["a web manifest that is not shipped", "/manifest.json"],
];

// task 02, scenario 3
const EXISTING_ASSET_ROWS = [
  ["the hashed JS bundle", "/assets/index-abc123.js", "text/javascript"],
  ["the hashed stylesheet", "/assets/index-abc123.css", "text/css"],
  ["the shell requested by name", "/index.html", "text/html"],
];

// task 02, scenario 6
const ENCODED_DOT_ROWS = [
  ["an encoded dot, uppercase", "/assets/index-missing%2Ejs", "/assets/index-missing.js"],
  ["an encoded dot, lowercase", "/assets/index-missing%2ejs", "/assets/index-missing.js"],
];

// =============================================================================
// task 00 — tasks/00_one-traversal-guard.feature
// =============================================================================

const traversalGuardTests = [
  {
    // Scenario Outline: the same traversal form is refused on every origin, and no byte
    // from outside the served root is ever returned.
    name: "static-serve/00 the same traversal form is refused on EVERY origin, and no byte from outside the served root is ever returned",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of TRAVERSAL_ROWS) {
          const results = [];
          for (const origin of fixture.origins) results.push(await get(origin, target));
          for (const result of results) {
            assert.equal(result.status, 404, `${label}: ${where(result)} is refused with 404`);
            assertNoMarker(result);
            // A 200 carrying the shell is not a refusal. Rows 3 and 5 are the two that
            // answered 200 text/html on the FLEET origin before this story.
            assertNotTheShell(result);
          }
          // …and the refusal did not damage the server.
          await assertStillServing(fixture.origins);
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario Outline: an attempted escape is never converted into the app shell — the
    // guard is decided BEFORE the fallback. THE ordering pin (ADR-004 [Amigos-2]).
    name: "static-serve/00 an attempted escape whose last segment is extension-less is NEVER converted into the app shell — the guard is decided BEFORE the fallback",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of EXTENSIONLESS_ESCAPE_ROWS) {
          for (const origin of fixture.origins) {
            const result = await get(origin, target);
            assert.equal(
              result.status,
              404,
              `${label}: ${where(result)} is 404, NOT 200 — every one of these is refused by the traversal guard AND accepted by the fallback predicate in isolation, so a handler that treats "guard refused" as "file missing" answers 200 text/html here and silently converts a refusal into a success (m45/ADR-004 [Amigos-2])`,
            );
            assertNotTheShell(result);
            assertNoMarker(result);
          }
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario: the board origin and the config-editor origin return the IDENTICAL
    // refusal for the identical request — the delegation (board-serve.mjs:20), observed.
    name: "static-serve/00 the board origin and the config-editor origin return the IDENTICAL refusal for the identical request (one handler reached twice)",
    async run() {
      const fixture = await startOrigins();
      try {
        const target = "/%2e%2e%2fpackage.json";
        const board = await get(fixture.board, target);
        const config = await get(fixture.config, target);
        assert.equal(board.status, config.status, "the same status");
        assert.equal(board.contentType, config.contentType, "the same content-type");
        assert.deepEqual(board.bytes, config.bytes, "the same body bytes — a difference here means board-serve.mjs:20's delegation has been broken");
        assert.equal(board.status, 404, "both are 404");
        assertNoMarker(board);
        assertNoMarker(config);
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario: each origin refuses in its own established not-found envelope, and
    // neither names a filesystem path. Pinned as-is so a later unification is a decision.
    name: "static-serve/00 each origin refuses in its OWN established not-found envelope, and neither body names a filesystem path",
    async run() {
      const fixture = await startOrigins();
      try {
        const board = await get(fixture.board, "/%2fetc%2fhosts");
        assert.equal(board.status, 404, "the board origin answers 404");
        assert.ok(board.contentType.includes("text/plain"), "…with content-type: text/plain");
        assert.equal(board.text, "Not found", "…and the body `Not found`");

        const fleet = await get(fixture.fleet, "/%2fetc%2fhosts");
        assert.equal(fleet.status, 404, "the fleet origin answers 404");
        assert.ok(fleet.contentType.includes("application/json"), "…with content-type: application/json");
        const envelope = JSON.parse(fleet.text);
        assert.equal(envelope.ok, false, "…a body whose ok is false");
        assert.equal(envelope.code, "not-found", "…and whose code is \"not-found\"");

        for (const result of [board, fleet]) assertLeaksNothing(result, fixture.dist);
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario Outline: a path the URL parser has already flattened arrives as a plain
    // missing file, and is still not served.
    name: "static-serve/00 a path the URL parser has already FLATTENED arrives as a plain missing file, and is still not served",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target, received] of FLATTENED_ROWS) {
          // The third column of the feature's table, asserted rather than trusted: this
          // is why scenario 1's green must not be read as covering the unencoded form.
          assert.equal(
            new URL(target, "http://127.0.0.1").pathname,
            received,
            `${label}: the URL parser flattens ${target} to ${received} BEFORE the handler sees it — it never reaches the guard at all`,
          );
          for (const origin of fixture.origins) {
            const result = await get(origin, target);
            assert.equal(result.status, 404, `${label}: ${where(result)} is 404`);
            assertNoMarker(result);
            assert.ok(!isHtml(result), `${label}: ${where(result)} does not carry content-type: text/html`);
          }
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario Outline: malformed and control-character input is answered cleanly and the
    // server keeps serving. The status is deliberately NOT pinned per row (a NUL byte
    // decodes cleanly and is a missing file, not an escape).
    name: "static-serve/00 malformed and control-character input is answered cleanly — nothing 5xxs, nothing leaks, and every origin keeps serving",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of MALFORMED_ROWS) {
          for (const origin of fixture.origins) {
            const result = await get(origin, target);
            assert.ok(result.status < 500, `${label}: ${where(result)} is not a 5xx (got ${result.status})`);
            assertLeaksNothing(result, fixture.dist);
          }
        }
        await assertStillServing(fixture.origins, { shell: true });
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario: a file that legitimately lives inside the served root is still served on
    // every origin. Without this, a guard that refused everything would pass the rest.
    name: "static-serve/00 the guard refuses ESCAPE, not DEPTH — a nested file genuinely inside the served root is still served on every origin",
    async run() {
      const fixture = await startOrigins();
      try {
        const js = await readFile(path.join(fixture.dist, "assets", "index-abc123.js"));
        const css = await readFile(path.join(fixture.dist, "assets", "index-abc123.css"));
        for (const origin of fixture.origins) {
          const asset = await get(origin, "/assets/index-abc123.js");
          assert.equal(asset.status, 200, `${where(asset)} answers 200`);
          assert.ok(asset.contentType.includes("text/javascript"), `${where(asset)} answers content-type: text/javascript`);
          assert.deepEqual(asset.bytes, js, `${where(asset)} answers the asset's own bytes`);

          const stylesheet = await get(origin, "/assets/index-abc123.css");
          assert.equal(stylesheet.status, 200, `${where(stylesheet)} answers 200`);
          assert.ok(stylesheet.contentType.includes("text/css"), `${where(stylesheet)} answers content-type: text/css`);
          assert.deepEqual(stylesheet.bytes, css, `${where(stylesheet)} answers the stylesheet's own bytes`);
        }
      } finally {
        await fixture.close();
      }
    },
  },
];

// =============================================================================
// task 01 — tasks/01_history-fallback.feature
// =============================================================================

const historyFallbackTests = [
  {
    // Scenario Outline: an extension-less path deep-linked on the board origin serves the
    // app shell instead of 404ing. Every row here answered `404 text/plain` before this
    // story except `/`.
    name: "static-serve/01 an extension-less path deep-linked on the board origin serves the app shell instead of 404ing",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of SHELL_ROWS) {
          const result = await get(fixture.board, target);
          assert.equal(result.status, 200, `${label}: ${where(result)} — status 200`);
          assert.ok(isHtml(result), `${label}: ${where(result)} — content-type: text/html`);
          assert.ok(result.text.includes(ROOT_DIV), `${label}: ${where(result)} — the body contains ${ROOT_DIV}`);
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario: the config-editor origin answers every one of those paths identically to
    // the board origin — the delegation observed, not taken on trust.
    name: "static-serve/01 the config-editor origin answers every one of those paths IDENTICALLY to the board origin",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of SHELL_ROWS) {
          const board = await get(fixture.board, target);
          const config = await get(fixture.config, target);
          assert.equal(board.status, config.status, `${label}: ${target} — the same status on both origins`);
          assert.equal(board.contentType, config.contentType, `${label}: ${target} — the same content-type on both origins`);
          assert.deepEqual(board.bytes, config.bytes, `${label}: ${target} — the same body bytes (a difference means board-serve.mjs:20's delegation has been broken)`);
          assertServesShell(board);
          assertServesShell(config);
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario Outline: the fleet origin serves the app shell for an extension-less path
    // — PINNED, not assumed. Green before this story for the WRONG reason (an
    // unconditional fallback); it must stay green now that it runs through the predicate.
    name: "static-serve/01 the fleet origin serves the app shell for an extension-less path — pinned, not assumed",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of FLEET_SHELL_ROWS) {
          const result = await get(fixture.fleet, target);
          assert.equal(result.status, 200, `${label}: ${where(result)} — status 200`);
          assert.ok(isHtml(result), `${label}: ${where(result)} — content-type: text/html`);
          assert.ok(result.text.includes(ROOT_DIV), `${label}: ${where(result)} — the body contains ${ROOT_DIV}`);
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario Outline: an unknown /api/... path returns the coded API not-found envelope
    // and is NEVER answered with the HTML shell.
    name: "static-serve/01 an unknown /api/... path returns the coded API not-found envelope and is NEVER answered with the HTML shell",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of API_NOT_FOUND_ROWS) {
          for (const origin of fixture.origins) {
            const result = await get(origin, target);
            assert.equal(result.status, 404, `${label}: ${where(result)} — status 404`);
            assertNotTheShell(result);
            const body = JSON.parse(result.text);
            assert.equal(body.ok, false, `${label}: ${where(result)} — the JSON envelope's ok is false`);
            assert.equal(
              body.code,
              "not-found",
              `${label}: ${where(result)} — code "not-found". The extension-less row is the one that would break if the fallback were allowed to run first: only the ordering (the API guard before the static handler, plus shouldServeAppShell's own /api/ refusal) keeps it JSON.`,
            );
          }
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario: a real API route on each origin still answers JSON, unchanged. The
    // regression guard for the row above — refusing unknown /api paths must not cost the
    // real ones.
    name: "static-serve/01 a REAL API route on each origin still answers JSON, unchanged",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const origin of [fixture.board, fixture.config]) {
          const result = await get(origin, "/api/work/list");
          assert.equal(result.status, 200, `${where(result)} — status 200`);
          assert.ok(result.contentType.includes("application/json"), `${where(result)} — content-type: application/json`);
          assert.ok(Array.isArray(JSON.parse(result.text).items), `${where(result)} — the body carries an items array`);
        }

        const status = await get(fixture.fleet, "/api/mesh/status");
        assert.equal(status.status, 200, `${where(status)} — status 200`);
        assert.ok(status.contentType.includes("application/json"), `${where(status)} — content-type: application/json`);
        assert.ok(Array.isArray(JSON.parse(status.text).nodes), `${where(status)} — the body carries a nodes array`);

        // The disjoint fleet face proxies no board.
        const work = await get(fixture.fleet, "/api/work/list");
        assert.equal(work.status, 404, `${where(work)} — still 404 on the fleet face`);
        assert.equal(JSON.parse(work.text).code, "not-found", `${where(work)} — code "not-found"`);
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario Outline: a path whose LAST segment contains a dot is never claimed by the
    // fallback. Rows 1-2 are the rule's accepted price; rows 3-4 discriminate the two
    // natural implementations (`path.extname(".env")` is "" and would serve the shell).
    name: "static-serve/01 a path whose LAST segment contains a dot is never claimed by the fallback (a dotfile is EXTENSIONED and 404s)",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of DOTTED_LAST_SEGMENT_ROWS) {
          for (const origin of fixture.origins) {
            const result = await get(origin, target);
            assert.equal(result.status, 404, `${label}: ${where(result)} — status 404`);
            assertNotTheShell(result);
          }
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario: the shell served for a deep link is byte-identical to the shell served at
    // `/` — the REAL index.html the build produced, script tags and all, never a
    // synthesised page that merely looks like one.
    name: "static-serve/01 the shell served for a deep link is BYTE-IDENTICAL to the shell served at `/`, on every origin",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const origin of fixture.origins) {
          const root = await get(origin, "/");
          const deep = await get(origin, "/some/future/deep/path");
          assert.equal(root.status, 200, `${where(root)} — status 200`);
          assert.equal(deep.status, 200, `${where(deep)} — status 200`);
          assert.ok(isHtml(root) && isHtml(deep), `${origin.name}: both are text/html`);
          assert.deepEqual(deep.bytes, root.bytes, `${origin.name}: the deep link's body is byte-identical to the shell served at /`);
          assert.ok(
            deep.text.includes(SHELL_SCRIPT),
            `${origin.name}: that body carries the built bundle's own ${SHELL_SCRIPT} — the fallback serves the REAL index.html, not a synthesised page`,
          );
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario Outline: a query string does not change the decision, and every legacy
    // advertised URL still serves the shell (the server-side half of the back-compat
    // promise stories 03 and 04 finish in the client).
    name: "static-serve/01 a query string does not change the decision — every legacy advertised URL still serves the shell on every origin",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of LEGACY_URL_ROWS) {
          for (const origin of fixture.origins) {
            const result = await get(origin, target);
            assert.equal(result.status, 200, `${label}: ${where(result)} — status 200`);
            assert.ok(isHtml(result), `${label}: ${where(result)} — content-type: text/html`);
            assert.ok(result.text.includes(ROOT_DIV), `${label}: ${where(result)} — the body contains ${ROOT_DIV}`);
          }
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario: a bundle with no index.html is a friendly 404 on every origin, never a
    // blank 200 — the same masking failure as a missing asset, one level up.
    //
    // HOW THIS IS STAGED, and why. `serveBoard` and `serveMeshUi` both PRE-CHECK for
    // index.html and refuse to start without it (`code: "ui-build-missing"`), so a
    // shell-less bundle cannot be served from a cold start on those two origins at all.
    // That refusal is itself the loud answer the scenario is about, so it is asserted
    // FIRST; the runtime half — the bundle losing its index.html under a running server,
    // which is the only way the handler's own fallback path is reachable — is then
    // exercised by deleting the file from the live root. Both halves are pinned, so
    // neither the precheck nor the handler can quietly stop being loud.
    name: "static-serve/01 a bundle with no index.html is a friendly 404 on every origin, never a blank 200 (and the ui-build-missing precheck stays loud)",
    async run() {
      // (a) the cold-start precheck: a repoRoot whose ui/dist has assets but no shell.
      const emptyRoot = await mkdtemp(path.join(os.tmpdir(), "aof-static-serve-noshell-"));
      const repo = await makeRepo();
      try {
        await mkdir(path.join(meshUiDist(emptyRoot), "assets"), { recursive: true });
        await writeFile(path.join(meshUiDist(emptyRoot), "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
        for (const [label, start] of [["serveBoard", serveBoard], ["serveMeshUi", serveMeshUi]]) {
          let refused;
          try {
            await start({ projectDir: repo, port: 0, repoRoot: emptyRoot, spawn: stubSpawn(), recordSessions: false });
          } catch (error) {
            refused = error;
          }
          assert.ok(refused, `${label} refuses to serve a bundle with no index.html`);
          assert.equal(refused.code, "ui-build-missing", `${label}'s refusal carries the ui-build-missing code — a missing build is LOUD`);
        }
      } finally {
        await rm(emptyRoot, { recursive: true, force: true });
        await rm(repo, { recursive: true, force: true });
      }

      // (b) the runtime half: the shell disappears from under a running server.
      const fixture = await startOrigins();
      try {
        await unlink(path.join(fixture.dist, "index.html"));
        for (const target of ["/", "/board", "/some/future/deep/path"]) {
          for (const origin of fixture.origins) {
            const result = await get(origin, target);
            assert.equal(result.status, 404, `${where(result)} — status 404 with no index.html on disk`);
            assert.ok(!(result.status === 200 && result.bytes.length === 0), `${where(result)} is never a 200 with an empty body`);
            // Each origin keeps its OWN established envelope.
            assertNotFoundEnvelope(result);
          }
        }
        // The missing shell did not take the assets with it.
        await assertStillServing(fixture.origins);
      } finally {
        await fixture.close();
      }
    },
  },
];

// =============================================================================
// task 02 — tasks/02_missing-asset-still-404s.feature
// =============================================================================

const missingAssetTests = [
  {
    // Scenario Outline: a request for a bundle file that does not exist returns 404 on
    // the board and config-editor origins. The BASELINE the new fallback must not move.
    name: "static-serve/02 a request for a bundle file that does not exist returns 404 on the board and config-editor origins",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of MISSING_FILE_ROWS) {
          for (const origin of [fixture.board, fixture.config]) {
            const result = await get(origin, target);
            assert.equal(result.status, 404, `${label}: ${where(result)} — status 404`);
            assertNotTheShell(result);
          }
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario Outline: the identical request returns 404 on the FLEET origin — the
    // deliberate narrowing. EVERY row here answered `200 text/html` with the app shell on
    // this origin before this story (measured 2026-08-06 at `eacbd57`).
    name: "static-serve/02 the identical request returns 404 on the FLEET origin — the unconditional fallback is narrowed by the same predicate",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target] of MISSING_FILE_ROWS) {
          const result = await get(fixture.fleet, target);
          assert.equal(
            result.status,
            404,
            `${label}: ${where(result)} — status 404, NOT 200. Before m45/ADR-004 this answered 200 text/html with the app shell, so a deploy that shipped without its JavaScript arrived as "Uncaught SyntaxError: Unexpected token '<'" in the console, arbitrarily far from its cause.`,
          );
          assertNotTheShell(result);
          const body = JSON.parse(result.text);
          assert.equal(body.ok, false, `${label}: ${where(result)} — the envelope's ok is false`);
          assert.equal(body.code, "not-found", `${label}: ${where(result)} — the envelope's code is "not-found"`);
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario Outline: an asset that DOES exist is still served as itself, with its own
    // content type, on every origin. A rule that 404'd everything would pass the two
    // scenarios above.
    name: "static-serve/02 an asset that DOES exist is still served as itself, with its own content type and its own bytes, on every origin",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target, expectedType] of EXISTING_ASSET_ROWS) {
          const onDisk = await readFile(path.join(fixture.dist, target.slice(1)));
          for (const origin of fixture.origins) {
            const result = await get(origin, target);
            assert.equal(result.status, 200, `${label}: ${where(result)} — status 200`);
            assert.ok(result.contentType.includes(expectedType), `${label}: ${where(result)} — content-type: ${expectedType} (got ${result.contentType})`);
            assert.deepEqual(result.bytes, onDisk, `${label}: ${where(result)} — the body is the file's own bytes, byte-identical to the file on disk`);
            if (target.startsWith("/assets/")) {
              assert.ok(!isHtml(result), `${label}: ${where(result)} — an /assets/ row is never HTML on any origin`);
            }
          }
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario: a deploy that shipped without its JavaScript fails at the ASSET, not at
    // the shell — the operator's actual experience of the bug, walked end to end, and the
    // one scenario that shows the fallback and the 404 rule working TOGETHER.
    name: "static-serve/02 a deploy that shipped without its JavaScript fails at the ASSET, not at the shell — on all three origins",
    async run() {
      const fixture = await startOrigins();
      try {
        await unlink(path.join(fixture.dist, "assets", "index-abc123.js"));
        for (const origin of fixture.origins) {
          const shell = await get(origin, "/board");
          assert.equal(shell.status, 200, `${where(shell)} — the shell still renders (status 200)`);
          assert.ok(isHtml(shell), `${where(shell)} — content-type: text/html`);
          assert.ok(shell.text.includes(ROOT_DIV), `${where(shell)} — the body contains ${ROOT_DIV}`);

          // The `src` the shell's OWN <script type="module"> names — read out of the body
          // that was just served, not hard-coded, so this really is the operator's walk.
          const src = shell.text.match(/<script[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/)?.[1];
          assert.ok(src, `${where(shell)} — the served shell names a module script src`);

          const asset = await get(origin, src);
          assert.equal(
            asset.status,
            404,
            `${where(asset)} — the missing script is 404. Before this story the fleet origin answered 200 text/html here, which is what turns a missing file into "Uncaught SyntaxError: Unexpected token '<'" in a console with no line of sight to the deploy.`,
          );
          assertNotTheShell(asset);
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario: a request for a directory is never a listing on any origin. Guards
    // against the other way a static handler leaks. (What these paths DO answer — the app
    // shell, because they are extension-less — is task 01's scenario 1.)
    name: "static-serve/02 a request for a directory is never a LISTING on any origin",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const target of ["/assets", "/assets/"]) {
          for (const origin of fixture.origins) {
            const result = await get(origin, target);
            assert.ok(!result.text.includes("decoy-9f9f.js"), `${where(result)} — the body never names the unreferenced file decoy-9f9f.js`);
            assert.ok(!result.contentType.includes("application/octet-stream"), `${where(result)} — never content-type: application/octet-stream`);
            assert.ok(result.status < 500, `${where(result)} — never a 5xx (got ${result.status})`);
          }
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario Outline: a missing asset cannot dodge the 404 by percent-encoding its
    // extension. `new URL()` does NOT decode `%2E`, so a predicate reading the RAW
    // pathname sees no dot, calls this extension-less and answers the app shell — the
    // masking guard bypassed by an encoding. The rule is applied to the path the server
    // actually RESOLVED (ADR-004's discriminator, decoded), which is what closes it.
    name: "static-serve/02 a missing asset cannot dodge the 404 by percent-encoding its extension",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const [label, target, literal] of ENCODED_DOT_ROWS) {
          for (const origin of fixture.origins) {
            const encoded = await get(origin, target);
            assert.equal(encoded.status, 404, `${label}: ${where(encoded)} — status 404`);
            assertNotTheShell(encoded);
            // …and the control: the same request with a literal dot.
            const control = await get(origin, literal);
            assert.equal(control.status, 404, `${label}: ${where(control)} — the literal-dot control also answers 404`);
            assertNotTheShell(control);
          }
        }
      } finally {
        await fixture.close();
      }
    },
  },

  {
    // Scenario: a run of misses leaves every origin serving normally — the house's "the
    // server survived" check.
    name: "static-serve/02 a run of misses leaves every origin serving normally",
    async run() {
      const fixture = await startOrigins();
      try {
        for (const origin of fixture.origins) {
          for (const [label, target] of MISSING_FILE_ROWS) {
            const result = await get(origin, target);
            assert.ok(result.status < 500, `${label}: ${where(result)} — never a 5xx (got ${result.status})`);
          }
        }
        await assertStillServing(fixture.origins, { shell: true });
      } finally {
        await fixture.close();
      }
    },
  },
];

export const staticServeFallbackTests = [
  ...traversalGuardTests,
  ...historyFallbackTests,
  ...missingAssetTests,
];
