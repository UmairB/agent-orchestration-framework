// Fitness function: acd-enrollment-code-single-use-constant-time (milestone 24 /
// story 01 device-code flow / SECURITY.md T4 "replay / double-admission" + T2
// "brute-force / timing oracle") — "The code match is SINGLE-USE (consumed) and uses
// a CONSTANT-TIME compare."
//
//   "A matched device code must be BURNED (single-use consume) so a captured/observed
//    code cannot be replayed for a second admission, and the hash comparison must be
//    CONSTANT-TIME (crypto.timingSafeEqual, NOT a `===`/`==` on the secret hash) so an
//    attacker on the LAN-reachable enrollment endpoint cannot use a timing oracle to
//    walk the 10^6 space digit-by-digit. A `===` on the stored codeHash leaks match
//    progress through response latency; timingSafeEqual removes that oracle. Single-use
//    is the structural half (a matched invite is consumed/removed); constant-time is the
//    compare half."
//
// This is the SECURITY.md control for replay (T4) and the timing-oracle facet of
// brute-force (T2). It is grounded in the real node:crypto seam the repo already uses
// (src/node-identity.mjs line 31 imports node:crypto; src/lock.mjs + src/notion/
// mapping.mjs already call timingSafeEqual — the primitive exists in this codebase).
//
// The invariant has TWO structural facets, each a proof:
//   (a) CONSTANT-TIME COMPARE: the module that verifies a presented code against the
//       stored codeHash imports node:crypto and calls timingSafeEqual — and does NOT
//       compare the codeHash with a raw `===`/`!==` equality (the timing-oracle form).
//       The forbidden shape is a strict-equality operator applied to a `*hash*`/`*code*`
//       identifier; the accepted shape is timingSafeEqual over the two buffers.
//   (b) SINGLE-USE CONSUME: the match/admit path consumes the invite — it calls a
//       consume/burn/delete/remove verb (or clears the pending-invite record) so a
//       matched code cannot be presented twice. The consume seam MUST exist on the
//       enrollment surface (a match that only READS the invite, never removing it, is
//       the replay hole this proof closes).
//
// Source-discipline grep modelled on acd-relay-stateless (milestone 23, fitness #1):
// comment-stripped for import reads, comment-AND-string-stripped for live-code matchers,
// so DOCUMENTING mentions of "timingSafeEqual"/"consume"/"===" do NOT trip. Each proof
// carries an m03 non-vacuous self-check.
//
// State: RED until the enrollment/verify module lands (story 01). The gate discovers the
// verify surface by a source marker (codeHash/timingSafeEqual/consume), so it covers
// whatever the story names the module (mesh-enrollment.mjs / mesh-registry.mjs).
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");
const COMMANDS = path.join(SRC, "commands");

// The verify/match surface marker: a module that carries the codeHash compare and/or the
// consume verb is the device-code MATCH path (distinct from the invite-mint path).
const MATCH_MARKER = /\bcodeHash\b|\btimingSafeEqual\b|\bconsume(Invite)?\b|\bmatch(Code|Invite)\b|\bredeem\b/i;

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

