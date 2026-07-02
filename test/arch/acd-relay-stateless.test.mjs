// Fitness function: acd-relay-stateless (milestone 23 / story 01 / ADR-001 / fitness #1)
// — "Relay statelessness / never a system of record."
//
//   "The relay module (src/mesh-relay.mjs) persists NO authoritative state and imports
//    NO record schema for persistence — it brokers ephemeral envelopes IN MEMORY ONLY
//    and fans them out: it performs no writeText/writeFile of a record (no durable
//    write), does not import mesh-store.mjs / mesh-presence.mjs / node-identity.mjs (the
//    record schema for persistence), and holds no on-disk store. It stages/fans-out
//    frames, not fields. Killing it loses LIVENESS, not DATA."
//
// Source-discipline grep modelled on acd-mesh-sync-record-neutral (the call-form-not-
// comment discipline: scans run over comment-stripped — and where the property is about
// live code, comment-AND-string-stripped — source, so the module's DOCUMENTING mentions
// of "writeText"/"mesh-store"/"persist" do NOT trip). Three proofs:
//   (a) NO RECORD-SCHEMA IMPORT: src/mesh-relay.mjs imports none of mesh-store.mjs /
//       mesh-presence.mjs / node-identity.mjs (it never sees the record it brokers).
//   (b) NO DURABLE WRITE: no writeText/writeFile/appendFile/writeFileSync call (it holds
//       the in-flight frame in memory only — over comment-AND-string-stripped live code).
//   (c) NO FS PERSISTENCE IMPORT: it does not import node:fs / node:fs/promises / the
//       repo's fs.mjs seam (no on-disk store).
//
// Non-vacuous: each matcher is self-checked against the exact forbidden form (a real
// mesh-store import, a real writeText call, a real fs import) and against an accepted form
// (the ws/http serve import), so the guards demonstrably fire.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_RELAY = path.join(repoRoot, "src", "mesh-relay.mjs");

// Comment-stripped (strings RETAINED) — for import-specifier reads.
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Comment-AND-string-stripped — for live-code identifier matchers (writeText, writeFile),
// so a documented/string mention is discounted and only a real call survives.
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

export const archTests = [
  {
    name: "arch/relay-stateless: src/mesh-relay.mjs imports NO record schema for persistence (mesh-store.mjs / mesh-presence.mjs / node-identity.mjs) — it brokers frames, not fields",
    run: async () => {
      const specs = importSpecifiers(stripCommentsOnly(await readFile(MESH_RELAY, "utf8")));
      const importsRecordSchema = specs.some(
        (s) =>
          /(^|\/)mesh-store\.mjs$/.test(s) ||
          /(^|\/)mesh-presence\.mjs$/.test(s) ||
          /(^|\/)node-identity\.mjs$/.test(s) ||
          /(^|\/)mesh-identity\.mjs$/.test(s)
      );
      assert.equal(
        importsRecordSchema,
        false,
        `src/mesh-relay.mjs imports NO record schema (mesh-store / mesh-presence / node-identity / mesh-identity); it is stateless. imports: ${specs.join(", ")}`
      );
      // Self-check (non-vacuous): the reader DOES catch a real record-schema import, and
      // does NOT fire on the legitimate ws serve import.
      assert.ok(
        importSpecifiers('import { presenceRecordPath } from "./mesh-store.mjs";').some((s) => /mesh-store\.mjs$/.test(s)),
        "the specifier reader catches a real mesh-store.mjs import"
      );
      assert.ok(
        !importSpecifiers('import { WebSocketServer } from "ws";').some(
          (s) => /mesh-store\.mjs$/.test(s) || /mesh-presence\.mjs$/.test(s) || /node-identity\.mjs$/.test(s)
        ),
        "the reader does NOT fire on the legitimate ws serve import"
      );
    },
  },
  {
    name: "arch/relay-stateless: src/mesh-relay.mjs performs NO durable write (no writeText/writeFile of a record) — it holds the in-flight frame in memory only",
    run: async () => {
      const liveCode = stripCommentsAndStrings(await readFile(MESH_RELAY, "utf8"));
      assert.ok(
        !DURABLE_WRITE.test(liveCode),
        "src/mesh-relay.mjs calls NO writeText/writeFile/appendFile (no durable write — the relay is stateless, the in-flight frame lives in memory)"
      );
      // Self-check (non-vacuous): the matcher FIRES on a real writeText call and does NOT
      // fire on a documented mention (the comment/string is stripped).
      assert.ok(DURABLE_WRITE.test("await writeText(path, bytes);"), "guard catches a real writeText call");
      assert.ok(
        !DURABLE_WRITE.test(stripCommentsAndStrings('// the relay never calls writeText on a record')),
        "guard does NOT fire on a documented mention"
      );
    },
  },
  {
    name: "arch/relay-stateless: src/mesh-relay.mjs imports NO filesystem persistence seam (node:fs / node:fs/promises / fs.mjs) — it holds no on-disk store",
    run: async () => {
      const specs = importSpecifiers(stripCommentsOnly(await readFile(MESH_RELAY, "utf8")));
      const importsFs = specs.some(
        (s) => /^node:fs(\/promises)?$/.test(s) || /(^|\/)fs\.mjs$/.test(s)
      );
      assert.equal(
        importsFs,
        false,
        `src/mesh-relay.mjs imports NO filesystem seam (node:fs / node:fs/promises / fs.mjs) — no on-disk store. imports: ${specs.join(", ")}`
      );
      // Self-check (non-vacuous): the reader DOES catch a real node:fs import.
      assert.ok(
        importSpecifiers('import { writeFile } from "node:fs/promises";').some((s) => /^node:fs(\/promises)?$/.test(s)),
        "the reader catches a real node:fs/promises import"
      );
    },
  },
];
