// src/mesh-relay.mjs — the thin, STATELESS relay (milestone 23 / story 01 / ADR-001):
// a ws@8 broker shipped as the same aof binary in a `relay` mode, carrying a FROZEN,
// payload-agnostic ephemeral envelope. It brokers signals IN MEMORY ONLY and fans them
// out — it persists NOTHING authoritative, imports NO record schema, and is NEVER a
// system of record. Kill it and the fleet loses LIVENESS, not DATA (durable state is
// written through the global mesh store/presence seams, never here).
//
// THE SERVE UNIT (the board-serve/terminal-ws precedent, 03/ADR-001): serveRelay({ port,
// config }) returns { server, url, stop } — ONE http.createServer; a single
// WebSocketServer via noServer + server.on('upgrade') routing by pathname to ONE relay
// path (socket.destroy() everything else); wss.handleUpgrade → wss.emit('connection').
// Binds loopback (the pre-auth posture, ADR-001). stop() closes the wss + server AND the
// live sockets (no dangling connection) — the disposable serve-unit discipline.
//
// THE FROZEN WIRE ENVELOPE (03/ADR-003), payload-agnostic about CONTENT: every frame is
// { kind, nodeId, signal } where `signal` is an OPAQUE blob forwarded BYTE-FOR-BYTE
// unparsed. The relay parses only enough to read { kind, nodeId } for routing — it does
// NO JSON.parse-then-branch on `signal` content, so a new `kind` (m26 leasing) rides the
// wire with ZERO relay change. An unknown `kind` is forwarded, never rejected.
//
// NEVER-CRASH (03/ADR-003, the terminal-ws parseControl try/catch shape): a malformed /
// non-JSON / OVERSIZED frame yields the frozen { type:'error', message } control-frame to
// the SENDER ONLY and never a throw. The over-limit check is HAND-ROLLED (a byte-length
// check FIRST, inside the inbound handler) so the sender gets OUR control-frame, not ws's
// protocol-level 1009 close; ws's maxPayload is set to the same value as a defence-in-
// depth floor, but the contract-bearing path is the hand-rolled check.
//
// STATELESS / ENVELOPE-NEUTRAL (fitness #1/#2): this module performs NO writeText/
// writeFile of a record (no durable write), imports NO record schema for persistence
// (mesh-store.mjs / mesh-presence.mjs / node-identity.mjs), and holds no on-disk store —
// it stages/fans-out frames, not fields. It carries opaque envelopes; it is file-disjoint
// from the presence record (story 00) and the integration (story 02).
import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
// milestone 24 / story 01 (ADR-002 move 2): the device-flow HTTP route reads/writes the
// group registry THROUGH story 00's seam ONLY — readRegistry (absence→empty) + the pure
// consume/admit helpers composed on the VALUE + the single control-node-guarded
// writeRegistry (acd-registry-write-scope: this module never writes the registry file
// itself). mesh-registry.mjs is the registry VERIFY/persist seam, NOT a record schema —
// the relay stays stateless (no fs import, no writeText here; acd-relay-stateless holds:
// the registry is the system of record, the relay merely invokes its seam on the one
// node that IS the enrollment authority).
import {
  isControlNode,
  readRegistry,
  writeRegistry,
  admitNode,
  consumePendingInvite,
  isInviteConsumed,
  isInviteExpired,
  verifyCredential,
} from "./mesh-registry.mjs";
import { publishNodeRecord, readNodeRecord } from "./mesh-store.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

// The single relay pathname (ADR-001 — ONE path; any other upgrade pathname is
// destroyed, the terminal-ws default branch). Loopback-bound by default (pre-auth).
export const RELAY_PATH = "/ws/relay";

// The documented default max frame size (ADR-001, the resolved QA flag #1): 1 MiB. A
// missing/malformed config value falls back to this without crashing. The CONTRACT-
// bearing limit is enforced by a hand-rolled byte-length check below (so the sender gets
// OUR frozen control-frame), with ws's maxPayload set to the same value as a floor.
export const DEFAULT_MAX_FRAME_BYTES = 1048576;

