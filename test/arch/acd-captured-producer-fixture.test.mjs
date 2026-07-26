// Fitness function: acd-captured-producer-fixture (milestone 38 / ADR-008)
//
// THE INVARIANT (ADR-008). Wherever we do NOT own the producer — a vendor hook
// payload, an HTTP route, a CROSS-LANGUAGE surface — the contract test must be fed a
// REAL CAPTURED payload from that producer, and that captured fixture must still
// MATCH what the producer emits today. A fixture that drifts from its producer is a
// fixture that proves nothing.
//
// THIS FILE GUARDS THE CROSS-LANGUAGE SURFACE: the Rust desktop
// (app/desktop/crates/core/src/view_model.rs) structurally CANNOT import the JS
// projection (ui/src/fleet/runs.mjs) — the ADR-004 reconciliation rule therefore has
// TWO implementations (JS `fleetCurrentWorkLines`, Rust `current_work`). The binding
// discipline that replaces the (false) "both UIs call the same function" guarantee is:
// BOTH implementations are exercised against the SAME REAL CAPTURED producer payload.
//
// The suite DOES run the Rust tests (`cargo test (app/desktop)` — scripts/test.mjs).
// What cargo CANNOT do is the part that matters here: a Rust test can only check the
// Rust code against the fixture SITTING NEXT TO IT — it has no way to reach the JS
// producer, so a fixture that has drifted from what `aof` actually emits stays green
// forever (that is precisely how F7/F8 shipped). This arch-test closes that hole from
// the Node side: it asserts the Rust surface's captured fixtures are (a) genuinely
// captured, (b) still PRODUCER-SHAPED against a record the REAL producer assembles in
// this very test run, and (c) pinned to the SAME rendered line the JS projection
// derives from them — so the two implementations cannot silently drift apart.
//
// GROUNDED IN THE FINDINGS: F1 (JS fixture shaped to the consumer), F8 (the same
// defect in Rust), F7 (the desktop never read `sessions` at all — its fixtures never
// carried one, because they were hand-written), F4/F6/F9 (the same class at the hook
// payload, the HTTP route, and the mounted component).
//
// PROOFS (every detector is a PURE function over source text, so the real Rust source
// and the planted violations run through the IDENTICAL code path):
//  1. The fixtures EXIST and are genuinely captured — each `REAL_CAPTURED_*` const
//     carries capture PROVENANCE (a comment naming the real `aof …` command whose
//     verbatim stdout it is). A hand-authored fixture is a violation.
//  2. Each captured fixture is PRODUCER-SHAPED — compared field-by-field against a
//     presence record assembled by the REAL producer in this very test (not against a
//     hand-written expectation): the frozen five-key set/order on the node this build
//     produced, `activeRuns` a bare `string[]`, `sessions[i]` exactly the producer's
//     four keys. Producer changes shape + fixture not re-captured ⇒ CI fails.
//  3. CROSS-SURFACE AGREEMENT — the line the JS projection derives from each captured
//     payload is pinned VERBATIM as an asserted literal in the Rust surface. If either
//     implementation of the ADR-004 rule drifts, the literal no longer matches.
//  4. SELF-CHECK (non-vacuous) — a planted un-captured fixture (no provenance), a
//     planted producer-drifted fixture (object-shaped `activeRuns`, a 4-key presence,
//     an invented session field) and a planted drifted Rust render literal are each
//     FLAGGED by the same detectors that return zero violations for the real tree.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../src/work.mjs";
import { startLauncher } from "../../src/mesh-launcher.mjs";
import { startSession } from "../../src/mesh-session.mjs";
import { fleetCurrentWorkLines } from "../../ui/src/fleet/runs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
// The CROSS-LANGUAGE surface under this rule: the Rust desktop's view-model (the
// second implementation of ADR-004's reconciliation rule).
const RUST_VIEW_MODEL = "app/desktop/crates/core/src/view_model.rs";

const NODE_ID = "node-a";
const NOW = "2026-07-12T12:00:00.000Z";

// ─────────────────────────────────────────────────────────── detectors (pure) ──

// Every `REAL_CAPTURED_*` fixture const in a Rust source, with the contiguous comment
// block immediately above it (its capture provenance).
function capturedFixtures(source) {
  const fixtures = [];
  const re = /const\s+([A-Z0-9_]*REAL_CAPTURED[A-Z0-9_]*)\s*:\s*&str\s*=\s*r#"([\s\S]*?)"#;/g;
  for (const match of source.matchAll(re)) {
    const before = source.slice(0, match.index).split(/\r?\n/);
    const provenance = [];
    for (let i = before.length - 1; i >= 0; i -= 1) {
      const line = before[i].trim();
      if (line.startsWith("//")) provenance.unshift(line);
      else if (line === "") continue;
      else break;
    }
    fixtures.push({ name: match[1], raw: match[2], provenance: provenance.join("\n") });
  }
  return fixtures;
}

