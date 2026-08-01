// src/mesh-fabric.mjs — THE ONE fabric-assumption seam (milestone 33 / story 01,
// ADR-001/ADR-002). "A mesh VPN gives every node a stable, directly-dialable
// address and handles NAT" is asserted in EXACTLY this module — no other src
// module spawns `tailscale`, hard-codes a 100.x range, or derives a peer dial
// address from a committed/hand-derived ws:// URL (fitness acd-fabric-single-seam).
//
// Three exported functions, each returning a structured shape (never a crash,
// never a hidden fallback):
//   - probeFabric(config, options)   → { fabric, state, healthy, reason }
//   - selfAddress(config, options)   → this node's dial address, or null
//   - resolvePeers(config, options)  → [{ nodeId, dialAddress, online, host }]
//
// THE INJECTED SEAM (ADR-001.consequence / the developer-amigo RESOLVED block on
// task 00): every spawn goes through an INJECTED `exec` closure —
// `(bin, args) => Promise<{ stdout, status }>` — defaulting to a real
// execFile("tailscale", […]) + timeout when absent (the tool-store.mjs
// `defaultProbe(exeFile, spawn = spawnSync)` / createRelayClient config-default
// idiom, generalised to an async execFile). Production code NEVER spawns a shell
// string — execFile's argv form only (the git-argv precedent).
//
// TWO-STAGE PROBE (RESEARCH §4): stage 1 — can `tailscale` be spawned at all?
// ENOENT (Windows tries the well-known install path(s) FIRST, RESEARCH §3) ⇒
// not-installed. Stage 2 — it spawned and returned JSON: branch on the top-level
// BackendState. A --json that will not parse ⇒ degraded (tolerant parse, RESEARCH
// §2 "format subject to change" — never a throw).
//
// A config.mesh.fabric OTHER than a SUPPORTED name is a CLEAN structured refusal
// (fabric-unsupported), never a crash, never a hidden fallback (06/ADR-002
// designed-not-shipped). An ABSENT config.mesh.fabric is fabric-undeclared,
// distinct from an unsupported named fabric.
//
// ------------------------------------------------ THE SECOND FABRIC: "direct" ----
// (2026-07-27) "tailscale" is no longer the only supported value. `direct` is the
// NO-OVERLAY fabric: there is no mesh VPN, no fabric CLI, and nothing to spawn — a
// peer is a NAME (or a literal address) and the ORDINARY KERNEL RESOLVER says where
// it is. It exists because the overlay conflated two separate questions:
//
//   1. "where do I dial?"  — answered by config (mesh.relay.url) + getaddrinfo.
//   2. "who is this connection?" — answered on tailscale by joining the socket's
//      remoteAddress to a nodeId through the fabric's own peer table.
//
// On `direct` there IS no address oracle for (2), so identity moves to where it
// always belonged: the enrollment credential (mesh-registry.mjs's verifyCredential —
// constant-time, revocation-aware). This module therefore answers (1) ONLY; the
// address rows it returns are for DIALLING and DISPLAY, never for admission.
//
// Consequences that make `direct` cheap rather than a second overlay:
//   - probeFabric never spawns. The only thing that can genuinely be wrong is "this
//     node has no address to bind", so that is the only degrade it reports.
//   - resolvePeers reads the SAME node roster the caller already hands in and pushes
//     each record's declared host through an INJECTED lookup (default
//     dns.promises.lookup) — the identical injected-seam idiom as `exec` above.
//   - a `direct` peer's `online` is NOT a liveness reading. Nothing on this fabric
//     can answer "is that host up" without dialling it; presence records
//     (mesh-presence.mjs) remain the real liveness source. A row means "this peer's
//     host RESOLVED", never "this peer is reachable".
import { execFile } from "node:child_process";
import dns from "node:dns";
import os from "node:os";

// The documented default spawn timeout (ADR-001.consequence — "fire-and-parse,
// never a blocking daemon call", RESEARCH §4). A missing/malformed config value
// falls back to this without crashing.
export const DEFAULT_FABRIC_EXEC_TIMEOUT_MS = 5000;

