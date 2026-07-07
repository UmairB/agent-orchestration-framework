// Traceability wiring for milestone 24 / story 01 — task 01 (tasks/01_device-code-flow
// .feature). The relay device-flow HTTP endpoint matches a presented code, consumes it
// single-use, admits the node + issues the credential, and bounds the 10^6 space with a
// TTL check + an attempt-cap.
//
// Covers EVERY @executable scenario / Scenario Outline row, driving the endpoint
// IN-PROCESS: the REAL serveRelay (src/mesh-relay.mjs) on an ephemeral port (port: 0)
// as the control node, a real HTTP POST to /enroll via fetch (the m23 in-process relay
// pattern), the group registry seeded via story 00's writeRegistry over a temp fixture.
// issuedAt / expiresAt and the endpoint's "now" are INJECTED (a mutable clock behind a
// () => iso seam — never wall-clock, 22/R2). codeHash + relayAuth are treated as OPAQUE
// (the crypto is the security fitness's) — asserted is the durable SHAPE + the
// observable admit/reject matrix. One test object per scenario / row group.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import {
  serveRelay,
  sha256Hex,
  resolveCodeTtlSeconds,
  resolveMaxAttempts,
  DEFAULT_CODE_TTL_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
} from "../src/mesh-relay.mjs";
import { writeRegistry, readRegistry } from "../src/mesh-registry.mjs";

const CONTROL_ID = "control-node-a";
const JOINER_ID = "joiner-node";
const CLOCK_START = "2026-07-01T10:00:00.000Z";

function controlConfig(extraMesh = {}) {
  return {
    mesh: {
      nodeId: CONTROL_ID,
      relay: { controlNode: CONTROL_ID },
      ...extraMesh,
    },
  };
}

// Merge enrollment knobs INTO the control config.
function configWithKnobs(knobs) {
  const base = controlConfig();
  base.mesh.enrollment = { ...(base.mesh.enrollment ?? {}), ...knobs };
  return base;
}

async function makeWorkspace() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-meshenroll-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, workspace: { workDir } };
}

// A pending invite for a plaintext code — hashed through the SAME seam the endpoint
// matches through (sha256Hex), so the hash value stays opaque to the assertions.
function inviteFor(plain, { issuedAt = CLOCK_START, expiresAt, consumedAt = null } = {}) {
  return {
    codeHash: sha256Hex(plain),
    issuedAt,
    expiresAt: expiresAt ?? new Date(Date.parse(issuedAt) + 300 * 1000).toISOString(),
    consumedAt,
  };
}

// Stand a control-node relay over a seeded registry with an injected mutable clock.
// Returns { relay, base, workspace, repo, setClock, config }.
async function standRelay({ pending = [], config = controlConfig(), roster = [] } = {}) {
  const { repo, workspace } = await makeWorkspace();
  const registry = { roster, boards: [], pending, revocations: [] };
  await writeRegistry(workspace, registry, config);
  let clock = CLOCK_START;
  const relay = await serveRelay({ port: 0, config, workspace, now: () => clock });
  const base = `http://${new URL(relay.url).host}`;
  return {
    relay,
    base,
    workspace,
    repo,
    config,
    setClock: (iso) => { clock = iso; },
  };
}

