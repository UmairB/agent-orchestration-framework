// Fitness function: acd-enroll-endpoint-http-not-ws (milestone 24, ADR-002 / structural
// fitness — the architect's). "The enrollment endpoint keeps the ws envelope
// payload-agnostic."
//
//   "Device-code enrollment is an HTTP route on serveRelay's EXISTING http.createServer
//    (03/ADR-001 — ONE server; the enrollment route slots above the terse 426 fallback),
//    NOT a new ws `kind`. The frozen ws { kind, nodeId, signal } envelope (23/ADR-001)
//    stays payload-agnostic: parseEnvelope / the wss message handler branch on NO
//    enrollment `kind` (no `kind === 'enroll'|'join'|'invite'`), so m26 leasing still
//    adds a `kind` with ZERO relay change (the 22/ADR-004 / 23/ADR-001 forward-stable
//    property). The enrollment match/admit logic, when present, lives in the
//    http.createServer request handler, NOT the wss.on('connection') message path."
//
// This preserves the milestone-23 invariant that the relay never parses signal CONTENT.
// An enrollment ws `kind` would make the relay import + branch on an enrollment payload —
// the exact anti-pattern 23/ADR-001's fitness #2 (acd-relay-envelope-neutral) forbids for
// presence, re-applied to enrollment. Enrollment is a discrete request/response (HTTP),
// not an ephemeral broadcast frame (ws).
//
// Source-discipline grep modelled on acd-relay-envelope-neutral (comment-AND-string-
// stripped live code for the kind-branch matcher; the http/ws handler split read
// structurally). Each proof carries an m03 non-vacuous self-check (the detector fires on a
// planted ws enrollment kind, stays quiet on the accepted HTTP-route form).
//
// State: GREEN today (m23's src/mesh-relay.mjs has no enrollment surface at all — the ws
// envelope is neutral, the http handler only 426s), STILL GREEN when story 01 adds the
// HTTP enrollment route (the route is on the http handler, the ws envelope is untouched),
// and RED only if enrollment is ever put on a ws `kind`. That is the correct lifecycle for
// a payload-agnostic-preservation gate: it guards against the WRONG shape, not the absence
// of the right one.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_RELAY = path.join(repoRoot, "src", "mesh-relay.mjs");

function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i += 1; continue; }
    if (state === "block") { if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i += 1; continue; }
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; i += 1; continue; }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}

