// src/mesh-launcher.mjs — the per-node presence and global propagation daemon (milestone 33 / story 01,
// ADR-003). The coordination launcher (F-3201): with the ws@8 broker eliminated
// (ADR-002), this is the per-node process the fabric-native model needs — it publishes
// this node's global presence record, runs global propagation cadence, and
// periodically re-reads the fabric peer-map so mesh:status reflects live liveness. On
// the control node it hosts the mesh WebSocket/enrollment service; on worker nodes it
// opens an outbound WebSocket client to that control service.
//
// TWO FACES over the SAME core (08/ADR-001 / the 23 precedent):
//   - launcherProbe(config, options)   — the NON-BLOCKING probe the registered mesh:*
//                                        command run IS (ADR-003.2): reports fabric
//                                        state + self-address + registered mesh peer count + whether
//                                        this node is the control node, and RETURNS.
//                                        Never starts long-lived listeners or tickers.
//   - startLauncher(ws, options)       — the long-lived launcher face: preflights the
//                                        fabric (refuse-with-guidance if degraded),
//                                        publishes presence, starts the reused global
//                                        propagation, and for control/worker roles
//                                        starts the appropriate server/client stream.
//                                        Returns { stop() } (mirrors
//                                        the serveRelay returned shape)
//                                        so the CLI face traps SIGINT/SIGTERM and calls
//                                        it — never a dependency on a raw process.on
//                                        firing inside a test.
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { globalMeshPaths } from "./workspace.mjs";
import { probeFabric, selfAddress, resolvePeers, fabricGuidance } from "./mesh-fabric.mjs";
import { readNodeRecords } from "./mesh-store.mjs";
import { deriveNodeId, sidecarPathFor, readSidecar } from "./node-identity.mjs";
import { aofVersion } from "./commands/mesh-identity.mjs";
import { assemblePresenceRecord, readActiveRuns, readLiveSessions, publishPresenceRecord, resolveNodeWorkspaces, resolveWorkspaceProjectRoot } from "./mesh-presence.mjs";
import { listItems, loadWorkspace } from "./work.mjs";
import { publishGlobalWorkSnapshot, workspaceIdFor, readWorkspaceProjectionItems } from "./global-work-publisher.mjs";
import { meshRole, resolveWorkerStreamTarget } from "./mesh-role.mjs";
import { createWorkerStreamClient, createWorkerWsTransport } from "./worker-stream-client.mjs";
import { startControlStreamServer, buildDirectiveFrame, DEFAULT_HEARTBEAT_WINDOW_SECONDS } from "./control-stream-server.mjs";
// milestone 35 / story 02 (ADR-004) — the accepted-directive execution handler
// client.onDirective(...) registers below.
import { createMeshWorkerExecutionHandler, createMeshRecoveryPushHandler, listActiveWorktrees, meshDebug, resolveCloneUrl, ensureWorktreeTrusted, INTERACTIVE_COMMAND_READY_DELAY_MS } from "./mesh-worker-execution.mjs";
// VERIFICATION (live soak 2026-07-25) — the control-driven recovery push. The control
// tick drains recovery requests, mints the write credential, and dispatches a
// recovery-push DOWN-frame (runRecoveryPushDispatchTick); the worker registers its
// commit+push handler on the SAME client (createMeshRecoveryPushHandler, above).
import { runRecoveryPushDispatchTick } from "./mesh-recovery-push.mjs";
import { createEnrollmentHttpHandler, relayMode } from "./mesh-relay.mjs";
import { readMeshLauncherLockStatus } from "./mesh-launcher-lock.mjs";
// milestone 38 / story 06 — ADR-014 AMENDMENT (2026-07-19, `aof:continue 38/06`
// closing BLOCKER F-38.06 — the HYBRID transport). An option-(a) draft (push the
// worker's frames straight at the mesh-relay broker) was FALSIFIED at source:
// `serveRelay` binds LOOPBACK ONLY (mesh-relay.mjs:622), so a worker on ANOTHER
// machine cannot reach it. The transport is therefore a HYBRID, each leg on the
// bind it fits:
//   - CROSS-MACHINE (worker → control): the FABRIC. The worker sends a terminal-frame
//     UP its stream client (client.sendTerminalFrame, worker branch below) — the only
//     off-host-reachable transport. This launcher references NO push transport on the
//     worker side (the fabric client carries it).
//   - SAME-MACHINE (control → the SEPARATE `aof mesh ui` process): a LOOPBACK relay.
//     The control launcher runs the mesh-relay broker on the KNOWN port named in
//     config.mesh.relay.url and bridges each fabric-received terminal-frame into it
//     (the `onTerminalFrame` sink at the startServer call site, control branch below);
//     the fleet-UI process subscribes over loopback (cli.mjs, unchanged).
// `createTerminalRelayPushTransport` is used ONLY on the CONTROL side (the loopback
// push into the broker) — never on the worker side.
import { createTerminalRelayPushTransport } from "./mesh-terminal-relay-bridge.mjs";
// milestone 35 / ADR-008 — the control-side dispatch/reclaim driver's DATA-LAYER
// orchestrator (owns the ONE store-open for both the dispatch scan AND the ADR-005
// reclaim call — this launcher module itself imports NO SQLite-store module
// directly, keeping fitness acd-global-publisher-single-seam intact; the launcher
// tick is the ONLY production CALLER of this orchestrator, per fitness
// acd-control-dispatch-reclaim-driver-wired).
import { runControlDispatchReclaimTick } from "./mesh-assignment-reclaim.mjs";
// milestone 38 / story 02 (ADR-010) — the config-selected clone-credential-mint
// PROVIDER, resolved HERE (where `config` lives) and wired as a LITERAL
// `mintCloneCredential` key at the ONE production `startServer({...})` call site
// below (the F12 discipline generalised to the provider). NO direct SQLite-store
// import here — `resolveWorkspaceProjectRoot` (mesh-presence.mjs, imported above)
// is the ONE seam this launcher reaches for a workspaceId -> project_root lookup,
// keeping fitness `acd-global-publisher-single-seam` intact.
import { resolveCloneCredentialProvider, resolveWriteCredentialProvider } from "./mesh-clone-credential-provider.mjs";

const DEFAULT_CADENCE_SECONDS = 15;
const DEFAULT_CONTROL_SERVICE_PORT = 4182;
const DEFAULT_CONTROL_STREAM_PATH = "/ws/relay";

function resolveCadenceSeconds(value) {
  if (typeof value !== "number") return DEFAULT_CADENCE_SECONDS;
  if (!Number.isFinite(value)) return DEFAULT_CADENCE_SECONDS;
  if (!Number.isInteger(value)) return DEFAULT_CADENCE_SECONDS;
  if (value <= 0) return DEFAULT_CADENCE_SECONDS;
  return value;
}

function cadenceFromConfig(workspace) {
  return resolveCadenceSeconds(workspace?.config?.mesh?.sync?.cadenceSeconds);
}

function resolveNow(options = {}) {
  if (typeof options?.now === "function") return String(options.now());
  if (typeof options?.now === "string" && options.now.length > 0) return options.now;
  return new Date().toISOString();
}

// createResolveWorkspaceCloneUrl(ws, options) — milestone 38 / story 02 (ADR-010 Gap
// A): builds the `resolveWorkspaceCloneUrl(workspaceId) => Promise<string|null>` seam
// the `github-app` provider closes over. Its SOURCE OF TRUTH is the SAME
// fleet-shared, COMMITTED `config.mesh.repo.cloneUrl` key ADR-005 established and
// SECURITY T5(a) trusts — NEVER the worker's own request frame (dropped at the
// client boundary; re-arming F15's "the requester must not steer the mint's repo
// scope" posture at this layer too).
//   - the CONTROL node's own launch workspace is the single-repo/bootstrap fallback
//     (`ws.config.mesh.repo.cloneUrl`, read via the existing `resolveCloneUrl(ws)`
//     raw optional-chain reader) — used directly when the requested workspaceId IS
//     this launch workspace's own id (the common single-repo-fleet case, AC 6: no new
//     config shape, no new store table for that case).
//   - otherwise, resolved per-workspace through the ADR-003 descriptor seam already
//     shipped for this exact "workspaceId -> project_root" lookup —
//     `resolveWorkspaceProjectRoot` (mesh-presence.mjs, mirroring
//     `resolveNodeWorkspaces`'s own descriptor read, which this launcher already
//     keeps NO direct SQLite-store dependency of its own to reach) -> `loadWorkspace`
//     -> `resolveCloneUrl(ws)`. A store fault, a missing descriptor row, or a
//     workspace whose own config carries no well-formed cloneUrl all resolve to
//     `null` — the caller (the provider) throws a loud, coded mint failure; this seam
//     never guesses, never throws itself (FAILURE-ISOLATED, the same discipline every
//     other launcher collaborator keeps).
export function createResolveWorkspaceCloneUrl(ws, options = {}) {
  const ownWorkspaceId = ws.config?.mesh?.workspaceId ?? workspaceIdFor(ws.projectRoot ?? ws.workDir);
  return async function resolveWorkspaceCloneUrl(workspaceId) {
    if (workspaceId === ownWorkspaceId) {
      return resolveCloneUrl(ws);
    }
    try {
      const projectRoot = await resolveWorkspaceProjectRoot(workspaceId, options);
      if (projectRoot == null) return null;
      const otherWs = await loadWorkspace(projectRoot, undefined, { env: options?.globalWorkStoreOptions?.env });
      return resolveCloneUrl(otherWs);
    } catch {
      return null;
    }
  };
}

