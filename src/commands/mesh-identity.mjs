// mesh:identity + mesh:status — the two registered node-identity commands
// (milestone 22 / story 01 / ADR-001/003). Thin over story 00's src/mesh-store.mjs
// (the partition seam + opaque per-node persist/read) and story 01's
// src/node-identity.mjs (id derivation + descriptor assembly), carrying the frozen
// { id, input, run, cli } contract (08/ADR-002). A node is "just another thin face":
// publishing identity + reading the fleet are command-core capabilities, not a
// parallel subsystem.
//
//   mesh:identity  — no ref → assemble THIS node's descriptor (real hostname /
//                    platform / runtimes / skills / version), publish it via the store,
//                    and return the published record (republish bumps publishedAt; the
//                    id is stable, persisted to config.mesh.nodeId on first publish). A
//                    ref → readNodeRecord(ref) and return it. Command-level: an absent
//                    read returns null (NOT an error — the run-store ENOENT→null
//                    discipline). The CLI FACE turns an absent READ into node-not-found
//                    (a face-level error); that split lives in meshVerbCli, not here.
//
//   mesh:status    — no input → readNodeRecords(ws) → { nodes:[...] } (an empty roster
//                    reads as { nodes: [] }, NOT an error). A pure read.
//
// This story WRITES only through the store's meshDir seam and NEVER calls the sync
// engine (story 02 moves the records); it is parallel-with-02 by construction.
import os from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { readJson, writeText } from "../fs.mjs";
import { publishNodeRecord, readNodeRecord, readNodeRecords } from "../mesh-store.mjs";
import { deriveNodeId, assembleDescriptor } from "../node-identity.mjs";
import { loadBundle } from "../work-bundle.mjs";

// The publishing install's aof version (ADR-003 provenance) — read from the package
// manifest via the import.meta.url idiom (same posture as bundleRoot()): src/ ->
// package.json is one level up. Read lazily + tolerantly so a missing/unreadable
// manifest degrades to "" rather than crashing the publish.
function aofVersion() {
  try {
    const manifestPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return JSON.parse(readFileSync(manifestPath, "utf8")).version ?? "";
  } catch {
    return "";
  }
}

// The installed bundle skill ids — the CAPABILITY advertisement (what work this node
// can take, ADR-003). The contract leaves the exact source open ("installed bundle
// skill ids"); we read them from loadBundle()'s resources (what this install ships).
// Tolerant: an unreadable bundle degrades to [] rather than crashing the publish.
function installedSkills() {
  try {
    return loadBundle().resources.map((resource) => resource.id);
  } catch {
    return [];
  }
}

// Resolve a STABLE per-install salt for the id-hash (the empty-stem fallback +
// collision suffix). Read config.mesh.salt; mint + persist one (read-merge-write the
// mesh subtree, NOT config-editor's whitelist) when absent so the install-hash is
// stable across publishes. Returns the salt string.
async function resolveInstallSalt(configPath, config) {
  const existing = config?.mesh?.salt;
  if (typeof existing === "string" && existing.length > 0) return existing;
  const salt = crypto.randomUUID();
  if (configPath) {
    let onDisk = {};
    try {
      onDisk = await readJson(configPath);
    } catch {
      onDisk = {};
    }
    if (!onDisk.mesh || typeof onDisk.mesh !== "object") onDisk.mesh = {};
    onDisk.mesh.salt = salt;
    await writeText(configPath, `${JSON.stringify(onDisk, null, 2)}\n`);
  }
  return salt;
}

export const meshIdentityCommand = {
  id: "mesh:identity",
  input: {
    type: "object",
    properties: { ref: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ws = ctx.workspace;
    const ref = typeof input?.ref === "string" ? input.ref.trim() : "";

    // A ref → READ that node's record. Absent reads as null (NOT an error — the
    // store's ENOENT→null discipline). The face turns absent into node-not-found.
    if (ref) {
      return await readNodeRecord(ws, ref);
    }

    // No ref → PUBLISH this node. Resolve a stable salt, derive (+ persist) the id,
    // assemble the descriptor, publish it through the store, and return the record.
    const config = ws.config ?? {};
    const salt = await resolveInstallSalt(ws.configPath, config);
    const hostname = os.hostname();
    const nodeId = await deriveNodeId({
      config,
      hostname,
      salt,
      configPath: ws.configPath,
    });
    const descriptor = assembleDescriptor({
      nodeId,
      hostname,
      platform: process.platform,
      runtimes: Array.isArray(config.runtimes) ? config.runtimes : [],
      skills: installedSkills(),
      aofVersion: aofVersion(),
    });
    await publishNodeRecord(ws, nodeId, descriptor);
    return descriptor;
  },

  cli: {
    // `aof mesh identity [<id>]` — an optional positional is the read ref.
    argv: (positionals) => ({ ref: positionals[0] }),

    // Publish confirmation names the node id; a read renders the node line. (A
    // null read never reaches here — meshVerbCli surfaces node-not-found first.)
    render(result) {
      if (result == null) return "No node record.";
      const caps = describeCaps(result);
      return `Node ${result.nodeId} — ${caps}`;
    },

    // The --json face is the bare node record (publish OR read), per the feature.
    json: (result) => result,
  },
};

export const meshStatusCommand = {
  id: "mesh:status",
  input: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },

  async run(_input, ctx) {
    // The synced roster — this node + every peer record in the tree. An empty roster
    // reads as { nodes: [] } (NOT an error — the store's absence-is-benign discipline).
    const nodes = await readNodeRecords(ctx.workspace);
    return { nodes };
  },

  cli: {
    // `aof mesh status` — no args; a stray positional is rejected by the face.
    argv: () => ({}),

    // The human render lists each node with its id + capabilities; an empty roster
    // renders an explicit empty line.
    render(result) {
      if (result.nodes.length === 0) return "No nodes in the mesh roster.";
      return result.nodes
        .map((node) => `${node.nodeId} — ${describeCaps(node)}`)
        .join("\n");
    },

    // The stable { nodes:[...] } shape passes through unchanged.
    json: (result) => result,
  },
};

// A one-line capability summary for the human render: runtimes + skill count.
function describeCaps(node) {
  const runtimes = Array.isArray(node.runtimes) ? node.runtimes : [];
  const skills = Array.isArray(node.skills) ? node.skills : [];
  const runtimePart = runtimes.length ? `runtimes: ${runtimes.join(", ")}` : "no runtimes";
  return `${runtimePart}; ${skills.length} skill(s)`;
}
