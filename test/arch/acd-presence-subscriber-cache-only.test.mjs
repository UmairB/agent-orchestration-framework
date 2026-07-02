// Fitness function: acd-presence-subscriber-cache-only (milestone 23 / F1 close-out /
// ADR-004 / fitness #7) — "Receive-side is a liveness cache, never a second system of
// record."
//
//   "The node-side receive-and-apply consumer applies a fanned-out presence signal into
//    an IN-MEMORY cache ONLY — the subscriber (src/mesh-presence-subscriber.mjs) and the
//    cache (src/mesh-presence-cache.mjs) perform NO writeText/writeFile of a record,
//    import NO durable-write / record-persist seam (node:fs / node:fs/promises / fs.mjs /
//    mesh-presence.mjs / mesh-store.mjs), reference NO publishPresenceRecord, and never
//    reference presenceRecordPath (the write target they must never touch) — so the applied
//    signal is provably a projection, never a durable authority. The relay stays a
//    cache/accelerator on the RECEIVE side, exactly as fitness #1 keeps the broker stateless
//    on the transport side and fitness #3 keeps the write path scoped on the SEND side."
//
// The deliberate carve-out (ADR-004): the modules MAY import the frozen PRESENCE_SIGNAL_KIND
// literal from mesh-relay-client.mjs (producer + consumer agree on the one wire `kind`) and
// the frame-size floor (DEFAULT_MAX_FRAME_BYTES / resolveMaxFrameBytes) from mesh-relay.mjs
// (the shared never-crash over-limit number) — a const literal and a size floor are not a
// persist seam. The durability line this gate draws is the fs / record-write seam.
//
// This is the invariant fitness #3 (acd-presence-write-scope) does NOT cover: fitness #3
// greps ONLY src/mesh-presence.mjs + src/commands/mesh-heartbeat.mjs, so a NEW subscriber
// that wrote a durable record would slip past it. ADR-004 authors this gate to close that
// gap — the "applied signal is not a durable authority" invariant, made structural.
//
// Source-discipline grep modelled on acd-relay-stateless (fitness #1): scans run over
// comment-stripped source (for import-specifier reads) and comment-AND-string-stripped
// source (for live-code identifier matchers), so a module's DOCUMENTING mentions of
// "writeText" / "presenceRecordPath" / "publishPresenceRecord" do NOT trip the guards —
// only real code does. Three proofs, each paired with a non-vacuous self-check (the m03
// lesson — the detector demonstrably fires on a planted violation AND stays quiet on an
// accepted form):
//   (a) NO DURABLE WRITE: no writeText/writeFile/appendFile/... call in either module
//       (they apply the signal into an in-memory cache, never disk).
//   (b) NO WRITE/PERSIST-SEAM IMPORT + NO publishPresenceRecord: neither module imports
//       node:fs / node:fs/promises / fs.mjs / mesh-presence.mjs / mesh-store.mjs, and
//       neither references publishPresenceRecord — so there is no seam through which a
//       durable record could be written. (mesh-relay-client.mjs is a sanctioned ADR-004
//       carve-out — the PRESENCE_SIGNAL_KIND literal, not a persist seam.)
//   (c) NO presenceRecordPath REFERENCE: neither module references presenceRecordPath (the
//       git-tracked write target), so the consumer can never join the durable path to write.
//
// State: GREEN against the delivered modules. src/mesh-presence-subscriber.mjs and
// src/mesh-presence-cache.mjs were built for the F1 close-out; this gate confirms the
// receive side is cache-only (no durable write, no persist-seam import, no
// presenceRecordPath reference). Were either module absent, readFile would reject and the
// gate would fail cleanly (module-not-found) — the RED-until-built discipline — so the gate
// is a live guard, not a placeholder.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUBSCRIBER = path.join(repoRoot, "src", "mesh-presence-subscriber.mjs");
const CACHE = path.join(repoRoot, "src", "mesh-presence-cache.mjs");
const RECEIVE_MODULES = [SUBSCRIBER, CACHE];