// githubAppPrivateKeyFilename(appId) — milestone 38 / story 03 (ADR-011 decision /
// SECURITY T12(b); the build-owed FILENAME convention flagged by aof-qa at refine,
// STATE.md's per-org-credential-scoping note). The code-enforced default DIRECTORY
// (`<meshRoot>/credentials/`, below) is SHARED by every org's App, so the FILE within
// it is keyed by `appId` — two orgs' keys must coexist as DISTINCT files, never
// overwrite one another. Pinned convention: `github-app-<appId>.pem`, `appId`
// sanitized to a filesystem-safe slug (never a raw path segment — a config value can
// never escape the credentials directory via `..`/separators). Absent an appId (the
// caller has nothing to key by — resolveWorkspaceAppIdentity refuses a blank appId
// before this default is ever reached for a MINT) falls back to the bare
// `github-app.pem` — the pre-multi-org singular default's filename, unchanged.
function githubAppPrivateKeyFilename(appId) {
  if (typeof appId === "string" && appId.trim().length > 0) {
    const slug = appId.trim().replace(/[^A-Za-z0-9_-]/g, "-");
    return `github-app-${slug}.pem`;
  }
  return "github-app.pem";
}

// defaultGithubAppPrivateKeyPath(config, options) — the CODE-ENFORCED default:
// `<meshRoot>/credentials/<filename>`, composed via the `globalMeshPaths` seam
// (honoring `AOF_GLOBAL_HOME`) — NEVER a `homedir()` + sync-folder guess (SECURITY
// T8/T12(b), the MEASURED footgun this story exists to close: the operator had to
// relocate the story-02 key OUT of a Dropbox-synced folder into
// `~/.aof/mesh/credentials/`). Mirrors `meshCheckoutPath`'s identical "one seam, one
// root" discipline (`mesh-worker-execution.mjs`).
function defaultGithubAppPrivateKeyPath(config, options = {}) {
  const appId = config?.mesh?.repo?.credential?.githubApp?.appId ?? null;
  return path.join(globalMeshPaths(options).meshRoot, "credentials", githubAppPrivateKeyFilename(appId));
}

function readGithubAppPrivateKeyFile(keyPath, options = {}) {
  const readFile = options.readPrivateKeyFile ?? readFileSync;
  try {
    return readFile(keyPath, "utf8");
  } catch {
    return null;
  }
}

// resolveGithubAppPrivateKey(config, options) — milestone 38 / story 02 (ADR-010
// §6.2, T8), extended by story 03 (ADR-011 decision 5, T12(b)): the App private key
// resolves from a FILE PATH, precedence:
//   1. `AOF_MESH_GITHUB_APP_PRIVATE_KEY_PATH` (env, `options.env ?? process.env`) —
//      consulted ONLY when `options.allowEnvOverride !== false`. Env is a single
//      control-node-PROCESS-wide setting, so it is part of "the control node's own"
//      (launch-workspace) default ONLY — it is NEVER consulted when resolving a
//      DIFFERENT (non-launch) workspace's OWN committed override (SECURITY T12: a
//      per-workspace override's sole source is that workspace's OWN committed
//      config, never a process-wide env value that could leak the SAME path across
//      an org boundary). `createResolveWorkspaceAppIdentity` below is the ONE caller
//      that decides which case applies.
//   2. `config.mesh.repo.credential.githubApp.privateKeyPath` — a committed PATH is
//      fine (the path is not the secret, the file's contents are).
//   3. the CODE-ENFORCED default above.
// Read via the injectable `options.readPrivateKeyFile` seam (default `readFileSync`;
// `@executable` tests inject a recording fake — no real fs read of a secret). A
// missing/unreadable key file resolves to `null` — NEVER a launcher crash; the
// resulting misconfiguration surfaces at the first MINT attempt as the existing loud
// coded `clone-credential-mint-failed`, not as a daemon-start fault.
export function resolveGithubAppPrivateKey(config, options = {}) {
  if (options.allowEnvOverride !== false) {
    const env = options.env ?? process.env;
    const envPath = env?.AOF_MESH_GITHUB_APP_PRIVATE_KEY_PATH;
    if (typeof envPath === "string" && envPath.length > 0) {
      return readGithubAppPrivateKeyFile(envPath, options);
    }
  }
  const configuredPath = config?.mesh?.repo?.credential?.githubApp?.privateKeyPath;
  if (typeof configuredPath === "string" && configuredPath.length > 0) {
    return readGithubAppPrivateKeyFile(configuredPath, options);
  }
  return readGithubAppPrivateKeyFile(defaultGithubAppPrivateKeyPath(config, options), options);
}

// identityFromConfig(config, options) — reads ONE workspace's OWN resolved config for
// a usable `{ appId, privateKey, installationId }` App identity, or `null` when it
// carries no usable `appId` (blank/absent) or its `privateKey` fails to resolve
// (unreadable key file) — the "no usable App/key" case SECURITY T12 / ADR-011
// invariant #2 requires to fail LOUD, never silently borrow elsewhere.
function identityFromConfig(config, options) {
  const githubApp = config?.mesh?.repo?.credential?.githubApp ?? {};
  const appId = typeof githubApp.appId === "string" && githubApp.appId.length > 0 ? githubApp.appId : null;
  if (appId == null) return null;
  const privateKey = resolveGithubAppPrivateKey(config, options);
  if (typeof privateKey !== "string" || privateKey.length === 0) return null;
  return { appId, privateKey, installationId: githubApp.installationId ?? null };
}

// createResolveWorkspaceAppIdentity(ws, options) — milestone 38 / story 03 (ADR-011):
// builds the `resolveWorkspaceAppIdentity(workspaceId) => Promise<{appId, privateKey,
// installationId}|null>` seam the `github-app` provider closes over, keyed by the
// mint's OWN `workspaceId` — the SAME per-workspace treatment
// `createResolveWorkspaceCloneUrl` (Gap A, above) already gives `cloneUrl`. Its
// source of truth is EACH workspace's OWN global-merged committed
// `mesh.repo.credential.githubApp.*`, resolved through the IDENTICAL ADR-003
// descriptor seam (`resolveWorkspaceProjectRoot` -> `loadWorkspace`) that function
// already uses:
//   - the CONTROL node's own launch workspace (`ws.config`, already loaded) is used
//     directly when the requested workspaceId IS the launch workspace's own id (the
//     env-override-eligible case — today's byte-unchanged single-org default).
//   - a DIFFERENT (non-launch) assigned workspace whose OWN resolved config carries a
//     genuine `githubApp.appId` override uses THAT identity exclusively (env is NEVER
//     consulted for it — SECURITY T12).
//   - absent a per-workspace override (or an unresolvable descriptor — a store fault,
//     a missing row, a workspace never checked out), resolution FALLS THROUGH to the
//     control node's own (global-merged) launch-workspace default — ADR-011's
//     "singular App by default, override-able per workspace" decision, now correctly
//     reached for ANY assigned workspace, not only the launch one.
// A workspace (own OR the launch fallback) whose resolved identity carries no usable
// `appId` + readable `privateKey` returns `null` — the caller (the provider) throws
// the loud coded mint failure; this seam never guesses, never throws itself, and
// NEVER reads a SIBLING (neither-own-nor-launch) workspace's identity — the
// structural "no cross-org borrow" ADR-011 invariant #2 / SECURITY T12 pins.
export function createResolveWorkspaceAppIdentity(ws, options = {}) {
  const ownWorkspaceId = ws.config?.mesh?.workspaceId ?? workspaceIdFor(ws.projectRoot ?? ws.workDir);
  return async function resolveWorkspaceAppIdentity(workspaceId) {
    if (workspaceId === ownWorkspaceId) {
      return identityFromConfig(ws.config ?? {}, { ...options, allowEnvOverride: true });
    }
    let targetConfig = null;
    try {
      const projectRoot = await resolveWorkspaceProjectRoot(workspaceId, options);
      if (projectRoot != null) {
        const otherWs = await loadWorkspace(projectRoot, undefined, { env: options?.globalWorkStoreOptions?.env });
        targetConfig = otherWs.config ?? {};
      }
    } catch {
      targetConfig = null;
    }
    const ownOverrideAppId = targetConfig?.mesh?.repo?.credential?.githubApp?.appId;
    if (typeof ownOverrideAppId === "string" && ownOverrideAppId.length > 0) {
      return identityFromConfig(targetConfig, { ...options, allowEnvOverride: false });
    }
    // No override of its own (or an unresolvable descriptor) -> the control node's
    // own (global-merged) launch-workspace default.
    return identityFromConfig(ws.config ?? {}, { ...options, allowEnvOverride: true });
  };
}

