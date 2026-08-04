// Traceability wiring for milestone 25 / story 00 / task 01 —
// 01_board-serves-unchanged.feature (@cli @work @board @executable).
//
// ADR-001 decision 2: the frozen /api/work envelope is UNTOUCHED by the rename. This
// file proves the OBSERVABLE serve: launched under the renamed verb (aof work ui →
// workUiCommand → serveBoard → serveSetupUi), milestone 03's board answers
// byte-identically — the EIGHT frozen /api/work routes (7 GET reads: list / doc /
// tasks / run-status / validate / doctor / next, + POST feedback), the same-origin
// static bundle + terminal WS on the one 127.0.0.1 port, and the frozen error
// envelope (not-found 404, ref-not-found 404, empty/malformed-json 400,
// payload-too-large 413 at the >1_000_000-byte cap).
//
// We exercise the REAL server the renamed verb launches: serveBoard(...) is exactly
// what workUiCommand dispatches to (cli.mjs), so standing it up in-process against a
// temp fixture is the faithful "launched by aof work ui" board. serveBoard resolves
// ui/dist against the given repoRoot; we point it at the aof repo root so the built
// bundle is present (mirrors board-serve.test.mjs's serveBoard harness). The frozen
// envelope assertions mirror board-face-contract.test.mjs (the m08 byte-for-byte
// oracle) — this is a rename-parity check over the SAME envelope, not a re-derivation.
import assert from "node:assert/strict";
import { assertFrozenShape } from "./support/answering-side.mjs";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { serveBoard } from "../src/board-serve.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A repo whose .aof/aof.config.json points work.dir at wiki/work, with milestone 03
// (+ story 03/01 with a STATE.md feedback heading + a task feature) so every frozen
// route has something to read and the feedback write has a landing target.
async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-work-ui-serves-"));
  const workDir = path.join(root, "wiki", "work");
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  const mDir = path.join(workDir, "03_milestone_board");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: \"03\"\nslug: board\nstatus: in-progress\ntitle: \"Board\"\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n# 03\n",
    "utf8"
  );
  const sDir = path.join(mDir, "stories", "01_story_board");
  await mkdir(path.join(sDir, "tasks"), { recursive: true });
  await writeFile(
    path.join(sDir, "STORY.md"),
    "---\ntype: story\nnumber: \"01\"\nslug: board\nstatus: in-progress\ntitle: \"Board\"\nparent: 3\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n# 01\n",
    "utf8"
  );
  await writeFile(
    path.join(sDir, "STATE.md"),
    "# 01 · State\n\n## Feedback (for retro)\n\n",
    "utf8"
  );
  await writeFile(
    path.join(sDir, "tasks", "00_routes.feature"),
    "@executable\nFeature: routes\n\n  Scenario: serves\n    Given x\n",
    "utf8"
  );
  return { root, workDir, storyDir: sDir };
}

// A stub spawn so a /ws/terminal handshake completes without touching node-pty.
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

