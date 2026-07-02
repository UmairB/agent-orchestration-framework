// Fitness function: acd-relay-auth-gate-checked (milestone 24 / story 02 relay-auth +
// revocation / SECURITY.md T1 "the pre-auth→authenticated relay transition" + T6
// "revocation completeness", the 22/R6 "the credential is actually USED" guard) —
// "The relay ws auth-gate REJECTS a connection without a valid, non-revoked credential,
// and the credential is READ + CHECKED against the roster/revocation list BEFORE any
// signal is brokered."
//
//   "m23's relay stood up PRE-AUTH: src/mesh-relay.mjs binds 127.0.0.1 loopback and the
//    ONLY admission control on the ws upgrade is the pathname destroy (any pathname !=
//    /ws/relay ⇒ socket.destroy()) — 23/ADR-001 §Security-posture states plainly the
//    trust boundary lands in m24. m24 makes the relay GROUP-REACHABLE + credential-
//    checked. The failure mode this gate closes is a credential that is ISSUED but never
//    CHECKED (22/R6: 'an issued credential that is never checked'), OR a revocation that
//    only half-applies. So the relay's connection admission MUST (a) read the presented
//    credential off the upgrade, (b) verify it against the group roster AND the
//    revocation list, and (c) REJECT (destroy / 401 / close) an absent/invalid/revoked
//    credential — and this gate MUST run inside/at the upgrade handler, BEFORE the
//    socket is added to the fan-out set (before any signal is brokered)."
//
// This is the SECURITY.md control for the pre-auth→authenticated transition (T1) and the
// enforcement half of revocation completeness (T6). It is grounded in the REAL seam: the
// existing `server.on("upgrade", ...)` handler in src/mesh-relay.mjs (lines ~133-148,
// which today only destroys non-relay pathnames and calls wss.handleUpgrade with NO
// credential check) and the `clients.add(ws)` fan-out registration (line ~155) the gate
// must precede.
//
// The invariant has two structural facets, each a proof:
//   (a) AN AUTH-GATE EXISTS AND IS WIRED INTO ADMISSION: src/mesh-relay.mjs imports /
//       references a credential-verify seam (a verifyCredential/authorizeConnection/
//       checkRoster helper — from the credential module, story 02) AND the upgrade
//       handler REJECTS (socket.destroy() / socket.write 401 / ws.close) on a failed
//       check. The gate is not a bare boolean elsewhere — the relay's admission path
//       must call it.
//   (b) THE CHECK CONSULTS THE REVOCATION LIST: the verify path reads a revocation /
//       roster source (revoked/revocation/roster) — a credential that verifies against
//       an issue-time signature but NEVER reads the current revocation list is the
//       "revocation that never applies" half of T6. The relay auth decision must be a
//       function of the LIVE roster/revocation state, not a static issue-time token.
//
// Source-discipline grep modelled on acd-relay-envelope-neutral (milestone 23): comment-
// stripped for import reads, comment-AND-string-stripped for live-code matchers. Each
// proof carries an m03 non-vacuous self-check.
//
// State: RED until story 02 adds the auth-gate to src/mesh-relay.mjs (today the module is
// pre-auth: the upgrade handler has NO credential check — this gate fails cleanly against
// the m23 loopback relay, which is the correct RED state, and turns GREEN when the m24
// auth-gate lands). NOTE the deliberate tension with milestone 23's acd-relay-stateless /
// acd-relay-envelope-neutral: those forbid the relay importing a RECORD SCHEMA for
// PERSISTENCE (mesh-store/mesh-presence). A credential-VERIFY seam is NOT a record-persist
// import (the relay reads the roster to AUTHORIZE, it does not persist a record) — the
// two gates are compatible: the relay stays stateless (no durable write) AND checks the
// credential (a read). The credential-module import the auth-gate adds is a READ seam, not
// the mesh-store/mesh-presence persist seam acd-relay-stateless forbids.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// A credential-verify seam call — the auth decision the admission path makes.
const VERIFY_CALL = /\b(?:verifyCredential|authorizeConnection|authorizeUpgrade|checkCredential|authenticate(?:Connection|Credential)?|isAuthorized|assertAuthorized)\s*\(/;
// A rejection on a failed check — the upgrade handler must be able to DENY.
const REJECT_FORM = /socket\.destroy\s*\(|socket\.write\s*\(|\.close\s*\(\s*(?:40\d\d?|1008|4401)|writeHead\s*\(\s*40\d/;
// Evidence the auth decision reads the LIVE revocation/roster state.
const REVOCATION_READ = /\brevoc?(?:ation|ed)\b|\brosterHas\b|\bisRevoked\b|\bisMember\b|\breadRoster\b|\brevocationList\b/i;

export const archTests = [
  {
    name: "arch/relay-auth-gate-checked: the relay's upgrade admission calls a credential-verify seam AND rejects on failure — a connection without a valid credential is denied (the pre-auth→authenticated transition, 22/R6 'the credential is actually used')",
    run: async () => {
      const raw = await readFile(MESH_RELAY, "utf8");
      const liveCode = stripCommentsAndStrings(raw);
      // (a) The admission path calls a credential-verify seam.
      assert.ok(
        VERIFY_CALL.test(liveCode),
        "src/mesh-relay.mjs calls a credential-verify seam (verifyCredential/authorizeConnection/authenticate/isAuthorized) in its admission path — RED until milestone 24 story 02 adds the auth-gate to the m23 pre-auth relay (today the upgrade handler only destroys a non-relay pathname; there is no credential check)"
      );
      // (b) The relay can REJECT — the upgrade handler denies a failed check.
      assert.ok(
        REJECT_FORM.test(liveCode),
        "src/mesh-relay.mjs rejects a failed auth (socket.destroy() / a 401/1008 close) — the gate must DENY, not just observe"
      );
      // Self-checks (non-vacuous).
      assert.ok(VERIFY_CALL.test("if (!(await verifyCredential(cred, roster))) socket.destroy();"), "the verify matcher fires on a real verifyCredential call");
      assert.ok(REJECT_FORM.test("socket.destroy();"), "the reject matcher fires on socket.destroy()");
      assert.ok(!VERIFY_CALL.test(stripCommentsAndStrings("// the upgrade handler must verifyCredential before adding the socket")), "the verify matcher does NOT fire on a documented mention");
    },
  },
  {
    name: "arch/relay-auth-gate-checked: the relay's auth decision consults the LIVE revocation/roster state — a revoked credential is rejected (revocation completeness, T6)",
    run: async () => {
      const raw = await readFile(MESH_RELAY, "utf8");
      // The revocation/roster read may live in mesh-relay.mjs directly OR in an imported
      // credential module the relay calls. Accept either: the relay imports a credential
      // module (whose verify reads revocation) OR references the revocation/roster read
      // itself. This keeps the invariant (the decision is a function of LIVE state)
      // without dictating exactly where the roster read is factored.
      const specs = importSpecifiers(stripCommentsOnly(raw));
      const importsCredentialModule = specs.some(
        (s) => /(^|\/)mesh-credential\.mjs$/.test(s) || /(^|\/)mesh-registry\.mjs$/.test(s) || /(^|\/)mesh-enrollment\.mjs$/.test(s)
      );
      const readsRevocationInline = REVOCATION_READ.test(stripCommentsAndStrings(raw));
      assert.ok(
        importsCredentialModule || readsRevocationInline,
        "src/mesh-relay.mjs's auth decision reads the LIVE revocation/roster — either by importing the credential/registry module (whose verify consults the revocation list) or by referencing the revocation/roster read inline. A credential that verifies an issue-time signature but never reads the current revocation list is the 'revocation that never applies' hole (T6) — RED until story 02 wires the roster/revocation read into the relay auth-gate"
      );
      // Self-checks (non-vacuous).
      assert.ok(
        importSpecifiers('import { verifyCredential } from "./mesh-credential.mjs";').some((s) => /mesh-credential\.mjs$/.test(s)),
        "the credential-module import reader catches a real mesh-credential.mjs import"
      );
      assert.ok(REVOCATION_READ.test("if (isRevoked(nodeId)) return deny();"), "the revocation-read matcher fires on an isRevoked call");
      assert.ok(!REVOCATION_READ.test("const roster = await readNodeRecords(workspace);"), "the revocation-read matcher does NOT fire on an unrelated roster read that is not a revocation check");
    },
  },
];