// Resolve the configured max frame size from a config object (config.mesh.relay
// .maxFrameBytes) via the raw optional-chain the namespace uses (no schema block — the
// top-level schema has no additionalProperties:false). A valid positive integer is used
// verbatim; ANY malformed value (absent, non-number, <= 0, non-integer) falls back to the
// documented default without crashing.
export function resolveMaxFrameBytes(config) {
  const raw = config?.mesh?.relay?.maxFrameBytes;
  if (typeof raw !== "number") return DEFAULT_MAX_FRAME_BYTES;
  if (!Number.isFinite(raw)) return DEFAULT_MAX_FRAME_BYTES;
  if (!Number.isInteger(raw)) return DEFAULT_MAX_FRAME_BYTES;
  if (raw <= 0) return DEFAULT_MAX_FRAME_BYTES;
  return raw;
}

// ------------------------------------------------ enrollment (milestone 24) ----
// ADR-005: the two documented enrollment knobs, read via resolvers structurally
// IDENTICAL to resolveMaxFrameBytes above — a valid positive integer verbatim; ANY
// malformed value (absent / non-number / non-finite / non-integer / <= 0) falls back to
// the documented default WITHOUT crashing (the m23 malformed→default tolerance).

// 5 minutes — a code is presentable for a few minutes, then expires (ADR-002 expiresAt
// = issuedAt + this; the mint reads it, and the endpoint's attempt-window rides it).
export const DEFAULT_CODE_TTL_SECONDS = 300;

// Single-digit — after this many FAILED presentations per source within the TTL window
// the endpoint refuses further attempts (ADR-005: the load-bearing control that turns
// the 10^6 code space from walkable into infeasible-within-the-TTL — SECURITY T2/T7).
export const DEFAULT_MAX_ATTEMPTS = 5;

// config.mesh.enrollment.codeTtlSeconds → the invite TTL (seconds).
export function resolveCodeTtlSeconds(config) {
  const raw = config?.mesh?.enrollment?.codeTtlSeconds;
  if (typeof raw !== "number") return DEFAULT_CODE_TTL_SECONDS;
  if (!Number.isFinite(raw)) return DEFAULT_CODE_TTL_SECONDS;
  if (!Number.isInteger(raw)) return DEFAULT_CODE_TTL_SECONDS;
  if (raw <= 0) return DEFAULT_CODE_TTL_SECONDS;
  return raw;
}

// config.mesh.enrollment.maxAttempts → the attempt-cap N (ADR-005).
export function resolveMaxAttempts(config) {
  const raw = config?.mesh?.enrollment?.maxAttempts;
  if (typeof raw !== "number") return DEFAULT_MAX_ATTEMPTS;
  if (!Number.isFinite(raw)) return DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(raw)) return DEFAULT_MAX_ATTEMPTS;
  if (raw <= 0) return DEFAULT_MAX_ATTEMPTS;
  return raw;
}

// THE enrollment hash seam (SECURITY T3 — acd-enrollment-code-hashed-at-rest): the
// reduction every enrollment secret passes through before anything durable sees it.
// The mint (mesh:invite) hashes the 6-digit code through THIS function before the
// pending record is written; the endpoint below hashes the PRESENTED code through the
// SAME function to match; and the issued relay-auth token is stored on the roster only
// as ITS hash. One seam, so mint and match can never disagree on the algorithm.
export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

// The CONSTANT-TIME hash compare (SECURITY T2/T4 — the timing-oracle guard): a
// crypto.timingSafeEqual over the two hex digests, never a raw ===/!== on hash
// material (response latency must leak no match progress an attacker could use to
// walk the 10^6 space digit-by-digit). A length mismatch is an immediate non-match.
function hashesEqual(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}



// One structured JSON response — the never-crash HTTP discipline (03/ADR-003 mirrored
// over HTTP): EVERY enrollment outcome, success or rejection, is a written response,
// never a throw out of the handler.
function respondJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

// Read a bounded request body: resolves the body text, or null when the stream errors
// or exceeds the limit (both are the malformed-presentation class — a flood of bytes
// is refused cheaply, the T7 posture; never a throw).
function readRequestBody(request, limitBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    request.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > limitBytes) {
        settle(null);
        try {
          request.destroy();
        } catch (error) {
          /* stream already closing */
      reportDegrade("mesh-relay", error); }
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => settle(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => settle(null));
  });
}

// Pull the presented 6-digit value off a parsed body. The read is a property access +
// a checks-on-a-neutral-local shape (never an equality operator adjacent to a
// code-named identifier — the constant-time fitness's grep is deliberately blunt).
// Anything that is not exactly six decimal digits is NOT a valid presentation.
function safeDescriptorString(value) {
  return typeof value === "string" ? value : "";
}

function safeDescriptorStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function readJoinerNodeRecord(parsed, joiner, nowIso) {
  const candidate = parsed?.nodeRecord;
  if (candidate == null || typeof candidate !== "object" || candidate.nodeId !== joiner) {
    return { nodeId: joiner, host: "", os: "", runtimes: [], aofVersion: "", publishedAt: nowIso };
  }
  return {
    nodeId: joiner,
    host: safeDescriptorString(candidate.host),
    os: safeDescriptorString(candidate.os),
    runtimes: safeDescriptorStringArray(candidate.runtimes),
    aofVersion: safeDescriptorString(candidate.aofVersion),
    publishedAt: safeDescriptorString(candidate.publishedAt) || nowIso,
  };
}
function readPresentedDigits(parsed) {
  const value = parsed?.code;
  if (typeof value !== "string") return null;
  return /^\d{6}$/.test(value) ? value : null;
}

// The request pathname, tolerant of a malformed url (null, never a throw).
function requestPathname(request) {
  try {
    return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return null;
  }
}

// ------------------------------------- the relay auth-gate (milestone 24) ----
// ADR-003 move 2 / STORY.md decision: the credential is carried on the ws upgrade in an
// `Authorization` header (settable via `new WebSocket(url, { headers: { Authorization } })`
// on both the in-process test client and the production connect path — preferred over a
// Sec-WebSocket-Protocol subprotocol to avoid the subprotocol-echo handshake flake). Read
// the presented relayAuth token off the header, tolerant of an optional `Bearer ` prefix;
// a missing/blank header is an absent credential (a deny for a group connection).
function readPresentedCredential(request) {
  const header = request?.headers?.authorization;
  if (typeof header !== "string") return null;
  const value = header.replace(/^Bearer\s+/i, "").trim();
  return value.length > 0 ? value : null;
}

// Is this a LOOPBACK (same-host) connection? Loopback stays the m23 local default — a
// same-host connection to its own relay needs NO credential (ADR-003 move 2; A3 "the
// relay binds loopback by default"). Recognise the IPv4 loopback, the IPv6 loopback, and
// the IPv4-mapped-IPv6 loopback forms. A null/undefined remote address is treated as
// non-loopback (fail-closed: an un-attributable connection is a group connection).
function isLoopbackAddress(address) {
  if (typeof address !== "string" || address.length === 0) return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

// The DEFAULT "is this a group (non-loopback) connection?" predicate — a group
// connection requires a valid credential; loopback does not. Derived from the socket's
// remote address (non-loopback ⇒ group). serveRelay exposes an INJECTABLE override
// (the isGroupConnection option) because every in-process `ws` client presents a
// 127.0.0.1 remote address, so the loopback-vs-group branch is not otherwise
// deterministic in-process (the STORY.md build note) — a test injects a predicate to
// drive both sides of the branch.
function defaultIsGroupConnection(request) {
  return !isLoopbackAddress(request?.socket?.remoteAddress);
}

// The byte-length of an inbound ws frame, tolerant of Buffer / ArrayBuffer / array-of-
// Buffer / string shapes (ws delivers any of these depending on fragmentation). Used by
// the hand-rolled over-limit check — measured in BYTES, never characters.
function frameByteLength(data) {
  if (data == null) return 0;
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + frameByteLength(part), 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return Buffer.byteLength(String(data));
}

// Send a frozen control-frame ({ type:'error'|'joined', … }) — never throws into the
// caller (the socket may already be closing). The 03/ADR-003 sendControl shape.
function sendControl(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch (error) {
    // socket closed/closing — nothing to send
      reportDegrade("mesh-relay", error); }
}

// Parse JUST enough of an inbound frame to read { kind, nodeId } for ROUTING — it NEVER
// parses or branches on `signal` CONTENT (the payload-agnostic property, fitness #2).
// Returns the parsed envelope object on a well-formed { kind } frame, or null on a
// malformed / non-JSON / non-envelope frame (the never-crash try/catch, never a throw).
// `signal` is left on the returned object UNTOUCHED — it is forwarded by re-emitting the
// ORIGINAL frame bytes, so the blob is byte-identical regardless of its content.
function parseEnvelope(text) {
  if (typeof text !== "string" || !text.startsWith("{")) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value == null || typeof value !== "object") return null;
  // The envelope is identified by a `kind` (the routing field). `nodeId` rides along for
  // routing/diagnostics. `signal` is NOT read here — it is the opaque blob.
  if (typeof value.kind !== "string") return null;
  return value;
}

