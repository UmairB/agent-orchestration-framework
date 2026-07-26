// src/mesh-relay-client.mjs — the NODE-SIDE relay client (milestone 23 / story 02 /
// ADR-003). The thin { connect, push } seam a node uses to push its presence signal to
// the control node's serveRelay (story 01) over ws@8 — the LIVENESS half of
// push-for-liveness, poll-for-durability. It is the ACCELERATOR, never the floor: the
// durable git write (story 00) happens UNCONDITIONALLY first; this client is pushed
// BEST-EFFORT second and a connect/push failure is CAUGHT, never thrown (ADR-003,
// fitness #4). Kill the relay and this client simply fails — the git record is already
// safe (data safe, liveness lost).
//
// THE INJECTED SEAM (the @executable feasibility lever — tasks 00/01's Background): the
// publish path takes an INJECTED relay client { connect, push } so the four relay states
// (up / down-connect-throws / unconfigured / push-throws) are reachable in CI with NO
// real ws server. This module ships:
//   - pushPresenceSignal(relayClient, envelope) — the one-shot, BEST-EFFORT push the
//     two-publish path calls (it connects, pushes ONE frame, and disposes — it holds no
//     long-lived socket; a heartbeat is a discrete publish). It NEVER swallows the throw
//     itself: the catch lives in mesh-heartbeat.mjs's two-publish path (so fitness #4 can
//     read the try/catch on the publish-path source). This function PROPAGATES a
//     connect/push failure to its caller's try/catch.
//   - relayEnvelope(nodeId, signal) — builds story 01's FROZEN { kind, nodeId, signal }
//     with kind "presence" and the presence record as the OPAQUE signal blob.
//   - createRelayClient(config) — the production client, or null when the relay is
//     UNCONFIGURED (no config.mesh.relay.url) so the push is SKIPPED (not attempted —
//     distinct from attempt-then-catch). It is a thin wrapper over a ws@8 socket whose
//     real-socket behaviour is exercised by the @manual fleet spike (task 02), NOT
//     @executable CI — so it stays a thin, injectable seam.
import { WebSocket } from "ws";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

// The FROZEN presence signal kind (story 01's first envelope `kind`; m26 leasing is the
// second). A single source so the publish path and the tests agree on the literal.
export const PRESENCE_SIGNAL_KIND = "presence";

// The FROZEN lease signal kind (milestone 26 / ADR-004.1 — the envelope's SECOND kind,
// cashing 23/ADR-001's "m26 leasing is the second kind" promise with ZERO change to
// src/mesh-relay.mjs: the broker parses only { kind, nodeId } for routing and forwards
// unknown kinds byte-for-byte, so this literal lives HERE and only here — the relay
// stays kind-blind, fitness #10 / acd-relay-lease-blind).
export const LEASE_SIGNAL_KIND = "lease";

// Build story 01's FROZEN { kind, nodeId, signal } envelope — kind "presence", THIS
// node's id, and the presence record as the OPAQUE `signal` blob (the relay forwards it
// byte-for-byte without parsing — fitness #2). A pure projection of its inputs.
export function relayEnvelope(nodeId, signal) {
  return { kind: PRESENCE_SIGNAL_KIND, nodeId, signal };
}

// Build the lease-intent envelope (m26 / ADR-004.1) — the SAME frozen { kind, nodeId,
// signal } form with kind "lease": THIS node's id and the claim record VERBATIM as the
// OPAQUE `signal` blob (the wire never parses it; the broker forwards it byte-for-byte).
// A pure projection of its inputs — relayEnvelope's sibling for the second kind.
export function leaseRelayEnvelope(nodeId, claim) {
  return { kind: LEASE_SIGNAL_KIND, nodeId, signal: claim };
}

// pushPresenceSignal(relayClient, envelope) — the ONE-SHOT best-effort push the
// two-publish path calls. It connects, pushes EXACTLY ONE frame, and returns. It does
// NOT catch — a connect/push failure PROPAGATES to the caller's try/catch (so the catch
// stays on the publish-path source, where fitness #4 reads it). A null/absent relayClient
// is the UNCONFIGURED case: the push is SKIPPED (returns { pushed:false, skipped:true }),
// never attempted — distinct from an attempt that then throws.
//
// THE { connect, push } CONTRACT (fix 1c): connect() MUST return a CLOSABLE handle (an
// object exposing close()) OR the client itself MUST expose close() — so the one-shot
// socket is always disposable after the single push (a heartbeat is a discrete publish,
// never a long-lived connection). Disposal below is robust to either shape and to odd
// shapes that satisfy neither (it simply has nothing to close).
export async function pushPresenceSignal(relayClient, envelope) {
  // UNCONFIGURED — no relay client to push to: SKIP (not attempted). The two-publish
  // path reads `pushed:false, skipped:true` to report "no push was attempted".
  if (relayClient == null) {
    return { pushed: false, skipped: true };
  }
  // CONFIGURED — attempt the push. connect() then push(envelope); a failure on either
  // throws OUT of here into the caller's catch (the best-effort wrapper). The disposable
  // handle returned by connect() is closed after the single push.
  const handle = await relayClient.connect();
  try {
    await relayClient.push(envelope);
  } finally {
    // Dispose the one-shot socket robustly (fix 1c): close the handle connect() returned
    // AND the client itself if it exposes close() — a heartbeat is a discrete publish, not
    // a long-lived connection, and an odd-shaped client/handle must never leak a socket.
    // Each close is independently guarded so a half-built or already-closing handle can
    // never mask the push outcome.
    if (handle && typeof handle.close === "function") {
      try { handle.close(); } catch (error) { /* handle already closing — nothing to dispose */
      reportDegrade("mesh-relay-client", error); }
    }
    if (typeof relayClient.close === "function") {
      try { relayClient.close(); } catch (error) { /* client already closing — nothing to dispose */
      reportDegrade("mesh-relay-client", error); }
    }
  }
  return { pushed: true, skipped: false };
}

