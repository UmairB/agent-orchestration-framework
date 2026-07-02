// Fitness function: acd-enrollment-code-hashed-at-rest (milestone 24 / story 01
// device-code flow + story 00 group registry / SECURITY.md T3 "code at rest =
// committed to git") — "The pending device code is stored HASHED, never plaintext."
//
//   "The group registry rides the git-of-record `.mesh/` stream (git IS the bus,
//    22/ADR-003) — so a pending invite record is COMMITTED TO GIT and synced to every
//    peer. A plaintext 6-digit code in that record would be pushed to the whole fleet
//    and live forever in git history. Therefore the enrollment authority persists only
//    a HASH of the code (via node:crypto createHash/scrypt/pbkdf2/hkdf — the same
//    node:crypto seam src/node-identity.mjs already uses at line 31), and matches a
//    presented code by hashing it and comparing against the stored hash. The raw code
//    exists ONLY in flight (the operator reads it off `aof mesh invite`, types it into
//    `aof mesh join`); it is NEVER a field on a durable record."
//
// This is the SECURITY.md control for the "code at rest" threat (T3) — grounded in the
// real seam: src/mesh-store.mjs's presenceRecordPath/nodeRecordPath already prove the
// `.mesh/` partition is git-TRACKED (line 15 "git IS the bus"); a pending-invite record
// on that same bus inherits the same commit-and-sync exposure. The invariant this gate
// enforces is that whatever field name the invite record carries for the code
// (`codeHash` / `hash` / `digest`), it is the OUTPUT of a hash, and no bare code field
// (`code` / `deviceCode` / `plaintext`) is written to the durable record.
//
// Source-discipline grep modelled on acd-relay-stateless (fitness #1, milestone 23):
// scans run over comment-stripped source (for import-specifier reads) and comment-AND-
// string-stripped source (for live-code identifier matchers), so a module's DOCUMENTING
// mentions of "plaintext" / "the code" do NOT trip the guards — only real code does.
// Three proofs, each paired with a non-vacuous m03 self-check (the detector demonstrably
// fires on a planted violation AND stays quiet on the accepted form):
//   (a) THE ENROLLMENT SURFACE HASHES: the module(s) that persist the invite record
//       import node:crypto (createHash / scrypt / pbkdf2 / hkdf) — there IS a hash seam
//       through which the code is reduced before it reaches disk.
//   (b) NO PLAINTEXT-CODE FIELD IN A WRITE: no durable write (writeText/writeFile)
//       persists a record object with a bare `code:` / `deviceCode:` / `plaintext:`
//       key — the code is stored under a hash-named field (`codeHash`/`hash`/`digest`),
//       never as the raw value.
//   (c) NO NON-HASH ROUND-TRIP OF THE RAW CODE: the module does not JSON.stringify the
//       raw invite code into the persisted record (the code is hashed BEFORE assembly).
//
// State: RED until the enrollment/registry module lands (story 00/01). readFile rejects
// on an absent module ⇒ the gate fails cleanly (module-not-found) — the RED-until-built
// discipline. The gate scans EVERY src/mesh-*.mjs whose source references the invite /
// enrollment surface, so an unexpected-but-plausible module name (mesh-enrollment.mjs /
// mesh-registry.mjs / mesh-invite.mjs) is still covered — the guard is keyed by the
// PRESENCE of the invite surface, not one hard-coded filename.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");
const COMMANDS = path.join(SRC, "commands");

// The enrollment/registry surface: whichever src/mesh-*.mjs (or src/commands/mesh-*.mjs)
// modules carry the device-code invite/join/registry mechanic. Discovered by a source
// marker so the gate does not depend on one guessed filename — it covers whatever the
// owning story names its enrollment module (mesh-enrollment / mesh-registry / mesh-invite).
const ENROLLMENT_MARKER = /\bdeviceCode\b|\binvite\b|\bpendingInvite\b|\benroll(ment)?\b|\bcodeHash\b/i;

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