// PROOF 1 — a fixture must be CAPTURED from the real producer, and say how.
function provenanceViolations(fixtures) {
  const violations = [];
  for (const fixture of fixtures) {
    const said = /captur/i.test(fixture.provenance);
    const command = /\baof\s+[a-z][a-z-]*/.test(fixture.provenance);
    if (!said || !command) {
      violations.push(`${fixture.name}: no capture provenance — a cross-language fixture must record that it is REAL CAPTURED stdout and name the \`aof …\` command it came from (ADR-008)`);
    }
  }
  return violations;
}

// PROOF 2 — the fixture still matches what the producer emits TODAY. `producer` is a
// live record assembled by the real production seam in this test run.
function producerShapeViolations(fixtures, producer) {
  const violations = [];
  for (const fixture of fixtures) {
    let doc;
    try {
      doc = JSON.parse(fixture.raw);
    } catch (error) {
      violations.push(`${fixture.name}: not parseable as the producer's JSON stdout (${error.message})`);
      continue;
    }
    const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
    if (nodes.length === 0) {
      violations.push(`${fixture.name}: carries no nodes[] — this is not a real \`aof mesh status --json\` payload`);
      continue;
    }
    // The node THIS build produced (`local: true`) must carry the CURRENT producer's
    // exact record shape. (A peer node in a real capture may legitimately predate a
    // key — ADR-001's absent-is-benign additive evolution — so only element shape is
    // enforced there.)
    const local = nodes.find((node) => node.local === true);
    if (!local) {
      violations.push(`${fixture.name}: no \`local: true\` node — a real capture always names the machine it was taken on`);
      continue;
    }
    if (!local.presence || typeof local.presence !== "object") {
      violations.push(`${fixture.name}: the local node carries no presence record`);
      continue;
    }
    const keys = Object.keys(local.presence);
    if (JSON.stringify(keys) !== JSON.stringify(producer.presenceKeys)) {
      violations.push(`${fixture.name}: local presence keys ${JSON.stringify(keys)} have DRIFTED from the producer's ${JSON.stringify(producer.presenceKeys)} — re-capture the fixture`);
    }
    for (const node of nodes) {
      const presence = node.presence;
      if (!presence || typeof presence !== "object") continue;
      const runs = presence.activeRuns;
      if (runs !== undefined) {
        if (!Array.isArray(runs)) {
          violations.push(`${fixture.name}: ${node.nodeId}'s activeRuns is not an array`);
        } else {
          for (const run of runs) {
            if (typeof run !== "string") {
              violations.push(`${fixture.name}: ${node.nodeId}'s activeRuns carries a NON-STRING element ${JSON.stringify(run)} — the producer emits bare run-id strings (F1/F8)`);
            }
          }
        }
      }
      const sessions = presence.sessions;
      if (sessions !== undefined) {
        if (!Array.isArray(sessions)) {
          violations.push(`${fixture.name}: ${node.nodeId}'s sessions is not an array`);
        } else {
          for (const session of sessions) {
            const sessionKeys = Object.keys(session ?? {});
            if (JSON.stringify(sessionKeys) !== JSON.stringify(producer.sessionKeys)) {
              violations.push(`${fixture.name}: ${node.nodeId}'s session entry keys ${JSON.stringify(sessionKeys)} have DRIFTED from the producer's ${JSON.stringify(producer.sessionKeys)}`);
            }
          }
        }
      }
    }
  }
  return violations;
}

// The Rust string-literal form of a rendered line (`·` is written `\u{b7}` in the
// Rust source's escaped literals).
function rustLiteral(line) {
  return `"${line.replace(/·/g, "\\u{b7}")}"`;
}