// resolveAggregationWorkspaces(ws, nodeId, options) — the ADR-003 workspace set this
// tick aggregates over: this node's registered workspaces (resolveNodeWorkspaces,
// the mesh-presence.mjs sanctioned seam — mesh-launcher.mjs gains no new direct
// SQLite dependency) PLUS the launch-cwd workspace, which is ALWAYS included (a
// registered workspace like any other — so no work is ever lost even when the
// registry read degrades). De-duplicated by workDir so a launch-cwd that is ALSO
// separately registered is not double-counted. A store-unreachable read (ok:false)
// degrades to JUST the launch-cwd workspace — never a crash, never an empty result.
// Each entry carries its OWN workspaceId (the launch-cwd entry derives it the SAME
// way the rest of the launcher already does — workspaceIdFor(projectRoot), the
// existing publish-time seam) — the id is what lets the assembler attribute a run
// count to its workspace (review F1: activeRuns on the WIRE is a bare `string[]` of
// run ids, 23/ADR-002 — it carries no workspace attribution of its own; the
// attribution exists ONLY here, in this per-workspace loop, never downstream).
// FINDING F11 (aof:verify 38, BLOCKER) — the dedup key is now a NORMALIZED absolute
// path, not the raw workDir string. Pre-fix, every registry-sourced workDir was the
// SAME raw relative "./wiki/work" string regardless of which workspace it came from,
// so this dedup collapsed genuinely DISTINCT workspaces into one (the "same
// workspace counted N times" half of the bug). Post-fix both mesh-presence.mjs's
// resolveNodeWorkspaces (the read side) and the launch-cwd's own ws.workDir
// (loadWorkspace) hand back CANONICAL absolute paths, but two spellings of the SAME
// directory (case, trailing separator, `..` segments) must still collapse to one —
// path.resolve normalizes that, and on win32 the comparison is case-folded (NTFS is
// case-insensitive; the SAME discipline global-node-registry.mjs's own pathKey
// keeps) so a workspace is never double-counted OR wrongly collapsed with a distinct
// one.
function normalizedWorkDirKey(workDir) {
  const resolved = path.resolve(workDir);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function resolveAggregationWorkspaces(ws, registryResult) {
  const seen = new Set();
  const workspaces = [];
  const addWorkspace = (workDir, workspaceId) => {
    if (typeof workDir !== "string" || workDir.length === 0) return;
    const key = normalizedWorkDirKey(workDir);
    if (seen.has(key)) return;
    seen.add(key);
    workspaces.push({ workDir, workspaceId });
  };
  addWorkspace(ws.workDir, ws.config?.mesh?.workspaceId ?? workspaceIdFor(ws.projectRoot ?? ws.workDir));
  if (registryResult.ok) {
    for (const entry of registryResult.workspaces) addWorkspace(entry.workDir, entry.workspaceId);
  }
  return workspaces;
}

// Review F1 (MAJOR product defect fix): `activeRuns` on the WIRE is the frozen m23
// `string[]` of bare run ids (23/ADR-002) — it carries NO workspace attribution, so
// a render-layer helper fed only `{ activeRuns, sessions }` can never correctly
// decide "which workspace does this run belong to" (the bug the review caught:
// ui/src/fleet/runs.mjs was keying subsumption off a shape production never emits).
// The attribution EXISTS only here, in this per-workspace loop — so the "run
// subsumes a same-workspace session" reconciliation (ADR-004) MUST happen here, not
// in the render helper. This function assembles activeRuns AND returns the set of
// workspaceIds that contributed at least one running run, so the caller can drop
// any live session on one of those workspaces BEFORE the record is published —
// `sessions[]` is therefore PRE-SUBSUMED on the wire; the render helper never needs
// (and structurally cannot perform) run-attribution of its own.
// `listItemsFn` is the injected item-enumeration seam (default the real
// listItems) — the real production listItems never throws (work.mjs's own
// readDirSafe swallows every readdir fault internally, an absence-is-benign
// discipline this codebase keeps throughout), so a test that wants to exercise
// THIS function's per-workspace try/catch isolation for "a workspace's item
// enumeration fails" needs an injectable seam rather than a real fs fault
// (Windows has no reliable cross-platform way to force a genuine EACCES on a
// directory a test just created) — mirrors every other launcher dependency
// (exec/now/tickers) already being injectable via options.
async function assembleActiveRunsAndSubsumedWorkspaces(workspaces, listItemsFn) {
  const activeRuns = [];
  const workspacesWithRuns = new Set();
  for (const workspace of workspaces) {
    // PER-WORKSPACE ISOLATION (never a daemon crash): a workspace whose items can't
    // be enumerated (its dir vanished mid-tick, a permissions fault, …) is skipped —
    // absence-is-benign; the rest of the union still aggregates.
    try {
      const items = await listItemsFn(workspace.workDir);
      const runs = await readActiveRuns(items);
      if (runs.length > 0) {
        activeRuns.push(...runs);
        if (typeof workspace.workspaceId === "string" && workspace.workspaceId.length > 0) {
          workspacesWithRuns.add(workspace.workspaceId);
        }
      }
    } catch {
      // absence-is-benign — this workspace's runs are skipped, not fatal.
    }
  }
  return { activeRuns, workspacesWithRuns };
}

// emitWarning(sink, warning, options) — review fix (live soak, 2026-07-17): every
// warning pushed into a launcher warnings accumulator used to be read back ONLY by
// tests (handle.warnings) — the real `aof mesh serve --serve` foreground process
// never reads that array again after startup, so a worker's own connect failure (or
// any other fault raised here) was invisible in its own log, forever. `options.onWarning`
// (production's meshServeDaemonCommand now supplies console.error) surfaces it LIVE,
// in addition to the existing accumulator — every pre-existing test that never passes
// onWarning keeps byte-identical behaviour (a no-op fallback).
function emitWarning(sink, warning, options) {
  sink.push(warning);
  if (typeof options?.onWarning === "function") {
    try { options.onWarning(warning); } catch { /* a warning consumer must never crash the daemon */ }
  }
}

// `warningsSink` (default a scratch array — production always passes the real
// `launcherWarnings` accumulator) is where FINDING F11's LOUD-skip diagnostics land:
// a workspace resolveNodeWorkspaces skipped (its resolved absolute work dir
// genuinely doesn't exist) is surfaced HERE as a coded warning — never a silent
// `continue` that lets a zero/short aggregation masquerade as healthy. The frozen
// presence record itself (ADR-001's five keys) carries NONE of this — warnings are
// a launcher-facing diagnostic, never a wire-shape change.
async function assembleCurrentPresenceRecord(ws, nodeId, options = {}, warningsSink = []) {
  const registryResult = await resolveNodeWorkspaces(nodeId, options);
  for (const skip of registryResult.skipped ?? []) {
    emitWarning(warningsSink, {
      code: "workspace-workdir-unresolvable",
      message: `Workspace ${skip.workspaceId} work dir could not be resolved (${skip.reason})${skip.workDir ? `: ${skip.workDir}` : ""}.`,
      path: skip.workDir ?? null,
    }, options);
  }
  const workspaces = resolveAggregationWorkspaces(ws, registryResult);

  // activeRuns is the UNION across every resolved workspace's items (ADR-003);
  // workspacesWithRuns is the per-workspace attribution the render layer cannot
  // derive from the wire shape (review F1) — used below to subsume a same-workspace
  // live session BEFORE the record is published.
  const listItemsFn = typeof options?.listItems === "function" ? options.listItems : listItems;
  const { activeRuns, workspacesWithRuns } = await assembleActiveRunsAndSubsumedWorkspaces(workspaces, listItemsFn);

  // sessions is the union of this node's LIVE session records (ADR-001/002) — session
  // records are stored per-NODE (mesh-session.mjs), not per-workspace-dir, so ONE
  // read already covers every workspace; a read fault here degrades to no sessions
  // for this tick rather than crashing it (the same never-crash discipline every
  // other launcher read keeps). ADR-004's run-wins-the-primary-line rule is applied
  // HERE (review F1): a session whose workspaceId already has a running run is
  // SUBSUMED — dropped before the record is published, so `sessions[]` on the wire
  // never contains a session the run already accounts for.
  let sessions = [];
  try {
    sessions = (await readLiveSessions(ws, nodeId, options)).filter((session) => !workspacesWithRuns.has(session.workspaceId));
  } catch {
    // absence-is-benign — sessions are skipped this tick, not fatal.
  }

  return assemblePresenceRecord({ nodeId, heartbeatAt: resolveNow(options), activeRuns, sessions, aofVersion: aofVersion() });
}

function configuredRelayUrl(config) {
  const raw = config?.mesh?.relay?.url;
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function configuredServicePort(config) {
  const parsed = configuredRelayUrl(config);
  if (parsed == null || parsed.port.length === 0) return DEFAULT_CONTROL_SERVICE_PORT;
  const port = Number.parseInt(parsed.port, 10);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_CONTROL_SERVICE_PORT;
}

function hostForUrl(host) {
  const value = String(host ?? "");
  if (value.includes(":") && !value.startsWith("[")) return `[${value}]`;
  return value;
}

function configuredServiceUrlForAddress(config, dialAddress) {
  const parsed = configuredRelayUrl(config);
  const protocol = parsed?.protocol ?? "ws:";
  const pathname = parsed?.pathname && parsed.pathname !== "/" ? parsed.pathname : DEFAULT_CONTROL_STREAM_PATH;
  const port = configuredServicePort(config);
  return `${protocol}//${hostForUrl(dialAddress)}${port != null ? `:${port}` : ""}${pathname}`;
}
function intervalTicker() {
  return {
    start(intervalSeconds, onTick) {
      return setInterval(onTick, intervalSeconds * 1000);
    },
    stop(handle) {
      clearInterval(handle);
    },
  };
}
// peerNodeIdsFrom(peers) — the ONE roster-extraction shape both the launch-time
// admission roster AND the peer-poll refresh use (review fix P0.2): a resolvePeers()
// row array reduced to its resolved, non-empty nodeIds. Factored out so the two call
// sites can never drift on what counts as "a peer" for admission purposes.
function peerNodeIdsFrom(peers) {
  return (Array.isArray(peers) ? peers : [])
    .map((peer) => peer?.nodeId)
    .filter((id) => typeof id === "string" && id.length > 0);
}

// defaultConnectWorkerStreamClient(client, ws) — review fix P1.7b: push an INITIAL
// snapshot over the client's already-constructed transport so the stream genuinely
// carries state from the moment it opens (never an inert client that only ever
// streams nothing) — sendSnapshot() itself calls ensureConnected() internally
// (worker-stream-client.mjs), so there is no separate connect step here. DEFERRED
// to task-04's @manual soak: the per-mutation delta feed (run-start/run-complete →
// sendDelta) and the real two-machine live validation — this seam only pushes the
// snapshot the client's own reconnect contract already re-sends on every future
// reconnect (worker-stream-client.mjs's needsSnapshot flag); it does not itself
// re-snapshot on a later local mutation.
async function defaultConnectWorkerStreamClient(client, ws, presenceRecord = null) {
  const items = await readWorkspaceProjectionItems(ws).then((result) => result.rows).catch(() => []);
  await client.sendSnapshot(items);
  if (presenceRecord != null && typeof client.sendPresence === "function") {
    await client.sendPresence(presenceRecord);
  }
}

// Resolve THIS node's stable id + whether it is the control node
// (config.mesh.relay.controlNode === nodeId — the SAME comparison relayStatus already
// makes, mesh-relay.mjs:669). READ-ONLY, always — this NEVER mints or persists
// anything (no writeSidecarPatch call reachable from this function): a pinned
// config.mesh.nodeId (the hydrated sidecar overlay OR the committed fallback) wins
// verbatim; otherwise the id is DERIVED IN-MEMORY from the current salt/hostname
// WITHOUT ever calling deriveNodeId with a sidecarPath (that is deriveNodeId's
// PERSISTING mode) and WITHOUT minting a fresh salt when none exists yet (an absent
// salt derives with salt:undefined — installHash(undefined) is still deterministic
// per hostname, so a fresh, never-published node still gets a STABLE id for the
// life of this probe/serve call, even though nothing was written). Minting +
// persisting the salt/id stays owned exclusively by mesh:identity / mesh:heartbeat
// (story 00's design) — the launcher's registered run is a config+fabric READ, never
// a mint. The --serve daemon writes only this machine's global presence/global work
// projection records.
async function resolveNodeIdentity(ws) {
  const config = ws.config ?? {};
  // Read the salt from the MACHINE-WIDE identity home (34/story 00) — ws.identityPath
  // (global, resolved by loadWorkspace); a synthetic workspace falls back to the legacy
  // per-workspace sidecar. (config.mesh.salt is usually already hydrated from the same
  // file by loadWorkspace; this stays a belt-and-suspenders read of the SAME source.)
  const sidecarPath = ws.identityPath ?? sidecarPathFor(ws.aofDir);
  const sidecar = await readSidecar(sidecarPath);
  const salt = typeof sidecar?.salt === "string" && sidecar.salt.length > 0 ? sidecar.salt : config?.mesh?.salt;
  // NO sidecarPath passed to deriveNodeId — the in-memory-derive mode
  // (node-identity.mjs's own documented "persistence is skipped when no sidecarPath
  // is given" branch): a pinned id still wins verbatim; an unpinned one is derived
  // but never written back.
  const nodeId = await deriveNodeId({ config, hostname: os.hostname(), salt });
  // role — the ONE shared mesh-role predicate (mesh-role.mjs, ADR-007 /
  // acd-worker-stream-single-predicate): "control" is BYTE-IDENTICAL to the
  // control-node comparison this function already made (kept below, unchanged,
  // for every existing caller); "worker"/"standalone" are the story-04 additions no
  // prior caller reads.
  const role = meshRole(config, nodeId);
  const controlNode = config?.mesh?.relay?.controlNode ?? null;
  return { nodeId, issuanceAuthority: controlNode != null && controlNode === nodeId, role };
}

// launcherProbe(ws, options) → { fabricState, selfAddress, peerCount, issuanceAuthority
// } — the NON-BLOCKING registered-run shape (ADR-003.2, the relayStatus precedent). A
// pure config+fabric read: probeFabric + selfAddress + registered resolvePeers() nodeIds + the
// control-node comparison — ZERO blocking calls, so acd-mesh-command-cli-bijection
// stays green (the probe runs clean + parseable + RETURNS).
export async function launcherProbe(ws, options = {}) {
  const config = ws.config ?? {};
  const probe = await probeFabric(config, options);
  const address = probe.healthy ? await selfAddress(config, options) : null;
  const nodeRecords = probe.healthy ? await readNodeRecords(ws) : [];
  const peers = probe.healthy ? await resolvePeers(config, { ...options, roster: nodeRecords }) : [];
  const { issuanceAuthority } = await resolveNodeIdentity(ws);
  const launcherStatus = await resolveLauncherStatus(ws, options);
  return {
    fabricState: probe.reason ?? "running",
    healthy: probe.healthy,
    selfAddress: address,
    peerCount: new Set(peerNodeIdsFrom(peers)).size,
    launcherRunning: launcherStatus.running === true,
    launcherPid: launcherStatus.running === true ? launcherStatus.pid : null,
    issuanceAuthority,
  };
}

async function resolveLauncherStatus(ws, options) {
  if (typeof options?.launcherStatus === "function") return await options.launcherStatus();
  const lockOptions = options?.launcherLockOptions ?? (typeof ws?.globalMeshRoot === "string" && ws.globalMeshRoot.length > 0
    ? { paths: { meshRoot: ws.globalMeshRoot } }
    : { env: process.env });
  return await readMeshLauncherLockStatus(lockOptions);
}

// startLauncher(ws, options) → { stop() } | { refused: true, guidance } — the long-lived
// `--serve` face over the one-shot core (ADR-003.1/.3):
//   (a) PREFLIGHT the fabric via probeFabric; a degraded probe REFUSES to start (no
//       loop, no presence publish) and returns { refused:true, guidance } instead of a
//       stop() handle — the caller (the CLI face) prints the guidance + exits non-zero.
//   (b) a healthy preflight publishes this node's presence record (reused
//       publishPresenceRecord) + starts global propagation on the configured
//       cadence (an INJECTED ticker, default intervalTicker() — no wall-clock wait in
//       tests) + starts a peer-poll ticker that periodically re-reads resolvePeers.
//   (c) starts the role-specific stream path: control listens on the fabric service
//       address; worker dials the control node's fabric service URL; standalone does
//       neither.
// options: { exec, platform } (the injected fabric-exec seam, task 00), { ticker }
// (the sync-loop ticker, default intervalTicker()), { peerPollTicker } (a SEPARATE
// injectable ticker for the peer re-read cadence, defaulting to the same real
// intervalTicker() when absent), { peerPollSeconds } (default 15s, the mesh propagation
// DEFAULT_CADENCE_SECONDS precedent), { onPeers } (a test/observer hook invoked with
// the resolvePeers() result on each peer-poll tick — production wires no observer).
export async function startLauncher(ws, options = {}) {
  const config = ws.config ?? {};
  const probe = await probeFabric(config, options);
  if (!probe.healthy) {
    return { refused: true, probe, guidance: fabricGuidance(probe, {}) };
  }

  // Publish this node's presence at start, then refresh it on every propagation tick.
  const { nodeId } = await resolveNodeIdentity(ws);
  // Declared BEFORE the first publish (finding F11) so a workspace-resolution loud
  // skip on the VERY FIRST presence assembly — not merely a later propagation tick —
  // is still captured on this same accumulator the caller reads off the returned
  // handle, never dropped on the floor.
  const launcherWarnings = [];
  const publishCurrentPresence = async () => {
    const nextRecord = await assembleCurrentPresenceRecord(ws, nodeId, options, launcherWarnings);
    await publishPresenceRecord(ws, nodeId, nextRecord);
    return nextRecord;
  };
  let record = await publishCurrentPresence();

  const capturePropagation = async () => {
    record = await publishCurrentPresence();
    const propagation = await publishGlobalWorkSnapshot(ws, options);
    if (propagation.warning) emitWarning(launcherWarnings, propagation.warning, options);
    return propagation;
  };
  await capturePropagation();

  // milestone 34 / story 04 (ADR-007) — the live-stream daemon, hosted ADDITIVELY on
  // the SAME launcher: a "control" node starts the always-on stream server; a
  // "worker" node starts the persistent stream client pointed at the fabric-resolved
  // control-node dial address; a "standalone" node starts neither. Every knob is
  // OPTIONAL and options-gated — a caller that supplies none of
  // { streamServer, streamClient, controlStreamServerOptions,
  // workerStreamClientOptions } gets EXACTLY today's behaviour (no server bound, no
  // client connected), so every pre-existing startLauncher test stays byte-identical.
  //
  // Constructed BEFORE the peer-poll ticker below (review fix P0.2) so pollPeers can
  // refresh a live streamServer's admission roster on every tick — declared here (not
  // inside the poll closure) so the SAME streamServer instance the poll refreshes is
  // the one returned to the caller.
  const role = meshRole(config, nodeId);
  // review fix P0.1: the frame workspaceId MUST be the SAME id the global projection
  // publishes under (workspaceIdFor(projectRoot) when config carries no
  // explicit config.mesh.workspaceId) — never a bare `?? null`, which would land the
  // worker's streamed rows under a phantom "null" workspace distinct from every other
  // write path for this same workspace.
  const workspaceId = config?.mesh?.workspaceId ?? workspaceIdFor(ws.projectRoot ?? ws.workDir);
  let streamServer = null;
  let streamClient = null;
  // VERIFICATION (live soak 2026-07-25) — the control-side write mint, hoisted to this
  // outer scope so the control dispatch/reclaim ticker (below, a SEPARATE `role ===
  // "control"` block) can hand it to runRecoveryPushDispatchTick. Assigned from the
  // block-scoped `resolvedMintWriteCredential` inside the stream-server branch, the SAME
  // provider the write-credential PULL uses — recovery mints through the identical seam.
  let controlMintWriteCredential = null;
  // Verify follow-up (34/story 04): does this worker hold a LIVE transport (vs the
  // stream-degraded state)? Only a truly-connected worker runs the stream-sync ticker.
  let workerStreamHasTransport = false;
  // milestone 38 / story 06 — ADR-014 AMENDMENT (HYBRID): the loopback relay BROKER
  // and its CONTROL-side push transport (control branch, below) — the same-machine
  // control→fleet-UI leg. Both disposed in stop(). (The worker's cross-machine leg
  // needs no launcher-held handle — it rides the existing stream client.)
  let relayBroker = null;
  let controlTerminalPush = null;
  if (role === "control" && options?.streamServer !== false) {
    const startServer = options?.startControlStreamServer ?? startControlStreamServer;
    const peers = await resolvePeers(config, { ...options, roster: await readNodeRecords(ws) });
    // review fix P1.6: bind the fabric-resolved self-address (never "0.0.0.0") and
    // hand the server an already-resolved peer→dialAddress index — this launcher is
    // the ONE module allowed to call resolvePeers (acd-worker-stream-fabric-
    // addressed); control-stream-server.mjs only ever consumes the resolved roster.
    const boundAddress = await selfAddress(config, options);
    const servicePort = configuredServicePort(config);
    // milestone 38 / story 02 (ADR-010), extended by story 03 (ADR-011) — THE FIX:
    // the config-selected clone-credential-mint PROVIDER, resolved HERE (the ONE
    // place `config` lives on this launcher) and wired as a LITERAL
    // `mintCloneCredential:` key BELOW, BEFORE and OUTSIDE the
    // `controlStreamServerOptions` test-injection spread — the F12 discipline
    // generalised to the provider (a provider reachable only through that spread
    // would be production-dead, exactly the story-01 F12 defect class again).
    // `resolveCloneCredentialProvider` THROWS LOUDLY for an unknown provider string
    // (never a silent `env-token` degrade, SECURITY T10 applied to selection itself)
    // — an unresolved mint refuses THIS launch outright, the same "fail loud, never a
    // hang" posture every other launcher precondition already keeps. Story 03: the
    // App IDENTITY is no longer read ONCE as a static appId/privateKey/installationId
    // triple — `resolveWorkspaceAppIdentity` is handed down as a PER-WORKSPACE seam
    // (ADR-011 invariant #1), resolved fresh for whichever workspace an assignment
    // actually targets, mirroring `resolveWorkspaceCloneUrl` immediately below it.
    const { mintCloneCredential: resolvedMintCloneCredential } = resolveCloneCredentialProvider(config, {
      resolveWorkspaceCloneUrl: createResolveWorkspaceCloneUrl(ws, options),
      resolveWorkspaceAppIdentity: createResolveWorkspaceAppIdentity(ws, options),
    });
    // milestone 38 / story 07 (ADR-015 decision 3) — the SEPARATE, WRITE-scoped
    // sibling mint, resolved the SAME way (the SAME config.mesh.repo.credential.provider
    // key, the SAME per-workspace identity seams) but through
    // resolveWriteCredentialProvider — a DIFFERENT function than
    // resolveCloneCredentialProvider above, so a write body can never be produced by
    // the clone path's own resolution branch.
    const { mintWriteCredential: resolvedMintWriteCredential } = resolveWriteCredentialProvider(config, {
      resolveWorkspaceCloneUrl: createResolveWorkspaceCloneUrl(ws, options),
      resolveWorkspaceAppIdentity: createResolveWorkspaceAppIdentity(ws, options),
    });
    // Hoist for the control recovery-push dispatch tick (below) — recovery mints through
    // the identical control-side write provider the PULL seam already resolved here.
    controlMintWriteCredential = resolvedMintWriteCredential;
    // milestone 38 / story 06 — ADR-014 AMENDMENT (2026-07-19, `aof:continue 38/06`
    // closing BLOCKER F-38.06 — the HYBRID transport's SAME-MACHINE leg). The
    // cross-machine leg is the FABRIC (the worker sends a terminal-frame UP its stream
    // client; this control server branches it to onTerminalFrame — below — never a
    // store apply). `onTerminalFrame` then fans each fabric-received frame into a
    // LOOPBACK relay broker that the SEPARATE `aof mesh ui` process (on THIS machine)
    // subscribes to over config.mesh.relay.url. `controlTerminalPush` is the
    // lazily-connected loopback push into that broker — constructed HERE (before the
    // startServer call, so onTerminalFrame can close over it) only when a relay is
    // actually configured + enabled. Gated on `options?.relay !== false` (the test-
    // isolation seam — a fixture passes `relay:false` to skip the real bind) AND a
    // CONFIGURED config.mesh.relay.url (no url -> the fleet subscriber
    // createTerminalMirrorSubscriberTransport returns null, so a broker would have no
    // subscriber — a clean no-start, which also keeps every fixture that sets no
    // relay.url byte-identical).
    const relayEnabled = options?.relay !== false && configuredRelayUrl(config) != null;
    if (relayEnabled) {
      controlTerminalPush = createTerminalRelayPushTransport(config);
    }
    streamServer = await startServer({
      ...(boundAddress ? { bindAddress: boundAddress } : {}),
      ...(servicePort != null ? { port: servicePort } : {}),
      peerNodeIds: peerNodeIdsFrom(peers),
      peersByAddress: peers,
      httpHandler: createEnrollmentHttpHandler({ config, workspace: ws, now: options?.now ?? null }),
      mintCloneCredential: resolvedMintCloneCredential,
      mintWriteCredential: resolvedMintWriteCredential,
      // ADR-014 AMENDMENT — the fabric->loopback terminal BRIDGE sink, a LITERAL key
      // at the production call site (the F12/F-38.05 discipline: a bridge reachable
      // only through the controlStreamServerOptions test spread would be production-
      // dead). control-stream-server branches a terminal-frame BEFORE applyStreamFrame
      // (never a store apply — ADR-014 inv.3) and hands it here; this pushes it into
      // the loopback broker for the fleet-UI process. A clean no-op when no relay is
      // configured (controlTerminalPush stays null). Fire-and-forget — a push fault is
      // swallowed by the transport (never stalls the accept loop).
      //
      // SECURITY T14 concern #2 / finding F17 — RE-STAMP the routing nodeId with the
      // CONNECTION-bound identity (the 2nd arg, `= meta.nodeId`, resolved at admission)
      // and DISCARD the worker's self-declared `frame.nodeId`. Without this re-stamp a
      // curious-but-admitted worker could send a raw
      // { kind:"terminal-frame", nodeId:"<victim>", … } up its OWN authenticated socket
      // and inject bytes onto ANOTHER node's fleet card (the mirror routes by
      // envelope.nodeId). The re-stamp is the SAME T6 discipline the credential path
      // keeps (control-stream-server.mjs's apply* functions all attribute by
      // meta.nodeId, never a self-declared frame.nodeId).
      onTerminalFrame: (frame, { nodeId }) => controlTerminalPush?.push({ ...frame, nodeId }),
      ...(options?.controlStreamServerOptions ?? {}),
    });

    // Start the loopback relay BROKER on the KNOWN port named in config.mesh.relay.url
    // (`servicePort`, parsed via configuredRelayUrl) — NEVER an ephemeral `?? 0`, so
    // the fleet subscriber's FIXED dial (createTerminalMirrorSubscriberTransport, the
    // same url) matches. `relayMode` SELF-GATES on
    // config.mesh.relay.controlNode === config.mesh.nodeId (mesh-relay.mjs:656-666) —
    // no new nomination logic; a non-nominated node gets a clean null. Started AFTER
    // startServer so the fabric-addressed control-stream server claims its
    // (fabric-ip, port) bind FIRST; the relay then binds (127.0.0.1, port) — distinct
    // addresses coexist, and in the degraded (loopback-only) case the relay's own bind
    // simply faults into the catch below rather than pre-empting the stream server.
    // Test isolation is `options.relay === false` (skip) or an injected
    // `options.relayMode` seam — the production code never binds a random port to
    // protect a fixture. Wrapped so a bind fault never crashes the daemon; disposed in
    // stop().
    if (relayEnabled) {
      const startRelayMode = options?.relayMode ?? relayMode;
      try {
        relayBroker = await startRelayMode(config, { port: servicePort });
      } catch (error) {
        emitWarning(launcherWarnings, { code: error?.code ?? "relay-broker-start-failed", message: error?.message ?? "The mesh-relay broker failed to start.", path: null }, options);
        relayBroker = null;
      }
    }
  } else if (role === "worker" && options?.streamClient !== false) {
    // review fix P1.7: assemble + connect the worker's dial (deferred: the
    // per-mutation delta feed from the run lifecycle and the real two-machine
    // validation stay task-04's @manual soak — this resolves the control-node
    // target FIRST, constructs the transport pointed at it, then constructs the
    // client WITH that transport, bridges a transport drop to notifyDrop(), and
    // pushes an initial snapshot so the stream genuinely carries state). A worker
    // whose control node is unresolvable on the fabric enters a stream-degraded retry state —
    // the client is still constructed (so streamClient/stop() stay well-defined)
    // but carries NO transport and makes NO connection attempt (task 00's clean
    // degrade, verbatim).
    const createClient = options?.createWorkerStreamClient ?? createWorkerStreamClient;
    const resolveTarget = options?.resolveWorkerStreamTarget ?? resolveWorkerStreamTarget;
    const nowFn = () => resolveNow(options);

    const nodeRecords = await readNodeRecords(ws);
    const resolved = await resolveTarget(config, nodeId, { ...options, roster: nodeRecords });

    let transport;
    if (resolved.target != null) {
      const dialUrl = configuredServiceUrlForAddress(config, resolved.target);
      // review fix (live soak, 2026-07-17): the resolved dial URL was never logged
      // anywhere — a worker whose connection never even ATTEMPTS (or fails) looked
      // identical in its own daemon output to one that's healthy. Not a fault, so a
      // benign code (never surfaced as an error) — emitWarning is reused purely as
      // the one existing "print it live in production, no-op under test" seam.
      emitWarning(launcherWarnings, { code: "worker-stream-dial-target", message: `resolving worker stream to ${dialUrl}`, path: null }, options);
      const createTransport = options?.createWorkerWsTransport ?? createWorkerWsTransport;
      transport = createTransport(dialUrl, options?.workerWsTransportOptions ?? {});
    } else if (resolved.message) {
      emitWarning(launcherWarnings, { code: "worker-stream-target-unresolved", message: resolved.message, path: null }, options);
    }

    const client = createClient({
      nodeId,
      workspaceId,
      transport,
      now: nowFn,
      onWarning: (warning) => emitWarning(launcherWarnings, warning, options),
      ...(options?.workerStreamClientOptions ?? {}),
    });
    streamClient = client;

    // milestone 35 / story 02 (ADR-004) — wire the accepted-directive execution
    // handler onto the SAME persistent channel's receive seam (worker-stream-
    // client.mjs's onDirective, story 01). ADDITIVE + OPTIONS-GATED (the same
    // discipline every other knob on this function follows): `options.workerExecution
    // !== false` (the default) wires the REAL handler
    // (createMeshWorkerExecutionHandler); a caller that passes `workerExecution:
    // false` — every pre-existing startLauncher test that never wired one — gets
    // EXACTLY today's behaviour (a client with no registered directive handler,
    // directives received into the void, worker-stream-client.mjs's own documented
    // no-op). `options.createMeshWorkerExecutionHandler` / `options.workerExecutionOptions`
    // let a test inject the execution handler's own collaborators (spawnRuntime, exec,
    // now, onCleanup, …) through the SAME launcher entry point a real `--serve` uses.
    if (options?.workerExecution !== false) {
      const createHandler = options?.createMeshWorkerExecutionHandler ?? createMeshWorkerExecutionHandler;
      const handler = createHandler({
        loadWs: options?.workerExecutionLoadWs ?? (() => Promise.resolve(ws)),
        nodeId,
        sendAssignmentStatus: (...args) => client.sendAssignmentStatus(...args),
        // milestone 38 / story 01 task 05 (ADR-009, finding F12) — THE FIX: the
        // credential resolver, supplied as a LITERAL key HERE, outside the
        // workerExecutionOptions test-injection spread below, closing over this
        // worker's OWN stream client (client.requestCloneCredential — the up/down
        // clone-credential-request/clone-credential frame pair, worker-stream-
        // client.mjs). A test may still override it through the spread; production
        // (`aof mesh serve --serve`) now genuinely supplies one, which it never did
        // before this fix (fitness acd-clone-credential-pull-not-pushed's F12 guard).
        requestCloneCredential: (request) => client.requestCloneCredential(request),
        // review fix (ADR-010 Gap A extended, live soak 2026-07-18) — the SAME F12
        // discipline as requestCloneCredential immediately above: a literal key HERE,
        // closing over this worker's OWN stream client, so production genuinely
        // supplies the clone-url PULL resolver rather than it being reachable only
        // through the workerExecutionOptions test-injection spread below.
        requestCloneUrl: (request) => client.requestCloneUrl(request),
        // milestone 38 / story 07 (ADR-015) — the SAME F12 discipline once more: the
        // write-credential resolver, supplied as a LITERAL key HERE, closing over
        // this worker's OWN stream client (client.requestWriteCredential — the
        // up/down write-credential-request/write-credential frame pair, worker-
        // stream-client.mjs). Called ONLY at the push seam
        // (pushWorktreeBranch/mesh-worker-execution.mjs), never speculatively.
        requestWriteCredential: (request) => client.requestWriteCredential(request),
        // milestone 38 / story 06 — ADR-014 AMENDMENT (2026-07-19, closing BLOCKER
        // F-38.06 — the HYBRID transport): THE FIX — the worker terminal-bridge
        // PRODUCER, a LITERAL key HERE (never reachable only through the
        // workerExecutionOptions test-injection spread below — the F12/F-38.05
        // discipline generalised to this seam too), wired to the FABRIC send:
        // `client.sendTerminalFrame` streams each live PTY chunk UP this worker's OWN
        // stream connection as a terminal-frame (control-stream-server branches it to
        // its onTerminalFrame sink — never persisted). The FABRIC, not the loopback
        // serveRelay push: a worker on ANOTHER machine cannot reach the control node's
        // loopback-bound broker, so the cross-machine leg MUST ride the fabric client
        // (the only off-host-reachable transport). `sessionId` is the driver's OWN 2nd
        // onOutputChunk argument (mesh-worker-execution.mjs's capturedSessionId,
        // populated by the ADR-013-amendment transcript watch) — an early null-session
        // frame still rides; the fleet mirror simply drops it (ADR-014 invariant 4).
        // Best-effort + fire-and-forget: sendTerminalFrame sends only on a live socket,
        // swallows faults, and NEVER touches the reconnect/drop bookkeeping (a
        // high-frequency PTY stream must not thrash the worker's backoff state).
        onOutputChunk: (chunk, sessionId) => client.sendTerminalFrame(sessionId, String(chunk)),
        // milestone 38 / story 06 / task 04 — ADR-014 AMENDMENT (2026-07-23,
        // structural invariant 8; BLOCKER F-38.06e): the END of that same stream,
        // a LITERAL key HERE for the SAME F12 reason `onOutputChunk` is one line
        // above — an end producer reachable only through the
        // workerExecutionOptions test-injection spread is an inert producer, which
        // is the defect class this whole story is scarred by.
        //
        // The driver calls this ONCE from its single `finish()` settle point, for
        // ALL THREE outcomes (`done`/`failed` via onExit, and `needs-input` via the
        // sentinel branch that kills the PTY — a human resumes on a NEW session, so
        // that stream is genuinely over even though the assignment stays
        // `running`). `client.sendTerminalEnd` puts the marker on the SAME fabric
        // leg the bytes rode, on the SAME opaque terminal-frame kind (the marker
        // lives INSIDE `signal`), so the control node needs NO new branch: it fans
        // the frame into the loopback relay exactly as it does a byte frame, the
        // fleet mirror routes it by the SAME (nodeId, sessionId) tuple, and the
        // /ws/terminal-view route answers it by CLOSING the browser socket — which
        // is what finally makes DESIGN V9's `stream ended` reachable from a REAL
        // session end. Best-effort + fire-and-forget, exactly like the byte send.
        onSessionEnd: (sessionId) => client.sendTerminalEnd(sessionId),
        // milestone 38 / story 06 / task 04 — ADR-013 AMENDMENT (2026-07-23,
        // structural invariant 7; BLOCKER F-38.06d): the LIVE join-key report, a
        // LITERAL key HERE for exactly the F12 reason the four keys above are — a
        // producer that exists only inside the handler's own default (or only
        // through the workerExecutionOptions test-injection spread) is one revision
        // away from being inert in production without a single test noticing.
        //
        // The worker used to surface its captured `session_id` ONLY on terminal
        // frames, so `global_assignments.session_id` was NULL for the entire live
        // run and the fleet card resolved `no-session` for precisely the interval an
        // operator wants to watch. This sends a SECOND `running` frame — same runId,
        // plus the freshly-captured sessionId — the moment the driver's transcript
        // watch resolves one, up this worker's OWN stream connection (the SAME
        // up-channel emitter every other assignment-status frame uses, so the T6
        // holder gate and the F17 connection-identity re-stamp both still apply).
        // No new frame kind: the control node's absent-is-not-a-clear writer accepts
        // `running` -> `running` idempotently.
        onSessionIdCaptured: (sessionId, { assignmentId, runId } = {}) => client.sendAssignmentStatus(assignmentId, "running", { runId, sessionId }),
        // milestone 38 / story 05 fix (live soak 2026-07-25, VERIFICATION F24) — the
        // pre-spawn worktree-trust producer, a LITERAL key HERE for the SAME F12 reason
        // as the seams above: pre-writing projects[<worktree>].hasTrustDialogAccepted
        // into ~/.claude.json clears claude's one-time folder-trust dialog that would
        // otherwise HANG a headless per-assignment worktree with no human to accept it.
        // A test overrides via the workerExecutionOptions spread; production supplies it
        // so the autonomous run never blocks pre-session. Paired with the driver's own
        // `--permission-mode auto` (NOT bypassPermissions — a real pause still surfaces).
        trustWorktree: ensureWorktreeTrusted,
        // milestone 38 / story 05 fix (live soak 2026-07-25, VERIFICATION F27) — the
        // production delay before the directive command is typed into claude's PTY, so
        // the write lands AFTER claude's interactive TUI is ready. A t=0 write raced
        // startup and left claude idle at an empty prompt — no session, no sessionId, no
        // terminal view. A LITERAL key HERE (the F12 discipline): a test overrides via
        // the workerExecutionOptions spread and the driver itself defaults to 0.
        commandDelayMs: INTERACTIVE_COMMAND_READY_DELAY_MS,
        now: nowFn,
        ...(options?.workerExecutionOptions ?? {}),
      });
      client.onDirective(handler);

      // VERIFICATION (live soak 2026-07-25) — the control-driven recovery-push handler,
      // registered on the SAME client beside onDirective. A LITERAL sendRecoveryPushResult
      // key (the F12 discipline the seams above keep — a producer reachable only through
      // the workerExecutionOptions spread is one revision from inert). The
      // workerExecutionOptions spread carries a test's own pushExec/exec through to it.
      const createRecoveryHandler = options?.createMeshRecoveryPushHandler ?? createMeshRecoveryPushHandler;
      const recoveryHandler = createRecoveryHandler({
        loadWs: options?.workerExecutionLoadWs ?? (() => Promise.resolve(ws)),
        nodeId,
        sendRecoveryPushResult: (...args) => client.sendRecoveryPushResult(...args),
        globalWorkStoreOptions: options?.globalWorkStoreOptions,
        ...(options?.workerExecutionOptions ?? {}),
      });
      client.onRecoveryPush(recoveryHandler);
    }

    if (transport != null) {
      // Bridge a transport-level drop to the client's own notifyDrop() (ADR-004: a
      // stream fault is a warning, never a rethrow) — production wires the REAL
      // transport's onDrop/close/error signal; a test-injected transport that omits
      // onDrop simply never bridges (no crash — onDrop is called only when present).
      if (typeof transport?.onDrop === "function") {
        transport.onDrop(() => client.notifyDrop());
      }
      const connectClient = options?.connectWorkerStreamClient ?? defaultConnectWorkerStreamClient;
      await connectClient(client, ws, record);
    }
    workerStreamHasTransport = transport != null;
  }

  // The peer-poll ticker — periodically re-reads resolvePeers so mesh:status reflects
  // live fabric liveness (ADR-003.1c). A SEPARATE ticker from the sync loop's (a
  // different cadence concern), defaulting to the SAME real intervalTicker() shape when
  // no injected ticker is supplied. review fix P0.2: EVERY tick also refreshes a live
  // control-node streamServer's admission roster (streamServer.updatePeers) — the
  // roster used to be frozen at launch, so a worker that enrolled after this node
  // started would be refused forever; now the SAME resolvePeers() read this tick
  // already did also keeps the stream server's roster current.
  const peerPollTicker = typeof options?.peerPollTicker === "object" && options.peerPollTicker != null ? options.peerPollTicker : intervalTicker();
  const peerPollSeconds = typeof options?.peerPollSeconds === "number" && options.peerPollSeconds > 0 ? options.peerPollSeconds : 15;
  const pollPeers = async () => {
    const nodeRecords = await readNodeRecords(ws);
    const peers = await resolvePeers(config, { ...options, roster: nodeRecords });
    // review fix P1.6(a): refresh the remote-address→nodeId join alongside the
    // roster on every tick — a peer's fabric address (or a freshly-admitted peer)
    // must be joinable on the VERY NEXT poll, not frozen at launch either.
    streamServer?.updatePeers?.(peerNodeIdsFrom(peers), peers);
    if (typeof options?.onPeers === "function") options.onPeers(peers);
  };
  const peerPollHandle = peerPollTicker.start(peerPollSeconds, () => {
    pollPeers().catch(() => {
      // a transient fabric-read fault mid-serve must never crash the daemon — the next
      // tick simply re-attempts (the same never-crash discipline probeFabric itself keeps).
    });
  });

  const propagationTicker = typeof options?.propagationTicker === "object" && options.propagationTicker != null ? options.propagationTicker : intervalTicker();
  const propagationSeconds = typeof options?.propagationSeconds === "number" && options.propagationSeconds > 0 ? options.propagationSeconds : cadenceFromConfig(ws);
  const propagationHandle = propagationTicker.start(propagationSeconds, () => {
    capturePropagation().catch((error) => {
      emitWarning(launcherWarnings, { code: error?.code ?? "global-work-propagation-failed", message: error?.message ?? "Global work propagation failed.", path: null }, options);
    });
  });

  // milestone 35 / ADR-008 — the control-side DISPATCH + RECLAIM driver: a THIRD
  // sibling over the SAME injected-ticker seam (propagationTicker/peerPollTicker),
  // role-gated to "control" and options-gated so every pre-existing launcher test
  // (which supplies none of these knobs) stays byte-identical. Each tick calls
  // runControlDispatchReclaimTick (mesh-assignment-reclaim.mjs) — the driver's
  // DATA-LAYER orchestrator, which owns the ONE store-open for BOTH halves so this
  // launcher module itself imports NO SQLite-store module / store-opener directly
  // (fitness acd-global-publisher-single-seam: the launcher reaches the global
  // store only through a sanctioned seam). That orchestrator:
  //   (1) DISPATCHES — scans global_assignments for `assigned` rows whose
  //       targetNodeId is a currently-connected admitted peer in the stream
  //       server's directiveTargets map (streamServer.directiveTargets.get(id)),
  //       and dispatchDirective(buildDirectiveFrame(row)) each over the ADR-002
  //       channel — the missing call site ADR-008 closes. A row whose target is
  //       NOT connected is left `assigned` (dispatches on a later tick, never a
  //       silent drop/loud error here). DISPATCH-ONCE (best-effort): dispatchedIds,
  //       an in-memory Set HELD HERE (this launcher's lifetime, not persisted,
  //       rebuilt empty on restart) and passed in on every tick — correctness rests
  //       on the WORKER's onDirective dedupe (mesh-worker-execution.mjs), the
  //       authoritative guard (a post-restart re-dispatch is safe because the
  //       worker ignores a duplicate it already holds).
  //   (2) RECLAIMS — calls reclaimStaleAssignments(store, ws, workspaceId, { now })
  //       verbatim (ADR-005's decision, never re-derived) so a dual-stale
  //       assignment converges to `reclaimed` on its own.
  // Both halves are FAILURE-ISOLATED (ADR-004): a store-read/dispatch fault on one
  // tick is caught here (the .catch below) and the next tick simply re-attempts —
  // never a daemon crash.
  const dispatchedAssignmentIds = new Set();
  let controlTickHandle = null;
  let controlDispatchReclaimTicker = null;
  // The driver requires a REAL stream-server handle (a genuine directiveTargets
  // map + dispatchDirective seam) — a test that fakes startControlStreamServer
  // down to a bare `{ stop(), updatePeers() }` (mesh-launcher-stream-role.test.mjs's
  // idiom) never satisfies this shape check, so it never opts this pre-existing
  // test into the tick (byte-identical behaviour preserved) without needing an
  // explicit `controlDispatchReclaimTicker: false` on every such fixture.
  const hasDispatchSeam = typeof streamServer?.dispatchDirective === "function" && typeof streamServer?.directiveTargets?.get === "function";
  if (role === "control" && hasDispatchSeam && options?.controlDispatchReclaimTicker !== false) {
    controlDispatchReclaimTicker = typeof options?.controlDispatchReclaimTicker === "object" && options.controlDispatchReclaimTicker != null
      ? options.controlDispatchReclaimTicker
      : intervalTicker();
    const controlTickSeconds = typeof options?.controlDispatchReclaimSeconds === "number" && options.controlDispatchReclaimSeconds > 0
      ? options.controlDispatchReclaimSeconds
      : cadenceFromConfig(ws);
    // Reuse the SAME store-options resolution the real control-stream server's
    // own store already opened under (controlStreamServerOptions.storeOptions),
    // falling back to the launcher's globalWorkStoreOptions knob — never a second,
    // independently-defaulted store location.
    const storeOptions = options?.controlStreamServerOptions?.storeOptions ?? options?.globalWorkStoreOptions ?? {};
    controlTickHandle = controlDispatchReclaimTicker.start(controlTickSeconds, () => {
      runControlDispatchReclaimTick(ws, streamServer, {
        workspaceId,
        now: resolveNow(options),
        storeOptions,
        buildDirectiveFrame,
        dispatchedIds: dispatchedAssignmentIds,
      }).catch((error) => {
        emitWarning(launcherWarnings, { code: error?.code ?? "control-dispatch-reclaim-tick-failed", message: error?.message ?? "The control dispatch/reclaim tick failed.", path: null }, options);
      });
      // VERIFICATION (live soak 2026-07-25) — drain any operator-requested recovery
      // pushes on the SAME control tick: mint the write credential (the hoisted control
      // provider) and dispatch a recovery-push DOWN-frame to each requested assignment's
      // target worker. Runs beside the dispatch/reclaim tick (own store-open, own
      // failure isolation) so a recovery drain fault never takes down the primary tick.
      runRecoveryPushDispatchTick(streamServer, {
        now: resolveNow(options),
        storeOptions,
        mintWriteCredential: controlMintWriteCredential,
      }).catch((error) => {
        emitWarning(launcherWarnings, { code: error?.code ?? "control-recovery-push-tick-failed", message: error?.message ?? "The control recovery-push dispatch tick failed.", path: null }, options);
      });
    });
  }

  // The STREAM-SYNC ticker (verify follow-up, 34/story 04) — keep the worker's stream
  // CURRENT, not merely pushed-once-at-connect. A run mutation happens in a SEPARATE CLI
  // process this daemon cannot observe in-memory, and the control-stream server marks a
  // worker "stale" after DEFAULT_HEARTBEAT_WINDOW_SECONDS with no frames. So an
  // actually-connected worker re-snapshots its CURRENT projection on a ticker faster than
  // that window. This ONE periodic re-snapshot does three jobs at once: every frame
  // refreshes the server's heartbeat (keeps the worker "live"), any local work advance
  // converges within a tick (scenario 1), and a post-reconnect tick re-syncs because the
  // client's needsSnapshot contract re-sends a snapshot first (scenario 2). Snapshot-only
  // for now (operator scale); a per-mutation INSTANT delta is a later optimization, not a
  // correctness gap. Only a worker with a live transport runs it (never control/standalone,
  // never the stream-degraded state). sendSnapshot is failure-isolated (ADR-004) — a fault
  // is a warning, never a daemon crash.
  let streamSyncHandle = null;
  const streamSyncTicker = typeof options?.streamSyncTicker === "object" && options.streamSyncTicker != null ? options.streamSyncTicker : intervalTicker();
  if (role === "worker" && streamClient != null && workerStreamHasTransport) {
    const streamSyncSeconds = typeof options?.streamSyncSeconds === "number" && options.streamSyncSeconds > 0
      ? options.streamSyncSeconds
      : Math.max(5, Math.floor(DEFAULT_HEARTBEAT_WINDOW_SECONDS / 3));
    const pushStreamSnapshot = async () => {
      const items = await readWorkspaceProjectionItems(ws).then((result) => result.rows).catch(() => []);
      const presence = await publishCurrentPresence();
      await streamClient.sendSnapshot(items);
      if (typeof streamClient.sendPresence === "function") {
        await streamClient.sendPresence(presence);
      }
      await pushActiveWorktreeState(items);
    };

    // VERIFICATION (live worktree streaming, 2026-07-25) — THE FIX for "the control node
    // cannot see what the worker is doing". The snapshot above is this worker's LAUNCH
    // workspace; an assignment's real output lands in a per-assignment WORKTREE, which was
    // never streamed at all — so an agent could break a milestone into seven stories and
    // the control node would still read the pre-run scaffold, with the work only becoming
    // visible after a commit+push. Reading the pushed branch is not an answer: it cannot
    // show work in flight and makes committing a precondition for visibility.
    //
    // Each tick, every worktree the driver currently has open is read AT ITS OWN work dir
    // and streamed up the connection this worker already holds — as a DELTA, never a
    // snapshot, so it MERGES into the workspace's rows (by ref) instead of replacing the
    // set. Scoped to the assignment's OWN item subtree, so a worktree can only ever speak
    // for the item it was created for. Best-effort throughout: a worktree that has been
    // removed, or a workspace that will not load, is skipped silently — this must never
    // disturb the presence/snapshot stream it rides beside.
    // `fullItems` is the launch workspace's own row set, passed IN by the caller — it is a
    // local of pushStreamSnapshot, and reaching for it as a free variable here threw a
    // ReferenceError that the catch below then swallowed, so this streamed NOTHING and said
    // nothing about it (found on the first real two-machine run of this code). A fault is
    // now REPORTED through the launcher's own warning channel rather than silently dropped:
    // best-effort must mean "does not crash the daemon", never "fails invisibly".
    const pushActiveWorktreeState = async (fullItems = []) => {
      const active_ = listActiveWorktrees();
      meshDebug("stream", `tick: ${active_.length} active worktree(s)`);
      for (const active of active_) {
        try {
          const worktreeWs = await loadWorkspace(active.worktreePath, undefined, { env: options?.globalWorkStoreOptions?.env });
          const result = await readWorkspaceProjectionItems(worktreeWs);
          const milestone = String(active.itemRef ?? "").split("/")[0];
          const rows = (result?.rows ?? []).filter((row) => row.ref === active.itemRef || row.ref === milestone || row.parent === milestone);
          meshDebug("stream", `${active.assignmentId}: read ${result?.rows?.length ?? 0} row(s) from ${worktreeWs.workDir}, ${rows.length} in scope for item ${active.itemRef}`);
          if (rows.length > 0) {
            const sent = await streamClient.sendDelta(rows, { fullItems });
            meshDebug("stream", `${active.assignmentId}: sendDelta -> ${JSON.stringify(sent)} refs=${rows.map((r) => r.ref).join(",")}`);
          }
        } catch (error) {
          meshDebug("stream", `${active?.assignmentId}: FAILED ${error?.stack ?? error?.message ?? error}`);
          emitWarning(launcherWarnings, {
            code: "worker-worktree-stream-failed",
            message: `streaming the worktree for assignment ${active?.assignmentId} failed: ${error?.message ?? error}`,
            path: active?.worktreePath ?? null,
          }, options);
        }
      }
    };
    streamSyncHandle = streamSyncTicker.start(streamSyncSeconds, () => pushStreamSnapshot().catch(() => {}));
  }

  // stop() — the clean daemon shutdown (ADR-003.3, the serve-unit discipline): stop
  // all tickers (peer poll + propagation + optional stream sync + optional control
  // dispatch/reclaim) cleanly, plus the stream server/client when this node started
  // one. No half-published record — the presence publish already completed before
  // this handle was returned. milestone 38 / story 06 (ADR-014 AMENDMENT, HYBRID):
  // also disposes the control node's loopback relay BROKER and its loopback push
  // transport, when either was started/constructed above.
  const stop = () => {
    peerPollTicker.stop(peerPollHandle);
    propagationTicker.stop(propagationHandle);
    if (streamSyncHandle != null) streamSyncTicker.stop(streamSyncHandle);
    if (controlTickHandle != null) controlDispatchReclaimTicker.stop(controlTickHandle);
    streamServer?.stop?.();
    streamClient?.stop?.();
    relayBroker?.stop?.();
    controlTerminalPush?.close?.();
  };

  return {
    stop,
    record,
    warnings: launcherWarnings,
    selfAddress: await selfAddress(config, options),
    role,
    streamServer,
    streamClient,
  };
}
