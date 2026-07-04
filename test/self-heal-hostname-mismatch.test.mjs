// Traceability wiring for milestone 33 / story 00 — per-install node identity.
//
// Covers EVERY @executable scenario in tasks/03_self-heal-hostname-mismatch.feature,
// exercising src/work.mjs's healIdentitySidecar (the self-heal step factored out of
// loadWorkspace's own heal-site call — see work.mjs's header comment) IN-PROCESS with
// an injected sidecar object + current hostname (+ an optional takenIds roster for
// the collision-preserving scenario), plus a real temp sidecar file for the
// rewrite/byte-unchanged assertions. One test object per @executable scenario
// (Scenario-Outline rows folded into one entry iterating the rows), each name tracing
// to feature + scenario. node:assert/strict.
//
//   03_self-heal-hostname-mismatch.feature — a sidecar whose nodeId was hostname-
//     derived but whose recorded hostname no longer matches this machine's current
//     hostname re-derives from the CURRENT hostname and rewrites the sidecar; an
//     operator-pinned id is honoured and never auto-healed; the copied-sidecar F-3203
//     symptom self-corrects; the heal re-derives with the sidecar's OWN salt
//     (preserving a collision suffix); the heal is self-terminating (a second load on
//     the now-correct host is a keep, not a repeated rewrite).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { healIdentitySidecar, loadWorkspace } from "../src/work.mjs";
import { installHash, readSidecar } from "../src/node-identity.mjs";

async function tempSidecar(initial) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-self-heal-"));
  const sidecarPath = path.join(dir, "mesh", "identity.json");
  await mkdir(path.dirname(sidecarPath), { recursive: true });
  await writeFile(sidecarPath, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  return { dir, sidecarPath };
}

// A fixture aof project (committed config + .aof/mesh/identity.json sidecar) for
// exercising loadWorkspace's REAL call site (craft/architect review regression:
// loadWorkspace passes NO takenIds to healIdentitySidecar, so a collision-suffixed id
// must be verified through the actual production call path, not just the factored-out
// heal step called directly with an injected takenIds roster).
async function fixtureProjectWithSidecar(sidecar) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-self-heal-loadworkspace-"));
  const aofDir = path.join(root, ".aof");
  await mkdir(aofDir, { recursive: true });
  const configPath = path.join(aofDir, "aof.config.json");
  await writeFile(configPath, `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`, "utf8");
  const sidecarPath = path.join(aofDir, "mesh", "identity.json");
  await mkdir(path.dirname(sidecarPath), { recursive: true });
  await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  return { root, sidecarPath };
}

