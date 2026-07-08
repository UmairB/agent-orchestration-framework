// Fitness function: acd-targeting-matcher-descriptor-pure (milestone 27 / story 00
// / ADR-003 / fitness #3) — "The matcher reads only the frozen descriptor fields;
// it imports no node-identity mechanic."
//
//   "nodeSatisfiesTarget(descriptor, target) in src/mesh-issuance.mjs reads ONLY
//    the frozen 22/ADR-003 fields (nodeId/runtimes/skills); any ⇒ true, node ⇒
//    nodeId match, capability ⇒ runtimes-or-skills membership, unknown kind ⇒
//    false; the module imports NO node-identity.mjs (no derive/assemble — the
//    matcher re-derives nothing)."
//
// Modelled on acd-run-store-mesh-free's import-specifier grep (comment-stripped)
// + the m03 planted-violation self-check discipline: inject a mutated source
// string reading e.g. `descriptor.host` and confirm the gate flags it (a
// non-vacuous proof the guard can actually fail).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_ISSUANCE = path.join(repoRoot, "src", "mesh-issuance.mjs");

function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

const NODE_IDENTITY_MODULE = /(^|\/)node-identity\.mjs$/;

// Extract the nodeSatisfiesTarget function BODY (balanced-brace extraction — the
// acd-run-store-mesh-free paramsOf idiom, applied to the function body instead of
// the parameter list).
function extractMatcherBody(source) {
  const m = /function\s+nodeSatisfiesTarget\s*\([^)]*\)\s*\{/.exec(source);
  if (!m) return null;
  const open = source.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

// The gate: the matcher body may reference ONLY these descriptor field names off
// its first argument (`descriptor`) — any OTHER `descriptor.<field>` /
// `descriptor?.<field>` access is a violation (the m03 planted-violation
// discipline below proves this fires).
const ALLOWED_DESCRIPTOR_FIELDS = new Set(["nodeId", "runtimes", "skills"]);

function descriptorFieldAccesses(body) {
  const re = /\bdescriptor\??\.(\w+)/g;
  const fields = [];
  let m;
  while ((m = re.exec(body)) !== null) fields.push(m[1]);
  return fields;
}

export const archTests = [
  {
    name: "arch/targeting-matcher-descriptor-pure: src/mesh-issuance.mjs imports NO node-identity.mjs (no derive/assemble — the matcher re-derives nothing)",
    run: async () => {
      const source = await readFile(MESH_ISSUANCE, "utf8");
      const specs = importSpecifiers(stripCommentsOnly(source));
      const identityImports = specs.filter((s) => NODE_IDENTITY_MODULE.test(s));
      assert.deepEqual(identityImports, [], `src/mesh-issuance.mjs imports no node-identity.mjs — imports: ${specs.join(", ")}`);
      // Self-check (non-vacuous): the matcher catches a real node-identity import form.
      for (const bad of ["./node-identity.mjs", "../src/node-identity.mjs"]) {
        assert.ok(NODE_IDENTITY_MODULE.test(bad), `the matcher catches a real ${bad} import`);
      }
      assert.ok(!NODE_IDENTITY_MODULE.test("./mesh-store.mjs"), "the matcher does NOT flag the module's legitimate dependency (./mesh-store.mjs)");
    },
  },
  {
    name: "arch/targeting-matcher-descriptor-pure: nodeSatisfiesTarget's body reads ONLY nodeId/runtimes/skills off its descriptor argument — no other frozen field",
    run: async () => {
      const source = stripCommentsOnly(await readFile(MESH_ISSUANCE, "utf8"));
      const body = extractMatcherBody(source);
      assert.ok(body != null, "nodeSatisfiesTarget is defined in src/mesh-issuance.mjs");
      const fields = descriptorFieldAccesses(body);
      assert.ok(fields.length > 0, "the matcher body reads at least one descriptor field (non-vacuous — it must read something)");
      const disallowed = fields.filter((f) => !ALLOWED_DESCRIPTOR_FIELDS.has(f));
      assert.deepEqual(disallowed, [], `the matcher reads only nodeId/runtimes/skills off descriptor — found disallowed field(s): ${disallowed.join(", ")}`);
    },
  },
  {
    name: "arch/targeting-matcher-descriptor-pure (m03 planted-violation self-check): a mutated source reading descriptor.host is FLAGGED by the same field-access gate",
    run: async () => {
      const planted = `
        export function nodeSatisfiesTarget(descriptor, target) {
          const kind = target?.kind;
          if (kind === "any") return true;
          if (kind === "node") return descriptor?.host === target.nodeId;
          return false;
        }
      `;
      const body = extractMatcherBody(planted);
      assert.ok(body != null, "the planted fixture's function body is extractable (non-vacuous harness)");
      const fields = descriptorFieldAccesses(body);
      const disallowed = fields.filter((f) => !ALLOWED_DESCRIPTOR_FIELDS.has(f));
      assert.ok(disallowed.includes("host"), `the gate FLAGS the planted violation reading descriptor.host — found: ${disallowed.join(", ")}`);
    },
  },
];