// The Windows well-known install paths (RESEARCH §3 — the folder name has varied
// across releases; try BOTH in sequence before concluding not-installed, the
// task-00 design note). Order: the current vendor-documented path first, the
// older "Tailscale IPN" folder second.
const WINDOWS_INSTALL_PATHS = [
  "C:\\Program Files\\Tailscale\\tailscale.exe",
  "C:\\Program Files\\Tailscale IPN\\tailscale.exe",
];

// Promisify one execFile completion into { stdout, stderr, status }. Resolves on
// ANY completion (including a non-zero exit, so a caller can branch on the parsed
// body rather than the exit code — RESEARCH §4's "no exit-code table" gap);
// REJECTS only on a spawn-level fault (ENOENT, timeout/kill) — the shape stage 1
// branches on.
function settleExecFile(error, stdout, stderr, resolve, reject) {
  if (error && (error.code === "ENOENT" || error.killed || error.signal)) {
    reject(error);
    return;
  }
  resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), status: error ? (typeof error.code === "number" ? error.code : 1) : 0 });
}

// The default production exec for a bare `tailscale` spawn (PATH resolution) — a
// real execFile("tailscale", [...]) with a timeout (the git-argv shell-less
// precedent). This is the ONE literal spawn call-form acd-fabric-single-seam's
// grep matches in this module.
function defaultFabricExec(args, { timeoutMs = DEFAULT_FABRIC_EXEC_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile("tailscale", args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) =>
      settleExecFile(error, stdout, stderr, resolve, reject)
    );
  });
}

// The Windows install-path fallback exec — the SAME primitive, spawning an
// explicit path string instead of the bare "tailscale" (no second literal
// "tailscale" spawn call-form; the path is data, not a second seam).
function pathFabricExec(installPath, args, { timeoutMs = DEFAULT_FABRIC_EXEC_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(installPath, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) =>
      settleExecFile(error, stdout, stderr, resolve, reject)
    );
  });
}

// Resolve the injected exec closure, defaulting to the real spawn (the
// createRelayClient / defaultProbe idiom: absent ⇒ production behaviour). The
// injected shape is `(bin, args) => Promise<{ stdout, status }>`; the production
// default dispatches "tailscale" to the literal spawn call-form and any other
// bin string (an install-path fallback) to the SAME primitive over that path.
function resolveExec(options) {
  if (typeof options?.exec === "function") return options.exec;
  return (bin, args) => (bin === "tailscale" ? defaultFabricExec(args) : pathFabricExec(bin, args));
}

// Attempt a bare `tailscale` spawn; on Windows, an ENOENT retries each well-known
// install path in sequence BEFORE concluding not-installed (RESEARCH §3, the
// task-00 design note). Returns { stdout, attemptedFallback } or throws the final
// ENOENT-shaped error when every attempt is exhausted.
async function spawnTailscale(exec, args, { platform = process.platform } = {}) {
  try {
    const result = await exec("tailscale", args);
    return { ...result, attemptedFallback: false };
  } catch (error) {
    if (error?.code !== "ENOENT" || platform !== "win32") {
      throw error;
    }
    // Windows fallback — try each well-known install path in turn.
    let lastError = error;
    for (const installPath of WINDOWS_INSTALL_PATHS) {
      try {
        const result = await exec(installPath, args);
        return { ...result, attemptedFallback: true };
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }
    throw lastError;
  }
}

// Tolerant JSON parse — a --json blob that will not parse yields null rather than
// throwing (RESEARCH §2 "format subject to change"). Unknown fields are naturally
// ignored by the property reads below (we never validate a schema).
function tolerantParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The RESEARCH §4 actionable-reason matrix for a non-Running BackendState. An
// unrecognised state string is a degraded refusal (never a crash on a fabric
// version this build has not seen).
function reasonForBackendState(state) {
  if (state === "Running") return null;
  if (state === "NeedsLogin") return "needs-login";
  if (state === "Stopped") return "stopped";
  if (state === "NeedsMachineAuth") return "needs-machine-auth";
  return "degraded";
}

// Strip a DNSName's trailing dot (the FQDN form RESEARCH §1 confirms Tailscale
// emits) and lower-case it, so a HostName/DNSName join tolerates the trailing-dot
// / case variance without a caller having to normalise first.
function normaliseDnsLabel(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\.$/, "").toLowerCase();
}

