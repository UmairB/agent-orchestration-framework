// test/support/mesh-clone-credential-mint-fixture.mjs — shared fixture builder for
// milestone 38 / story 02 (clone-credential-mint) task traceability modules
// (tasks 01, 02, 04). Mirrors the story-01 support fixtures' shape
// (mesh-worker-clone-fixture.mjs, mesh-directive-channel-fixture.mjs): hermetic,
// injected-seam building blocks — a THROWAWAY (test-generated, never a real GitHub
// App's) RSA keypair for the REAL `node:crypto` JWT signer to sign with, a fake HTTP
// client that records every call + scripts its response, and the ROUND-TRIP driver
// that hands a captured up-frame to the REAL `applyCloneCredentialRequestFrame` and
// delivers its reply back onto the worker's fake transport — the SAME "real producer,
// never hand-authored" discipline story-01's own
// test/mesh-worker-clone-credential-pull.test.mjs keeps.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { applyCloneCredentialRequestFrame } from "../../src/control-stream-server.mjs";

// generateThrowawayKeypair() — a LOCAL, test-only RSA keypair (never a real GitHub
// App's registered key) — genuinely sufficient for the REAL default `node:crypto`
// RS256 signer to sign with, so "@executable signs via node:crypto" is a real
// assertion against production code, never a vacuous stand-in for it (no real
// network, no real App, no real key — ADR-010 §6.2's `@executable` discipline).
export function generateThrowawayKeypair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
}

// createFakeHttpRequest(responder) — the injected `httpRequest(url, init)` seam
// (mesh-clone-credential-provider.mjs's `createGithubAppMintProvider`). `responder`
// is `({ url, init }) => Promise<{ ok, status, json }>` (a fetch-`Response`-shaped
// fake) OR may itself throw/reject to simulate a network fault. Every call is
// recorded on the returned function's OWN `.calls` array (`{ url, init }`) so a test
// can assert call count/order/body without a real network.
export function createFakeHttpRequest(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return responder({ url, init, callIndex: calls.length - 1 });
  };
  fn.calls = calls;
  return fn;
}

// jsonResponse(status, body) — a minimal fetch-`Response`-shaped fake: `.ok` derived
// from `status`, `.json()` resolves the given body.
export function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// waitForFrame(transport, predicate, { timeoutMs }) — polls a REAL wall-clock bound
// (mirrors test/mesh-worker-clone-credential-pull.test.mjs's own helper, verbatim)
// until the LATEST frame on `transport` satisfies `predicate`, or gives up.
export async function waitForFrame(transport, predicate, { timeoutMs = 5000, pollMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const latest = transport.frames.at(-1);
    if (latest != null && predicate(latest)) return latest;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// driveCloneCredentialReply(...) — drives the REAL control-side
// applyCloneCredentialRequestFrame against the up-frame the worker's fake transport
// just captured, then hands the resulting down-frame back to the worker's transport
// exactly as a real ws "message" event would (mirrors story-01's own driver,
// verbatim) — the "real producer" for the control half of every round-trip test in
// this story's task 02/04 modules.
export async function driveCloneCredentialReply({ transport, targets, store, requesterNodeId, mintCloneCredential, now }) {
  const upFrame = await waitForFrame(transport, (f) => f.kind === "clone-credential-request");
  assert.ok(upFrame != null, "a clone-credential-request frame was sent within the wait bound");
  const applied = await applyCloneCredentialRequestFrame(store, upFrame, {
    nodeId: requesterNodeId,
    directiveTargets: targets,
    mintCloneCredential,
    now,
  });
  const socket = targets.get(requesterNodeId);
  const downFrame = socket?.frames?.at(-1) ?? null;
  if (downFrame != null) transport.deliver(downFrame);
  return { upFrame, downFrame, applied };
}
