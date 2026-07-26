// Fitness function: acd-clone-credential-relay-not-logged (milestone 38 / ADR-009 +
// SECURITY T3, re-derived on the NEW relay-borne credential frame)
//
// WHY THIS EXISTS — T3 was written before the credential ever crossed the relay. As of
// ADR-009 the credential is a live field on TWO frames that flow through code paths T3's
// original fitness (`acd-worker-clone-no-credential-persisted`, scoped to
// `mesh-worker-execution.mjs`) never looked at:
//   - control-stream-server.mjs — `buildCloneCredentialFrame(...)` mints the DOWN-frame
//     `{ kind:"clone-credential", to, assignmentId, credential, at }`; the token is a
//     literal field on that object.
//   - worker-stream-client.mjs — `requestCloneCredential(...)` / `settleCloneCredential
//     Request(...)` RECEIVE that frame and read `frame.credential`.
// The single likeliest future regression on this surface is a debugging line —
// `console.log(frame)` in the receive path, `onWarning({ message: credential })` on a
// refusal, `logger.debug("minted", credential)` at the mint — any of which streams a live
// token into a run record / console / warning sink a passive attacker with log access
// harvests (SECURITY T3 · Info-disclosure). Neither module logs a credential today; this
// pins that both STAY log-free of the credential value.
//
// THE INVARIANT (structural, over both relay modules): no `console.*` / `logger.*` /
// `warn(...)` / `onWarning(...)` call in control-stream-server.mjs or worker-stream-
// client.mjs passes a `credential` value. (The frame is written to the WIRE via
// `ws.send(JSON.stringify(frame))` — that is transport, not a log, and is not matched.)
//
// Self-check (m03 non-vacuous, milestone-38 hard lesson): every plant is a SYNTHESIZED
// snippet built with explicit "\n" joins (never a string-replace on the real file, never a
// raw multi-line template literal — the tree is CRLF, and a needle written with "\n" would
// silently no-op against CRLF source and leave the self-check vacuous). Each plant asserts
// it DIFFERS from its clean baseline before asserting the detector trips — a plant that did
// not land proves nothing.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const controlSourcePath = path.join(repoRoot, "src", "control-stream-server.mjs");
const clientSourcePath = path.join(repoRoot, "src", "worker-stream-client.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// lf(source) — normalise CRLF → LF so the detector's line/call scan is endings-agnostic
// (the tree is checked out CRLF on this platform).
function lf(source) {
  return source.replace(/\r\n/g, "\n");
}

// balancedArgs(source, openParenIndex) — the substring INSIDE the (...) whose opening
// paren is at `openParenIndex`, paren-depth-balanced so a nested call in the argument
// list does not truncate the slice early.
function balancedArgs(source, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, i);
    }
  }
  return source.slice(openParenIndex + 1);
}