const TIMING_SAFE = /\btimingSafeEqual\s*\(/;
const CONSUME_VERB = /\b(?:consume|burn|redeem|delete|remove|clear|revoke)(?:Invite|Code|PendingInvite)?\s*\(|\.(?:delete|unlink)\s*\(/;
// A raw equality applied to a hash/code identifier — the timing-oracle form. Matches
// `codeHash === x`, `x === storedHash`, `presentedCode == y` etc. over live code.
const RAW_HASH_EQUALITY = /\b\w*(?:[cC]odeHash|[hH]ash|[cC]ode|[dD]igest)\w*\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*\w*(?:[cC]odeHash|[hH]ash|[cC]ode|[dD]igest)\w*/;

async function matchSurface() {
  const found = [];
  for (const dir of [SRC, COMMANDS]) {
    let entries = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/^mesh-.*\.mjs$/.test(name)) continue;
      const file = path.join(dir, name);
      let raw;
      try {
        raw = await readFile(file, "utf8");
      } catch {
        continue;
      }
      if (MATCH_MARKER.test(stripCommentsAndStrings(raw))) found.push({ file, raw });
    }
  }
  return found;
}

export const archTests = [
  {
    name: "arch/enrollment-code-single-use-constant-time: the code match uses a CONSTANT-TIME compare (crypto.timingSafeEqual) and NOT a raw === on the codeHash (no timing oracle on the 10^6 space)",
    run: async () => {
      const modules = await matchSurface();
      assert.ok(
        modules.length > 0,
        "the device-code MATCH surface (a src/mesh-*.mjs carrying codeHash/timingSafeEqual/consume) exists — RED until milestone 24 story 01 lands the device-code match"
      );
      // At least one match-surface module reaches timingSafeEqual — the constant-time seam.
      const constantTime = modules.find(({ raw }) => {
        const specs = importSpecifiers(stripCommentsOnly(raw));
        const importsCrypto = specs.some((s) => /^node:crypto$/.test(s));
        return importsCrypto && TIMING_SAFE.test(stripCommentsAndStrings(raw));
      });
      assert.ok(
        constantTime,
        `an enrollment match-surface module imports node:crypto AND calls timingSafeEqual — the codeHash compare is constant-time. surface: ${modules.map((m) => path.basename(m.file)).join(", ")}`
      );
      // No match-surface module compares a code/hash identifier with a RAW equality — the
      // timing-oracle form the constant-time compare exists to replace.
      for (const { file, raw } of modules) {
        const liveCode = stripCommentsAndStrings(raw);
        assert.ok(
          !RAW_HASH_EQUALITY.test(liveCode),
          `${path.basename(file)} compares a code/hash with a raw ===/!== (a timing oracle) — use crypto.timingSafeEqual over the two buffers instead`
        );
      }
      // Self-checks (non-vacuous).
      assert.ok(TIMING_SAFE.test("crypto.timingSafeEqual(a, b)"), "the timingSafeEqual matcher fires on a real call");
      assert.ok(RAW_HASH_EQUALITY.test("if (storedCodeHash === presentedHash) admit();"), "the raw-equality matcher fires on a === over a codeHash identifier");
      assert.ok(!RAW_HASH_EQUALITY.test("if (timingSafeEqual(storedBuf, presentedBuf)) admit();"), "the raw-equality matcher does NOT fire on the timingSafeEqual form");
    },
  },
  {
    name: "arch/enrollment-code-single-use-constant-time: the match/admit path CONSUMES the invite (single-use burn) — a matched code cannot be replayed for a second admission",
    run: async () => {
      const modules = await matchSurface();
      assert.ok(modules.length > 0, "the device-code MATCH surface exists (RED until story 01 lands)");
      // The consume seam MUST exist somewhere on the match surface — a match that only
      // READS the invite (never removing/clearing it) is the replay hole T4 closes.
      const consumes = modules.some(({ raw }) => CONSUME_VERB.test(stripCommentsAndStrings(raw)));
      assert.ok(
        consumes,
        `an enrollment match-surface module consumes the invite (consume/burn/redeem/delete/remove/clear the pending invite) so a matched code is single-use — surface: ${modules.map((m) => path.basename(m.file)).join(", ")}`
      );
      // Self-checks (non-vacuous).
      assert.ok(CONSUME_VERB.test("await consumeInvite(registry, codeHash);"), "the consume matcher fires on a real consumeInvite call");
      assert.ok(CONSUME_VERB.test("await pending.delete(codeHash);"), "the consume matcher fires on a .delete of the pending invite");
      assert.ok(!CONSUME_VERB.test(stripCommentsAndStrings("// a matched invite must be consumed (burned) so it cannot be redeemed twice")), "the consume matcher does NOT fire on a documented mention");
    },
  },
];