// The DNSName's leading label (before the first "."), the part that matches a bare
// HostName / aof nodeId (RESEARCH §1 — "umairs-mbp.tail1a2b.ts.net." → "umairs-mbp").
function dnsLeadingLabel(dnsName) {
  const stripped = normaliseDnsLabel(dnsName);
  const dot = stripped.indexOf(".");
  return dot === -1 ? stripped : stripped.slice(0, dot);
}

// Resolve config.mesh.fabric's declared value (undeclared ⇒ null, distinct from an
// unsupported named fabric).
function declaredFabric(config) {
  const raw = config?.mesh?.fabric;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

// --------------------------------------------------- the "direct" fabric ----
// The no-overlay fabric (see the header). Every function below is PURE over an
// injected seam — `options.interfaces` (default os.networkInterfaces()) and
// `options.lookup` (default dns.promises.lookup) — mirroring the `options.exec`
// discipline the tailscale branch keeps, so none of it needs a real machine to test.
export const DIRECT_FABRIC = "direct";

// The fabric names this build implements. Anything else stays a clean
// fabric-unsupported refusal (never a crash, never a silent fallback).
const SUPPORTED_FABRICS = new Set(["tailscale", DIRECT_FABRIC]);

// An operator-declared address for THIS node (config.mesh.address) — the escape
// hatch for a multi-homed box where the auto-derived first non-internal IPv4 is the
// wrong interface. Declared wins verbatim; it is never validated against the live
// interface list (an operator who names an address they cannot bind gets the bind
// error, which is a better diagnostic than a silent substitution).
function declaredAddress(config) {
  const raw = config?.mesh?.address;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

// The first NON-INTERNAL IPv4 this machine owns — the auto-derived bind/dial address
// when config.mesh.address is absent. IPv4 only, deliberately: WSL2's NAT (and most
// container/VM switches) carry no usable IPv6 path to the host, so an IPv6-first
// choice would resolve to an address peers cannot reach (measured 2026-07-27 — a
// guest reached every host IPv4 and no host IPv6). `internal` (loopback) is skipped
// so this never returns 127.0.0.1 as a peer-facing address.
function firstLocalIPv4(interfaces) {
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      const family = entry?.family;
      const isV4 = family === "IPv4" || family === 4;
      if (isV4 && entry?.internal !== true && typeof entry.address === "string" && entry.address.length > 0) {
        return entry.address;
      }
    }
  }
  return null;
}

// This node's `direct` address: declared wins, else the first non-internal IPv4,
// else null (the ONE genuine degrade this fabric has — a node with no address cannot
// bind a reachable listener).
function directSelfAddress(config, options) {
  const declared = declaredAddress(config);
  if (declared != null) return declared;
  const interfaces = options?.interfaces ?? os.networkInterfaces();
  return firstLocalIPv4(interfaces);
}

// The injected host->address resolver, defaulting to the real kernel resolver
// (dns.promises.lookup with { all: true } — getaddrinfo, so /etc/hosts, the Windows
// hosts file, mDNS and DNS all participate exactly as they do for every other program
// on the box). A literal IP passes straight through getaddrinfo unchanged, so a
// roster host may be either a name or an address with no branching here.
function resolveLookup(options) {
  if (typeof options?.lookup === "function") return options.lookup;
  return (host) => dns.promises.lookup(host, { all: true });
}