// Stand up the board the renamed verb launches (serveBoard, the workUiCommand target),
// run the body against its base URL, and always close the server.
async function withBoard(root, body, { spawn } = {}) {
  const { server, url } = await serveBoard({
    projectDir: root,
    port: 0,
    repoRoot,
    spawn,
    recordSessions: false,
  });
  try {
    return await body({ url, server });
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

function openSocket(wsUrl, { timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      reject(new Error("WS handshake timed out"));
    }, timeoutMs);
    ws.on("open", () => { clearTimeout(timer); resolve(ws); });
    ws.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

// Pull the feedback bullets from under the "## Feedback (for retro)" heading.
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

export const workUiBoardServesUnchangedTests = [
  // Scenario Outline: the seven frozen /api/work GET routes answer unchanged through
  // aof work ui — each with its own frozen success envelope shape.
  {
    name: "work-ui-board-serves-unchanged/01 the seven frozen /api/work GET routes answer their unchanged envelopes through aof work ui",
    async run() {
      const { root } = await makeFixture();
      try {
        await withBoard(root, async ({ url }) => {
          // list → the `{ items, stalenessSeconds }` envelope whose rows are the flat
          // ListRow[] carrying the 7 contract fields. m43 / story 04 (ADR-010/R4.1) added
          // the envelope so the cache-staleness window is stated once per response instead
          // of being duplicated per row or defaulted in the client. This file's subject —
          // that `aof work ui` serves the SAME board face as `aof work board` ever did — is
          // unmoved: the row shape below is byte-identical and the change is on the route
          // for both callers alike.
          const list = await getJson(url, "/api/work/list");
          assert.equal(list.status, 200, "list answers 200");
          assert.equal(typeof list.body.stalenessSeconds, "number", "the envelope states the window once");
          const listRows = list.body.items;
          assert.ok(Array.isArray(listRows), "the list rows are a flat JSON array (the m03 row envelope)");
          // m43 / story 06 (ADR-005 rule 3) — the seven frozen fields are all still present and
          // unrenamed; the answering-side stamp is the only permitted addition (ADR-014/E1).
          const expected = ["ref", "type", "slug", "status", "title", "parent", "dir"];
          for (const item of listRows) {
            assertFrozenShape(item, expected, `${item.ref} carries the 7 contract fields`);
          }
          assert.ok(listRows.some((r) => r.ref === "03"), "milestone 03 present");
          assert.ok(listRows.some((r) => r.ref === "03/01"), "story 03/01 present");

          // doc → { ref, doc, present, body } with the verbatim SPEC.md body.
          const doc = await getJson(url, "/api/work/doc?ref=03&doc=SPEC");
          assert.equal(doc.status, 200, "doc answers 200");
          assertFrozenShape(doc.body, ["body", "doc", "present", "ref"], "the frozen doc envelope keys");
          assert.equal(doc.body.ref, "03");
          assert.equal(doc.body.present, true);

          // tasks → { ref, tasks } with the parsed feature counts.
          const tasks = await getJson(url, "/api/work/tasks?ref=03/01");
          assert.equal(tasks.status, 200, "tasks answers 200");
          assertFrozenShape(tasks.body, ["ref", "tasks"], "the frozen tasks envelope keys");
          assert.equal(tasks.body.ref, "03/01");
          assert.equal(tasks.body.tasks.length, 1, "the one seeded feature");
          assert.equal(tasks.body.tasks[0].file, "00_routes.feature");

          // run-status → the m21 read route (carried forward, not forked).
          const runStatus = await getJson(url, "/api/work/run-status?ref=03");
          assert.equal(runStatus.status, 200, "run-status answers 200 (the m21 read route carried forward)");
          assert.ok(runStatus.body && typeof runStatus.body === "object", "run-status returns an object envelope");

          // validate → { findings }, a clean stream → empty findings.
          const validate = await getJson(url, "/api/work/validate");
          assert.equal(validate.status, 200, "validate answers 200");
          assert.deepEqual(Object.keys(validate.body), ["findings"], "a { findings } envelope");
          assert.ok(Array.isArray(validate.body.findings), "findings is an array");

          // doctor → the diagnostic envelope (200, an object).
          const doctor = await getJson(url, "/api/work/doctor");
          assert.equal(doctor.status, 200, "doctor answers 200");
          assert.ok(doctor.body && typeof doctor.body === "object", "doctor returns an object envelope");

          // next → the NextResult envelope carrying a state.
          const next = await getJson(url, "/api/work/next");
          assert.equal(next.status, 200, "next answers 200");
          assert.ok(typeof next.body.state === "string", "next carries a state (the NextResult envelope)");
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: the feedback POST answers unchanged and still lands the one attributed
  // bullet (the board's ONE write — 03/ADR-004 — carried through the rename).
  {
    name: "work-ui-board-serves-unchanged/01 the feedback POST answers unchanged and lands the one attributed bullet through aof work ui",
    async run() {
      const { root, storyDir } = await makeFixture();
      try {
        await withBoard(root, async ({ url }) => {
          const { status, body } = await postJson(url, "/api/work/feedback", {
            ref: "03/01",
            note: "a note",
            actor: "qa",
          });
          assert.equal(status, 200, "feedback answers 200");
          assert.equal(body.ok, true, "{ ok:true } — the frozen success envelope");
          assert.ok(typeof body.bullet === "string" && body.bullet.length > 0, "carries the appended bullet");

          const stateText = await readFile(path.join(storyDir, "STATE.md"), "utf8");
          const bullets = bulletsUnderHeading(stateText);
          assert.equal(bullets.length, 1, "exactly one attributed bullet lands");
          assert.equal(bullets[0], body.bullet, "the returned bullet is the appended line");
          assert.equal(bullets[0], "- a note — Raised by: qa", "the one attributed feedback bullet");
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: the static bundle, the API, and the terminal websocket share the one
  // origin (03/ADR-001 — one 127.0.0.1 port answers all three, no second server).
  {
    name: "work-ui-board-serves-unchanged/01 the static bundle, an /api/work route, and /ws/terminal share the one 127.0.0.1 origin",
    async run() {
      const { root } = await makeFixture();
      try {
        await withBoard(root, async ({ url, server }) => {
          const port = server.address().port;

          // The static bundle serves on the origin.
          const page = await fetch(new URL("/", url));
          assert.equal(page.status, 200, "the board page serves on the origin");

          // An /api/work route answers on the SAME origin.
          const api = await fetch(new URL("/api/work/list", url));
          assert.equal(api.status, 200, "the /api/work route answers on the same origin");

          // The terminal WS handshake opens on the SAME port.
          const ws = await openSocket(`ws://127.0.0.1:${port}/ws/terminal?ref=03&provider=claude`);
          assert.equal(ws.readyState, WebSocket.OPEN, "the /ws/terminal handshake opens on the same port");
          await new Promise((resolve) => { ws.on("close", resolve); ws.close(); });

          // All three resolved on the one 127.0.0.1 port — the URL host confirms it.
          assert.ok(url.startsWith(`http://127.0.0.1:${port}`), `the one origin is 127.0.0.1:${port} (no second server or port)`);
        }, { spawn: stubSpawn() });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: an unknown /api/work route answers the frozen not-found envelope,
  // byte-identical to board-ui.mjs:154.
  {
    name: "work-ui-board-serves-unchanged/01 an unknown /api/work route answers the frozen not-found envelope",
    async run() {
      const { root } = await makeFixture();
      try {
        await withBoard(root, async ({ url }) => {
          const { status, body } = await getJson(url, "/api/work/does-not-exist");
          assert.equal(status, 404, "an unknown route is a 404");
          assert.deepEqual(
            body,
            { ok: false, error: "Work API route not found.", code: "not-found" },
            "the frozen not-found envelope, byte-identical"
          );
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario Outline: the frozen error envelope + status mapping carry through the
  // renamed verb — ref-not-found 404, empty-json 400, malformed-json 400,
  // payload-too-large 413 (body byte-length STRICTLY > 1_000_000).
  {
    name: "work-ui-board-serves-unchanged/01 the frozen { ok:false, error, code } envelope + status mapping carry through aof work ui",
    async run() {
      const { root } = await makeFixture();
      try {
        await withBoard(root, async ({ url }) => {
          // ref-not-found: a GET of /api/work/doc for a ref that resolves to no item.
          const refNotFound = await getJson(url, "/api/work/doc?ref=99&doc=SPEC");
          assert.equal(refNotFound.status, 404, "an unresolved ref → 404");
          assert.deepEqual(Object.keys(refNotFound.body).sort(), ["code", "error", "ok"], "exactly { ok, error, code }");
          assert.equal(refNotFound.body.ok, false);
          assert.equal(refNotFound.body.code, "ref-not-found");

          // empty-json: a POST to /api/work/feedback with an empty body.
          const emptyJson = await postJson(url, "/api/work/feedback", null, { raw: "" });
          assert.equal(emptyJson.status, 400, "an empty body → 400");
          assert.equal(emptyJson.body.ok, false);
          assert.equal(emptyJson.body.code, "empty-json");

          // malformed-json: a POST to /api/work/feedback with a malformed JSON body.
          const malformed = await postJson(url, "/api/work/feedback", null, { raw: "{not json" });
          assert.equal(malformed.status, 400, "a malformed JSON body → 400");
          assert.equal(malformed.body.ok, false);
          assert.equal(malformed.body.code, "malformed-json");

          // payload-too-large: a body STRICTLY over 1_000_000 bytes → 413.
          const oversized = JSON.stringify({ ref: "03/01", note: "x".repeat(1_000_001) });
          const tooLarge = await postJson(url, "/api/work/feedback", null, { raw: oversized });
          assert.equal(tooLarge.status, 413, "a body over 1,000,000 bytes → 413");
          assert.equal(tooLarge.body.ok, false);
          assert.equal(tooLarge.body.code, "payload-too-large");
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
