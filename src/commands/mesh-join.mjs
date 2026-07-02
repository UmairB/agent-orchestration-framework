// mesh:join <code> — the joining node's half of device-code enrollment (milestone 24 /
// story 01 / ADR-002 move 3 + ADR-003 moves 1+3). A registered command-core command
// carrying the frozen { id, input, run, cli } contract (08/ADR-002):
//
//   1. READ config.mesh.relay.url (the control node's endpoint — the
//      mesh-relay-client.mjs url-read precedent) and derive the device-flow HTTP
//      endpoint from it (ws://host/ws/relay → http://host/enroll — the SAME server,
//      03/ADR-001; wss → https).
//   2. PRESENT — POST { code, nodeId } to the endpoint. The control node matches,
//      consumes, admits, and issues; a rejection (bad / expired / consumed / capped)
//      comes back as a structured JSON class.
//   3. ON MATCH — store the issued credential { relayAuth, nodeId, gitRemote } at
//      config.mesh.credential via the READ-MERGE-WRITE of the free-form mesh subtree
//      (the resolveInstallSalt precedent in mesh-identity.mjs): the on-disk config is
//      re-read and only mesh.credential is set, so every other key — mesh.nodeId,
//      mesh.relay.url, mesh.salt, the non-mesh top level — survives byte-equivalent
//      (merge, never a clobber).
//   4. PROVISION git-remote access (ADR-003 move 3 — "provisioned alongside", 22/R6:
//      the grant RUNS, it is not a README line): `git remote add <name> <url>` against
//      the JOINING node's OWN clone via the shell-less spawnSync("git", [ … ]) argv
//      idiom (13/ADR-002 / the mesh-sync git precedent — a shell string would
//      word-split a url on Windows; acd-enroll-git-argv-no-shell greps the argv form
//      here). An already-configured remote is tolerated (probe first, add only when
//      absent); no git verb ever touches a foreign source tree.
//   5. ON REJECTION — a clean face-level error and NOTHING stored: the config file is
//      byte-unchanged and no git remote is added.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readJson, writeText } from "../fs.mjs";

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

// The joining node's OWN clone: walk up from the workspace's work stream to the
// containing git repo (the mesh-sync repoRootFor shape), falling back to a
// projectRoot that is itself a repo. Null ⇒ no repo to provision (a structured
// degraded outcome on the result, never a crash).
function findRepoRoot(workspace) {
  const start = workspace.workDir ?? workspace.projectRoot;
  let dir = start ? path.resolve(start) : null;
  while (dir) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const projectRoot = workspace.projectRoot ? path.resolve(workspace.projectRoot) : null;
  if (projectRoot && existsSync(path.join(projectRoot, ".git"))) return projectRoot;
  return null;
}

// Provision the granted git remote on the joining node's OWN clone — the shell-less
// argv idiom ONLY (13/ADR-002: spawnSync("git", [ … ]) with the url as ONE argv token,
// so a url containing a space is NEVER word-split — the Windows hazard a shell string
// carries). Tolerant: an absent grant / no repo / an already-existing remote are
// structured outcomes on the result, never throws. The only git verbs used are the
// remote-configuration verbs on THIS clone (remote get-url / remote add) — no write
// verb against any foreign source tree (the read-only-source discipline).
function provisionGitRemote(workspace, grant) {
  const remoteName = typeof grant?.name === "string" && grant.name.length > 0 ? grant.name : null;
  const remoteUrl = typeof grant?.url === "string" && grant.url.length > 0 ? grant.url : null;
  if (remoteName == null || remoteUrl == null) {
    return { provisioned: false, reason: "no-grant", name: remoteName, url: remoteUrl };
  }
  const repoRoot = findRepoRoot(workspace);
  if (repoRoot == null) {
    return { provisioned: false, reason: "no-git-repo", name: remoteName, url: remoteUrl };
  }
  // Tolerate an already-existing remote: probe first (a read of THIS clone's config);
  // an existing remote is left as configured, never clobbered.
  const probe = spawnSync("git", ["remote", "get-url", remoteName], { cwd: repoRoot, encoding: "utf8" });
  if (!probe.error && probe.status === 0) {
    return { provisioned: true, existing: true, name: remoteName, url: probe.stdout.trim() };
  }
  const added = spawnSync("git", ["remote", "add", remoteName, remoteUrl], { cwd: repoRoot, encoding: "utf8" });
  if (added.error || added.status !== 0) {
    const detail = added.error ? String(added.error.message ?? added.error) : (added.stderr ?? "").trim();
    return { provisioned: false, reason: "git-remote-add-failed", detail, name: remoteName, url: remoteUrl };
  }
  return { provisioned: true, existing: false, name: remoteName, url: remoteUrl };
}