// PROOF 3 — the OTHER implementation of the ADR-004 rule pins the SAME rendered line
// the JS implementation derives from the SAME captured payload.
function crossSurfaceDriftViolations(fixtures, rustSource) {
  const violations = [];
  for (const fixture of fixtures) {
    let doc;
    try {
      doc = JSON.parse(fixture.raw);
    } catch {
      continue; // already reported by producerShapeViolations
    }
    const local = (doc.nodes ?? []).find((node) => node.local === true);
    if (!local) continue;
    const lines = fleetCurrentWorkLines(local.presence ?? {}).lines;
    for (const line of lines) {
      if (!rustSource.includes(rustLiteral(line))) {
        violations.push(
          `${fixture.name}: the JS projection renders ${JSON.stringify(line)} for this captured payload, but the Rust surface pins no such assertion (${rustLiteral(line)}) — the two implementations of the ADR-004 rule have DRIFTED`,
        );
      }
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────── the real producer (proof 2) ─

function manualTicker() {
  return {
    start(intervalSeconds, onTick) {
      return { intervalSeconds, onTick, stopped: false };
    },
    stop(handle) {
      handle.stopped = true;
    },
  };
}

// Assemble a presence record through the REAL production seams (a real session record
// minted by `startSession`, aggregated + published by the launcher's
// `assembleCurrentPresenceRecord`) — the SAME code path that produced the captured
// fixtures' stdout. Its SHAPE is the yardstick every captured fixture is held to.
async function produceProducerShape() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-acd-captured-producer-"));
  const root = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId: NODE_ID, fabric: "tailscale", workspaceId: "ws-A" } }, null, 2)}\n`,
    "utf8",
  );
  const env = { AOF_GLOBAL_HOME: home };
  const ws = await loadWorkspace(root, undefined, { env });
  await startSession(ws, { nodeId: NODE_ID, workspaceId: "ws-A", repo: "aof", assistant: "claude-code", now: NOW });

  const handle = await startLauncher(ws, {
    exec: async () => ({ stdout: JSON.stringify({ BackendState: "Running", Self: { HostName: NODE_ID, DNSName: `${NODE_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true }, Peer: {} }), status: 0 }),
    platform: "linux",
    peerPollTicker: manualTicker(),
    propagationTicker: manualTicker(),
    streamServer: false,
    streamClient: false,
    now: () => NOW,
    globalWorkStoreOptions: { env },
  });
  handle.stop?.();
  const record = handle.record;
  await rm(tmp, { recursive: true, force: true });
  return {
    record,
    presenceKeys: Object.keys(record),
    sessionKeys: Object.keys(record.sessions[0] ?? {}),
  };
}

async function readRustSurface() {
  return readFile(path.join(REPO, RUST_VIEW_MODEL), "utf8");
}

