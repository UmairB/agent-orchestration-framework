// Traceability wiring for milestone 27 / story 00 — the issuance directive record
// (task 00, ADR-001).
//
// Covers EVERY @executable scenario in
// tasks/00_issuance-directive-record.feature: the six-key assembly matrix over the
// three target-union arms (any/node/capability), the union read across one/two/
// many issuer partitions, absence-tolerance (no issuance/ dir ⇒ []), torn-file
// tolerance (one unparseable file degrades to one missing directive, never a
// throw), and the byte-faithful round-trip through issuanceDirectivePath.
//
// FIXTURE NOTE — story 00 writes are FIXTURE-WRITTEN (the production write is
// story 01's mesh:issue). Every scenario places directive files DIRECTLY at
// issuanceDirectivePath(ws, issuer, ref) via the writeDirective test helper below
// (mirrors the m26 story-00 02_add-only-run-merge precedent of writing run records
// directly). node:assert/strict, mkdtemp fixtures — no git needed for this file
// (task 02 owns the real bare-remote transport proof).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleDirective, readIssuanceDirectives } from "../src/mesh-issuance.mjs";
import { issuanceDirectivePath, meshDir } from "../src/mesh-store.mjs";
import { writeText } from "../src/fs.mjs";

async function makeWorkspace() {
  // A repo-shaped temp root so meshDir resolves to an ISOLATED <root>/.aof/mesh
  // (the seam roots the partition at the .aof home two levels above workDir).
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-issuance-record-"));
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { workDir, projectRoot: root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// The test helper the feature's Background names: "place directive files directly
// at issuanceDirectivePath(workspace, issuer, itemRef) via a test helper."
async function writeDirective(workspace, issuer, itemRef, directive) {
  await writeText(issuanceDirectivePath(workspace, issuer, itemRef), JSON.stringify(directive, null, 2));
}

const NOW = "2026-07-03T10:00:00.000Z";

export const meshIssuanceDirectiveRecordTests = [
  // ── Scenario Outline: a directive assembles as exactly six keys carrying its target union arm and state "issued" ──
  {
    name: 'issuance-record/00 a directive assembles as exactly six keys — target { kind: "any" }',
    run: async () => {
      const directive = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, issuedAt: NOW, aofVersion: "0.1.0" });
      assert.deepEqual(Object.keys(directive), ["itemRef", "issuer", "target", "state", "issuedAt", "aofVersion"], "exactly the six keys, no more no fewer");
      assert.equal(directive.itemRef, "27/00");
      assert.equal(directive.issuer, "node-a");
      assert.equal(directive.state, "issued");
      assert.equal(directive.issuedAt, "2026-07-03T10:00:00.000Z");
      assert.equal(directive.aofVersion, "0.1.0", "aofVersion carries the injected provenance value, never absent");
      assert.deepEqual(directive.target, { kind: "any" });
    },
  },
  {
    name: 'issuance-record/00 a directive assembles as exactly six keys — target { kind: "node", nodeId: "build-server" }',
    run: async () => {
      const directive = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "node", nodeId: "build-server" }, issuedAt: NOW, aofVersion: "0.1.0" });
      assert.deepEqual(Object.keys(directive), ["itemRef", "issuer", "target", "state", "issuedAt", "aofVersion"]);
      assert.equal(directive.itemRef, "27/00");
      assert.equal(directive.issuer, "node-a");
      assert.equal(directive.state, "issued");
      assert.equal(directive.issuedAt, "2026-07-03T10:00:00.000Z");
      assert.equal(directive.aofVersion, "0.1.0");
      assert.deepEqual(directive.target, { kind: "node", nodeId: "build-server" });
    },
  },
  {
    name: 'issuance-record/00 a directive assembles as exactly six keys — target { kind: "capability", value: "codex" }',
    run: async () => {
      const directive = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "capability", value: "codex" }, issuedAt: NOW, aofVersion: "0.1.0" });
      assert.deepEqual(Object.keys(directive), ["itemRef", "issuer", "target", "state", "issuedAt", "aofVersion"]);
      assert.equal(directive.itemRef, "27/00");
      assert.equal(directive.issuer, "node-a");
      assert.equal(directive.state, "issued");
      assert.equal(directive.issuedAt, "2026-07-03T10:00:00.000Z");
      assert.equal(directive.aofVersion, "0.1.0");
      assert.deepEqual(directive.target, { kind: "capability", value: "codex" });
    },
  },

  // ── Scenario: two different issuers each with a directive for the same item both read back in the union ──
  {
    name: "issuance-record/00 two different issuers each with a directive for the same item both read back in the union (the reader never resolves a winner)",
    run: async () => {
      const ws = await makeWorkspace();
      try {
        await writeDirective(ws, "node-a", "27/00", assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, issuedAt: NOW, aofVersion: "0.1.0" }));
        await writeDirective(ws, "node-b", "27/00", assembleDirective({ itemRef: "27/00", issuer: "node-b", target: { kind: "capability", value: "codex" }, issuedAt: NOW, aofVersion: "0.1.0" }));

        const directives = await readIssuanceDirectives(ws);

        assert.equal(directives.length, 2, "exactly two directives return");
        const byIssuer = Object.fromEntries(directives.map((d) => [d.issuer, d]));
        assert.deepEqual(byIssuer["node-a"].target, { kind: "any" });
        assert.deepEqual(byIssuer["node-b"].target, { kind: "capability", value: "codex" });
        assert.ok(directives.every((d) => d.itemRef === "27/00"), "both carry itemRef 27/00");
      } finally {
        await ws.cleanup();
      }
    },
  },

  // ── Scenario: directives for multiple items across multiple issuers all read back in one union ──
  {
    name: "issuance-record/00 directives for multiple items across multiple issuers all read back in one union (a flat union, not grouped)",
    run: async () => {
      const ws = await makeWorkspace();
      try {
        await writeDirective(ws, "node-a", "27/00", assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, issuedAt: NOW, aofVersion: "0.1.0" }));
        await writeDirective(ws, "node-a", "27/01", assembleDirective({ itemRef: "27/01", issuer: "node-a", target: { kind: "any" }, issuedAt: NOW, aofVersion: "0.1.0" }));
        await writeDirective(ws, "node-b", "27/02", assembleDirective({ itemRef: "27/02", issuer: "node-b", target: { kind: "any" }, issuedAt: NOW, aofVersion: "0.1.0" }));

        const directives = await readIssuanceDirectives(ws);

        assert.equal(directives.length, 3, "exactly three directives return");
        const pairs = directives.map((d) => [d.itemRef, d.issuer]).sort((a, b) => a[0].localeCompare(b[0]));
        assert.deepEqual(pairs, [["27/00", "node-a"], ["27/01", "node-a"], ["27/02", "node-b"]]);
      } finally {
        await ws.cleanup();
      }
    },
  },

  // ── Scenario: a workspace with no issuance directory reads as an empty list, never a throw ──
  {
    name: "issuance-record/00 a workspace with no issuance directory reads as an empty list, never a throw",
    run: async () => {
      const ws = await makeWorkspace();
      try {
        // No mesh/issuance/ directory exists at all (under the .aof mesh home).
        assert.ok(!existsSync(path.join(meshDir(ws), "issuance")), "precondition: no mesh issuance dir exists yet");

        let directives;
        await assert.doesNotReject(async () => { directives = await readIssuanceDirectives(ws); }, "no error is raised");
        assert.deepEqual(directives, [], "an empty list returns");
      } finally {
        await ws.cleanup();
      }
    },
  },

  // ── Scenario: a torn directive file is skipped and the rest still read ──
  {
    name: "issuance-record/00 a torn directive file is skipped and the rest still read (spans issuers, never blinds the healthy directives)",
    run: async () => {
      const ws = await makeWorkspace();
      try {
        await writeDirective(ws, "node-a", "27/00", assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, issuedAt: NOW, aofVersion: "0.1.0" }));
        // An unparseable torn file under node-b's partition.
        const tornPath = issuanceDirectivePath(ws, "node-b", "torn-item");
        await writeText(tornPath, "{ not valid json ");
        await writeDirective(ws, "node-a", "27/01", assembleDirective({ itemRef: "27/01", issuer: "node-a", target: { kind: "any" }, issuedAt: NOW, aofVersion: "0.1.0" }));

        let directives;
        await assert.doesNotReject(async () => { directives = await readIssuanceDirectives(ws); }, "no error is raised (the torn file degrades to one missing directive)");
        assert.equal(directives.length, 2, "exactly two directives return (the two valid node-a directives)");
        assert.deepEqual(directives.map((d) => d.itemRef).sort(), ["27/00", "27/01"]);
      } finally {
        await ws.cleanup();
      }
    },
  },

  // ── Scenario Outline: an assembled directive round-trips through its issuer path byte-faithfully ──
  {
    name: 'issuance-record/00 an assembled directive round-trips through its issuer path byte-faithfully — node "build-server"',
    run: async () => {
      const ws = await makeWorkspace();
      try {
        const directive = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "node", nodeId: "build-server" }, issuedAt: NOW, aofVersion: "0.1.0" });
        const serialized = JSON.stringify(directive, null, 2);
        await writeDirective(ws, "node-a", "27/00", directive);

        const rawBytes = await readFile(issuanceDirectivePath(ws, "node-a", "27/00"), "utf8");
        assert.equal(rawBytes, serialized, "the on-disk bytes are exactly the serialized assembled record");

        const directives = await readIssuanceDirectives(ws);

        assert.equal(directives.length, 1, "exactly one directive returns");
        assert.equal(JSON.stringify(directives[0], null, 2), serialized, "byte-faithful: the read-back record re-serializes to the identical bytes — every key, value and key order preserved");
        assert.deepEqual(directives[0].target, { kind: "node", nodeId: "build-server" });
      } finally {
        await ws.cleanup();
      }
    },
  },
  {
    name: 'issuance-record/00 an assembled directive round-trips through its issuer path byte-faithfully — capability "claude"',
    run: async () => {
      const ws = await makeWorkspace();
      try {
        const directive = assembleDirective({ itemRef: "27/01", issuer: "build-server", target: { kind: "capability", value: "claude" }, issuedAt: NOW, aofVersion: "0.1.0" });
        const serialized = JSON.stringify(directive, null, 2);
        await writeDirective(ws, "build-server", "27/01", directive);

        const rawBytes = await readFile(issuanceDirectivePath(ws, "build-server", "27/01"), "utf8");
        assert.equal(rawBytes, serialized, "the on-disk bytes are exactly the serialized assembled record");

        const directives = await readIssuanceDirectives(ws);

        assert.equal(directives.length, 1, "exactly one directive returns");
        assert.equal(JSON.stringify(directives[0], null, 2), serialized, "byte-faithful: the read-back record re-serializes to the identical bytes — every key, value and key order preserved");
        assert.deepEqual(directives[0].target, { kind: "capability", value: "claude" });
      } finally {
        await ws.cleanup();
      }
    },
  },
];
