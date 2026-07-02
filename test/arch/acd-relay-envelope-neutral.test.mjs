// Fitness function: acd-relay-envelope-neutral (milestone 23 / story 01 / ADR-001 /
// fitness #2) — "Relay envelope is payload-agnostic."
//
//   "The relay (src/mesh-relay.mjs) does NOT import the presence/node-record schema to
//    parse signal CONTENT — a new signal `kind` (leasing, m26) needs ZERO relay change:
//    it imports neither mesh-presence.mjs nor node-identity.mjs / the presence schema,
//    performs no JSON.parse-then-branch on a signal's CONTENT (it forwards the opaque
//    `signal` blob), and frames a malformed/oversized input as the frozen { type:'error' }
//    control-frame, never a throw (the 03/ADR-003 discipline)."
//
// Source-discipline grep modelled on acd-mesh-sync-record-neutral. Four proofs:
//   (a) ENVELOPE-NEUTRAL IMPORT: src/mesh-relay.mjs imports neither mesh-presence.mjs nor
//       node-identity.mjs / mesh-store.mjs (the record/presence schema).
//   (b) NO SIGNAL-CONTENT BRANCH: the inbound message handler reads only { kind, nodeId }
//       for routing — it NEVER reads/branches on a `.signal` field (the opaque blob is
//       forwarded by re-emitting the original frame, never parsed-then-rewritten).
//   (c) THE FROZEN ERROR CONTROL-FRAME EXISTS: the module emits a frozen
//       { type:'error', message } control-frame (the 03/ADR-003 shape) for a bad frame.
//   (d) NEVER A THROW ON A BAD FRAME (behavioural): an in-process serveRelay framed a
//       malformed AND an oversized input as the { type:'error' } control-frame to the
//       sender — the broker process did NOT throw/crash.
//
// Non-vacuous: each source matcher is self-checked against the forbidden/accepted forms.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { serveRelay } from "../../src/mesh-relay.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_RELAY = path.join(repoRoot, "src", "mesh-relay.mjs");

function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

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

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

// --- an in-process ws harness for the behavioural proof (d) -------------------

function openClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames = [];
    let joined = false;
    let resolved = false;
    const timer = setTimeout(() => { if (!resolved) { resolved = true; reject(new Error("ws ack timeout")); } }, 3000);
    ws.on("message", (data) => {
      const text = data.toString();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* raw */ }
      if (parsed && parsed.type === "joined" && !joined) {
        joined = true;
        if (!resolved) { resolved = true; clearTimeout(timer); resolve({ ws, frames }); }
        return;
      }
      frames.push({ text, parsed });
    });
    ws.on("error", (error) => { if (!resolved) { resolved = true; clearTimeout(timer); reject(error); } });
  });
}