// pushLeaseSignal(relayClient, envelope) — the lease-intent push (m26 / ADR-004.1): the
// SAME one-shot connect → push-one-frame → dispose seam, reused verbatim (the push logic
// is envelope-agnostic — it never reads envelope.kind, so the second kind rides the
// first kind's seam unchanged). Like its sibling it NEVER swallows the throw: a
// connect/push failure PROPAGATES to the caller's try/catch — the best-effort catch
// lives on the CLAIM path (src/commands/run-start.mjs), where fitness #9
// (acd-claim-relay-independent) reads it. A null/absent relayClient is the UNCONFIGURED
// case: skipped, never attempted.
export async function pushLeaseSignal(relayClient, envelope) {
  return pushPresenceSignal(relayClient, envelope);
}

// createRelayClient(config) → { connect, push, close } | null — the PRODUCTION node-side
// client, or null when the relay is UNCONFIGURED (no config.mesh.relay.url). The
// real-socket behaviour is exercised by the @manual fleet spike (task 02), NOT
// @executable CI — so this stays a thin seam. connect() opens a ws@8 socket to the
// configured url and resolves on the server's { type:'joined' } ack (the deterministic
// barrier story 01's broker sends); push(envelope) sends ONE JSON frame; close() disposes
// the socket. A connect/push error rejects (it is the caller's best-effort try/catch that
// swallows it — never here).
//
// THE { connect, push } CONTRACT pushPresenceSignal relies on: connect() MUST resolve to a
// CLOSABLE handle (an object with a close() method) OR the client itself MUST expose
// close() — so the one-shot socket is always disposable after the single push. This
// production client satisfies both (connect resolves the ws, which has close(); and the
// client exposes close()).
export function createRelayClient(config, { timeoutMs = 3000 } = {}) {
  const url = config?.mesh?.relay?.url;
  // UNCONFIGURED — no url to push to: return null so the publish path SKIPS the push
  // (not attempted), the clean degradation-to-git-only floor.
  if (typeof url !== "string" || url.length === 0) {
    return null;
  }

  let socket = null;
  // A post-ack transport fault (an error OR a clean close AFTER connect() resolved). The
  // join-ack `settled` guard correctly stops a post-ack fault from double-settling the
  // connect promise — but without this latch the fault is otherwise SWALLOWED, and a
  // subsequent push() would either hang or send into a dead socket. push() reads this so a
  // fault in the window before/during the send surfaces as a REJECT (caught by the
  // best-effort publish path), never a silently-dropped frame.
  let postAckFault = null;

  return {
    // Open the ws socket and resolve on the join ack (proof the peer is registered in the
    // broker's fan-out set — the same barrier the story-01 tests await). Rejects on a
    // socket error, a clean close BEFORE the ack, or an ack timeout; the caller's
    // try/catch swallows it.
    connect() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            try { ws.close(); } catch (error) { /* noop */
      reportDegrade("mesh-relay-client", error); }
            reject(new Error("relay connect: join-ack timeout"));
          }
        }, timeoutMs);
        ws.on("message", (data) => {
          let parsed = null;
          try { parsed = JSON.parse(data.toString()); } catch (error) { /* raw frame */
      reportDegrade("mesh-relay-client", error); }
          if (parsed && parsed.type === "joined" && !settled) {
            settled = true;
            clearTimeout(timer);
            socket = ws;
            resolve(ws);
          }
        });
        ws.on("error", (error) => {
          if (!settled) { settled = true; clearTimeout(timer); reject(error); return; }
          // POST-ACK error (fix 1a): connect() already resolved, so we must not re-settle
          // it — but the error must NOT be swallowed. Latch it so a subsequent push()
          // rejects with it (the best-effort failure the publish path catches) instead of
          // sending into a faulted socket.
          postAckFault = postAckFault ?? error;
        });
        // A clean socket close (fix 1b): if it fires BEFORE the join ack with NO `error`
        // event, the connect promise would otherwise wait the full timeoutMs before
        // rejecting. Reject immediately so a dead/misbehaving peer is detected at once.
        // A close AFTER the ack latches a post-ack fault so the next push() rejects.
        ws.on("close", () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error("relay connect: socket closed before the join ack"));
            return;
          }
          postAckFault = postAckFault ?? new Error("relay push: socket closed after the join ack");
        });
      });
    },

    // Push ONE JSON frame (story 01's frozen envelope). Rejects if a post-ack transport
    // fault was latched (fix 1a — surfaces as the best-effort failure the publish path
    // catches) or the socket is not open.
    push(envelope) {
      return new Promise((resolve, reject) => {
        if (postAckFault != null) {
          reject(postAckFault);
          return;
        }
        if (socket == null || socket.readyState !== WebSocket.OPEN) {
          reject(new Error("relay push: socket is not open"));
          return;
        }
        socket.send(JSON.stringify(envelope), (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },

    // Dispose the one-shot socket.
    close() {
      try { socket?.close(); } catch (error) { /* already closing */
      reportDegrade("mesh-relay-client", error); }
      socket = null;
    },
  };
}