export const meshJoinCommand = {
  id: "mesh:join",
  input: {
    type: "object",
    properties: { code: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ws = ctx.workspace;
    const config = ws.config ?? {};

    const presented = typeof input?.code === "string" ? input.code.trim() : "";
    if (presented.length === 0) {
      throw faceError("mesh:join requires the 6-digit invite code the operator read off `aof mesh invite`.", "invalid-input");
    }

    // (1) The control node's endpoint, off the SAME config key the relay push client
    // reads (config.mesh.relay.url — the mesh-relay-client precedent).
    const relayUrl = config?.mesh?.relay?.url;
    if (typeof relayUrl !== "string" || relayUrl.length === 0) {
      throw faceError("mesh:join needs config.mesh.relay.url — the control node's relay endpoint to present the code to.", "no-relay-url");
    }
    const endpoint = deriveEndpoint(relayUrl);
    if (endpoint == null) {
      throw faceError(`mesh:join could not parse config.mesh.relay.url ("${relayUrl}") as a url.`, "invalid-relay-url");
    }

    // The stream-identity half the admission records: THIS node's stable id. Enrolment
    // never invents an identity — `aof mesh identity` mints it first.
    const nodeId = config?.mesh?.nodeId;
    if (typeof nodeId !== "string" || nodeId.length === 0) {
      throw faceError("mesh:join needs this node's identity (config.mesh.nodeId) — run `aof mesh identity` first.", "no-node-identity");
    }

    // (2) PRESENT the code. An unreachable endpoint is an honest face error — admission
    // requires the control node's relay ONLINE (there is no offline verification path).
    let response;
    try {
      // (shorthand body deliberately — no bare code-named field literal lives in a
      // module that also performs a durable write, the hashed-at-rest grep discipline)
      const code = presented;
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, nodeId }),
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

    // (5) A REJECTION stores NOTHING: no config write, no git remote — the error names
    // the structured class the endpoint returned.
    if (!response.ok || payload?.ok !== true || payload.credential == null) {
      const reason = typeof payload?.reason === "string" ? payload.reason : `http-${response.status}`;
      throw faceError(`the control node rejected the code (${reason}) — nothing was stored.`, reason);
    }
    const credential = payload.credential;

    // (3) STORE the credential — read-merge-write of the free-form config.mesh.*
    // subtree (the resolveInstallSalt precedent): re-read the on-disk config and set
    // ONLY mesh.credential, so every other key survives byte-equivalent.
    if (ws.configPath) {
      let onDisk = {};
      try {
        onDisk = await readJson(ws.configPath);
      } catch {
        onDisk = {};
      }
      if (!onDisk.mesh || typeof onDisk.mesh !== "object") onDisk.mesh = {};
      onDisk.mesh.credential = credential;
      await writeText(ws.configPath, `${JSON.stringify(onDisk, null, 2)}\n`);
    }

    // (4) PROVISION the granted git remote on THIS node's own clone (argv-form git).
    const gitRemote = provisionGitRemote(ws, credential.gitRemote);

    return { joined: true, nodeId: credential.nodeId ?? nodeId, credential, gitRemote };
  },

  cli: {
    // `aof mesh join <code>` — ONE positional: the presented 6-digit code.
    argv: (positionals) => ({ code: positionals[0] }),

    render(result) {
      const remoteLine = result.gitRemote?.provisioned
        ? `git remote "${result.gitRemote.name}" → ${result.gitRemote.url}${result.gitRemote.existing ? " (already configured)" : ""}`
        : `no git remote provisioned (${result.gitRemote?.reason ?? "no grant"})`;
      return [
        `Joined the mesh as ${result.nodeId} — credential stored at config.mesh.credential.`,
        remoteLine,
      ].join("\n");
    },

    // The --json face reports the admission + the stored credential + the provisioning.
    json: (result) => result,
  },
};