function waitFor(predicate, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timeout"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

export const archTests = [
  {
    name: "arch/relay-envelope-neutral: src/mesh-relay.mjs imports NEITHER mesh-presence.mjs NOR node-identity.mjs / the presence schema (a new kind needs zero relay change)",
    run: async () => {
      const specs = importSpecifiers(stripCommentsOnly(await readFile(MESH_RELAY, "utf8")));
      const importsSchema = specs.some(
        (s) =>
          /(^|\/)mesh-presence\.mjs$/.test(s) ||
          /(^|\/)node-identity\.mjs$/.test(s) ||
          /(^|\/)mesh-store\.mjs$/.test(s) ||
          /(^|\/)mesh-identity\.mjs$/.test(s)
      );
      assert.equal(
        importsSchema,
        false,
        `src/mesh-relay.mjs imports NEITHER the presence schema NOR the node-record schema; the envelope is payload-agnostic. imports: ${specs.join(", ")}`
      );
      // Self-check (non-vacuous).
      assert.ok(
        importSpecifiers('import { assemblePresenceRecord } from "./mesh-presence.mjs";').some((s) => /mesh-presence\.mjs$/.test(s)),
        "the reader catches a real mesh-presence.mjs import"
      );
    },
  },
  {
    name: "arch/relay-envelope-neutral: src/mesh-relay.mjs never reads/branches on a signal's CONTENT (it routes by { kind, nodeId } and forwards the opaque signal blob unparsed)",
    run: async () => {
      const source = await readFile(MESH_RELAY, "utf8");
      // The relay must NOT read a `signal` field off a parsed frame — neither via DOT
      // access (`value.signal`) NOR BRACKET access (`value["signal"]` / `value['signal']`).
      // Either would be the parse-then-branch-on-content the payload-agnostic property
      // forbids; a future regression that reaches the blob via bracket access must be
      // caught too.
      //
      // The two forms need DIFFERENT strip levels, or one matcher would be vacuous:
      //   - DOT access (`.signal`) is checked against the strings-AND-comments-stripped
      //     source, so a documented `.signal` mention inside a comment/string is NOT a
      //     false positive.
      //   - BRACKET access (`["signal"]`) keys the field via a STRING LITERAL, so it must
      //     be checked against the comments-stripped-only source (strings preserved) — were
      //     it checked against the strings-stripped source the "signal" key would be gone
      //     and the matcher could never fire (the false-comfort trap). A bracket access
      //     surviving in real code is the genuine regression we want to catch.
      const liveCode = stripCommentsAndStrings(source);
      const codeWithStrings = stripCommentsOnly(source);
      const dotAccess = /\.\s*signal\b/;
      const bracketAccess = /\[\s*["']signal["']\s*\]/;
      assert.ok(
        !dotAccess.test(liveCode),
        "src/mesh-relay.mjs reads NO `.signal` field via dot access (it forwards the opaque blob by re-emitting the original frame, never parsing signal content)"
      );
      assert.ok(
        !bracketAccess.test(codeWithStrings),
        "src/mesh-relay.mjs reads NO `signal` field via bracket access (value['signal'] / value[\"signal\"]) — the opaque blob is never keyed out and branched on"
      );
      // Self-check (non-vacuous): EACH matcher FIRES on its real signal-content branch and
      // does NOT fire on a documented mention — so the guard still fires on a real violation
      // and passes on the current relay, which has zero live `signal` access of either form.
      assert.ok(dotAccess.test("if (envelope.signal.kind === 'presence') {}"), "the dot guard catches a real .signal content branch");
      assert.ok(bracketAccess.test('if (envelope["signal"].kind === "presence") {}'), 'the bracket guard catches a real ["signal"] (double-quote) content branch');
      assert.ok(bracketAccess.test("if (envelope['signal'].kind === 'presence') {}"), "the bracket guard catches a real ['signal'] (single-quote) content branch");
      assert.ok(bracketAccess.test('if (envelope[ "signal" ].kind) {}'), "the bracket guard tolerates whitespace inside the brackets");
      assert.ok(
        !dotAccess.test(stripCommentsAndStrings('// signal is the opaque blob the relay forwards without parsing')),
        "the dot guard does NOT fire on a documented mention of signal (comment stripped)"
      );
      assert.ok(
        !bracketAccess.test(stripCommentsOnly('// value["signal"] is never read — the blob is opaque')),
        "the bracket guard does NOT fire on a documented mention inside a comment (comment stripped)"
      );
    },
  },
  {
    name: "arch/relay-envelope-neutral: src/mesh-relay.mjs frames a bad input as the FROZEN { type:'error', message } control-frame (the 03/ADR-003 shape)",
    run: async () => {
      const src = stripCommentsOnly(await readFile(MESH_RELAY, "utf8"));
      // The frozen error control-frame: a { type: "error", message } object literal.
      assert.ok(
        /type\s*:\s*["']error["']/.test(src),
        "src/mesh-relay.mjs emits a frozen { type:'error', … } control-frame for a bad frame"
      );
      assert.ok(
        /message\s*:/.test(src),
        "the error control-frame carries a message field ({ type:'error', message })"
      );
    },
  },
  {
    name: "arch/relay-envelope-neutral: a malformed AND an oversized frame each yield the { type:'error' } control-frame to the sender — the broker process does not throw/crash (behavioural)",
    run: async () => {
      // A tiny max-frame so "oversized" is cheap to reach.
      const relay = await serveRelay({ port: 0, config: { mesh: { relay: { maxFrameBytes: 64 } } } });
      let sender;
      try {
        sender = (await openClient(relay.url)).ws;

        // (1) A malformed (non-envelope) frame → the frozen error control-frame.
        const malformedFrames = [];
        sender.on("message", (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed && parsed.type === "error") malformedFrames.push(parsed);
          } catch { /* raw */ }
        });
        sender.send("not a json envelope at all");
        await waitFor(() => malformedFrames.length >= 1);
        assert.equal(malformedFrames[0].type, "error", "a malformed frame yields a { type:'error' } control-frame");
        assert.equal(typeof malformedFrames[0].message, "string", "the error control-frame carries a message");

        // (2) An oversized frame (> 64 bytes) → the frozen error control-frame (the
        // hand-rolled size check, OUR control-frame, not ws's 1009 close).
        sender.send("x".repeat(500));
        await waitFor(() => malformedFrames.length >= 2);
        assert.equal(malformedFrames[1].type, "error", "an oversized frame yields a { type:'error' } control-frame");

        // The broker did not crash — it is still serving: a fresh client still gets its
        // join ack.
        const second = await openClient(relay.url);
        assert.ok(second.ws, "the broker is still serving after the bad frames (it did not crash)");
        try { second.ws.close(); } catch { /* noop */ }
      } finally {
        try { sender?.close(); } catch { /* noop */ }
        await relay.stop();
      }
    },
  },
];