export const archTests = [
  {
    name: "arch/38 ADR-008 (acd-captured-producer-fixture): the cross-language (Rust) surface tests against REAL CAPTURED producer payloads, each carrying capture provenance — a hand-authored fixture fails CI",
    run: async () => {
      const rust = await readRustSurface();
      const fixtures = capturedFixtures(rust);
      // Non-vacuity: the rule has something to govern. Deleting the captured fixtures
      // (the easiest way to "make the test pass") fails HERE.
      assert.ok(
        fixtures.length >= 2,
        `${RUST_VIEW_MODEL} must test the reconciliation rule against REAL CAPTURED producer payloads (found ${fixtures.length})`,
      );
      const violations = provenanceViolations(fixtures);
      assert.deepEqual(violations, [], `a cross-language fixture is not provably captured from the producer:\n${violations.join("\n")}`);
    },
  },

  {
    name: "arch/38 ADR-008 (acd-captured-producer-fixture): every captured fixture is still PRODUCER-SHAPED — compared against a record assembled by the REAL producer in this test (frozen five keys / string[] activeRuns / the producer's session keys), so a producer shape-change with a stale fixture fails CI",
    run: async () => {
      const producer = await produceProducerShape();
      assert.deepEqual(producer.presenceKeys, ["nodeId", "heartbeatAt", "activeRuns", "sessions", "aofVersion", "buildId"], "the producer's frozen record (the yardstick; buildId is the m42/item-1 sixth additive key)");
      assert.deepEqual(producer.sessionKeys, ["workspaceId", "repo", "assistant", "lastPingAt"], "the producer's session projection (the yardstick)");

      const rust = await readRustSurface();
      const fixtures = capturedFixtures(rust);
      const violations = producerShapeViolations(fixtures, producer);
      assert.deepEqual(violations, [], `a captured fixture has drifted from the producer:\n${violations.join("\n")}`);
    },
  },

  {
    name: "arch/38 ADR-008 (acd-captured-producer-fixture): the TWO implementations of the ADR-004 rule agree on the SAME captured payload — the JS projection's line is the exact literal the Rust surface pins (the discipline that replaces the false 'both UIs call one function' guarantee)",
    run: async () => {
      const rust = await readRustSurface();
      const fixtures = capturedFixtures(rust);
      const violations = crossSurfaceDriftViolations(fixtures, rust);
      assert.deepEqual(violations, [], `the JS and Rust implementations of the reconciliation rule disagree on a captured payload:\n${violations.join("\n")}`);

      // Non-vacuity: the captured payloads genuinely exercise the SESSION path (an
      // all-idle fixture set would make the agreement check trivially true).
      const working = fixtures.filter((fixture) => {
        const doc = JSON.parse(fixture.raw);
        const local = (doc.nodes ?? []).find((node) => node.local === true);
        return fleetCurrentWorkLines(local?.presence ?? {}).state === "working";
      });
      assert.ok(working.length >= 1, "at least one captured payload carries live work (a session), so the agreement assertion has teeth");
    },
  },

  {
    name: "arch/38 ADR-008 (acd-captured-producer-fixture): self-check — an un-captured fixture, a producer-drifted fixture (object-shaped activeRuns / 4-key presence / invented session key) and a drifted Rust render literal are each FLAGGED by the same detectors the real tree passes (non-vacuous)",
    run: async () => {
      const producer = {
        presenceKeys: ["nodeId", "heartbeatAt", "activeRuns", "sessions", "aofVersion", "buildId"],
        sessionKeys: ["workspaceId", "repo", "assistant", "lastPingAt"],
      };

      // ── planted: a HAND-AUTHORED fixture (no capture provenance) ─────────────
      const plantedHandAuthored = `
    // A handy fixture for the desktop tests.
    const REAL_CAPTURED_MADE_UP: &str = r#"{"nodes":[{"nodeId":"n1","local":true,"presence":{"nodeId":"n1","heartbeatAt":"${NOW}","activeRuns":[],"sessions":[],"aofVersion":"0.1.0","buildId":"source"}}],"boards":[],"isControlNode":true}"#;
`;
      const handAuthored = capturedFixtures(plantedHandAuthored);
      assert.equal(handAuthored.length, 1, "the planted fixture is seen by the extractor");
      assert.equal(provenanceViolations(handAuthored).length, 1, "a fixture with no capture provenance is flagged");
      // …and the REAL fixtures pass the SAME detector.
      const rust = await readRustSurface();
      const real = capturedFixtures(rust);
      assert.deepEqual(provenanceViolations(real), [], "the real captured fixtures carry provenance");

      // ── planted: PRODUCER DRIFT — the F8/F1 object-shaped run element ────────
      const driftedRuns = capturedFixtures(`
    // REAL — captured live via \`aof mesh status --json\`.
    const REAL_CAPTURED_DRIFTED_RUNS: &str = r#"{"nodes":[{"nodeId":"n1","local":true,"presence":{"nodeId":"n1","heartbeatAt":"${NOW}","activeRuns":[{"ref":"35/02","title":"UI"}],"sessions":[],"aofVersion":"0.1.0","buildId":"source"}}],"boards":[],"isControlNode":true}"#;
`);
      const runsViolations = producerShapeViolations(driftedRuns, producer);
      assert.equal(runsViolations.length, 1, `an object-shaped activeRuns element is flagged (got ${JSON.stringify(runsViolations)})`);

      // ── planted: PRODUCER DRIFT — a presence that predates the additive fifth
      //    key on the node THIS build produced (a stale, never-re-captured fixture) ─
      const driftedKeys = capturedFixtures(`
    // REAL — captured live via \`aof mesh status --json\`.
    const REAL_CAPTURED_STALE_SHAPE: &str = r#"{"nodes":[{"nodeId":"n1","local":true,"presence":{"nodeId":"n1","heartbeatAt":"${NOW}","activeRuns":[],"aofVersion":"0.1.0"}}],"boards":[],"isControlNode":true}"#;
`);
      assert.equal(producerShapeViolations(driftedKeys, producer).length, 1, "a stale (pre-sessions) local presence shape is flagged");

      // ── planted: PRODUCER DRIFT — an invented session field ──────────────────
      const driftedSession = capturedFixtures(`
    // REAL — captured live via \`aof mesh status --json\`.
    const REAL_CAPTURED_DRIFTED_SESSION: &str = r#"{"nodes":[{"nodeId":"n1","local":true,"presence":{"nodeId":"n1","heartbeatAt":"${NOW}","activeRuns":[],"sessions":[{"workspaceId":"ws-A","repo":"aof","assistant":"claude-code","lastPingAt":"${NOW}","ref":"38/00"}],"aofVersion":"0.1.0","buildId":"source"}}],"boards":[],"isControlNode":true}"#;
`);
      assert.equal(producerShapeViolations(driftedSession, producer).length, 1, "a session entry carrying a key the producer never emits is flagged");

      // ── planted: CROSS-SURFACE DRIFT — the Rust surface renders the same
      //    captured payload differently from the JS projection ───────────────────
      const driftedRust = rust.replaceAll("working \\u{b7} aof (session)", "working: aof [session]");
      assert.notEqual(driftedRust, rust, "the planted mutation genuinely changed the Rust surface's pinned literal");
      const driftViolations = crossSurfaceDriftViolations(real, driftedRust);
      assert.ok(driftViolations.length >= 1, `a drifted Rust render literal is flagged (got ${JSON.stringify(driftViolations)})`);
      // …and the REAL Rust surface passes the SAME detector.
      assert.deepEqual(crossSurfaceDriftViolations(real, rust), [], "the real Rust surface agrees with the JS projection on every captured payload");
    },
  },
];