// resolvePeers' `direct` branch: the roster IS the peer list (there is no fabric to
// enumerate), each record's declared host pushed through the kernel resolver. Rows
// are emitted per RESOLVED ADDRESS, so a dual-homed peer surfaces every address it
// answers on. THIS node is excluded (a roster contains its own record; a tailscale
// Peer map never lists Self — the two branches agree on "peers means others").
// A host that will not resolve is DROPPED, never a throw and never a null-address
// row: an unresolvable peer is indistinguishable from an absent one for dialling.
async function resolveDirectPeers(config, options) {
  const roster = Array.isArray(options?.roster) ? options.roster : [];
  const lookup = resolveLookup(options);
  const selfNodeId = typeof config?.mesh?.nodeId === "string" ? config.mesh.nodeId : null;

  const peers = [];
  for (const entry of roster) {
    const nodeId = typeof entry?.nodeId === "string" && entry.nodeId.length > 0 ? entry.nodeId : null;
    if (nodeId == null || nodeId === selfNodeId) continue;
    const host = typeof entry?.host === "string" && entry.host.trim().length > 0 ? entry.host.trim() : null;
    if (host == null) continue;

    let addresses;
    try {
      addresses = await lookup(host);
    } catch {
      // Unresolvable — the kernel has no answer for this name today. Dropped, exactly
      // as an offline tailscale peer contributes no dial address.
      continue;
    }
    const rows = Array.isArray(addresses) ? addresses : [addresses];
    for (const row of rows) {
      const dialAddress = typeof row === "string" ? row : typeof row?.address === "string" ? row.address : null;
      if (dialAddress == null || dialAddress.length === 0) continue;
      // `online: true` means RESOLVED, not reachable — this fabric has no liveness
      // oracle (header note). Presence records remain the real liveness source.
      peers.push({ nodeId, dialAddress, online: true, host });
    }
  }
  return peers;
}

// probeFabric(config, options) → { fabric, state, healthy, reason }. The two-stage
// liveness probe (ADR-001.2). `options.exec` is the injected fabric-exec closure
// (defaults to the real execFile); `options.platform` is the injected platform
// (defaults to process.platform) — the Windows-fallback branch.
export async function probeFabric(config, options = {}) {
  const fabric = declaredFabric(config);

  // Declaration side (ADR-001.2): absent vs an unsupported named fabric are
  // DISTINCT clean refusals — neither ever spawns tailscale.
  if (fabric == null) {
    return { fabric: null, state: null, healthy: false, reason: "fabric-undeclared" };
  }
  if (!SUPPORTED_FABRICS.has(fabric)) {
    return { fabric, state: null, healthy: false, reason: "fabric-unsupported" };
  }

  // `direct` — nothing to spawn and no daemon to be down, so the ONLY honest degrade
  // is "this node has no address to bind/advertise". Reported as a distinct reason
  // (never the generic `degraded`) so the guidance can name the actual fix.
  if (fabric === DIRECT_FABRIC) {
    const address = directSelfAddress(config, options);
    return address == null
      ? { fabric, state: null, healthy: false, reason: "no-local-address" }
      : { fabric, state: "direct", healthy: true, reason: null };
  }

  const exec = resolveExec(options);
  const platform = options?.platform ?? process.platform;

  // Stage 1 — can `tailscale` be spawned at all?
  let result;
  try {
    result = await spawnTailscale(exec, ["status", "--json"], { platform });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { fabric, state: null, healthy: false, reason: "not-installed" };
    }
    // A non-ENOENT spawn fault (timeout/kill) is a degraded fabric, never a crash.
    return { fabric, state: null, healthy: false, reason: "degraded" };
  }

  // Stage 2 — it spawned; parse the JSON tolerantly.
  const parsed = tolerantParseJson(result.stdout);
  if (parsed == null || typeof parsed !== "object") {
    return { fabric, state: null, healthy: false, reason: "degraded" };
  }
  const state = typeof parsed.BackendState === "string" ? parsed.BackendState : null;
  const reason = reasonForBackendState(state);
  return { fabric, state, healthy: reason === null, reason };
}

// selfAddress(config, options) → this node's dial address (Self.TailscaleIPs[0]),
// or null on a degraded fabric (never a crash, ADR-001.3).
export async function selfAddress(config, options = {}) {
  const fabric = declaredFabric(config);
  // `direct` — the declared address, else the first non-internal IPv4. No spawn.
  if (fabric === DIRECT_FABRIC) return directSelfAddress(config, options);
  if (fabric !== "tailscale") return null;

  const exec = resolveExec(options);
  const platform = options?.platform ?? process.platform;
  let result;
  try {
    result = await spawnTailscale(exec, ["status", "--json"], { platform });
  } catch {
    return null;
  }
  const parsed = tolerantParseJson(result.stdout);
  const ips = parsed?.Self?.TailscaleIPs;
  return Array.isArray(ips) && typeof ips[0] === "string" ? ips[0] : null;
}

