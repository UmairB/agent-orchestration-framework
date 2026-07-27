// mesh:join <code> — the joining node's half of device-code enrollment (milestone 24 /
// story 01 / ADR-002 move 3 + ADR-003 moves 1+3). A registered command-core command
// carrying the frozen { id, input, run, cli } contract (08/ADR-002):
//
//   1. READ config.mesh.relay.url (the control node's endpoint — the
//      mesh-relay-client.mjs url-read precedent) and derive the device-flow HTTP
//      endpoint from it (ws://host/ws/relay → http://host/enroll — the SAME server,
//      03/ADR-001; wss → https).
//   2. PRESENT — POST { code, nodeId, nodeRecord } to the endpoint. The control node
//      matches, consumes, admits, persists the joined node descriptor, and issues;
//      a rejection (bad / expired / consumed / capped) comes back as a structured
//      JSON class.
//   3. ON MATCH — store the issued credential { relayAuth, nodeId } at
//      config.mesh.credential via the READ-MERGE-WRITE of the free-form mesh subtree
//      (the resolveInstallSalt precedent in mesh-identity.mjs): the on-disk config is
//      re-read and only mesh.credential is set, so every other key — mesh.nodeId,
//      mesh.relay.url, mesh.salt, the non-mesh top level — survives byte-equivalent
//      (merge, never a clobber).
//   4. ON REJECTION — a clean face-level error and NOTHING stored: machine config stays byte-unchanged.
import os from "node:os";
import { readJson, writeText } from "../fs.mjs";
import { globalWorkspacePaths } from "../workspace.mjs";
import { resolvePeers } from "../mesh-fabric.mjs";
import { assembleDescriptor } from "../node-identity.mjs";
import { publishNodeRecord } from "../mesh-store.mjs";
import { aofVersion } from "./mesh-identity.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "../degrade.mjs";

// A structured command error the mesh face renders as ONE { ok:false, error, code }
// envelope (the property is assigned, not an object-literal field).
function faceError(message, token) {
  const error = new Error(message);
  error.code = token;
  return error;
}

// Derive the device-flow HTTP endpoint from the configured relay url — the SAME
// host/port the ws broker serves on (03/ADR-001: ONE server; the enrollment route
// rides it). ws → http, wss → https; null on an unparseable url (a face error).
function deriveEndpoint(relayUrl) {
  let parsed;
  try {
    parsed = new URL(relayUrl);
  } catch {
    return null;
  }
  const scheme = parsed.protocol === "wss:" ? "https:" : "http:";
  return `${scheme}//${parsed.host}/enroll`;
}

const DEFAULT_RELAY_PORT = 4182;
const DEFAULT_RELAY_PATH = "/ws/relay";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hostForUrl(host) {
  const value = String(host ?? "").trim();
  if (value.includes(":") && !value.startsWith("[")) return `[${value}]`;
  return value;
}