// credentialLogProblems(code, label) — every logging-shaped call whose argument list
// references a `credential` value. `console.*`, `logger.*`, and the two failure-side
// sinks this codebase uses (`warn(...)`, `onWarning(...)`) are the sink set.
const LOG_SINK = /\b(?:console\.[a-z]+|logger\.[a-z]+|warn|onWarning)\s*\(/g;

function credentialLogProblems(code, label) {
  const problems = [];
  let match;
  LOG_SINK.lastIndex = 0;
  while ((match = LOG_SINK.exec(code)) != null) {
    const openParen = code.indexOf("(", match.index);
    if (openParen === -1) continue;
    const args = balancedArgs(code, openParen);
    if (/\bcredential\b/.test(args)) {
      problems.push(`${label}: a credential value flows into a \`${match[0].trim()}…)\` log/warn sink — the relay-borne clone credential must never be logged (SECURITY T3)`);
    }
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/38 ADR-009 (acd-clone-credential-relay-not-logged): neither the control send-side (buildCloneCredentialFrame/mint) nor the worker receive-side (requestCloneCredential) logs the relay-borne credential value (structural, both modules)",
    run: async () => {
      const control = stripComments(lf(await readFile(controlSourcePath, "utf8")));
      const client = stripComments(lf(await readFile(clientSourcePath, "utf8")));
      const problems = [
        ...credentialLogProblems(control, "control-stream-server.mjs"),
        ...credentialLogProblems(client, "worker-stream-client.mjs"),
      ];
      assert.deepEqual(problems, [], `credential-log problems: ${JSON.stringify(problems, null, 2)}`);
    },
  },
  {
    name: "arch/38 ADR-009 (acd-clone-credential-relay-not-logged): self-check — a console.log of frame.credential, a logger.debug of the minted token, and an onWarning carrying the credential ALL trip; a warn(code, error) with no credential stays clean",
    run: async () => {
      const control = stripComments(lf(await readFile(controlSourcePath, "utf8")));
      const client = stripComments(lf(await readFile(clientSourcePath, "utf8")));
      // Baseline: the real, shipped source is clean under the detector.
      assert.deepEqual(credentialLogProblems(control, "control"), [], "the real control source is clean");
      assert.deepEqual(credentialLogProblems(client, "client"), [], "the real client source is clean");

      // A minimal, hand-written clean baseline the plants are diffed against (explicit
      // "\n" joins — CRLF-immune by construction).
      const clean = [
        "function handleTransportMessage(raw) {",
        "  const frame = JSON.parse(raw);",
        "  if (frame.kind === 'clone-credential') settle(frame);",
        "}",
      ].join("\n");
      assert.deepEqual(credentialLogProblems(clean, "clean"), [], "sanity: the synthesized clean shape logs no credential");

      // PLANT 1 — a debug log of the received credential frame's token (the likeliest regression).
      const plantedConsole = [
        "function handleTransportMessage(raw) {",
        "  const frame = JSON.parse(raw);",
        "  console.log('got clone credential=' + frame.credential);",
        "  if (frame.kind === 'clone-credential') settle(frame);",
        "}",
      ].join("\n");
      assert.notEqual(plantedConsole, clean, "the console plant differs from the clean baseline");
      assert.ok(credentialLogProblems(plantedConsole, "p1").length > 0, "a console.log of frame.credential trips the detector");

      // PLANT 2 — the mint side logs the freshly-minted token.
      const plantedLogger = [
        "async function applyCloneCredentialRequestFrame(store, frame, options) {",
        "  const credential = await mint(frame.workspaceId, frame.assignmentId);",
        "  logger.debug('minted', credential);",
        "  return buildCloneCredentialFrame(frame.nodeId, { credential });",
        "}",
      ].join("\n");
      assert.notEqual(plantedLogger, clean, "the logger plant differs from the clean baseline");
      assert.ok(credentialLogProblems(plantedLogger, "p2").length > 0, "a logger.debug of the minted credential trips the detector");

      // PLANT 3 — a failure sink (onWarning) that carries the credential in its payload.
      const plantedWarn = [
        "function requestCloneCredential({ assignmentId }) {",
        "  const credential = frame.credential;",
        "  onWarning({ code: 'x', message: 'using ' + credential });",
        "  return credential;",
        "}",
      ].join("\n");
      assert.notEqual(plantedWarn, clean, "the onWarning plant differs from the clean baseline");
      assert.ok(credentialLogProblems(plantedWarn, "p3").length > 0, "an onWarning carrying the credential trips the detector");

      // NEGATIVE CONTROL — the codebase's real failure-isolation shape: warn(code, error)
      // with no credential in the args. Must stay clean (this is what worker-stream-
      // client.mjs actually does on a transport fault).
      const negativeControl = [
        "const warn = (code, error) => {",
        "  onWarning({ code, message: error?.message ?? String(error), path: null });",
        "};",
        "async function sendFrame(frame) {",
        "  try { await transport.send(handle, frame); } catch (error) { warn('worker-stream-send-failed', error); }",
        "}",
      ].join("\n");
      assert.deepEqual(credentialLogProblems(negativeControl, "neg"), [], "the real warn(code, error) failure-isolation shape (no credential in args) stays clean");
    },
  },
];
