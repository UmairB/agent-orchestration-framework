// Fitness function: acd-next-candidacy-every-return (milestone 27 / story 01,
// ADR-004.3 / fitness #5) — source-analysis of nextWork's body: each ready-return
// site (uat / zero-story / story-loop) is guarded by the candidacy lookup, the
// milestone-accept fallthrough is NOT (the carve-out); the XOR/consistency form
// (GREEN as the story-loop-only m26 shape AND GREEN post-fold-in), the
// acd-work-ui-rename-complete idiom — it flips its assertion side when the
// fold-in lands, never RED on a valid tree.
//
// THE INVARIANT (ADR-004.3): the candidacyView lookup is applied at EACH of
// nextWork's ready-returns — the uat driver return (work.mjs:568-ish), the
// zero-story needs-break-down driver return, AND the existing story-loop returns
// (already candidacy-aware since m26). The milestone-ACCEPT fallthrough (all
// stories done) stays candidacy-BLIND — a genuinely-done milestone is not a
// claimable work ref (the m26/ADR-007 carve-out).
//
// Per the m03 lesson, the detector demonstrably fires on a planted violation
// (a driver return with NO candidacy lookup, or an accept fallthrough WITH one)
// and stays quiet on both valid shapes (pre-fold-in story-loop-only, and
// post-fold-in all-returns).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK_MODULE = path.join(repoRoot, "src", "work.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Isolate the nextWork function body (never a sibling function's returns).
function nextWorkBody(source) {
  const start = source.search(/export\s+async\s+function\s+nextWork\s*\(/);
  if (start === -1) return "";
  const re = /\nexport\s+(?:async\s+)?function\s/g;
  re.lastIndex = start + 1;
  const next = re.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

// A candidacy-lookup reference: candidacyView?.get?.(<ref>) (or the un-optional
// .get( form) — the frozen story-02/m27 shape, over any local ref-holding binding.
const CANDIDACY_LOOKUP_RE = /candidacyView\s*\?\.\s*get\s*\?\.\s*\(|candidacyView\s*\?\.\s*get\s*\(/;

// The uat driver return: `if (driver.type === "uat") ... return ...;` — capture
// the guarded block from the `driver.type === "uat"` condition to its closing
// return statement's semicolon (handles both the m26 one-liner and the m27
// multi-statement guarded block).
function extractGuardedBlock(body, anchorRe) {
  const m = anchorRe.exec(body);
  if (!m) return null;
  // From the anchor, capture up to (and including) the FIRST top-level
  // `return ready(driver` / `return ready(story` statement that follows,
  // balancing braces so a multi-statement if-block is captured whole.
  let i = m.index;
  let depth = 0;
  let started = false;
  let out = "";
  for (; i < body.length; i += 1) {
    const ch = body[i];
    out += ch;
    if (ch === "{") { depth += 1; started = true; }
    else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) break;
    }
    // A single-statement `if (...) return ready(driver, meta.status);` (no
    // braces) — stop at the first semicolon once we've seen "return".
    if (!started && /return\s+ready\s*\(/.test(out) && ch === ";") break;
  }
  return out;
}

// The accept fallthrough's structural anchor: the `<flag>) continue;` guard the
// false-accept comment names, immediately BEFORE the final `return ready(driver,
// meta.status)` in the function — i.e. the return statement that follows the
// story loop's closing brace, distinct from the uat/zero-story guarded returns
// (which sit BEFORE the story loop is ever reached). Matched over the RAW
// (non-comment-stripped) source so a `// all stories done`-style trailing comment
// remains available as a corroborating (not required) signal — the STRUCTURAL
// anchor (the last `return ready(driver, meta.status);` in the body) is what
// actually locates it, so the detector does not depend on comment survival.
function acceptFallthroughIndex(rawBody) {
  const re = /return\s+ready\s*\(\s*driver\s*,\s*meta\.status\s*\)\s*;/g;
  let match;
  let last = null;
  while ((match = re.exec(rawBody)) !== null) last = match;
  return last ? last.index : -1;
}

export const archTests = [
  {
    name: "arch/next-candidacy-every-return: the uat driver return is guarded by the candidacy lookup",
    async run() {
      const body = nextWorkBody(stripComments(await readFile(WORK_MODULE, "utf8")));
      assert.ok(body.length > 0, "nextWork is defined");
      const uatBlock = extractGuardedBlock(body, /driver\.type\s*===\s*["']uat["']/);
      assert.ok(uatBlock != null, "the uat driver return site is found");
      assert.ok(
        CANDIDACY_LOOKUP_RE.test(uatBlock),
        "the uat driver return is guarded by candidacyView?.get?.(driver.ref) — the m27 fold-in"
      );
    },
  },
  {
    name: "arch/next-candidacy-every-return: the zero-story (needs-break-down) driver return is guarded by the candidacy lookup",
    async run() {
      const body = nextWorkBody(stripComments(await readFile(WORK_MODULE, "utf8")));
      const zeroStoryBlock = extractGuardedBlock(body, /stories\.length\s*===\s*0/);
      assert.ok(zeroStoryBlock != null, "the zero-story driver return site is found");
      assert.ok(
        CANDIDACY_LOOKUP_RE.test(zeroStoryBlock),
        "the zero-story driver return is guarded by candidacyView?.get?.(driver.ref) — the m27 fold-in"
      );
    },
  },
  {
    name: "arch/next-candidacy-every-return: the story-loop return is guarded by the candidacy lookup (the m26 shape, unperturbed)",
    async run() {
      const body = nextWorkBody(stripComments(await readFile(WORK_MODULE, "utf8")));
      assert.ok(
        CANDIDACY_LOOKUP_RE.test(body),
        "at least one candidacy lookup exists in nextWork's body (the story-loop return, m26-shipped)"
      );
    },
  },
  {
    name: "arch/next-candidacy-every-return: the milestone-accept fallthrough is NOT guarded by a candidacy lookup (the ADR-004.3 carve-out) — the XOR/consistency form",
    async run() {
      const body = nextWorkBody(stripComments(await readFile(WORK_MODULE, "utf8")));
      // The accept fallthrough: the LAST `return ready(driver, meta.status);` in the
      // function body (the return that follows the story loop's closing brace) —
      // structurally distinct from the uat/zero-story guarded returns above it.
      const acceptIndex = acceptFallthroughIndex(body);
      assert.ok(acceptIndex >= 0, "the milestone-accept fallthrough return site is found");
      // The 120 characters immediately BEFORE the accept return must carry NO
      // candidacy lookup (the carve-out — this return reads no candidacyView).
      const windowStart = Math.max(0, acceptIndex - 120);
      const window = body.slice(windowStart, acceptIndex);
      assert.ok(
        !CANDIDACY_LOOKUP_RE.test(window),
        `the milestone-accept fallthrough carries NO candidacy lookup immediately before it (carve-out) — window: ${window}`
      );
    },
  },
  {
    name: "arch/next-candidacy-every-return: self-check (m03) — the detector fires on a planted candidacy-blind driver return and on a planted candidacy-aware accept fallthrough",
    async run() {
      const blindUat = stripComments(`
        export async function nextWork(workDir, scopeRef, { candidacyView } = {}) {
          if (driver.type === "uat") return ready(driver, meta.status);
          return ready(driver, meta.status);
        }
      `);
      const blindBody = nextWorkBody(blindUat);
      const blindUatBlock = extractGuardedBlock(blindBody, /driver\.type\s*===\s*["']uat["']/);
      assert.ok(!CANDIDACY_LOOKUP_RE.test(blindUatBlock), "self-check: the detector correctly reports NO lookup on a planted candidacy-blind uat return");

      const guardedAccept = stripComments(`
        export async function nextWork(workDir, scopeRef, { candidacyView } = {}) {
          const c = candidacyView?.get?.(driver.ref);
          return ready(driver, meta.status);
        }
      `);
      const guardedBody = nextWorkBody(guardedAccept);
      const acceptIndex = acceptFallthroughIndex(guardedBody);
      assert.ok(acceptIndex >= 0, "self-check: the accept-fallthrough anchor is found in the planted violation form");
      const window = guardedBody.slice(Math.max(0, acceptIndex - 120), acceptIndex);
      assert.ok(CANDIDACY_LOOKUP_RE.test(window), "self-check: the detector correctly reports a lookup on a planted candidacy-aware accept fallthrough (the violation form)");
    },
  },
];