// POST a presentation to /enroll. `body` may be an object (JSON-encoded) or a raw
// string (the malformed rows). Returns { status, payload }.
async function postEnroll(base, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const response = await fetch(`${base}/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

// The m23 join-ack ws harness (the deterministic barrier — a peer is provably in the
// fan-out set before the sender publishes).
function connectWs(url, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("join-ack timeout")); }
    }, timeoutMs);
    ws.on("message", (data) => {
      const text = data.toString();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* raw */ }
      if (parsed && parsed.type === "joined" && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ws, frames });
        return;
      }
      frames.push({ text, parsed });
    });
    ws.on("error", (error) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(error); }
    });
  });
}

function waitFor(predicate, { timeoutMs = 1500, label = "condition" } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = predicate(); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`waitFor(${label}) timeout`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

export const meshEnrollDeviceFlowTests = [
  // ══ Scenario: a good live code matches — the node is admitted, a credential is
  //    issued, and the invite is consumed ═══════════════════════════════════════════
  {
    name: "mesh-enroll-flow/01 a good live code admits the node (roster append), issues { relayAuth, nodeId }, consumes the matched invite, and leaves every other pending invite byte-unchanged",
    async run() {
      const target = "123456";
      const otherA = inviteFor("111111");
      const otherB = inviteFor("222222");
      const stand = await standRelay({ pending: [otherA, inviteFor(target), otherB] });
      try {
        const { status, payload } = await postEnroll(stand.base, { code: target, nodeId: JOINER_ID });

        // A structured HTTP success carrying the credential { relayAuth, nodeId }.
        assert.equal(status, 200, "the response is a structured HTTP success");
        assert.equal(payload.ok, true, "the success envelope is structured (ok: true)");
        assert.equal(typeof payload.credential.relayAuth, "string", "the credential carries a relayAuth token");
        assert.ok(payload.credential.relayAuth.length > 0, "relayAuth is non-empty");
        assert.equal(payload.credential.nodeId, JOINER_ID, "the credential carries the stream identity (the joining nodeId)");
        assert.equal("gitRemote" in payload.credential, false, "the credential carries no repository grant; mesh sync is websocket-only");

        const after = await readRegistry(stand.workspace);
        // Admitted exactly once — { nodeId, admittedAt, boards } (+ the verifiable hash half).
        assert.equal(after.roster.length, 1, "the joining node is appended to the roster exactly once");
        const entry = after.roster[0];
        assert.equal(entry.nodeId, JOINER_ID, "the roster entry names the joining node");
        assert.equal(entry.admittedAt, CLOCK_START, "admittedAt is the injected now");
        assert.deepEqual(entry.boards, [], "the roster entry carries its boards list");
        // The roster stores the VERIFIABLE half of the credential — a hash of the
        // token, never the token itself (story 02's auth-gate data source).
        assert.equal(entry.relayAuthHash, sha256Hex(payload.credential.relayAuth), "the roster carries relayAuthHash — the hash of the issued token");
        assert.notEqual(entry.relayAuthHash, payload.credential.relayAuth, "the plaintext relayAuth token is NOT at rest");
        assert.ok(!JSON.stringify(after).includes(payload.credential.relayAuth), "the registry nowhere contains the plaintext token");

        // The matched invite is consumed (single-use); the OTHERS are byte-unchanged.
        const consumed = after.pending[1];
        assert.equal(consumed.consumedAt, CLOCK_START, "the matched invite is consumed (consumedAt stamped at the injected now)");
        assert.equal(JSON.stringify(after.pending[0]), JSON.stringify(otherA), "the first unmatched invite is byte-unchanged");
        assert.equal(JSON.stringify(after.pending[2]), JSON.stringify(otherB), "the second unmatched invite is byte-unchanged");
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: the reject matrix — expired / consumed / malformed / unknown
  //    are structured rejections that admit nothing ═════════════════════════════════
  {
    name: "mesh-enroll-flow/01 the reject matrix — expired / consumed / unknown / malformed / empty each answer a structured rejection (never a throw) that admits nothing, issues nothing, and consumes nothing",
    async run() {
      const target = "123456";
      const rows = [
        {
          label: "a code whose invite has expired (now > expiresAt)",
          pending: () => [inviteFor(target, { expiresAt: CLOCK_START })],
          clock: "2026-07-01T10:00:00.001Z", // strictly after expiresAt
          body: { code: target, nodeId: JOINER_ID },
          outcome: "expired",
        },
        {
          label: "a code whose invite was already consumed",
          pending: () => [inviteFor(target, { consumedAt: "2026-07-01T09:59:00.000Z" })],
          clock: CLOCK_START,
          body: { code: target, nodeId: JOINER_ID },
          outcome: "consumed",
        },
        {
          label: "an unknown code matching no pending invite",
          pending: () => [inviteFor(target)],
          clock: CLOCK_START,
          body: { code: "654321", nodeId: JOINER_ID },
          outcome: "no-match",
        },
        {
          label: "a malformed request body (not a valid code)",
          pending: () => [inviteFor(target)],
          clock: CLOCK_START,
          body: "this is not a json envelope {{{",
          outcome: "malformed",
        },
        {
          label: "an empty request body",
          pending: () => [inviteFor(target)],
          clock: CLOCK_START,
          body: "",
          outcome: "malformed",
        },
      ];

      for (const row of rows) {
        const seededPending = row.pending();
        const stand = await standRelay({ pending: seededPending });
        try {
          stand.setClock(row.clock);
          const before = await readRegistry(stand.workspace);

          const { status, payload } = await postEnroll(stand.base, row.body);

          // A structured HTTP rejection, not a thrown error.
          assert.ok(status >= 400 && status < 500, `[${row.label}] the rejection is a structured 4xx (got ${status})`);
          assert.equal(payload.ok, false, `[${row.label}] the rejection envelope is structured (ok: false)`);
          assert.equal(payload.reason, row.outcome, `[${row.label}] the rejection class is "${row.outcome}"`);
          // No admission, no credential, no consume.
          assert.equal(payload.credential, undefined, `[${row.label}] no credential was issued`);
          const after = await readRegistry(stand.workspace);
          assert.equal(JSON.stringify(after.roster), JSON.stringify(before.roster), `[${row.label}] the roster is byte-unchanged (nothing admitted)`);
          assert.equal(JSON.stringify(after.pending), JSON.stringify(before.pending), `[${row.label}] no pending invite was consumed by the rejected presentation`);

          // The process did not crash — the endpoint still ANSWERS a follow-up
          // presentation with a structured response.
          const probe = await postEnroll(stand.base, { code: "000000", nodeId: JOINER_ID });
          assert.ok(probe.status >= 400, `[${row.label}] the endpoint is still answering after the rejection (no crash)`);
          assert.equal(probe.payload.ok, false, `[${row.label}] the follow-up answer is structured`);
        } finally {
          await stand.relay.stop();
          await rm(stand.repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: the attempt-cap refuses further presentations after
  //    resolveMaxAttempts failures within the TTL (1/4/5 answered; 6/7 refused) ══════
  {
    name: "mesh-enroll-flow/01 the attempt-cap N-boundary — failed presentations 1..5 are answered as normal rejects, the 6th and 7th are refused with a structured 429-class attempt-cap rejection",
    async run() {
      const stand = await standRelay({ pending: [inviteFor("123456")] });
      try {
        assert.equal(resolveMaxAttempts(stand.config), 5, "resolveMaxAttempts(config) is 5 (the documented default)");
        for (let attempt = 1; attempt <= 7; attempt += 1) {
          // A failed presentation for a code the attacker does not know, within the TTL.
          const { status, payload } = await postEnroll(stand.base, { code: "000000", nodeId: "attacker-node" });
          if (attempt <= 5) {
            // The 1st..5th failed presentation is STILL ANSWERED (a normal reject).
            assert.equal(status, 404, `attempt ${attempt} is answered as a normal reject (within the attempt budget)`);
            assert.equal(payload.reason, "no-match", `attempt ${attempt} carries the normal no-match class, not the cap`);
          } else {
            // The 6th (N+1) and beyond are REFUSED by the cap — a structured 429.
            assert.equal(status, 429, `attempt ${attempt} is refused by the attempt-cap (a structured 429-class rejection)`);
            assert.equal(payload.reason, "attempt-cap", `attempt ${attempt} names the attempt-cap class`);
          }
          assert.equal(payload.ok, false, `attempt ${attempt} is a structured rejection either way`);
        }
        // Nothing was admitted by the walk.
        const after = await readRegistry(stand.workspace);
        assert.deepEqual(after.roster, [], "the walked endpoint admitted nothing");
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a successful match after some failed-but-in-budget attempts still
  //    admits and retires the bucket ════════════════════════════════════════════════
  {
    name: "mesh-enroll-flow/01 after 4 failed-but-in-budget presentations the correct code (the 5th) still admits, issues, and consumes — the bucket is retired by the successful match",
    async run() {
      const target = "123456";
      const stand = await standRelay({ pending: [inviteFor(target)] });
      try {
        for (let i = 0; i < 4; i += 1) {
          const failed = await postEnroll(stand.base, { code: "000000", nodeId: JOINER_ID });
          assert.equal(failed.status, 404, `failed presentation ${i + 1} is answered (in budget)`);
        }
        // The failed attempts did NOT admit.
        let registry = await readRegistry(stand.workspace);
        assert.deepEqual(registry.roster, [], "the 4 failed presentations admitted nothing");

        // The 5th presentation — the correct code, in budget — still admits.
        const { status, payload } = await postEnroll(stand.base, { code: target, nodeId: JOINER_ID });
        assert.equal(status, 200, "the correct 5th presentation admits (the bucket did not poison the good code)");
        assert.equal(typeof payload.credential.relayAuth, "string", "a credential is issued");
        registry = await readRegistry(stand.workspace);
        assert.equal(registry.roster.length, 1, "the node is admitted");
        assert.equal(registry.pending[0].consumedAt, CLOCK_START, "the matched invite is consumed — the code is burned, the successful path closes the window");
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: a malformed enrollment knob falls back to the documented
  //    default without crashing (absent / NaN / 0 / -1 / non-integer / null) ═════════
  {
    name: "mesh-enroll-flow/01 malformed enrollment knobs (absent / non-number / 0 / -1 / non-integer / null) fall back to ttl=300 + cap=5 without crashing, and a live code still admits on the defaults",
    async run() {
      const rows = [
        { label: "absent (unset)", ttl: undefined, cap: undefined },
        { label: '"not-a-number"', ttl: "not-a-number", cap: "not-a-number" },
        { label: "0", ttl: 0, cap: 0 },
        { label: "-1", ttl: -1, cap: -1 },
        { label: "300.5 / 5.5", ttl: 300.5, cap: 5.5 },
        { label: "null", ttl: null, cap: null },
      ];
      const target = "123456";
      for (const row of rows) {
        const knobs = row.ttl === undefined ? {} : { codeTtlSeconds: row.ttl, maxAttempts: row.cap };
        const config = configWithKnobs(knobs);
        // The resolvers fall back to the documented defaults.
        assert.equal(resolveCodeTtlSeconds(config), DEFAULT_CODE_TTL_SECONDS, `[${row.label}] the ttl in force is the documented default 300 seconds`);
        assert.equal(resolveMaxAttempts(config), DEFAULT_MAX_ATTEMPTS, `[${row.label}] the attempt-cap in force is the documented default 5`);

        // No error is raised — the endpoint stands and a live code still admits.
        const stand = await standRelay({ pending: [inviteFor(target)], config });
        try {
          const { status, payload } = await postEnroll(stand.base, { code: target, nodeId: JOINER_ID });
          assert.equal(status, 200, `[${row.label}] the live code still admits (the endpoint functions on the defaults)`);
          assert.equal(payload.ok, true, `[${row.label}] the admit is structured`);
        } finally {
          await stand.relay.stop();
          await rm(stand.repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: admission requires the control node's relay online — there is no
  //    offline verification path ════════════════════════════════════════════════════
  {
    name: "mesh-enroll-flow/01 with the control node's relay down the presentation cannot be answered — the endpoint is unreachable and no node is admitted",
    async run() {
      const target = "123456";
      const stand = await standRelay({ pending: [inviteFor(target)] });
      const { base, workspace, repo } = stand;
      try {
        // Take the relay DOWN — serveRelay is stopped; nothing else can answer.
        await stand.relay.stop();

        // The presentation cannot be answered (connection refused — no offline path).
        await assert.rejects(
          () => fetch(`${base}/enroll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: target, nodeId: JOINER_ID }),
          }),
          "the endpoint is unreachable with serveRelay down"
        );

        // No node was admitted (admission requires the live control node).
        const after = await readRegistry(workspace);
        assert.deepEqual(after.roster, [], "no node is admitted while the control node's relay is down");
        assert.equal(after.pending[0].consumedAt, null, "the invite is untouched — nothing verified it offline");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a device-flow POST is answered over HTTP and the ws envelope is
  //    untouched ════════════════════════════════════════════════════════════════════
  {
    name: "mesh-enroll-flow/01 the enroll exchange is answered over HTTP while a ws signal frame still fans out byte-identical — the enrollment route left the ws path neutral",
    async run() {
      const stand = await standRelay({ pending: [inviteFor("123456")] });
      let sender = null;
      let peer = null;
      try {
        // The enrollment exchange is answered over HTTP (a structured HTTP response,
        // not a ws frame).
        const { status, payload } = await postEnroll(stand.base, { code: "999999", nodeId: JOINER_ID });
        assert.ok(status >= 400, "the enroll POST is answered over HTTP with a status");
        assert.equal(payload.ok, false, "the enroll answer is a structured HTTP JSON document");

        // The ws { kind, nodeId, signal } envelope is untouched: a signal frame still
        // fans out to peers exactly as m23 pins it.
        sender = await connectWs(stand.relay.url);
        peer = await connectWs(stand.relay.url);
        const frame = JSON.stringify({ kind: "presence", nodeId: "node-x", signal: { heartbeatAt: CLOCK_START } });
        sender.ws.send(frame);
        await waitFor(() => peer.frames.length >= 1, { label: "peer received the fan-out" });
        assert.equal(peer.frames[0].text, frame, "the ws signal frame fans out byte-identical (the enrollment route did not perturb the ws path)");
        assert.equal(peer.frames[0].parsed.kind, "presence", "the envelope carries its own kind — no enrollment kind rides the ws envelope");
        assert.equal(peer.frames.length, 1, "no extra (enrollment) ws frame arrived");
      } finally {
        try { sender?.ws?.close(); } catch { /* noop */ }
        try { peer?.ws?.close(); } catch { /* noop */ }
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────────
  // Coverage-hardening rows (aof-qa behavioural review, story 01): behaviours the CODE
  // gets right but nothing pinned — each would let a real regression ship green.
  // ─────────────────────────────────────────────────────────────────────────────────

  // ══ (QA-1) The TTL boundary is STRICT `>`: a code presented at EXACTLY its expiresAt
  //    still admits — the complement of the reject-matrix "expired" row (now = exp+1ms).
  //    Without this a `>=` regression (wrongly expiring a code at its exact expiry
  //    instant, the m20 strict-> discipline ADR-005 calls load-bearing) stays green. ══
  {
    name: "mesh-enroll-flow/01 the TTL boundary is strict > — a code presented at EXACTLY its expiresAt (now == expiresAt) still admits, not expired",
    async run() {
      const target = "123456";
      const stand = await standRelay({ pending: [inviteFor(target, { expiresAt: CLOCK_START })] });
      try {
        stand.setClock(CLOCK_START); // now === expiresAt — the load-bearing boundary
        const { status, payload } = await postEnroll(stand.base, { code: target, nodeId: JOINER_ID });
        assert.equal(status, 200, "a code presented at EXACTLY expiresAt still admits (strict >, not >=)");
        assert.equal(payload.ok, true, "the boundary admit is structured");
        const after = await readRegistry(stand.workspace);
        assert.equal(after.roster.length, 1, "the boundary presentation admitted the node");
        assert.equal(after.pending[0].consumedAt, CLOCK_START, "the at-boundary invite is consumed (it was presentable)");
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ (QA-2) The attempt-window RESETS after the TTL lapses: a source capped within one
  //    window is answered again once `now` advances past codeTtlSeconds (the bucket is
  //    anchored at its first failure and lapses). The whole reset branch was untested. ══
  {
    name: "mesh-enroll-flow/01 the attempt-window resets after the TTL lapses — a source capped within a window is answered again once now advances past codeTtlSeconds",
    async run() {
      const stand = await standRelay({ pending: [inviteFor("123456")] });
      try {
        // Cap the source at CLOCK_START (5 fails answered, the 6th refused).
        for (let a = 1; a <= 6; a += 1) {
          const r = await postEnroll(stand.base, { code: "000000", nodeId: "attacker-node" });
          if (a <= 5) assert.equal(r.status, 404, `attempt ${a} answered (in budget)`);
          else assert.equal(r.status, 429, "the 6th attempt is cap-refused");
        }
        // Advance `now` beyond the default 300s window — the stale bucket lapses.
        stand.setClock("2026-07-01T10:06:00.000Z"); // +360s > codeTtlSeconds (300)
        const reset = await postEnroll(stand.base, { code: "000000", nodeId: "attacker-node" });
        assert.equal(reset.status, 404, "after the TTL window lapses the source's attempt bucket resets — a failed presentation is answered again, not cap-refused");
        assert.equal(reset.payload.reason, "no-match", "the reset presentation is a normal reject, not the attempt-cap");
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ (QA-3) A MALFORMED presentation debits the SAME per-source attempt budget (a
  //    malformed flood is still a flood — SECURITY T7). Proven hard: after 5 malformed
  //    bodies even a well-formed GOOD code is cap-refused (the cap short-circuits before
  //    matching), so a regression that stopped counting malformed presentations reds. ══
  {
    name: "mesh-enroll-flow/01 a malformed body debits the per-source attempt budget — 5 malformed presentations exhaust the cap and the 6th (even a good code) is cap-refused before matching",
    async run() {
      const stand = await standRelay({ pending: [inviteFor("123456")] });
      try {
        for (let a = 1; a <= 5; a += 1) {
          const r = await postEnroll(stand.base, "not a json envelope {{{");
          assert.equal(r.status, 400, `malformed presentation ${a} is answered (in budget)`);
          assert.equal(r.payload.reason, "malformed", `malformed presentation ${a} is the malformed class`);
        }
        // The 6th — a well-formed GOOD code — is cap-refused: the malformed flood debited
        // the same per-source budget, and the cap short-circuits before matching.
        const sixth = await postEnroll(stand.base, { code: "123456", nodeId: JOINER_ID });
        assert.equal(sixth.status, 429, "the 6th presentation is cap-refused — malformed bodies debit the attempt budget");
        assert.equal(sixth.payload.reason, "attempt-cap", "the 6th names the attempt-cap class");
        const after = await readRegistry(stand.workspace);
        assert.deepEqual(after.roster, [], "the good code arriving after the cap admitted nothing (the cap refuses before matching)");
        assert.equal(after.pending[0].consumedAt, null, "the good invite is untouched — the cap refused before the match/consume");
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ (QA-5) The cap buckets per SOURCE, not per code: 5 DISTINCT wrong codes from one
  //    source cap it — a per-code cap would never stop an attacker walking many codes.
  //    This is the assertion that actually pins the 10^6-walk brake (SECURITY T2/T7). ══
  {
    name: "mesh-enroll-flow/01 the attempt-cap buckets per SOURCE (not per code) — 5 DISTINCT wrong codes from one source cap it, defeating the enumeration walk a per-code cap would miss",
    async run() {
      const stand = await standRelay({ pending: [inviteFor("123456")] });
      try {
        const distinctWrong = ["000001", "000002", "000003", "000004", "000005"];
        for (const wrong of distinctWrong) {
          const r = await postEnroll(stand.base, { code: wrong, nodeId: "attacker-node" });
          assert.equal(r.status, 404, `distinct wrong code ${wrong} is answered (in budget)`);
          assert.equal(r.payload.reason, "no-match", `distinct wrong code ${wrong} is a normal no-match`);
        }
        // A 6th DISTINCT wrong code from the SAME source is cap-refused — proving the
        // bucket is per-source (the enumeration brake), not per-code.
        const sixth = await postEnroll(stand.base, { code: "000006", nodeId: "attacker-node" });
        assert.equal(sixth.status, 429, "a 6th DISTINCT wrong code from the same source is cap-refused — the cap buckets per source, braking the 10^6 walk");
        assert.equal(sixth.payload.reason, "attempt-cap", "the 6th names the attempt-cap class");
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ (QA-4) A leading-zero 6-digit code round-trips (present → match → admit) with its
  //    zeros intact — a numeric coercion anywhere on the code path would drop them. ══
  {
    name: "mesh-enroll-flow/01 a leading-zero 6-digit code (000042) matches + admits — no numeric coercion drops the leading zeros on the match path",
    async run() {
      const target = "000042"; // leading zeros — a numeric coercion would mangle this
      const stand = await standRelay({ pending: [inviteFor(target)] });
      try {
        const { status, payload } = await postEnroll(stand.base, { code: target, nodeId: JOINER_ID });
        assert.equal(status, 200, "a leading-zero 6-digit code matches + admits (its zeros survived the round-trip)");
        assert.equal(typeof payload.credential.relayAuth, "string", "a credential is issued for the leading-zero code");
        const after = await readRegistry(stand.workspace);
        assert.equal(after.roster.length, 1, "the leading-zero presentation admitted the node");
        assert.equal(after.pending[0].consumedAt, CLOCK_START, "the leading-zero invite is consumed");
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ (QA-6) The endpoint's own admission authority guard: a relay that is UP but is NOT
  //    the nominated control node refuses admission with a structured 503 not-control-node
  //    and admits/consumes nothing — a distinct rejection class from the relay being down. ══
  {
    name: "mesh-enroll-flow/01 a relay that is up but NOT the enrollment authority refuses a good code with 503 not-control-node, admitting and consuming nothing",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      // Seed the registry AS the control node (so a pending invite exists to match).
      const controlCfg = controlConfig();
      await writeRegistry(workspace, { roster: [], boards: [], pending: [inviteFor("123456")], revocations: [] }, controlCfg);
      // Stand the relay as a NON-authority node (nodeId !== relay.controlNode): the /enroll
      // route serves, but admission's writeRegistry refuses off the control node.
      const nonAuthorityCfg = {
        mesh: {
          nodeId: "not-the-authority-node",
          relay: { controlNode: CONTROL_ID },
        },
      };
      const relay = await serveRelay({ port: 0, config: nonAuthorityCfg, workspace, now: () => CLOCK_START });
      const base = `http://${new URL(relay.url).host}`;
      try {
        const before = await readRegistry(workspace);
        const { status, payload } = await postEnroll(base, { code: "123456", nodeId: JOINER_ID });
        assert.equal(status, 503, "a relay that is not the enrollment authority refuses admission (503)");
        assert.equal(payload.ok, false, "the refusal is structured");
        assert.equal(payload.reason, "not-control-node", "the refusal names the not-control-node class (distinct from the relay being down)");
        const after = await readRegistry(workspace);
        assert.equal(JSON.stringify(after.roster), JSON.stringify(before.roster), "no node was admitted off the control node");
        assert.equal(after.pending[0].consumedAt, null, "the invite was not consumed off the control node");
      } finally {
        await relay.stop();
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