// resolvePeers(config, options) → [{ nodeId, dialAddress, online, host }]. Parses
// the Peer map (ADR-002.2) and joins each peer to an aof nodeId by HostName then
// DNSName (trailing-dot-tolerant). `options.roster` is the aof node roster to join
// against — an array of records carrying `nodeId` (and, when known, `host`); when
// absent every peer is surfaced UNJOINED (nodeId:null), never dropped, never
// crashed on. A degraded fabric (unspawnable / unparseable / declaration refusal)
// resolves to [] — a peer list is never partially populated from a crash.
export async function resolvePeers(config, options = {}) {
  const fabric = declaredFabric(config);
  // `direct` — the injected roster resolved through the kernel resolver (no spawn,
  // no peer map). Returns [] for an absent roster, exactly like the tailscale branch.
  if (fabric === DIRECT_FABRIC) return await resolveDirectPeers(config, options);
  if (fabric !== "tailscale") return [];

  const exec = resolveExec(options);
  const platform = options?.platform ?? process.platform;
  const roster = Array.isArray(options?.roster) ? options.roster : [];

  let result;
  try {
    result = await spawnTailscale(exec, ["status", "--json"], { platform });
  } catch {
    return [];
  }
  const parsed = tolerantParseJson(result.stdout);
  const peerMap = parsed?.Peer;
  if (peerMap == null || typeof peerMap !== "object") return [];

  // Build the join index once: every roster entry's nodeId AND (sanitised) host,
  // each mapped to the nodeId — so a peer can match on either key.
  const byHost = new Map();
  const byNodeId = new Set();
  for (const entry of roster) {
    const nodeId = typeof entry?.nodeId === "string" ? entry.nodeId : null;
    if (nodeId == null) continue;
    byNodeId.add(nodeId);
    byHost.set(nodeId.toLowerCase(), nodeId);
    const host = typeof entry?.host === "string" ? entry.host : null;
    if (host != null) byHost.set(host.toLowerCase(), nodeId);
  }

  const peers = [];
  for (const peer of Object.values(peerMap)) {
    if (peer == null || typeof peer !== "object") continue;
    const host = typeof peer.HostName === "string" ? peer.HostName : null;
    const ips = Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs : [];
    const dialAddress = typeof ips[0] === "string" ? ips[0] : null;
    const online = peer.Online === true;

    // Join by HostName first, then the DNSName leading label (trailing-dot
    // tolerant) — a peer matching neither surfaces UNJOINED (nodeId:null).
    let nodeId = host != null ? byHost.get(host.toLowerCase()) ?? null : null;
    if (nodeId == null && typeof peer.DNSName === "string") {
      const label = dnsLeadingLabel(peer.DNSName);
      nodeId = label ? byHost.get(label) ?? null : null;
    }

    peers.push({ nodeId, dialAddress, online, host });
  }
  return peers;
}

// ------------------------------------------ per-fabric operator guidance ----
// (milestone 33 / story 01, ADR-003.4 / ADR-001.4, task 04) — a PURE formatter over
// probeFabric's { healthy, reason } shape, sourced from THIS module (the ONE fabric-
// assumption seam) so the launcher preflight and `work doctor` print the SAME text.
// Install-guidance ONLY — it never runs a remediation itself (ADR-001.consequence:
// "the transport can only report the fabric CLI failed, here is why").

// The RESEARCH §4 remediation matrix — ONE actionable message per probeFabric reason.
// An unrecognised reason still resolves to a generic, non-crashing message (never a
// throw on a reason string this build has not seen).
const REMEDIATION_BY_REASON = {
  "not-installed": "install Tailscale",
  "needs-login": "run `tailscale up`",
  stopped: "the tailscale daemon isn't running",
  "needs-machine-auth": "waiting on tailnet admin approval",
  degraded: "the fabric probe could not be parsed — check tailscale",
  "fabric-unsupported": 'this build supports "tailscale" and "direct" — that fabric is not implemented',
  "fabric-undeclared": 'declare config.mesh.fabric ("direct" for no overlay, or "tailscale") to enable the mesh',
  // `direct`'s ONE degrade: no bindable/advertisable address on this machine.
  "no-local-address": 'no non-internal IPv4 on this machine — declare config.mesh.address explicitly',
};