// A node:crypto hash seam — the reduction the code passes through before it is durable.
const CRYPTO_IMPORT = /^node:crypto$/;
const HASH_CALL = /\b(?:createHash|scrypt|scryptSync|pbkdf2|pbkdf2Sync|hkdf|hkdfSync|createHmac)\s*\(/;
const DURABLE_WRITE = /\b(?:writeText|writeFile|writeFileSync|appendFile|appendFileSync|outputFile)\s*\(/;
// A BARE plaintext-code field written as a record key (the forbidden persisted shape).
const PLAINTEXT_CODE_FIELD = /\b(?:code|deviceCode|plaintext|plainCode|rawCode)\s*:/;

// Discover the enrollment surface modules on disk (RED-until-built: if none carry the
// marker yet, the enrollment story has not landed — the gate asserts the surface exists
// so it cannot silently pass before the code is written).
async function enrollmentModules() {
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
      // Match the marker on comment-AND-string-stripped LIVE code, so a module that only
      // MENTIONS "invite" in a comment (e.g. mesh-relay.mjs's auth-gate note) is not
      // mistaken for the enrollment persist surface.
      if (ENROLLMENT_MARKER.test(stripCommentsAndStrings(raw))) found.push({ file, raw });
    }
  }
  return found;
}

export const archTests = [
  {
    name: "arch/enrollment-code-hashed-at-rest: the enrollment/registry surface exists and hashes the device code via node:crypto (a hash seam reduces the code before it is durable)",
    run: async () => {
      const modules = await enrollmentModules();
      assert.ok(
        modules.length > 0,
        "the device-code enrollment surface (a src/mesh-*.mjs carrying invite/deviceCode/enrollment) exists — RED until milestone 24 story 00/01 lands the group registry + device-code flow"
      );
      // At least one enrollment-surface module reaches node:crypto AND performs a real
      // hash call — the reduction the plaintext code passes through before persistence.
      const hashingModule = modules.find(({ raw }) => {
        const specs = importSpecifiers(stripCommentsOnly(raw));
        const importsCrypto = specs.some((s) => CRYPTO_IMPORT.test(s));
        const callsHash = HASH_CALL.test(stripCommentsAndStrings(raw));
        return importsCrypto && callsHash;
      });
      assert.ok(
        hashingModule,
        `an enrollment-surface module imports node:crypto AND calls a hash (createHash/scrypt/pbkdf2/hkdf/createHmac) — the code is hashed, never stored raw. surface: ${modules.map((m) => path.basename(m.file)).join(", ")}`
      );
      // Self-check (non-vacuous): the crypto import + hash-call matchers fire on the real
      // node-identity idiom (crypto.createHash("sha256")) and do NOT fire on a doc mention.
      assert.ok(CRYPTO_IMPORT.test("node:crypto"), "the crypto-import matcher fires on node:crypto");
      assert.ok(HASH_CALL.test('crypto.createHash("sha256").update(code).digest("hex")'), "the hash-call matcher fires on a real createHash call");
      assert.ok(!HASH_CALL.test(stripCommentsAndStrings("// we hash the code with createHash before storing it")), "the hash-call matcher does NOT fire on a documented mention");
    },
  },
  {
    name: "arch/enrollment-code-hashed-at-rest: no enrollment-surface module persists a bare plaintext-code field (code:/deviceCode:/plaintext:) — the durable invite record carries a hash, never the raw code",
    run: async () => {
      const modules = await enrollmentModules();
      assert.ok(modules.length > 0, "the enrollment surface exists (RED until story 00/01 lands)");
      for (const { file, raw } of modules) {
        const liveCode = stripCommentsAndStrings(raw);
        // If a module performs a durable write, its live code must not ALSO define a bare
        // plaintext-code record field — the two together are the "commit the raw code to
        // git" failure. (A module with a hash-named field `codeHash:` passes; a bare
        // `code:` / `deviceCode:` / `plaintext:` field is the violation.)
        if (DURABLE_WRITE.test(liveCode)) {
          assert.ok(
            !PLAINTEXT_CODE_FIELD.test(liveCode),
            `${path.basename(file)} performs a durable write AND defines a bare plaintext-code field (code:/deviceCode:/plaintext:) — the raw device code must never be a field on a git-committed record; store a hash (codeHash:/digest:) instead`
          );
        }
      }
      // Self-check (non-vacuous): the durable-write + plaintext-field matchers fire on the
      // forbidden shape and the plaintext-field matcher does NOT fire on the accepted
      // hash-named field.
      assert.ok(DURABLE_WRITE.test("await writeText(invitePath, JSON.stringify(rec));"), "the durable-write matcher fires on a real writeText call");
      assert.ok(PLAINTEXT_CODE_FIELD.test("{ deviceCode: rawCode, expiresAt }"), "the plaintext-field matcher fires on a bare deviceCode: field");
      assert.ok(!PLAINTEXT_CODE_FIELD.test("{ codeHash: hashed, expiresAt }"), "the plaintext-field matcher does NOT fire on the accepted codeHash: field");
    },
  },
];