// Comment-stripped (strings RETAINED) — for import-specifier reads.
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Comment-AND-string-stripped — for live-code identifier matchers (writeText, writeFile,
// publishPresenceRecord, presenceRecordPath), so a documented / string mention is
// discounted and only a real reference survives.
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

// A durable WRITE call — writeText / writeFile / appendFile / writeFileSync / outputFile.
const DURABLE_WRITE = /\b(?:writeText|writeFile|writeFileSync|appendFile|appendFileSync|outputFile)\s*\(/;

// A write/persist-seam import specifier (any of these would give the consumer a way to
// reach disk or the record schema's DURABLE-WRITE path):
//   - node:fs / node:fs/promises / the repo's fs.mjs seam → a raw disk write.
//   - mesh-presence.mjs → carries publishPresenceRecord (the durable git write).
//   - mesh-store.mjs → carries presenceRecordPath + the atomic write seam.
// NOT forbidden (a deliberate carve-out, per ADR-004): mesh-relay-client.mjs (the frozen
// PRESENCE_SIGNAL_KIND literal — a const the cache reuses so producer + consumer agree on
// the one wire `kind`; it is the PUSH seam, not a persist seam) and mesh-relay.mjs (the
// never-crash frame-size floor DEFAULT_MAX_FRAME_BYTES/resolveMaxFrameBytes the subscriber
// shares with the broker). Importing a literal or the frame-size floor does NOT make the
// consumer a second system of record — the durability line is the fs / record-write seam.
function importsWriteSeam(specs) {
  return specs.some(
    (s) =>
      /^node:fs(\/promises)?$/.test(s) ||
      /(^|\/)fs\.mjs$/.test(s) ||
      /(^|\/)mesh-presence\.mjs$/.test(s) ||
      /(^|\/)mesh-store\.mjs$/.test(s)
  );
}

export const archTests = [
  {
    name: "arch/presence-subscriber-cache-only: the subscriber + cache perform NO durable write (no writeText/writeFile of a record) — the applied signal lives in an in-memory cache",
    run: async () => {
      for (const moduleFile of RECEIVE_MODULES) {
        const liveCode = stripCommentsAndStrings(await readFile(moduleFile, "utf8"));
        assert.ok(
          !DURABLE_WRITE.test(liveCode),
          `${path.basename(moduleFile)} calls NO writeText/writeFile/appendFile (no durable write — the receive-side consumer is an in-memory cache, never a second system of record)`
        );
      }
      // Self-check (non-vacuous): the matcher FIRES on a real writeText call and does NOT
      // fire on a documented/string mention (the comment/string is stripped).
      assert.ok(DURABLE_WRITE.test("await writeText(presenceRecordPath(ws, id), body);"), "guard catches a real writeText call");
      assert.ok(
        !DURABLE_WRITE.test(stripCommentsAndStrings('// the subscriber never calls writeText on the applied signal')),
        "guard does NOT fire on a documented mention"
      );
    },
  },
  {
    name: "arch/presence-subscriber-cache-only: the subscriber + cache import NO write/persist seam and reference NO publishPresenceRecord — there is no seam through which a durable record could be written",
    run: async () => {
      for (const moduleFile of RECEIVE_MODULES) {
        const raw = await readFile(moduleFile, "utf8");
        const specs = importSpecifiers(stripCommentsOnly(raw));
        assert.equal(
          importsWriteSeam(specs),
          false,
          `${path.basename(moduleFile)} imports NO write/persist seam (node:fs / node:fs/promises / fs.mjs / mesh-presence.mjs / mesh-store.mjs). imports: ${specs.join(", ")}`
        );
        // No publishPresenceRecord reference in live code (the durable-write function it
        // must never call — over comment-AND-string-stripped source).
        const liveCode = stripCommentsAndStrings(raw);
        assert.ok(
          !/\bpublishPresenceRecord\b/.test(liveCode),
          `${path.basename(moduleFile)} references NO publishPresenceRecord (the durable git-write function — the consumer never writes the record the git bus carries)`
        );
      }
      // Self-check (non-vacuous): the import reader DOES catch a real fs / mesh-presence
      // import, and does NOT fire on the injected-transport ws import the subscriber MAY use
      // (the subscriber takes an INJECTED transport, so it need not even import ws — but if
      // it does for a real-socket helper, that is not a write/persist seam).
      assert.ok(
        importsWriteSeam(importSpecifiers('import { writeText } from "./fs.mjs";')),
        "the reader catches a real fs.mjs persist-seam import"
      );
      assert.ok(
        importsWriteSeam(importSpecifiers('import { publishPresenceRecord } from "./mesh-presence.mjs";')),
        "the reader catches a real mesh-presence.mjs import"
      );
      assert.ok(
        !importsWriteSeam(importSpecifiers('import { WebSocket } from "ws";')),
        "the reader does NOT fire on the ws transport import (not a write/persist seam)"
      );
      // Self-check: the publishPresenceRecord matcher fires on a real call, not a comment.
      assert.ok(/\bpublishPresenceRecord\b/.test("await publishPresenceRecord(ws, id, r);"), "the publishPresenceRecord matcher catches a real call");
    },
  },
  {
    name: "arch/presence-subscriber-cache-only: the subscriber + cache reference NO presenceRecordPath — they can never join the git-tracked durable path to write",
    run: async () => {
      for (const moduleFile of RECEIVE_MODULES) {
        const liveCode = stripCommentsAndStrings(await readFile(moduleFile, "utf8"));
        assert.ok(
          !/\bpresenceRecordPath\b/.test(liveCode),
          `${path.basename(moduleFile)} references NO presenceRecordPath (the git-tracked write target) — the applied signal is keyed in memory by nodeId, never joined to a durable path`
        );
      }
      // Self-check (non-vacuous): the matcher FIRES on a real presenceRecordPath reference
      // and does NOT fire on a documented/string mention (stripped).
      assert.ok(/\bpresenceRecordPath\b/.test("writeText(presenceRecordPath(ws, id), body);"), "guard catches a real presenceRecordPath reference");
      assert.ok(
        !/\bpresenceRecordPath\b/.test(stripCommentsAndStrings('// git durability writes presenceRecordPath; the cache never does')),
        "guard does NOT fire on a documented mention"
      );
    },
  },
];
