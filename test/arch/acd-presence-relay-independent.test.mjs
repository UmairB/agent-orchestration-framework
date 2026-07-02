// Fitness function: acd-presence-relay-independent (milestone 23, ADR-003 / fitness #4)
// — the structural form of "correctness independent of the relay / graceful degradation
// to git-only". A SOURCE control-flow grep over src/commands/mesh-heartbeat.mjs (+ the
// node-side relay client src/mesh-relay-client.mjs):
//
//   "The presence publish path writes git UNCONDITIONALLY and treats the relay push as
//    best-effort — the publishPresenceRecord/writeText call is NOT nested inside a
//    relay-push conditional/success branch, and the relay push IS wrapped in a try/catch
//    that SWALLOWS the throw — so the git write survives a relay failure (data safe,
//    liveness lost)."
//
// The two-publish path the grep reads (the literal ADR-003 shape):
//     await publishPresenceRecord(ws, nodeId, record);   // git, UNCONDITIONAL, the floor
//     try { await pushPresenceSignal(relayClient, envelope); }  // relay, BEST-EFFORT
//     catch (err) { /* liveness lost, data safe — never rethrown */ }
//
// Three proofs, each paired with a non-vacuous self-check (the m03 lesson — a fitness
// function asserts the PRESENCE of what should exist, not only the absence of what
// shouldn't, AND the detector fires on a real violation):
//   (a) the git write (publishPresenceRecord) is present AND is NOT nested inside the
//       relay-push try-block (it precedes it — the durable floor is unconditional);
//   (b) the relay push (pushPresenceSignal) IS wrapped in a try/catch (a real try-block
//       whose body contains the push and whose catch swallows the throw — no rethrow);
//   (c) the relay push is NOT inside an `if (...push...)` conditional/success branch
//       gating the git write (no `if (await push…) { …writeGit… }` inversion).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const HEARTBEAT_COMMAND = new URL("../../src/commands/mesh-heartbeat.mjs", import.meta.url);
const RELAY_CLIENT = new URL("../../src/mesh-relay-client.mjs", import.meta.url);

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Find each `try { … } catch (…) { … }` block in the source and return its { body, catch }
// text. A small brace-matcher (the source-analysis idiom the namespace's arch-tests use).
function tryCatchBlocks(code) {
  const blocks = [];
  const tryRe = /\btry\s*\{/g;
  let match;
  while ((match = tryRe.exec(code))) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matchBrace(code, bodyStart);
    if (bodyEnd === -1) continue;
    const body = code.slice(bodyStart, bodyEnd);
    // The catch clause must follow the try body (optionally a (err) binding + a brace).
    const after = code.slice(bodyEnd + 1);
    const catchMatch = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(after);
    if (!catchMatch) continue;
    const catchStart = bodyEnd + 1 + catchMatch[0].length;
    const catchEnd = matchBrace(code, catchStart);
    if (catchEnd === -1) continue;
    blocks.push({ body, catch: code.slice(catchStart, catchEnd) });
  }
  return blocks;
}