// KEEP strings — the ws message handler branches on a `kind` STRING literal, so the
// forbidden form is `kind === "enroll"` etc. with the literal retained.
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// A ws-envelope `kind` branch on an ENROLLMENT verb — the forbidden form (enrollment must
// not ride the ws envelope). Matches `kind === "enroll"` / `value.kind === "join"` /
// `=== "invite"` and the switch-case `case "enroll":` forms.
const WS_ENROLL_KIND = /\bkind\s*===\s*["'](?:enroll|enrollment|join|invite)["']|\bcase\s+["'](?:enroll|enrollment|join|invite)["']\s*:/;

// The wss connection/message handler body — where the ws envelope is parsed. The
// enrollment kind-branch must NOT appear here (it must be on the http request handler).
function wssMessageRegion(source) {
  // From the wss.on("connection" registration to the end of file — the ws message path.
  const start = source.search(/wss\.on\s*\(\s*["']connection["']/);
  if (start === -1) return "";
  return source.slice(start);
}

// The http.createServer request-handler region — the legitimate host for the enrollment
// route (03/ADR-001: ONE server, the route above the 426 fallback).
function httpHandlerRegion(source) {
  const start = source.search(/http\.createServer\s*\(/);
  if (start === -1) return "";
  // Up to the wss.on("connection") (the ws path begins there) — a coarse but sufficient
  // split of the two handlers for the structural read.
  const wssAt = source.search(/wss\.on\s*\(\s*["']connection["']/);
  return wssAt > start ? source.slice(start, wssAt) : source.slice(start);
}

export const archTests = [
  {
    name: "arch/enroll-endpoint-http-not-ws: the relay's ws envelope stays payload-agnostic — parseEnvelope / the wss message handler branch on NO enrollment `kind` (enrollment is HTTP, not a ws kind)",
    run: async () => {
      const withStrings = stripCommentsOnly(await readFile(MESH_RELAY, "utf8"));
      const wsRegion = wssMessageRegion(withStrings);
      // The ws message path exists (m23's broker) — assert it, so the region read is real,
      // not an empty vacuous pass.
      assert.ok(wsRegion.length > 0, "src/mesh-relay.mjs has a wss.on('connection') message path (the m23 broker)");
      assert.ok(
        !WS_ENROLL_KIND.test(wsRegion),
        "the ws message handler branches on NO enrollment `kind` (kind === 'enroll'/'join'/'invite') — enrollment must NOT ride the frozen { kind, nodeId, signal } ws envelope; it is an HTTP route (ADR-2). A ws enrollment kind would make the relay parse an enrollment payload, breaking the 23/ADR-001 payload-agnostic property (m26 leasing must add a kind with zero relay change)."
      );
      // Self-checks (non-vacuous): the matcher FIRES on a planted ws enrollment kind and
      // stays QUIET on the legitimate presence kind + the accepted http-route text.
      assert.ok(WS_ENROLL_KIND.test('if (envelope.kind === "enroll") { admit(); }'), "the matcher fires on a planted ws enroll kind");
      assert.ok(WS_ENROLL_KIND.test('case "join":'), "the matcher fires on a planted switch-case join kind");
      assert.ok(!WS_ENROLL_KIND.test('if (envelope.kind === "presence") { fanOut(); }'), "the matcher does NOT fire on the legitimate presence kind");
      assert.ok(!WS_ENROLL_KIND.test('response.writeHead(200); // POST /enroll route'), "the matcher does NOT fire on a documented http route mention");
    },
  },
  {
    name: "arch/enroll-endpoint-http-not-ws: an enrollment surface, when present, lives in the http.createServer request handler (an HTTP route), not the ws message path",
    run: async () => {
      const withStrings = stripCommentsOnly(await readFile(MESH_RELAY, "utf8"));
      const httpRegion = httpHandlerRegion(withStrings);
      const wsRegion = wssMessageRegion(withStrings);
      assert.ok(httpRegion.length > 0, "src/mesh-relay.mjs has an http.createServer request handler (03/ADR-001 — ONE server)");

      // Whether an enrollment surface exists yet (RED-until-built: m23 has none — the loop
      // is vacuously satisfied; story 01 adds the /enroll route to the http handler).
      const ENROLL_ROUTE_TOKEN = /["'`]\/?enroll["'`]|enrollRoute|handleEnroll|deviceFlow|verifyCode\s*\(|consumePending\s*\(/;
      const inHttp = ENROLL_ROUTE_TOKEN.test(httpRegion);
      const inWs = ENROLL_ROUTE_TOKEN.test(wsRegion);

      // The invariant: if an enrollment surface is present at all, it is in the HTTP
      // handler and NOT in the ws message path. (When neither region has it yet — the m23
      // state — both are false and the invariant holds vacuously, the RED-until-built
      // discipline; the ws-kind gate above is the always-live half.)
      assert.ok(
        !inWs,
        "no enrollment surface (enroll route / verifyCode / consumePending) appears in the ws message path — enrollment is an HTTP route on the http.createServer handler, never the wss.on('connection') path (ADR-2)"
      );
      if (inHttp || inWs) {
        assert.ok(inHttp && !inWs, "the enrollment surface lives on the HTTP request handler, not the ws message path");
      }

      // Self-check (non-vacuous): the enroll-route token matcher DOES fire on a planted
      // route, and the http/ws region split is real (both regions found, distinct).
      assert.ok(ENROLL_ROUTE_TOKEN.test('if (request.url === "/enroll") { handleEnroll(request, response); }'), "the enroll-route matcher fires on a planted /enroll route");
      assert.ok(wsRegion.length > 0 && httpRegion.length > 0 && httpRegion !== wsRegion, "the http and ws regions are found and distinct");
    },
  },
];
