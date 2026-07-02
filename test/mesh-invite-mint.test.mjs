// Traceability wiring for milestone 24 / story 01 — task 00 (tasks/00_mesh-invite-mint
// .feature). mesh:invite mints a short-lived single-use 6-digit code, records it HASHED
// as a pending invite, and returns the plaintext once.
//
// Covers EVERY @executable scenario, white-box over the REAL mesh:invite in the command
// core (loadWorkspace + invoke over a temp fixture), with an INJECTED issuedAt (never
// wall-clock — the 22/R2 discipline) and a config seeded WITH / WITHOUT the controlNode
// match (relayMode true/false). The registry is seeded + read via story 00's
// writeRegistry / readRegistry. The hash is treated as OPAQUE (codeHash present + no
// plaintext field — the algorithm is the security fitness's). One test object per
// scenario / Scenario Outline row group. node:assert/strict.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { writeRegistry, readRegistry, registryPath } from "../src/mesh-registry.mjs";
import { spawnCliSync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

const CONTROL_ID = "control-node-a";
const PEER_ID = "peer-node-b";
const INJECTED_ISSUED_AT = "2026-07-01T10:00:00.000Z";

// A fixture repo whose .aof config carries the mesh block the mint reads. `mesh`
// controls the control-node predicate + the enrollment knobs.
async function makeRepo(mesh) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-meshinvite-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh }, null, 2)}\n`,
    "utf8"
  );
  return repo;
}

const controlMesh = (extra = {}) => ({ nodeId: CONTROL_ID, relay: { controlNode: CONTROL_ID }, ...extra });
const nonControlMesh = () => ({ nodeId: PEER_ID, relay: { controlNode: CONTROL_ID } });
const controlConfig = () => ({ mesh: controlMesh() });

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

// A seeded registry with real roster/boards/revocations content, so the "unaffected
// lists byte-unchanged" (R4) assertions bite on something.
function seededRegistry() {
  return {
    roster: [{ nodeId: "node-x", admittedAt: "2026-06-30T09:00:00Z", boards: ["board-1"] }],
    boards: ["board-1"],
    pending: [{ codeHash: "OPAQUE-PRIOR-HASH", issuedAt: "2026-06-30T09:00:00Z", expiresAt: "2026-06-30T09:05:00Z", consumedAt: null }],
    revocations: [{ nodeId: "node-z", revokedAt: "2026-06-29T08:00:00Z", reason: "left" }],
  };
}

export const meshInviteMintTests = [
  // ══ Scenario: mesh:invite on the control node mints a 6-digit code, appends a
  //    pending invite, and returns the plaintext once ═══════════════════════════════
  {
    name: "mesh-invite-mint/00 on the control node mesh:invite mints a 6-digit code, appends ONE pending invite, returns the plaintext once, and leaves roster/boards/revocations byte-unchanged",
    async run() {
      const repo = await makeRepo(controlMesh());
      try {
        const ctx = await ctxFor(repo);
        await writeRegistry(ctx.workspace, seededRegistry(), controlConfig());
        const before = await readRegistry(ctx.workspace);

        const result = await invoke("mesh:invite", { issuedAt: INJECTED_ISSUED_AT }, ctx);

        // The --json result carries a 6-digit numeric plaintext code, returned once.
        assert.match(result.code, /^\d{6}$/, "the result carries a 6-digit numeric plaintext code");

        const after = await readRegistry(ctx.workspace);
        // The pending list has grown by exactly one entry.
        assert.equal(after.pending.length, before.pending.length + 1, "the pending list grew by exactly one entry");
        const entry = after.pending[after.pending.length - 1];
        // That pending entry is { codeHash, issuedAt, expiresAt, consumedAt: null }.
        assert.deepEqual(Object.keys(entry), ["codeHash", "issuedAt", "expiresAt", "consumedAt"], "the pending entry carries exactly the ADR-001 shape");
        assert.equal(entry.consumedAt, null, "consumedAt is null — unconsumed");
        assert.equal(typeof entry.codeHash, "string", "codeHash is present");
        // R4 — the UNAFFECTED side: roster, boards, revocations byte-unchanged.
        assert.equal(JSON.stringify(after.roster), JSON.stringify(before.roster), "the roster is byte-unchanged");
        assert.equal(JSON.stringify(after.boards), JSON.stringify(before.boards), "the boards list is byte-unchanged");
        assert.equal(JSON.stringify(after.revocations), JSON.stringify(before.revocations), "the revocations list is byte-unchanged");
        // The prior pending entry is untouched too (add-only append).
        assert.equal(JSON.stringify(after.pending[0]), JSON.stringify(before.pending[0]), "the prior pending invite is byte-unchanged (add-only)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the durable pending record carries codeHash, not the plaintext code ═
  {
    name: "mesh-invite-mint/00 the durable pending record carries codeHash and NO plaintext code field — the plaintext exists only in the returned result",
    async run() {
      const repo = await makeRepo(controlMesh());
      try {
        const ctx = await ctxFor(repo);
        const result = await invoke("mesh:invite", { issuedAt: INJECTED_ISSUED_AT }, ctx);

        const persisted = await readRegistry(ctx.workspace);
        const entry = persisted.pending[persisted.pending.length - 1];
        // A codeHash field is present (the hash value itself is OPAQUE here).
        assert.equal(typeof entry.codeHash, "string", "the persisted entry carries a codeHash field");
        assert.ok(entry.codeHash.length > 0, "codeHash is non-empty");
        // NO plaintext code field (no code / deviceCode / plaintext key).
        for (const forbidden of ["code", "deviceCode", "plaintext", "plainCode", "rawCode"]) {
          assert.ok(!(forbidden in entry), `the persisted entry carries no "${forbidden}" key`);
        }
        // The plaintext exists ONLY in the returned result — no persisted value IS it.
        assert.notEqual(entry.codeHash, result.code, "the stored codeHash is not the plaintext code");
        for (const value of Object.values(entry)) {
          assert.notEqual(value, result.code, "no persisted field holds the plaintext code");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: expiresAt is issuedAt + resolveCodeTtlSeconds over the
  //    injected issuedAt (rows: absent→300, 600→600, 60→60) ═════════════════════════
  {
    name: "mesh-invite-mint/00 expiresAt equals the injected issuedAt plus resolveCodeTtlSeconds — absent config → 300s default; 600 → 600s; 60 → 60s",
    async run() {
      const rows = [
        { configured: undefined, ttlSeconds: 300 },
        { configured: 600, ttlSeconds: 600 },
        { configured: 60, ttlSeconds: 60 },
      ];
      for (const row of rows) {
        const mesh = row.configured === undefined
          ? controlMesh()
          : controlMesh({ enrollment: { codeTtlSeconds: row.configured } });
        const repo = await makeRepo(mesh);
        try {
          const ctx = await ctxFor(repo);
          const result = await invoke("mesh:invite", { issuedAt: INJECTED_ISSUED_AT }, ctx);
          // The ttl in force.
          assert.equal(result.ttlSeconds, row.ttlSeconds, `[${row.configured ?? "absent"}] the ttl in force is ${row.ttlSeconds} seconds`);
          const persisted = await readRegistry(ctx.workspace);
          const entry = persisted.pending[persisted.pending.length - 1];
          // expiresAt = issuedAt + ttl seconds, over the INJECTED issuedAt.
          assert.equal(
            Date.parse(entry.expiresAt),
            Date.parse(INJECTED_ISSUED_AT) + row.ttlSeconds * 1000,
            `[${row.configured ?? "absent"}] expiresAt equals issuedAt + ${row.ttlSeconds}s`
          );
          // issuedAt equals the injected issuedAt (verbatim — never wall-clock).
          assert.equal(entry.issuedAt, INJECTED_ISSUED_AT, `[${row.configured ?? "absent"}] issuedAt is the injected instant, verbatim`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: mesh:invite on a NON-control node refuses and writes nothing ════════
  {
    name: "mesh-invite-mint/00 on a NON-control node mesh:invite refuses with a structured error, returns no code, and leaves the registry file byte-unchanged",
    async run() {
      const repo = await makeRepo(nonControlMesh());
      try {
        const ctx = await ctxFor(repo);
        // A pre-existing registry (seeded through the seam AS the control node — the
        // one legitimate writer) whose on-disk state I record.
        await writeRegistry(ctx.workspace, seededRegistry(), controlConfig());
        const priorBytes = await readFile(registryPath(ctx.workspace), "utf8");

        // The invocation refuses — a structured error, no plaintext code returned.
        let refused = null;
        await assert.rejects(
          () => invoke("mesh:invite", { issuedAt: INJECTED_ISSUED_AT }, ctx),
          (error) => {
            refused = error;
            return true;
          },
          "a non-authority node cannot mint an invite"
        );
        assert.equal(refused.code, "not-control-node", "the refusal is structured (not-control-node)");
        assert.ok(!/\b\d{6}\b/.test(refused.message), "no plaintext code is returned in the refusal");

        // R4 — the registry file is BYTE-unchanged (no pending entry, nothing written).
        assert.equal(await readFile(registryPath(ctx.workspace), "utf8"), priorBytes, "the registry file is byte-unchanged across the refused invocation");

        // And on a FRESH workspace a refused mint creates no registry file at all.
        const fresh = await makeRepo(nonControlMesh());
        try {
          const freshCtx = await ctxFor(fresh);
          await assert.rejects(() => invoke("mesh:invite", { issuedAt: INJECTED_ISSUED_AT }, freshCtx));
          await assert.rejects(() => access(registryPath(freshCtx.workspace)), "no registry file was created by the refused mint");
        } finally {
          await rm(fresh, { recursive: true, force: true });
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the minted code is exactly 6 numeric digits (the 10^6 space) ════════
  {
    name: "mesh-invite-mint/00 the minted code is exactly 6 characters, every one a decimal digit (the 10^6 space) — across repeated mints",
    async run() {
      const repo = await makeRepo(controlMesh());
      try {
        const ctx = await ctxFor(repo);
        // Repeated mints, so a short/padded code (leading zeros) cannot slip through.
        for (let i = 0; i < 8; i += 1) {
          const result = await invoke("mesh:invite", { issuedAt: INJECTED_ISSUED_AT }, ctx);
          assert.equal(result.code.length, 6, "the returned plaintext code is exactly 6 characters");
          for (const ch of result.code) {
            assert.match(ch, /^[0-9]$/, "every character of the code is a decimal digit");
          }
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:invite --json runs clean and parseable (rides the existing
  //    bijection gate) ═══════════════════════════════════════════════════════════════
  {
    name: "mesh-invite-mint/00 aof mesh invite --json on the control node exits cleanly and emits the parseable invite result carrying the plaintext code once",
    async run() {
      const repo = await makeRepo(controlMesh());
      try {
        const result = spawnCliSync(process.execPath, [cliPath, "mesh", "invite", "--json"], {
          cwd: repo,
          encoding: "utf8",
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        assert.equal(result.status, 0, `aof mesh invite --json exits cleanly (stderr: ${result.stderr})`);
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, "the emitted JSON parses");
        assert.match(parsed.code, /^\d{6}$/, "the parsed result carries the 6-digit plaintext code");
        assert.equal(typeof parsed.expiresAt, "string", "the parsed result carries expiresAt");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
