// Fitness function: acd-relay-lease-blind (milestone 26, ADR-004 / fitness #10) —
// "ZERO relay change: the 23/ADR-001 promise cashed."
//
//   "src/mesh-relay.mjs contains NO lease reference — no lease-kind literal, no
//    lease-module import, no LEASE_SIGNAL_KIND — the broker stays KIND-BLIND while
//    carrying the second kind (it parses only { kind, nodeId } for routing and forwards
//    unknown kinds byte-for-byte). The frozen lease kind literal lives in
//    src/mesh-relay-client.mjs and ONLY there."
//
// This gate was GREEN before story 02 landed and MUST STAY GREEN through it — it exists
// to catch the tempting edit (teaching the broker the second kind). Three proofs, each
// paired with a non-vacuous self-check (the m03 lesson):
//   (a) the relay source (comment-stripped, strings RETAINED so a `kind === "lease"`
//       branch is caught) carries no `lease` token and no LEASE_SIGNAL_KIND reference;
//   (b) the relay imports no lease module (mesh-lease.mjs) and no relay-client module
//       (mesh-relay-client.mjs — where the kind literal lives);
//   (c) the positive half: LEASE_SIGNAL_KIND is DEFINED exactly once across src/, in
//       mesh-relay-client.mjs, with the frozen value "lease".
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEASE_SIGNAL_KIND } from "../../src/mesh-relay-client.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELAY = path.join(repoRoot, "src", "mesh-relay.mjs");
const RELAY_CLIENT = path.join(repoRoot, "src", "mesh-relay-client.mjs");
const SRC = path.join(repoRoot, "src");

// Comment-stripped, strings RETAINED — a broker branching on the "lease" string
// literal must be caught, so strings stay in scope for the token grep.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

async function srcModules(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await srcModules(abs)));
    else if (entry.name.endsWith(".mjs")) out.push(abs);
  }
  return out;
}

export const archTests = [
  {
    name: "arch/relay-lease-blind: src/mesh-relay.mjs contains NO lease token and NO LEASE_SIGNAL_KIND reference — the broker stays kind-blind while carrying the second kind",
    async run() {
      const code = stripComments(await readFile(RELAY, "utf8"));
      assert.ok(
        !/\blease\b/i.test(code),
        "mesh-relay.mjs carries no `lease` token (no lease-kind literal, no lease branch — the broker never learned the second kind)"
      );
      assert.ok(!/\bLEASE_SIGNAL_KIND\b/.test(code), "mesh-relay.mjs references no LEASE_SIGNAL_KIND");
      // Self-check (non-vacuous): the token detector fires on a real kind branch —
      // and the comment-strip does NOT hide a string literal.
      assert.ok(/\blease\b/i.test(stripComments('if (parsed.kind === "lease") { grant(parsed); }')), "the detector catches a broker lease-kind branch");
      // The comment-tolerance half genuinely depends on stripComments: the SAME text
      // carries the bare `lease` token (it WOULD trip unstripped) and stops matching
      // only because the comment is stripped.
      const docOnly = "// the lease kind rides second";
      assert.ok(/\blease\b/i.test(docOnly), "the doc-only sample carries the bare token unstripped (the self-check is non-vacuous)");
      assert.ok(!/\blease\b/i.test(stripComments(docOnly)), "a comment mention alone would not trip the gate (stripComments removes it)");
    },
  },
  {
    name: "arch/relay-lease-blind: src/mesh-relay.mjs imports no lease module and no relay-client module — no seam through which the broker could learn the kind",
    async run() {
      const specs = importSpecifiers(stripComments(await readFile(RELAY, "utf8")));
      assert.ok(
        !specs.some((s) => /(^|\/)mesh-lease\.mjs$/.test(s)),
        `mesh-relay.mjs imports no mesh-lease.mjs. imports: ${specs.join(", ")}`
      );
      assert.ok(
        !specs.some((s) => /(^|\/)mesh-relay-client\.mjs$/.test(s)),
        `mesh-relay.mjs imports no mesh-relay-client.mjs (where the kind literal lives). imports: ${specs.join(", ")}`
      );
      // Self-check (non-vacuous): the import reader catches a real lease-module import.
      assert.ok(
        importSpecifiers('import { acquireLease } from "./mesh-lease.mjs";').some((s) => /(^|\/)mesh-lease\.mjs$/.test(s)),
        "the reader catches a real mesh-lease.mjs import"
      );
    },
  },
  {
    name: "arch/relay-lease-blind: LEASE_SIGNAL_KIND is defined exactly once across src/ — in mesh-relay-client.mjs, with the frozen value 'lease'",
    async run() {
      // The positive half: the second kind EXISTS and its literal has ONE home.
      assert.equal(LEASE_SIGNAL_KIND, "lease", "the frozen lease kind literal is 'lease'");
      const definers = [];
      for (const moduleFile of await srcModules(SRC)) {
        const code = stripComments(await readFile(moduleFile, "utf8"));
        if (/\bLEASE_SIGNAL_KIND\s*=/.test(code)) definers.push(moduleFile);
      }
      assert.deepEqual(definers, [RELAY_CLIENT], "LEASE_SIGNAL_KIND is defined in mesh-relay-client.mjs and ONLY there");
      // Self-check (non-vacuous): the definition detector fires on a real definition.
      assert.ok(/\bLEASE_SIGNAL_KIND\s*=/.test('export const LEASE_SIGNAL_KIND = "lease";'), "the detector catches a definition");
    },
  },
];
