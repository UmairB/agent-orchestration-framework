// Traceability wiring for milestone 22 / story 01 — the node-identity mechanic.
//
// Covers EVERY @executable scenario in tasks/00_node-identity-descriptor.feature,
// exercising src/node-identity.mjs IN-PROCESS with INJECTED hostname / salt / config
// (the white-box Build-notes requirement — no real-machine coupling), plus a real temp
// config file for the persist+reuse scenarios. One test object per @executable scenario
// (Scenario-Outline rows folded into one entry iterating the rows), each name tracing
// to feature + scenario. node:assert/strict.
//
//   00_node-identity-descriptor.feature — id derivation is deterministic + stable
//     (sanitized hostname, persisted to mesh.nodeId on first derive, reused thereafter;
//     a collision appends a stable per-install hash; an empty stem falls back to
//     node-<install-hash>; an operator-set id wins verbatim); the descriptor carries
//     the complete frozen 7-key schema, correctly typed, rebuildable (reads, never
//     writes); array fields empty to [] at the boundaries.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deriveNodeId,
  assembleDescriptor,
  sanitizeHostname,
  installHash,
} from "../src/node-identity.mjs";

const ID_RE = /^[a-z0-9-]+$/;

async function tempConfig(initial = { name: "fixture" }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-nodeid-"));
  const configPath = path.join(dir, "aof.config.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  return { dir, configPath };
}

export const meshNodeIdentityTests = [
  // ══ Scenario Outline: the node id is the sanitized, lowercased hostname ══════
  {
    name: "mesh-node-identity/00 the node id is the sanitized, lowercased hostname with illegal runs collapsed to one '-'",
    async run() {
      const rows = [
        ["build-server", "build-server"],
        ["Umair-Desktop", "umair-desktop"],
        ["Umair Desktop", "umair-desktop"],
        ["umair.desktop", "umair-desktop"],
        ["umair_desktop", "umair-desktop"],
        ["umair@desktop!", "umair-desktop"],
        ["umair--__--desktop", "umair-desktop"],
        ["-leading-trailing-", "leading-trailing"],
        ["node01", "node01"],
      ];
      for (const [hostname, expected] of rows) {
        // Derive (no configPath → in-memory, no persist); injected hostname/salt.
        const id = await deriveNodeId({ config: {}, hostname, salt: "salt-x" });
        assert.equal(id, expected, `"${hostname}" → "${expected}"`);
        // Deterministic — deriving again yields the same id.
        const again = await deriveNodeId({ config: {}, hostname, salt: "salt-x" });
        assert.equal(again, id, `"${hostname}" deterministic`);
        // [a-z0-9-]-only, no leading/trailing "-".
        assert.match(id, ID_RE, `"${id}" is [a-z0-9-]-only`);
        assert.ok(!id.startsWith("-") && !id.endsWith("-"), `"${id}" has no edge "-"`);
      }
    },
  },

  // ══ Scenario Outline: a hostname that sanitizes to empty → node-<install-hash> ═
  {
    name: "mesh-node-identity/00 a hostname that sanitizes to empty falls back to a deterministic node-<install-hash> id",
    async run() {
      for (const hostname of ["***", ""]) {
        assert.equal(sanitizeHostname(hostname), "", `"${hostname}" sanitizes to empty`);
        const salt = "install-salt-7";
        const id = await deriveNodeId({ config: {}, hostname, salt });
        // Non-empty, matches node-<install-hash> reusing the SAME per-install hash.
        assert.equal(id, `node-${installHash(salt)}`, `"${hostname}" → node-<install-hash>`);
        assert.ok(id.length > 0, "id is non-empty");
        assert.match(id, ID_RE, `"${id}" is [a-z0-9-]-only`);
        // Deterministic + stable across re-derivation on this install (same salt).
        const again = await deriveNodeId({ config: {}, hostname, salt });
        assert.equal(again, id, "empty-stem fallback is deterministic + stable");
      }
    },
  },

  // ══ Scenario: first derivation persists the id; later derivations reuse it ════
  {
    name: "mesh-node-identity/00 the first derivation persists the id to config and later derivations reuse it",
    async run() {
      const { dir, configPath } = await tempConfig({ name: "fixture" });
      try {
        // First derive (configPath supplied → persists mesh.nodeId).
        const id1 = await deriveNodeId({ config: {}, hostname: "Umair-Desktop", salt: "s", configPath });
        assert.equal(id1, "umair-desktop");
        // config mesh.nodeId is now pinned.
        const afterFirst = JSON.parse(await readFile(configPath, "utf8"));
        assert.equal(afterFirst.mesh.nodeId, "umair-desktop", "mesh.nodeId persisted");
        // The host later changes; deriving again reads the PINNED id (the rename is
        // ignored once an id is pinned). Pass the persisted config back in.
        const id2 = await deriveNodeId({ config: afterFirst, hostname: "Umair-Laptop", salt: "s", configPath });
        assert.equal(id2, "umair-desktop", "the persisted id, not the new hostname");
        const afterRename = JSON.parse(await readFile(configPath, "utf8"));
        assert.equal(afterRename.mesh.nodeId, "umair-desktop", "the rename did not rewrite the pinned id");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: an operator-set mesh.nodeId overrides + is never rewritten ══════
  {
    name: "mesh-node-identity/00 an operator-set mesh.nodeId overrides the derived default and is never rewritten",
    async run() {
      const { dir, configPath } = await tempConfig({ name: "fixture", mesh: { nodeId: "build-server" } });
      try {
        const config = JSON.parse(await readFile(configPath, "utf8"));
        const id = await deriveNodeId({ config, hostname: "Umair-Desktop", salt: "s", configPath });
        assert.equal(id, "build-server", "operator-set id wins verbatim");
        const after = JSON.parse(await readFile(configPath, "utf8"));
        assert.equal(after.mesh.nodeId, "build-server", "deriving did not overwrite the operator's value");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a hostname collision is disambiguated by a stable per-install hash ═
  {
    name: "mesh-node-identity/00 a hostname collision is disambiguated by a stable per-install hash suffix",
    async run() {
      // Two installs, same host "laptop", distinct salts. The second derives against a
      // takenIds set containing the first install's stem.
      const idA = await deriveNodeId({ config: {}, hostname: "laptop", salt: "salt-A", takenIds: ["laptop"] });
      const idB = await deriveNodeId({ config: {}, hostname: "laptop", salt: "salt-B", takenIds: ["laptop"] });
      assert.notEqual(idA, idB, "the two ids differ");
      // Each keeps the sanitized hostname stem before the suffix.
      assert.ok(idA.startsWith("laptop-"), `"${idA}" keeps the "laptop" stem`);
      assert.ok(idB.startsWith("laptop-"), `"${idB}" keeps the "laptop" stem`);
      assert.equal(idA, `laptop-${installHash("salt-A")}`, "suffix is the per-install hash");
      assert.equal(idB, `laptop-${installHash("salt-B")}`, "suffix is the per-install hash");
      // Stable across re-derivation on its own install.
      assert.equal(await deriveNodeId({ config: {}, hostname: "laptop", salt: "salt-A", takenIds: ["laptop"] }), idA, "idA stable");
      assert.equal(await deriveNodeId({ config: {}, hostname: "laptop", salt: "salt-B", takenIds: ["laptop"] }), idB, "idB stable");
      assert.match(idA, ID_RE, `"${idA}" is [a-z0-9-]-only`);
      assert.match(idB, ID_RE, `"${idB}" is [a-z0-9-]-only`);
    },
  },

  // ══ Scenario: the capability descriptor carries the complete frozen schema ════
  {
    name: "mesh-node-identity/00 the capability descriptor carries the complete frozen schema",
    async run() {
      const descriptor = assembleDescriptor({
        nodeId: "umair-desktop",
        hostname: "Umair-Desktop",
        platform: "linux",
        runtimes: ["claude", "codex"],
        skills: ["aof-developer", "aof-qa"],
        aofVersion: "0.1.0",
      });
      assert.equal(typeof descriptor.nodeId, "string");
      assert.ok(descriptor.nodeId.length > 0, "nodeId is a non-empty string");
      assert.equal(descriptor.host, "Umair-Desktop", "host is the raw host name");
      assert.ok(["win32", "darwin", "linux"].includes(descriptor.os), "os is the platform");
      assert.deepEqual(descriptor.runtimes, ["claude", "codex"], "runtimes from config");
      assert.deepEqual(descriptor.skills, ["aof-developer", "aof-qa"], "skills are the installed skill ids");
      assert.equal(descriptor.aofVersion, "0.1.0", "aofVersion is the install's version");
      // publishedAt is an ISO-8601 UTC trailing-Z instant (a toISOString form).
      assert.match(descriptor.publishedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "publishedAt is trailing-Z ISO");
      assert.equal(new Date(descriptor.publishedAt).toISOString(), descriptor.publishedAt, "publishedAt round-trips toISOString");
      // No field outside the frozen schema's known + additive keys (exactly the 7).
      assert.deepEqual(
        Object.keys(descriptor),
        ["nodeId", "host", "os", "runtimes", "skills", "aofVersion", "publishedAt"],
        "exactly the frozen 7 keys, in order"
      );
    },
  },

  // ══ Scenario Outline: the descriptor's capability arrays at the boundaries ════
  {
    name: "mesh-node-identity/00 the descriptor's capability arrays reflect config faithfully at the boundaries",
    async run() {
      const rows = [
        { runtimes: ["claude", "codex"], skills: ["aof-developer", "aof-qa"], expectSkills: ["aof-developer", "aof-qa"] },
        { runtimes: ["claude"], skills: ["aof-developer"], expectSkills: ["aof-developer"] },
        { runtimes: [], skills: [], expectSkills: [] },
      ];
      for (const { runtimes, skills, expectSkills } of rows) {
        const d = assembleDescriptor({
          nodeId: "n", hostname: "h", platform: "linux", runtimes, skills, aofVersion: "0.1.0",
        });
        assert.deepEqual(d.runtimes, runtimes, `runtimes echo ${JSON.stringify(runtimes)}`);
        assert.deepEqual(d.skills, expectSkills, `skills echo ${JSON.stringify(expectSkills)}`);
        assert.ok(Array.isArray(d.runtimes) && Array.isArray(d.skills), "arrays present, not absent");
      }
      // Empty/absent arrays assemble as [] (not absent, not crash).
      const minimal = assembleDescriptor({ nodeId: "n", hostname: "h", platform: "linux", aofVersion: "0.1.0" });
      assert.deepEqual(minimal.runtimes, [], "absent runtimes → []");
      assert.deepEqual(minimal.skills, [], "absent skills → []");
    },
  },

  // ══ Scenario: the descriptor is a rebuildable projection that reads, never writes ═
  {
    name: "mesh-node-identity/00 the descriptor is a rebuildable projection that reads config without mutating it",
    async run() {
      const { dir, configPath } = await tempConfig({ name: "fixture", mesh: { nodeId: "umair-desktop", salt: "s" } });
      try {
        const before = await readFile(configPath, "utf8");
        const args = { nodeId: "umair-desktop", hostname: "Umair-Desktop", platform: "linux", runtimes: ["claude"], skills: ["aof-developer"], aofVersion: "0.1.0" };
        const d1 = assembleDescriptor(args);
        // A real, monotonic-or-equal publishedAt between the two assemblies.
        await new Promise((resolve) => setTimeout(resolve, 2));
        const d2 = assembleDescriptor(args);
        // Equivalent in every field except publishedAt.
        for (const key of ["nodeId", "host", "os", "runtimes", "skills", "aofVersion"]) {
          assert.deepEqual(d1[key], d2[key], `field "${key}" stable across re-assembly`);
        }
        assert.ok(Date.parse(d2.publishedAt) >= Date.parse(d1.publishedAt), "publishedAt at or after the previous assembly");
        // assembly reads config but NEVER writes it — the file is byte-unchanged.
        const after = await readFile(configPath, "utf8");
        assert.equal(after, before, "mesh.* config byte-unchanged across both assemblies");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },
];