export const selfHealHostnameMismatchTests = [
  // ══ Scenario Outline: the self-heal matrix ═════════════════════════════════════
  {
    name: "self-heal-hostname-mismatch/03 self-heal re-derives a stale hostname-derived sidecar id, keeps a matching or operator-pinned id",
    async run() {
      const rows = [
        { before: { nodeId: "macbook-pro", salt: "s", derivedFrom: "macbook-pro" }, hostname: "macbook-pro", resultingNodeId: "macbook-pro", rewritten: false },
        { before: { nodeId: "umairs-msi", salt: "s", derivedFrom: "umairs-msi" }, hostname: "macbook-pro", resultingNodeId: "macbook-pro", rewritten: true },
        { before: { nodeId: "umairs-msi", salt: "s", derivedFrom: "umairs-msi" }, hostname: "Umair's MacBook", resultingNodeId: "umair-s-macbook", rewritten: true },
        { before: { nodeId: "operator-choice", salt: "s", pinned: true }, hostname: "macbook-pro", resultingNodeId: "operator-choice", rewritten: false },
      ];
      for (const { before, hostname, resultingNodeId, rewritten } of rows) {
        const { dir, sidecarPath } = await tempSidecar(before);
        try {
          const bytesBefore = await readFile(sidecarPath, "utf8");
          const healed = await healIdentitySidecar({ sidecar: before, hostname, sidecarPath });
          assert.equal(healed.nodeId, resultingNodeId, `hostname "${hostname}": resulting nodeId "${resultingNodeId}"`);
          const bytesAfter = await readFile(sidecarPath, "utf8").catch(() => null);
          if (rewritten) {
            assert.notEqual(bytesAfter, bytesBefore, `case "${hostname}" vs "${before.nodeId}": the sidecar WAS rewritten`);
            assert.equal(JSON.parse(bytesAfter).nodeId, resultingNodeId, "the rewritten sidecar carries the healed id");
          } else {
            assert.equal(bytesAfter, bytesBefore, `case "${hostname}" vs "${before.nodeId}": the sidecar is left byte-unchanged`);
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: the copied-sidecar symptom self-corrects ═════════════════════════
  {
    name: "self-heal-hostname-mismatch/03 a copied identity sidecar re-derives on a different host so the two machines never share a nodeId",
    async run() {
      const copied = { nodeId: "umairs-msi", salt: "origin-salt", derivedFrom: "umairs-msi" };
      const { dir, sidecarPath } = await tempSidecar(copied);
      try {
        const healed = await healIdentitySidecar({ sidecar: copied, hostname: "macbook-pro", sidecarPath });
        assert.equal(healed.nodeId, "macbook-pro");
        assert.notEqual(healed.nodeId, "umairs-msi", "identity self-corrected — not the origin's id");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: heal re-derives with the sidecar's own salt, preserving the
  //    collision suffix ══════════════════════════════════════════════════════════
  {
    name: "self-heal-hostname-mismatch/03 self-heal re-derives with the sidecar's own salt so the install hash stays stable",
    async run() {
      const before = { nodeId: "origin-host", salt: "fixed-salt-A", derivedFrom: "origin-host" };
      const { dir, sidecarPath } = await tempSidecar(before);
      try {
        const healed = await healIdentitySidecar({
          sidecar: before,
          hostname: "shared-host",
          sidecarPath,
          takenIds: ["shared-host"],
        });
        assert.equal(healed.nodeId, `shared-host-${installHash("fixed-salt-A")}`);
        assert.equal(healed.salt, "fixed-salt-A", "no fresh salt minted");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: heal is the only load-time sidecar write, self-terminating ══════
  {
    name: "self-heal-hostname-mismatch/03 after a heal the sidecar records the new hostname so a second load is a keep (heal is self-terminating)",
    async run() {
      const before = { nodeId: "umairs-msi", salt: "s", derivedFrom: "umairs-msi" };
      const { dir, sidecarPath } = await tempSidecar(before);
      try {
        const firstHeal = await healIdentitySidecar({ sidecar: before, hostname: "macbook-pro", sidecarPath });
        assert.deepEqual(firstHeal, { nodeId: "macbook-pro", salt: "s", derivedFrom: "macbook-pro" });
        const bytesAfterFirst = await readFile(sidecarPath, "utf8");

        const secondHeal = await healIdentitySidecar({ sidecar: firstHeal, hostname: "macbook-pro", sidecarPath });
        const bytesAfterSecond = await readFile(sidecarPath, "utf8");
        assert.deepEqual(secondHeal, firstHeal, "a second heal with the same hostname is a keep");
        assert.equal(bytesAfterSecond, bytesAfterFirst, "the sidecar is left byte-unchanged on the second load");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },

  // ══ REGRESSION (craft/architect review): a collision-suffixed id on its OWN
  //    recorded host must NOT churn on every loadWorkspace call ═════════════════════
  // The keep-predicate must compare the CURRENT hostname against the sidecar's
  // RECORDED derivedFrom, never the resolved nodeId — a collision-suffixed id
  // (nodeId:"shared-host-<hash>", derivedFrom:"shared-host") never equals its own
  // bare sanitized stem, so comparing against nodeId would fire the heal on EVERY
  // load. Driven through the REAL production call site (loadWorkspace, which passes
  // NO takenIds to healIdentitySidecar) — not healIdentitySidecar called directly
  // with an injected takenIds roster, which would sidestep the bug.
  {
    name: "self-heal-hostname-mismatch/03 REGRESSION: loadWorkspace does not churn a collision-suffixed id when the current hostname matches its recorded derivation host",
    async run() {
      const suffixedId = `shared-host-${installHash("fixed-salt-A")}`;
      const sidecar = { nodeId: suffixedId, salt: "fixed-salt-A", derivedFrom: "shared-host" };
      const { root, sidecarPath } = await fixtureProjectWithSidecar(sidecar);
      try {
        const bytesBefore = await readFile(sidecarPath, "utf8");
        const ws = await loadWorkspace(root, undefined, { hostname: "shared-host" });
        const bytesAfter = await readFile(sidecarPath, "utf8");
        assert.equal(bytesAfter, bytesBefore, "the sidecar is BYTE-UNCHANGED — no churn on a matching-host collision-suffixed id");
        assert.equal(ws.config.mesh.nodeId, suffixedId, "the returned config still carries the suffixed id, untouched");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ REGRESSION (F-3302, milestone 33 verify): a STALE-FORMAT id — one no longer
  //    producible from its own recorded host under CURRENT rules (a pre-`.local`-strip
  //    `umairs-mac-mini-local`) — self-migrates on load EVEN WITH THE HOSTNAME UNCHANGED,
  //    and is self-terminating. Driven through loadWorkspace's REAL call site (which
  //    passes NO takenIds), and isDerivationOf recognises the collision-suffixed form so
  //    the regression above (a legitimate collision id) is NOT churned. ═══════════════
  {
    name: "self-heal-hostname-mismatch/03 REGRESSION (F-3302): a stale-format .local id self-migrates to the Tailscale-matching short id, self-terminating",
    async run() {
      const before = { nodeId: "umairs-mac-mini-local", salt: "8263411c", derivedFrom: "Umairs-Mac-mini.local" };
      const { root, sidecarPath } = await fixtureProjectWithSidecar(before);
      try {
        const ws = await loadWorkspace(root, undefined, { hostname: "Umairs-Mac-mini.local" });
        assert.equal(ws.config.mesh.nodeId, "umairs-mac-mini", "the stale `.local` id healed to the Tailscale-matching short id");
        const healed = await readSidecar(sidecarPath);
        assert.equal(healed.nodeId, "umairs-mac-mini", "the sidecar was rewritten with the short id");
        assert.equal(healed.salt, "8263411c", "the sidecar's own salt is preserved (no fresh mint)");
        const bytesAfterFirst = await readFile(sidecarPath, "utf8");

        // Self-terminating: a second load on the same host is a KEEP (no re-churn) —
        // after the heal the id IS a valid derivation, so trigger 2 no longer fires.
        const ws2 = await loadWorkspace(root, undefined, { hostname: "Umairs-Mac-mini.local" });
        assert.equal(ws2.config.mesh.nodeId, "umairs-mac-mini", "the id is stable on a second load");
        assert.equal(await readFile(sidecarPath, "utf8"), bytesAfterFirst, "the sidecar is byte-unchanged on the second load (self-terminating)");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
