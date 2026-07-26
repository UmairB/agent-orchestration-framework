// Fitness function: acd-claim-relay-independent (milestone 26, ADR-004 / fitness #9 —
// the 23/fitness-#4 mirror on the CLAIM path). The structural form of "correctness
// independent of the relay": a SOURCE control-flow analysis over
// src/commands/run-start.mjs (+ the node-side push seam in src/mesh-relay-client.mjs):
//
//   "The claim path performs the durable local claim write + the AUTHORITATIVE git sync
//    (composed as acquireLease over the injected syncMesh closure) OUTSIDE any
//    relay-push conditional/success branch, and the relay intent push (pushLeaseSignal)
//    IS wrapped in a try/catch that SWALLOWS the throw — so a relay failure NEVER
//    propagates and NEVER gates/undoes the claim (relay loss degrades arbitration to
//    the git cadence, never blocks a claim — PRD A2)."
//
// The frozen shape the grep reads (ADR-004.3's ORDER — claim-write → intent → sync —
// composed in ONE file: the push rides acquireLease's onClaimWritten slot, which
// fires between the durable claim write and the FIRST sync round):
//     const lease = await acquireLease(ws, item.ref, meshNodeId, {
//       runSync, …,
//       onClaimWritten: async (claim) => {
//         try { await pushLeaseSignal(relayClient, leaseRelayEnvelope(…, claim)); }
//         catch { /* swallowed — arbitration falls to the git cadence */ }
//       },
//     });
//
// Five proofs, each paired with a non-vacuous self-check (the m03 lesson — the detector
// demonstrably fires on a planted violation):
//   (a) the claim acquisition (acquireLease) + the sync composition (syncMesh) are
//       present AND NOT nested inside the relay-push try-block;
//   (b) the relay push IS wrapped in a try/catch whose catch swallows (no rethrow);
//   (c) the relay push does not GATE the claim (no `if (…push…) { …acquire/sync… }`);
//   (d) THE ORDER (ADR-004.3): the push rides the onClaimWritten option INSIDE the
//       acquireLease call — never a free-standing post-acquire push, which would make
//       the intent wait out up to MAX_CLAIM_SYNC_ATTEMPTS sync rounds (slowest exactly
//       under contention — the A2 window the fast path exists to collapse);
//   (e) pushLeaseSignal itself PROPAGATES (no hidden swallow in the client — the catch
//       lives on the claim path, where THIS gate reads it).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const RUN_START = new URL("../../src/commands/run-start.mjs", import.meta.url);
const RELAY_CLIENT = new URL("../../src/mesh-relay-client.mjs", import.meta.url);

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Find each `try { … } catch (…) { … }` block and return its { body, catch } text —
// the brace-matching source-analysis idiom acd-presence-relay-independent uses.
function tryCatchBlocks(code) {
  const blocks = [];
  const tryRe = /\btry\s*\{/g;
  let match;
  while ((match = tryRe.exec(code))) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matchBrace(code, bodyStart);
    if (bodyEnd === -1) continue;
    const body = code.slice(bodyStart, bodyEnd);
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
    name: "arch/claim-relay-independent: the claim acquisition (acquireLease) + the authoritative sync (syncMesh) are present and NOT nested inside the relay-push try-block",
    async run() {
      const code = stripComments(await readFile(RUN_START, "utf8"));
      // (positive) the durable claim + authoritative sync composition IS present.
      assert.ok(/\bacquireLease\s*\(/.test(code), "run-start.mjs acquires the lease via acquireLease (the durable claim + git arbitration exist)");
      assert.ok(/\bsyncMesh\s*\(/.test(code), "run-start.mjs composes the authoritative sync via syncMesh (the injected runSync closure)");
      // (negative) neither sits inside ANY try-block that also pushes the relay — the
      // acquire composition (claim write + authoritative sync) is never nested inside
      // a relay-push conditional/success branch. (The ADR-004.3 ORDER is the claim
      // WRITE first, the intent push second, the sync third — the push rides the
      // acquire's onClaimWritten slot, pinned by the order proof below; what this
      // proof forbids is the relay push GUARDING the authoritative acts.)
      const blocks = tryCatchBlocks(code);
      const relayPushBlocks = blocks.filter((b) => /\bpushLeaseSignal\s*\(/.test(b.body));
      assert.ok(relayPushBlocks.length >= 1, "the relay intent push is wrapped in a try-block (at least one)");
      for (const block of relayPushBlocks) {
        assert.ok(
          !/\bacquireLease\s*\(/.test(block.body),
          "the claim acquisition is NOT nested inside the relay-push try-block (the durable claim is unconditional)"
        );
        assert.ok(
          !/\bsyncMesh\s*\(/.test(block.body),
          "the authoritative git sync is NOT nested inside the relay-push try-block"
        );
      }
      // Self-check (non-vacuous): the nesting detector fires on a real violation.
      const offending = tryCatchBlocks(stripComments(
        "try { await pushLeaseSignal(c, e); const lease = await acquireLease(ws, ref, id, {}); } catch {}"
      ));
      assert.ok(
        offending.some((b) => /pushLeaseSignal/.test(b.body) && /acquireLease/.test(b.body)),
        "the detector catches a claim acquisition nested inside the relay-push try-block"
      );
    },
  },
  {
    name: "arch/claim-relay-independent: the relay intent push is wrapped in a try/catch that swallows the throw (no rethrow)",
    async run() {
      const code = stripComments(await readFile(RUN_START, "utf8"));
      const blocks = tryCatchBlocks(code);
      const relayPushBlocks = blocks.filter((b) => /\bpushLeaseSignal\s*\(/.test(b.body));
      assert.ok(relayPushBlocks.length >= 1, "the relay push (pushLeaseSignal) is wrapped in a try/catch (the best-effort accelerator)");
      for (const block of relayPushBlocks) {
        assert.ok(
          !/\bthrow\b/.test(block.catch),
          "the relay-push catch swallows the throw — a relay failure never propagates (arbitration falls to the git cadence)"
        );
      }
      // Self-check (non-vacuous): the swallow detector fires on a catch that rethrows.
      const rethrows = tryCatchBlocks(stripComments("try { await pushLeaseSignal(c, e); } catch (err) { throw err; }"));
      assert.ok(rethrows.some((b) => /\bthrow\b/.test(b.catch)), "the detector catches a relay-push catch that rethrows");
    },
  },
  {
    name: "arch/claim-relay-independent: the relay push does not gate the claim (no `if (push) { acquire/sync/mint }` inversion)",
    async run() {
      const code = stripComments(await readFile(RUN_START, "utf8"));
      // Scan every `if (…)` head referencing the push; its block must not contain the
      // claim acquisition, the sync, or the mint — the forbidden relay-gates-git shape.
      const gated = ifBlocksReferencing(code, /pushLeaseSignal/);
      for (const block of gated) {
        assert.ok(
          !/\bacquireLease\s*\(|\bsyncMesh\s*\(|\bstartRun\s*\(|\bretryRun\s*\(/.test(block),
          "no claim/sync/mint sits inside an `if (…pushLeaseSignal…)` branch (no relay-gates-claim inversion)"
        );
      }
      // Self-check (non-vacuous): the inversion detector fires on a real violation.
      const planted = ifBlocksReferencing(
        stripComments("if (await pushLeaseSignal(c, e)) { const lease = await acquireLease(ws, ref, id, {}); }"),
        /pushLeaseSignal/
      );
      assert.ok(planted.some((b) => /acquireLease/.test(b)), "the detector catches a real `if (push) { acquire }` inversion");
    },
  },
  {
    name: "arch/claim-relay-independent: THE ORDER — the intent push rides the onClaimWritten slot INSIDE the acquireLease call (claim-write → intent → sync, ADR-004.3), never a free-standing post-acquire push",
    async run() {
      const code = stripComments(await readFile(RUN_START, "utf8"));
      // Locate the acquireLease CALL and paren-match its full argument span.
      const callMatch = /\bacquireLease\s*\(/.exec(code);
      assert.ok(callMatch, "run-start.mjs calls acquireLease");
      const argsStart = callMatch.index + callMatch[0].length;
      const argsEnd = matchParen(code, argsStart);
      assert.ok(argsEnd !== -1, "the acquireLease call's argument list is well-formed");
      const args = code.slice(argsStart, argsEnd);
      // The push rides the onClaimWritten option of THAT call — the frozen slot
      // between the durable claim write and the FIRST sync round.
      assert.ok(/\bonClaimWritten\s*:/.test(args), "the acquireLease call passes the onClaimWritten hook (the ADR-004.3 intent slot)");
      assert.ok(/\bpushLeaseSignal\s*\(/.test(args), "the intent push (pushLeaseSignal) sits INSIDE the onClaimWritten hook of the acquire call");
      // And NOWHERE else: every pushLeaseSignal occurrence in the file sits within the
      // acquire call's span — a free-standing post-acquire push (claim → sync → push)
      // would re-open the contention window the fast path exists to collapse.
      const pushRe = /\bpushLeaseSignal\s*\(/g;
      let push;
      while ((push = pushRe.exec(code))) {
        assert.ok(
          push.index > argsStart && push.index < argsEnd,
          "every pushLeaseSignal call rides the acquireLease onClaimWritten slot (no free-standing post-acquire push)"
        );
      }
      // Self-check (non-vacuous): the order detector FLAGS the drift shape — a push
      // placed after the acquire call instead of inside its options.
      const drifted = stripComments(
        "const lease = await acquireLease(ws, ref, id, { runSync }); try { await pushLeaseSignal(c, e); } catch {}"
      );
      const dm = /\bacquireLease\s*\(/.exec(drifted);
      const dEnd = matchParen(drifted, dm.index + dm[0].length);
      const dPush = /\bpushLeaseSignal\s*\(/.exec(drifted);
      assert.ok(dPush.index > dEnd, "the detector flags a free-standing post-acquire push (outside the acquire call's span)");
      assert.ok(!/\bonClaimWritten\s*:/.test(drifted.slice(dm.index, dEnd)), "the drifted shape carries no onClaimWritten slot");
    },
  },
  {
    name: "arch/claim-relay-independent: pushLeaseSignal itself never swallows — it rides the one-shot push seam and PROPAGATES (the catch lives on the claim path, where this gate reads it)",
    async run() {
      const code = stripComments(await readFile(RELAY_CLIENT, "utf8"));
      const start = code.search(/export\s+async\s+function\s+pushLeaseSignal\s*\(/);
      assert.ok(start !== -1, "pushLeaseSignal is exported from the relay client");
      const bodyStart = code.indexOf("{", start);
      const bodyEnd = matchBrace(code, bodyStart + 1);
      const body = code.slice(bodyStart + 1, bodyEnd);
      // It rides the ONE-SHOT push seam (the connect → push-one → dispose shape, reused
      // verbatim via pushPresenceSignal, or inlined as .connect/.push).
      assert.ok(
        /\bpushPresenceSignal\s*\(/.test(body) || (/\.connect\s*\(/.test(body) && /\.push\s*\(/.test(body)),
        "pushLeaseSignal rides the one-shot connect → push-one → dispose seam"
      );
      // It does NOT catch — a connect/push failure propagates to the claim path's
      // best-effort try/catch (so this gate's grep on run-start.mjs is load-bearing).
      assert.ok(!/\bcatch\b/.test(body), "pushLeaseSignal contains no catch — the connect/push failure PROPAGATES");
      // Self-check (non-vacuous): the no-catch detector fires on a hidden swallow.
      assert.ok(/\bcatch\b/.test("try { await c.push(e); } catch { }"), "the detector catches a hidden swallow");
    },
  },
];

// Return the index of the `)` that closes the `(` whose contents start at `start`, or -1.
function matchParen(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

// Every `{ … }` block that follows an `if (…)` whose CONDITION matches `re`.
function ifBlocksReferencing(code, re) {
  const blocks = [];
  const ifRe = /\bif\s*\(/g;
  let match;
  while ((match = ifRe.exec(code))) {
    const condStart = match.index + match[0].length;
    let depth = 0;
    let condEnd = -1;
    for (let i = condStart; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        if (depth === 0) {
          condEnd = i;
          break;
        }
        depth -= 1;
      }
    }
    if (condEnd === -1) continue;
    const cond = code.slice(condStart, condEnd);
    if (!re.test(cond)) continue;
    const braceStart = code.indexOf("{", condEnd);
    if (braceStart === -1) continue;
    const braceEnd = matchBrace(code, braceStart + 1);
    if (braceEnd === -1) continue;
    blocks.push(code.slice(braceStart + 1, braceEnd));
  }
  return blocks;
}