function relayUrlForControl(control) {
  const value = nonEmptyString(control);
  if (value == null) return null;
  if (/^wss?:\/\//i.test(value)) return value;
  return `ws://${hostForUrl(value)}:${DEFAULT_RELAY_PORT}${DEFAULT_RELAY_PATH}`;
}

function fabricConfigForControlResolution(config) {
  const mesh = isPlainObject(config?.mesh) ? config.mesh : {};
  return { ...config, mesh: { ...mesh, fabric: nonEmptyString(mesh.fabric) ?? "tailscale" } };
}

async function relayUrlFromInput(input, config, ctx) {
  const explicit = nonEmptyString(input?.relayUrl);
  if (explicit != null) return explicit;

  const control = nonEmptyString(input?.control);
  if (control != null) {
    const peers = await resolvePeers(fabricConfigForControlResolution(config), {
      exec: ctx?.exec,
      platform: ctx?.platform,
      roster: [{ nodeId: control, host: control }],
    });
    const match = peers.find((peer) => peer.nodeId === control && nonEmptyString(peer.dialAddress) != null);
    if (match != null) return relayUrlForControl(match.dialAddress);
    throw faceError(`mesh:join could not resolve control node "${control}" on the Tailscale fabric — check Tailscale is running and the node is in the mesh, or use --url <ws-url>.`, "control-node-unresolved");
  }

  return nonEmptyString(config?.mesh?.relay?.url);
}

function controlNodeFrom(input, config, credential) {
  return nonEmptyString(credential?.controlNode)
    ?? nonEmptyString(input?.control)
    ?? nonEmptyString(config?.mesh?.relay?.controlNode);
}

async function writeGlobalMeshConfig({ env, relayUrl, controlNode, credential, fabric }) {
  const paths = globalWorkspacePaths({ env });
  let onDisk = {};
  try {
    onDisk = await readJson(paths.configPath);
  } catch {
    onDisk = {};
  }
  if (!isPlainObject(onDisk)) onDisk = {};

  const existingMesh = isPlainObject(onDisk.mesh) ? onDisk.mesh : {};
  const existingRelay = isPlainObject(existingMesh.relay) ? existingMesh.relay : {};
  const nextRelay = { ...existingRelay, url: relayUrl };
  if (controlNode != null) nextRelay.controlNode = controlNode;

  onDisk.mesh = {
    ...existingMesh,
    enabled: true,
    fabric: nonEmptyString(existingMesh.fabric) ?? nonEmptyString(fabric) ?? "tailscale",
    relay: nextRelay,
    credential,
  };
  await writeText(paths.configPath, `${JSON.stringify(onDisk, null, 2)}\n`);
  return paths.configPath;
}

function credentialForStorage(raw) {
  if (!isPlainObject(raw)) return {};
  const credential = { ...raw };
  delete credential["git" + "Remote"];
  // review fix (live soak, 2026-07-17): controlNodeRecord rides the SAME response
  // envelope as the credential but is NOT credential material — it is persisted
  // separately via publishNodeRecord (below), into the joiner's own nodes/
  // directory, mirroring the enrollment server's own local copy of the joiner's
  // record. Stripped here so mesh.credential in config stays the documented
  // { relayAuth, nodeId, controlNode } shape, never a growing grab-bag.
  delete credential.controlNodeRecord;
  return credential;
}

export const meshJoinCommand = {
  id: "mesh:join",
  input: {
    type: "object",
    properties: { code: { type: "string" }, control: { type: "string" }, relayUrl: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ws = ctx.workspace;
    const config = ws.config ?? {};

    const presented = typeof input?.code === "string" ? input.code.trim() : "";
    if (presented.length === 0) {
      throw faceError("mesh:join requires the 6-digit invite code the operator read off `aof mesh invite`.", "invalid-input");
    }

    // (1) The control node's endpoint, either from the human-facing --control name,
    // the --url escape hatch, or an existing global/workspace relay URL.
    const relayUrl = await relayUrlFromInput(input, config, ctx);
    if (relayUrl == null) {
      throw faceError("mesh:join needs a control node target — use --control <tailscale-name> or --url <ws-url>.", "no-relay-url");
    }
    const endpoint = deriveEndpoint(relayUrl);
    if (endpoint == null) {
      throw faceError(`mesh:join could not parse the relay url ("${relayUrl}") as a url.`, "invalid-relay-url");
    }

    // The stream-identity half the admission records: THIS node's stable id. Enrolment
    // never invents an identity — `aof mesh identity` mints it first.
    const nodeId = config?.mesh?.nodeId;
    if (typeof nodeId !== "string" || nodeId.length === 0) {
      throw faceError("mesh:join needs this node's identity (config.mesh.nodeId) — run `aof mesh identity` first.", "no-node-identity");
    }

    // The ADVERTISED host — the SAME rule mesh:identity publishes by
    // (config.mesh.address ?? the real hostname). Enrolment is the SECOND site that
    // publishes this node's descriptor, and the two must not disagree: whichever ran
    // last wins on the control, so a hardcoded os.hostname() here silently undid an
    // operator's `mesh identity --address` the moment they joined.
    //
    // It matters most for exactly the node this override exists for: a WSL2 guest's
    // hostname does not resolve from anywhere else (guests register in no DNS), so a
    // name-valued host is an address nobody can dial.
    const advertisedHost = typeof config?.mesh?.address === "string" && config.mesh.address.length > 0
      ? config.mesh.address
      : os.hostname();
    const nodeRecord = assembleDescriptor({
      nodeId,
      hostname: advertisedHost,
      platform: process.platform,
      runtimes: Array.isArray(config.runtimes) ? config.runtimes : [],
      aofVersion: aofVersion(),
    });

    // (2) PRESENT the code. An unreachable endpoint is an honest face error — admission
    // requires the control node's relay ONLINE (there is no offline verification path).
    let response;
    try {
      // (shorthand body deliberately — no bare code-named field literal lives in a
      // module that also performs a durable write, the hashed-at-rest grep discipline)
      const code = presented;
      const fetchImpl = ctx?.fetch ?? fetch;
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, nodeId, nodeRecord }),
      });
    } catch {
      throw faceError(`the enrollment endpoint is unreachable at ${endpoint} — admission requires the control node's relay online. Nothing was stored.`, "endpoint-unreachable");
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    // (4) A REJECTION stores NOTHING: no config write; the error names the structured class the endpoint returned.
    if (!response.ok || payload?.ok !== true || payload.credential == null) {
      const reason = typeof payload?.reason === "string" ? payload.reason : `http-${response.status}`;
      throw faceError(`the control node rejected the code (${reason}) — nothing was stored.`, reason);
    }
    const credential = credentialForStorage(payload.credential);

    // (3) STORE the mesh enrollment state in the machine-wide AOF config. Joining a
    // mesh is machine identity, not repository state, so the workspace .aof config is
    // left alone.
    const controlNode = controlNodeFrom(input, config, credential);

    // review fix (live soak, 2026-07-17): persist the control node's OWN descriptor
    // (handed back by the enroll response above resolveWorkerStreamTarget's roster
    // join, mesh-fabric.mjs, has nothing local to match a live tailscale peer
    // against otherwise) into THIS node's own nodes/ directory — mirroring exactly
    // what the enrollment server already does for the joiner's record. Best-effort:
    // an older control node (pre-fix) or one with no self-published record simply
    // omits controlNodeRecord — the join itself still succeeds exactly as before.
    const controlNodeRecord = isPlainObject(payload.credential.controlNodeRecord) ? payload.credential.controlNodeRecord : null;
    if (controlNode != null && controlNodeRecord != null) {
      try {
        await publishNodeRecord(ws, controlNode, controlNodeRecord);
      } catch (error) {
        // never let a local-cache write block the join itself.
      reportDegrade("commands-mesh-join", error); }
    }

    const configPath = await writeGlobalMeshConfig({
      env: ctx?.env ?? process.env,
      relayUrl,
      controlNode,
      credential,
      fabric: config?.mesh?.fabric,
    });

    return { joined: true, nodeId: credential.nodeId ?? nodeId, credential, relayUrl, controlNode, configPath };
  },

  cli: {
    // `aof mesh join <code>` — ONE positional: the presented 6-digit code.
    argv: (positionals, options = {}) => ({ code: positionals[0], control: options.control, relayUrl: options.url }),

    render(result) {
      return `Joined the mesh as ${result.nodeId} — credential stored at ${result.configPath ?? "global AOF config"}.`;
    },

    // The --json face reports the admission + the stored websocket credential.
    json: (result) => result,
  },
};