// Return the index of the `}` that closes the `{` whose body starts at `start`, or -1.
function matchBrace(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

export const archTests = [
  {
    name: "arch/presence-relay-independent: the git write (publishPresenceRecord) is present and is NOT nested inside the relay-push try-block",
    async run() {
      const code = stripComments(await readFile(HEARTBEAT_COMMAND, "utf8"));
      // (positive) the durable git write IS present — the floor exists.
      assert.ok(
        /\bpublishPresenceRecord\s*\(/.test(code),
        "mesh-heartbeat.mjs writes git via publishPresenceRecord (the durable floor exists)"
      );
      // (negative) the git write is NOT inside ANY try-block that also pushes the relay —
      // the unconditional write must precede the best-effort push, never be guarded by it.
      const blocks = tryCatchBlocks(code);
      const relayPushBlocks = blocks.filter((b) => /\bpushPresenceSignal\s*\(/.test(b.body));
      assert.ok(relayPushBlocks.length >= 1, "the relay push is wrapped in a try-block (at least one)");
      for (const block of relayPushBlocks) {
        assert.ok(
          !/\bpublishPresenceRecord\s*\(/.test(block.body),
          "the git write (publishPresenceRecord) is NOT nested inside the relay-push try-block (the durable floor is unconditional)"
        );
      }
      // Self-check (non-vacuous): the nesting detector DOES fire on a real violation —
      // a git write placed INSIDE the relay-push try-block.
      const offending = tryCatchBlocks(stripComments(
        "try { await pushPresenceSignal(c, e); await publishPresenceRecord(ws, id, r); } catch (err) {}"
      ));
      assert.ok(
        offending.some((b) => /pushPresenceSignal/.test(b.body) && /publishPresenceRecord/.test(b.body)),
        "the detector catches a git write nested inside the relay-push try-block"
      );
    },
  },
  {
    name: "arch/presence-relay-independent: the relay push is wrapped in a try/catch that swallows the throw (no rethrow)",
    async run() {
      const code = stripComments(await readFile(HEARTBEAT_COMMAND, "utf8"));
      const blocks = tryCatchBlocks(code);
      const relayPushBlocks = blocks.filter((b) => /\bpushPresenceSignal\s*\(/.test(b.body));
      assert.ok(
        relayPushBlocks.length >= 1,
        "the relay push (pushPresenceSignal) is wrapped in a try/catch (the best-effort accelerator)"
      );
      // The catch must SWALLOW the throw — it must NOT rethrow (no `throw` in the catch).
      for (const block of relayPushBlocks) {
        assert.ok(
          !/\bthrow\b/.test(block.catch),
          "the relay-push catch swallows the throw (it never rethrows — liveness lost, data safe)"
        );
      }
      // Self-check (non-vacuous): the swallow detector DOES fire on a catch that rethrows.
      const rethrows = tryCatchBlocks(stripComments(
        "try { await pushPresenceSignal(c, e); } catch (err) { throw err; }"
      ));
      assert.ok(
        rethrows.some((b) => /\bthrow\b/.test(b.catch)),
        "the detector catches a relay-push catch that rethrows"
      );
    },
  },
  {
    name: "arch/presence-relay-independent: the relay push does not gate the git write (no `if (push) { writeGit }` inversion)",
    async run() {
      const code = stripComments(await readFile(HEARTBEAT_COMMAND, "utf8"));
      // There must be NO `if (... pushPresenceSignal ...) { ... publishPresenceRecord ... }`
      // — the SPEC-forbidden inversion where the durable write is conditional on the relay
      // push succeeding. Scan every `if (…)` head that references the push and assert its
      // following brace-block does not contain the git write.
      const ifRe = /\bif\s*\(/g;
      let match;
      while ((match = ifRe.exec(code))) {
        // Read the if-condition (paren-matched) and the block that follows it.
        const condStart = match.index + match[0].length;
        let depth = 0;
        let condEnd = -1;
        for (let i = condStart; i < code.length; i += 1) {
          const ch = code[i];
          if (ch === "(") depth += 1;
          else if (ch === ")") {
            if (depth === 0) { condEnd = i; break; }
            depth -= 1;
          }
        }
        if (condEnd === -1) continue;
        const cond = code.slice(condStart, condEnd);
        if (!/pushPresenceSignal/.test(cond)) continue;
        // The if-condition references the relay push — its block must NOT write git.
        const braceStart = code.indexOf("{", condEnd);
        if (braceStart === -1) continue;
        const braceEnd = matchBrace(code, braceStart + 1);
        const block = braceEnd === -1 ? "" : code.slice(braceStart + 1, braceEnd);
        assert.ok(
          !/publishPresenceRecord/.test(block),
          "the git write is NOT inside an `if (...pushPresenceSignal...)` branch (no relay-gates-git inversion)"
        );
      }
      // Self-check (non-vacuous): the inversion detector fires on a real `if (push) { write }`.
      const inversionCode = stripComments(
        "if (await pushPresenceSignal(c, e)) { await publishPresenceRecord(ws, id, r); }"
      );
      let fired = false;
      const re2 = /\bif\s*\(/g;
      let m2;
      while ((m2 = re2.exec(inversionCode))) {
        const cs = m2.index + m2[0].length;
        let d = 0, ce = -1;
        for (let i = cs; i < inversionCode.length; i += 1) {
          const ch = inversionCode[i];
          if (ch === "(") d += 1;
          else if (ch === ")") { if (d === 0) { ce = i; break; } d -= 1; }
        }
        const cond = inversionCode.slice(cs, ce);
        if (!/pushPresenceSignal/.test(cond)) continue;
        const bs = inversionCode.indexOf("{", ce);
        const be = matchBrace(inversionCode, bs + 1);
        const block = inversionCode.slice(bs + 1, be);
        if (/publishPresenceRecord/.test(block)) fired = true;
      }
      assert.ok(fired, "the inversion detector catches a real `if (push) { writeGit }`");
    },
  },
  {
    name: "arch/presence-relay-independent: pushPresenceSignal itself never swallows (the catch lives on the publish path, where fitness #4 reads it)",
    async run() {
      // The best-effort CATCH must live on the publish path (mesh-heartbeat.mjs), NOT
      // hidden inside the relay client — otherwise the arch-test would read a clean
      // heartbeat source while the swallow happened out of sight. Assert the client's
      // pushPresenceSignal PROPAGATES (it has no try/catch that swallows the push).
      const code = stripComments(await readFile(RELAY_CLIENT, "utf8"));
      // Locate pushPresenceSignal's body and assert it contains no `catch` that swallows
      // the connect/push (a `finally` for socket disposal is fine — it does not catch).
      const start = code.search(/export\s+async\s+function\s+pushPresenceSignal\s*\(/);
      assert.ok(start !== -1, "pushPresenceSignal is exported from the relay client");
      const bodyStart = code.indexOf("{", start);
      const bodyEnd = matchBrace(code, bodyStart + 1);
      const body = code.slice(bodyStart + 1, bodyEnd);
      // It connects + pushes (the one-shot best-effort push).
      assert.ok(/\.connect\s*\(/.test(body) && /\.push\s*\(/.test(body), "pushPresenceSignal connects then pushes");
      // It does NOT catch the connect/push throw — that propagates to the publish path's
      // best-effort try/catch (so fitness #4's grep on mesh-heartbeat.mjs is load-bearing).
      assert.ok(
        !/\bcatch\s*(?:\([^)]*\))?\s*\{[^}]*connect|\bcatch\s*(?:\([^)]*\))?\s*\{[^}]*push\b/.test(body),
        "pushPresenceSignal does not swallow the connect/push throw (the catch lives on the publish path)"
      );
    },
  },
];