// The RESEARCH §5 reachability guidance lines a healthy preflight prints alongside the
// resolved self-address — the silent failure modes (shields-up/ACL) named for the
// operator since they cannot be pre-read from `tailscale status --json`.
export const SAME_TAILNET_GUIDANCE = "both nodes must be on the same tailnet";
export const PEER_ONLINE_GUIDANCE = "ensure `tailscale status` shows the peer Online";
export const SHIELDS_UP_GUIDANCE = "if a dial is refused, check `--shields-up`/ACLs";

// The `direct` equivalents — the silent failure modes of a NO-OVERLAY fabric, which
// are different in kind from the tailnet's. There is no ACL and no coordination
// server; what bites instead is a peer whose advertised host resolves to the WRONG
// interface (the WSL hostname-collision class: a guest inheriting its host's name
// resolves to the HOST, not the guest) and a host firewall on the dial port.
export const DIRECT_RESOLVE_GUIDANCE = "each peer's advertised host must resolve, from THIS machine, to that peer — not to itself";
export const DIRECT_OVERRIDE_GUIDANCE = "a peer whose hostname collides must advertise an explicit address (`aof mesh identity --name <id> --address <ip>`)";
export const DIRECT_FIREWALL_GUIDANCE = "if a dial is refused, check the host firewall on the control port";

// remediationForReason(reason) → the ONE actionable RESEARCH §4 message for a degraded
// probeFabric reason, or null for a healthy (reason:null) probe. Never throws.
export function remediationForReason(reason) {
  if (reason == null) return null;
  return REMEDIATION_BY_REASON[reason] ?? "the fabric is degraded — check tailscale";
}

// fabricGuidance(probeResult, { selfAddress }) → { healthy, lines: string[] } — the
// PURE projection task 03's launcher preflight (and work doctor) render:
//   - healthy probe   → the resolved self-address + the same-tailnet / peer-Online /
//                        shields-up reachability guidance lines (ADR-003.4);
//   - degraded probe  → the ONE matching RESEARCH §4 remediation line.
// A pure formatter — it never spawns, never reads a clock, never mutates anything.
export function fabricGuidance(probeResult, { selfAddress: address = null } = {}) {
  if (probeResult?.healthy) {
    const lines = [];
    if (typeof address === "string" && address.length > 0) {
      lines.push(`self-address: ${address}`);
    }
    // Per-fabric reachability guidance — the failure modes differ in KIND, so a
    // `direct` node is never told to check a tailnet it does not have.
    if (probeResult?.fabric === DIRECT_FABRIC) {
      lines.push(DIRECT_RESOLVE_GUIDANCE, DIRECT_OVERRIDE_GUIDANCE, DIRECT_FIREWALL_GUIDANCE);
    } else {
      lines.push(SAME_TAILNET_GUIDANCE, PEER_ONLINE_GUIDANCE, SHIELDS_UP_GUIDANCE);
    }
    return { healthy: true, lines };
  }
  return { healthy: false, lines: [remediationForReason(probeResult?.reason ?? null)] };
}

// macOsAppStoreSplitWarning(options) → the ONE macOS App-Store-CLI-split warning line,
// or null when it does not apply (ADR-001.4 / RESEARCH §3). Fires ONLY when:
//   - the injected platform is "darwin" (default process.platform — the SAME
//     injected-platform-defaulting idiom as config-inspect.mjs's toolPlatformChecks);
//   - options.cliUnreachable is true (an INJECTED signal — never a literal exit-code/
//     stderr match, RESEARCH §3's exact symptom is community-reported, not measured).
// Install-guidance only: it steers to the Standalone/open-source tailscaled build and
// NEVER attempts a runtime auto-fix.
export function macOsAppStoreSplitWarning({ platform = process.platform, cliUnreachable = false } = {}) {
  if (platform !== "darwin" || cliUnreachable !== true) return null;
  return "the Tailscale CLI cannot reach the daemon — this may be the macOS App-Store sandbox split; install the Standalone/open-source tailscaled build instead";
}