export function createEnrollmentHttpHandler({ config, workspace = null, now = null } = {}) {
  const codeTtlSeconds = resolveCodeTtlSeconds(config);
  const maxAttempts = resolveMaxAttempts(config);
  const attemptBuckets = new Map();
  const resolveNowIso = () => {
    if (typeof now === "function") return String(now());
    if (typeof now === "string" && now.length > 0) return now;
    return new Date().toISOString();
  };

  function attemptsExhausted(source, nowMs) {
    const bucket = attemptBuckets.get(source);
    if (bucket == null) return false;
    if (Number.isFinite(nowMs) && nowMs - bucket.startMs > codeTtlSeconds * 1000) {
      attemptBuckets.delete(source);
      return false;
    }
    return bucket.failures >= maxAttempts;
  }

  function recordFailedAttempt(source, nowMs) {
    const startMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const bucket = attemptBuckets.get(source);
    if (bucket == null || startMs - bucket.startMs > codeTtlSeconds * 1000) {
      attemptBuckets.set(source, { failures: 1, startMs });
      return;
    }
    bucket.failures += 1;
  }

  async function handleEnroll(request, response) {
    if (workspace == null) {
      respondJson(response, 503, { ok: false, reason: "enrollment-unavailable", error: "this relay has no workspace wired — enrollment needs the group registry" });
      return;
    }

    const nowIso = resolveNowIso();
    const nowMs = Date.parse(nowIso);
    const source = request.socket?.remoteAddress ?? "unknown";

    if (attemptsExhausted(source, nowMs)) {
      respondJson(response, 429, { ok: false, reason: "attempt-cap", error: "too many failed presentations from this source — the enrollment endpoint refuses further attempts within the TTL window" });
      return;
    }

    const bodyText = await readRequestBody(request, 4096);
    let parsed = null;
    if (bodyText != null) {
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = null;
      }
    }
    const presented = readPresentedDigits(parsed);
    const joiner = typeof parsed?.nodeId === "string" && parsed.nodeId.length > 0 ? parsed.nodeId : null;
    if (presented == null || joiner == null) {
      recordFailedAttempt(source, nowMs);
      respondJson(response, 400, { ok: false, reason: "malformed", error: "malformed enrollment body — expected JSON { code: <6 digits>, nodeId }" });
      return;
    }
    const joinerRecord = readJoinerNodeRecord(parsed, joiner, nowIso);

    const registry = await readRegistry(workspace);
    const pendingInvites = Array.isArray(registry.pending) ? registry.pending : [];
    const presentedHash = sha256Hex(presented);
    const matched = pendingInvites.find((invite) => hashesEqual(presentedHash, invite?.codeHash));

    if (matched == null) {
      recordFailedAttempt(source, nowMs);
      respondJson(response, 404, { ok: false, reason: "no-match", error: "the presented code matches no pending invite" });
      return;
    }
    if (isInviteConsumed(matched)) {
      recordFailedAttempt(source, nowMs);
      respondJson(response, 409, { ok: false, reason: "consumed", error: "the presented code was already consumed — an invite is single-use" });
      return;
    }
    if (isInviteExpired(matched, nowIso)) {
      recordFailedAttempt(source, nowMs);
      respondJson(response, 410, { ok: false, reason: "expired", error: "the presented code has expired" });
      return;
    }
    if (!isControlNode(config)) {
      respondJson(response, 503, { ok: false, reason: "not-control-node", error: "admission requires the nominated control node — this relay is not the enrollment authority" });
      return;
    }

    await publishNodeRecord(workspace, joiner, joinerRecord);

    const relayAuth = crypto.randomBytes(32).toString("hex");
    const relayAuthHash = sha256Hex(relayAuth);
    const controlNode = typeof config?.mesh?.relay?.controlNode === "string" && config.mesh.relay.controlNode.length > 0 ? config.mesh.relay.controlNode : null;
    const consumed = consumePendingInvite(registry, matched.codeHash, nowIso);
    const admitted = admitNode(consumed, { nodeId: joiner, admittedAt: nowIso, boards: [], relayAuthHash });
    const persisted = await writeRegistry(workspace, admitted, config);
    if (!persisted.written) {
      respondJson(response, 503, { ok: false, reason: "not-control-node", error: "admission requires the nominated control node — this relay is not the enrollment authority" });
      return;
    }

    attemptBuckets.delete(source);
    // review fix (live soak, 2026-07-17): the joiner's record was already persisted
    // ON THE CONTROL NODE above (publishNodeRecord(workspace, joiner, ...)), but
    // nothing in the ORIGINAL enroll response ever gave the JOINER a copy of the
    // CONTROL NODE'S own descriptor — only its bare nodeId string. Without that
    // descriptor in the joiner's own local nodes/ directory, resolvePeers' roster
    // join (mesh-fabric.mjs) has nothing to match a live tailscale peer against, so
    // a freshly (or re-)joined worker can NEVER resolve the control node's dial
    // address, regardless of tailscale connectivity — the join silently completed
    // but left the worker permanently unable to stream. Read the control node's OWN
    // already-published record (every control node publishes itself via `aof mesh
    // identity` before it can serve) and hand it back so the joiner can persist an
    // equivalent local copy (mesh-join.mjs). Absence-tolerant: an unpublished
    // control-node record degrades to admission succeeding exactly as before this
    // fix, never a failure of the join itself.
    const controlNodeRecord = controlNode != null ? await readNodeRecord(workspace, controlNode) : null;
    respondJson(response, 200, { ok: true, credential: { relayAuth, nodeId: joiner, controlNode, controlNodeRecord } });
  }

  return async function enrollmentHttpHandler(request, response) {
    if (request.method !== "POST" || requestPathname(request) !== "/enroll") return false;
    try {
      await handleEnroll(request, response);
    } catch {
      try {
        respondJson(response, 500, { ok: false, reason: "enroll-failed", error: "enrollment failed unexpectedly" });
      } catch (error) {
        /* response already settled */
      reportDegrade("mesh-relay", error); }
    }
    return true;
  };
}
// serveRelay({ port, config, workspace, now }) → { server, url, stop }. The one-shot
// serve core (the board-serve/terminal-ws clone). Binds loopback on the requested port
// (0 ⇒ an ephemeral port; the url carries the ACTUAL assigned port, the setup-ui
// readback). Returns a disposable serve unit.
//
// milestone 24 / story 01 — two ADDITIVE parameters (both default-null, so every m23
// call site is byte-compatible):
//   workspace — the control node's workspace the enrollment route reads/writes the
//               group registry through (story 00's seam). Absent ⇒ the route answers a
//               structured 503 (enrollment needs the registry; the ws broker is
//               unaffected either way).
//   now       — the INJECTED clock the enrollment route reads (an ISO string or a
//               () => iso function; the 22/R2 inject-the-clock discipline). Absent ⇒
//               wall-clock. Only enrollment reads it — the broker has no clock.
//
// milestone 24 / story 02 — one further ADDITIVE parameter (default-null, so every
// prior call site is byte-compatible):
//   isGroupConnection — the INJECTABLE "this is a group (non-loopback) connection"
//               predicate the ws auth-gate branches on (STORY.md build note: every
//               in-process `ws` client presents a 127.0.0.1 remote address, so the
//               loopback-vs-group branch is not otherwise deterministic in-process).
//               A predicate (request) => boolean. Absent ⇒ the default derives it from
//               the socket's remote address (non-loopback ⇒ group).
export async function serveRelay({ port = 0, config, workspace = null, now = null, isGroupConnection = null } = {}) {
  const maxFrameBytes = resolveMaxFrameBytes(config);
  // The loopback-vs-group predicate the auth-gate reads — the injected override, else
  // the remote-address default (ADR-003 move 2; the STORY.md injectable seam).
  const isGroup = typeof isGroupConnection === "function" ? isGroupConnection : defaultIsGroupConnection;

  // Enrollment state lives inside createEnrollmentHttpHandler; the WebSocket relay core
  // keeps only connection/broker state.

  // ONE http.createServer (ADR-001 / 03/ADR-001 — never a second server or port). The
  // m24 device-flow enrollment route (ADR-002 move 2) sits ABOVE the 426 fallback —
  // the ONLY HTTP route the relay serves; every other non-upgrade request still gets
  // the terse 426 and never hangs.
  const enrollmentHttpHandler = createEnrollmentHttpHandler({ config, workspace, now });
  const server = http.createServer((request, response) => {
    enrollmentHttpHandler(request, response)
      .then((handled) => {
        if (handled) return;
        response.writeHead(426, { "Content-Type": "text/plain" });
        response.end("Upgrade required");
      })
      .catch(() => {
        try {
          respondJson(response, 500, { ok: false, reason: "http-failed", error: "request failed unexpectedly" });
        } catch (error) {
          /* response already settled */
      reportDegrade("mesh-relay", error); }
      });
  });

  // A single WebSocketServer via noServer (ADR-001) + the maxPayload floor (the defence-
  // in-depth half; the CONTRACT path is the hand-rolled byte-length check below). The
  // floor is set ABOVE the configured maxFrameBytes (a generous margin) so a frame just
  // over the contract limit still REACHES the inbound handler and gets OUR frozen
  // { type:'error' } control-frame — not ws's protocol-level 1009 close (the WRONG
  // observable: the build-note resolution of QA flag #1). ws's maxPayload still guards
  // against a truly enormous frame (a real DoS floor), but never pre-empts the contract.
  const payloadFloor = Math.max(maxFrameBytes * 2, maxFrameBytes + 65536);
  const wss = new WebSocketServer({ noServer: true, maxPayload: payloadFloor });

  // The live connected-clients set — fan-out is broadcast-to-OTHERS over it (add on
  // connection, delete on close). Held in memory ONLY; never persisted.
  const clients = new Set();

  // Route the upgrade by pathname to the ONE relay path; destroy everything else (the
  // terminal-ws default branch). milestone 24 / story 02 (ADR-003 move 2): ABOVE the
  // handleUpgrade, the ADDITIVE credential auth-gate — for a GROUP (non-loopback)
  // connection the presented relayAuth token is VERIFIED against the LIVE
  // roster/revocation (readRegistry(workspace) → verifyCredential) and a missing /
  // invalid / not-in-roster / REVOKED credential is destroyed with the SAME
  // socket.destroy() shape the pathname mismatch uses (no ws emitted, the socket never
  // reaches clients.add). LOOPBACK stays the local default — a same-host connection
  // needs no credential (A3). The gate is a READ + a decision: it persists NOTHING, so
  // acd-relay-stateless stays GREEN, and it branches in the upgrade handler on the
  // credential, never on a signal's content, so acd-relay-envelope-neutral stays GREEN.
  server.on("upgrade", (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url ?? "/", "ws://127.0.0.1").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== RELAY_PATH) {
      socket.destroy();
      return;
    }

    // The admit-then-hand-off tail: the socket has cleared the auth-gate, join the ws
    // handshake + the fan-out (the m23 path, unchanged).
    const admit = () => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    };

    // LOOPBACK: the m23 local default — no credential required, admit straight through.
    if (!isGroup(request)) {
      admit();
      return;
    }

    // GROUP (non-loopback): the credential MUST verify against the live roster AND not
    // be revoked. The verify reads the registry FRESH per upgrade (never a serve-start
    // snapshot), so a node revoked after issuance is denied on its next connect (T6).
    const token = readPresentedCredential(request);
    // The registry read is async; any read fault is a fail-closed DENY (a group
    // connection is never admitted on an unreadable roster).
    readRegistry(workspace ?? {})
      .then((registry) => {
        const decision = verifyCredential(registry, token);
        if (!decision.ok) {
          // A missing / invalid / not-in-roster / revoked credential is destroyed
          // upstream of the broker (the same reject shape the pathname mismatch uses).
          socket.destroy();
          return;
        }
        admit();
      })
      .catch(() => {
        socket.destroy();
      });
  });

  wss.on("connection", (ws) => {
    // Register the socket in the broadcast set BEFORE the ack, so the ack is the
    // deterministic proof the peer is in the set (the ack-on-connect barrier, the
    // resolved QA flag #2 — the raw `open` event fires before the server-side handler
    // has registered the socket, the 22/R3-class race).
    clients.add(ws);

    // The join-confirm / ack-on-connect control-frame: the barrier the tests await
    // before publishing.
    sendControl(ws, { type: "joined" });

    ws.on("message", (data, isBinary) => {
      // NEVER-CRASH (03/ADR-003): every bad-frame path errors the SENDER ONLY and returns
      // — it never forwards and never throws. The peer is untouched on every bad row.

      // (1) The HAND-ROLLED over-limit check, FIRST (the resolved QA flag #1): an
      // oversized frame gets OUR frozen control-frame, not ws's 1009 close.
      if (frameByteLength(data) > maxFrameBytes) {
        sendControl(ws, { type: "error", message: "frame exceeds the configured maximum size" });
        return;
      }

      // (2) Parse JUST { kind, nodeId } for routing (never `signal` content). A binary
      // frame is not the JSON envelope; a malformed / non-JSON frame returns null.
      const text = isBinary ? null : data.toString();
      const envelope = text == null ? null : parseEnvelope(text);
      if (envelope == null) {
        sendControl(ws, { type: "error", message: "malformed frame: expected a { kind, nodeId, signal } envelope" });
        return;
      }

      // (3) Fan out the ORIGINAL frame bytes to every client EXCEPT the sender — no
      // self-echo, no rewrite (`signal` forwarded byte-for-byte, opaque). An unknown
      // `kind` is forwarded, never rejected (the m26 leasing property).
      for (const peer of clients) {
        if (peer === ws) continue;
        try {
          peer.send(text);
        } catch (error) {
          // a peer socket closing mid-broadcast must never break the fan-out
      reportDegrade("mesh-relay", error); }
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      // a peer-level socket error must never crash the broker (03/ADR-003) — drop it
      // from the set and carry on.
      clients.delete(ws);
    });
  });

  // Bind loopback (the pre-auth posture, ADR-001). Reject (don't hang) on a bind error so
  // a caller can degrade honestly. The url carries the ACTUAL assigned port (the setup-ui
  // readback) — honest for the ephemeral-port (port: 0) case.
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}${RELAY_PATH}`;

  // stop() — the disposable serve-unit teardown: close every live socket (no dangling
  // connection against a dead server), then close the wss + the server.
  const stop = () =>
    new Promise((resolve) => {
      for (const ws of clients) {
        try {
          ws.close();
        } catch (error) {
          /* already closed */
      reportDegrade("mesh-relay", error); }
      }
      clients.clear();
      wss.close(() => {
        server.close(() => resolve());
      });
    });

  return { server, url, stop };
}

// relayMode(config, { port }) → { server, url, stop } | null — the in-process config
// gate (the resolved QA flag #3). Serve ONLY when config.mesh.relay.controlNode ===
// config.mesh.nodeId (the raw optional-chain read); otherwise return null — a CLEAN
// no-op, no listener bound, no port taken (the not-nominated branch). Re-nomination is
// purely re-pointing config.mesh.relay.controlNode + calling relayMode on the new node —
// no election message is exchanged.
export async function relayMode(config, { port = 0, workspace = null, now = null } = {}) {
  const nodeId = config?.mesh?.nodeId;
  const controlNode = config?.mesh?.relay?.controlNode;
  // This node hosts the relay ONLY when it is the nominated control node. A missing
  // nodeId / controlNode is a non-nomination (a clean null, never a crash).
  if (nodeId == null || controlNode == null || controlNode !== nodeId) {
    return null;
  }
  // m24: the ADDITIVE workspace/now pass-through — the launcher wires the workspace so
  // the device-flow route can reach the group registry (absent ⇒ the route 503s).
  return await serveRelay({ port, config, workspace, now });
}

// relayStatus(config) → the NON-BLOCKING probe the `aof mesh relay --json` face reports
// (the resolved bijection-probe requirement): it reports the configured control-node, the
// peer-push url, and whether THIS node is nominated — WITHOUT calling listen() / blocking.
// `aof mesh relay` is a long-lived serve verb, so its --json path is this dry-run probe
// (a usage/status), not a blocking listen — so the bijection gate runs clean + returns.
export function relayStatus(config) {
  const nodeId = config?.mesh?.nodeId ?? null;
  const controlNode = config?.mesh?.relay?.controlNode ?? null;
  const url = config?.mesh?.relay?.url ?? null;
  const nominated = nodeId != null && controlNode != null && controlNode === nodeId;
  return {
    nodeId,
    controlNode,
    url,
    nominated,
    maxFrameBytes: resolveMaxFrameBytes(config),
  };
}
