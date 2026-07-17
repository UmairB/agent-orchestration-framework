// test/mesh-clone-credential-mint-failure-loud.test.mjs — traceability for milestone
// 38 / story 02, task 04 (04_mint-failure-loud-no-fallback.feature, ADR-010 decision
// 5, SECURITY T10). Every @executable Scenario Outline row is driven through the REAL
// producer chain: createGithubAppMintProvider (src/mesh-clone-credential-provider.mjs)
// scripted to fault at a different step per row, minting through the REAL
// createMeshWorkerExecutionHandler / cloneRepoForWorkspace (worker side) and the REAL
// applyCloneCredentialRequestFrame (control side, src/control-stream-server.mjs) —
// never a hand-authored stand-in for either half.
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import {
  applyCloneCredentialRequestFrame,
  CLONE_CREDENTIAL_MINT_FAILED,
} from "../src/control-stream-server.mjs";
import { createGithubAppMintProvider } from "../src/mesh-clone-credential-provider.mjs";
import { createMeshWorkerExecutionHandler, meshCheckoutPath } from "../src/mesh-worker-execution.mjs";
import { createWorkerStreamClient } from "../src/worker-stream-client.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { createDirectiveChannelFixture, createFakeWorkerTransport } from "./support/mesh-directive-channel-fixture.mjs";
import { seedAssignment } from "./support/mesh-assign-fixture.mjs";
import { withMeshCloneFixture, createStatusRecorder, createRecordingCloneExec } from "./support/mesh-worker-clone-fixture.mjs";
import { generateThrowawayKeypair, createFakeHttpRequest, jsonResponse, driveCloneCredentialReply } from "./support/mesh-clone-credential-mint-fixture.mjs";

const NOW = "2026-07-14T09:00:00.000Z";
const CLONE_URL = "https://git.example.com/acme/secret.git";

async function pathExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

// buildFaultyMint(fault) — the FIVE `github-app` provider faults the Scenario
// Outline names, each a REAL provider instance (createGithubAppMintProvider) scripted
// to fault at a DIFFERENT step, never a hand-thrown stand-in error.
function buildFaultyMint(fault) {
  const { privateKey } = generateThrowawayKeypair();
  const base = { appId: "app-1", resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git" };
  if (fault === "app-not-installed") {
    const httpRequest = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(404, { message: "Not Found" }) : jsonResponse(201, { token: "SHOULD-NEVER-MINT" })));
    return createGithubAppMintProvider({ ...base, privateKey, httpRequest });
  }
  if (fault === "bad-key") {
    // A genuinely INVALID key (not PEM at all) — the REAL default node:crypto signer
    // throws synchronously on `createSign(...).sign(...)`. No HTTP call is ever reached.
    const httpRequest = createFakeHttpRequest(async () => { throw new Error("must never be called — signing should fail first"); });
    return createGithubAppMintProvider({ ...base, privateKey: "not-a-real-private-key", httpRequest });
  }
  if (fault === "unreachable") {
    const httpRequest = createFakeHttpRequest(async () => { throw new TypeError("fetch failed: network unreachable"); });
    return createGithubAppMintProvider({ ...base, privateKey, httpRequest });
  }
  if (fault === "permission-denied") {
    const httpRequest = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 1 }) : jsonResponse(403, { message: "Resource not accessible by integration" })));
    return createGithubAppMintProvider({ ...base, privateKey, httpRequest });
  }
  if (fault === "blank-token") {
    const httpRequest = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 1 }) : jsonResponse(201, { token: "" })));
    return createGithubAppMintProvider({ ...base, privateKey, httpRequest });
  }
  throw new Error(`unknown fault ${fault}`);
}

const FAULT_ROWS = [
  { fault: "app-not-installed", label: "the App is not installed on the repo (GET installation 404)" },
  { fault: "bad-key", label: "the app private key is invalid (JWT signing/exchange 401)" },
  { fault: "unreachable", label: "the GitHub API is unreachable (network error)" },
  { fault: "permission-denied", label: "the token exchange is permission-denied (403)" },
  { fault: "blank-token", label: "the exchange returns a blank/absent token" },
];

// driveFaultThroughHandler(fault) — the SHARED round-trip: a genuine clone-miss
// directive handled by the REAL worker execution handler, which pulls a credential
// over the ALREADY-OPEN stream; control's REAL applyCloneCredentialRequestFrame mints
// with the FAULTY provider and (via the existing try/catch) replies with the coded
// `clone-credential-mint-failed`; the handler surfaces the worker's loud coded
// `assignment-repo-unavailable`, attempting NO clone exec call.
async function driveFaultThroughHandler(fault) {
  return withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
    const assignmentId = `asg-04-${fault}`;
    await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
      assignmentId, itemRef, workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
    });

    const transport = createFakeWorkerTransport();
    const channel = createDirectiveChannelFixture();
    channel.connectWorker("worker-a");
    const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, cloneCredentialTimeoutMs: 5000 });

    const status = createStatusRecorder();
    const cloneExec = createRecordingCloneExec();
    const handler = createMeshWorkerExecutionHandler({
      loadWs: () => Promise.resolve(workspace),
      nodeId: "worker-a",
      sendAssignmentStatus: status.sendAssignmentStatus,
      requestCloneCredential: (request) => client.requestCloneCredential(request),
      cloneExec: cloneExec.exec,
      globalWorkStoreOptions: { env },
    });

    const mintCloneCredential = buildFaultyMint(fault);
    const handlerPromise = handler({ assignmentId, itemRef, workspaceId });
    const store = await openGlobalWorkProjectionStore({ env });
    let downFrame;
    try {
      ({ downFrame } = await driveCloneCredentialReply({
        transport,
        targets: channel.targets,
        store,
        requesterNodeId: "worker-a",
        mintCloneCredential,
        now: NOW,
      }));
    } finally {
      store.close();
    }
    await handlerPromise;

    return { status, cloneExec, downFrame, workspaceId, env };
  }, { cloneUrl: CLONE_URL });
}

export const meshCloneCredentialMintFailureLoudTests = [
  // ------------------------------------------------------------------
  // Scenario Outline: every mint fault is a loud coded refusal, never a silent success
  // ------------------------------------------------------------------
  {
    name: "task04/38 mint-failure-loud-no-fallback: Examples — every github-app mint fault THROWS -> control replies clone-credential-mint-failed -> the worker surfaces assignment-repo-unavailable; NO clone is attempted, no partial checkout, and the env-token provider is never consulted as a fallback",
    run: async () => {
      // F-QA3 — "the env-token provider is NOT consulted as a fallback" was previously
      // proved VACUOUSLY: AOF_MESH_CLONE_TOKEN was never set, so even a REGRESSED
      // fallback to the env-token provider would have found no token and produced no
      // clone either — indistinguishable from correct behaviour. For ONE row (the
      // first), set AOF_MESH_CLONE_TOKEN to a DISTINCTIVE sentinel value (restored in
      // `finally`) — if a fallback existed, it would clone WITH this sentinel, which
      // would show up both as a non-empty cloneExec.calls AND the sentinel appearing in
      // one of those calls' argv/env; asserting BOTH the zero-calls invariant and the
      // sentinel's absence makes the "no fallback" claim genuinely non-vacuous.
      const SENTINEL_FAULT = FAULT_ROWS[0].fault;
      const SENTINEL_TOKEN = "SENTINEL-AOF_MESH_CLONE_TOKEN-must-never-be-used-abc123";

      for (const { fault, label } of FAULT_ROWS) {
        const useSentinel = fault === SENTINEL_FAULT;
        const prevToken = process.env.AOF_MESH_CLONE_TOKEN;
        if (useSentinel) process.env.AOF_MESH_CLONE_TOKEN = SENTINEL_TOKEN;
        let result;
        try {
          result = await driveFaultThroughHandler(fault);
        } finally {
          if (useSentinel) {
            if (prevToken === undefined) delete process.env.AOF_MESH_CLONE_TOKEN;
            else process.env.AOF_MESH_CLONE_TOKEN = prevToken;
          }
        }
        const { status, cloneExec, downFrame, workspaceId, env } = result;

        assert.equal(downFrame?.code, CLONE_CREDENTIAL_MINT_FAILED, `[${label}] control replies with the coded clone-credential-mint-failed`);
        assert.equal(downFrame?.credential, null, `[${label}] no credential is ever handed back on a fault`);

        const finalFrame = status.frames.at(-1);
        assert.equal(finalFrame?.state, "failed", `[${label}] the worker surfaces a failed assignment status`);
        assert.equal(finalFrame?.code, "assignment-repo-unavailable", `[${label}] the loud coded assignment-repo-unavailable refusal fires`);

        // NO clone is attempted (whether with a fallback env-token OR unauthenticated)
        // and no partial checkout is left behind — a single assertion covers both: any
        // clone attempt at all, by ANY credential path, would show up as a recorded call.
        assert.equal(cloneExec.calls.length, 0, `[${label}] no clone exec call was ever attempted — never a fallback, never an unauthenticated clone`);
        assert.equal(await pathExists(meshCheckoutPath(workspaceId, { env })), false, `[${label}] no partial checkout is left behind`);

        if (useSentinel) {
          assert.ok(!JSON.stringify(cloneExec.calls).includes(SENTINEL_TOKEN), `[${label}] the sentinel AOF_MESH_CLONE_TOKEN value never appears in any cloneExec argv/env — the env-token provider genuinely was NOT consulted as a fallback, proved non-vacuously`);
        }
      }
    },
  },

  // ------------------------------------------------------------------
  // Scenario: a private repo with a broken mint FAILS — never rescued into an unauthenticated clone
  // ------------------------------------------------------------------
  {
    name: "task04/38 mint-failure-loud-no-fallback: a private repo whose mint cannot produce a token is refused, never attempted without a credential, and the outcome is the loud coded failure — never a success by any other credential path",
    run: async () => {
      const { status, cloneExec } = await driveFaultThroughHandler("unreachable");
      assert.equal(cloneExec.calls.length, 0, "the clone is refused, not attempted without a credential");
      const finalFrame = status.frames.at(-1);
      assert.equal(finalFrame?.state, "failed");
      assert.equal(finalFrame?.code, "assignment-repo-unavailable", "the outcome is the loud coded failure, never a success by any other credential path");
    },
  },

  // ------------------------------------------------------------------
  // Craft fix R3 (defensive, additional coverage beyond the locked feature contract) —
  // a 2xx response whose body is not valid JSON is a loud coded mint failure too, never
  // a raw SyntaxError escaping createGithubAppMintProvider.
  // ------------------------------------------------------------------
  {
    name: "task04/38 mint-failure-loud-no-fallback (craft R3): a 2xx installation-lookup or token-exchange response with a malformed JSON body still fails LOUD and CODED — never a raw SyntaxError",
    run: async () => {
      const { privateKey } = generateThrowawayKeypair();
      // Row A — the installation lookup itself returns 2xx with a body whose .json() throws.
      {
        const httpRequest = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation")
          ? { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token in JSON"); } }
          : jsonResponse(201, { token: "SHOULD-NEVER-MINT" })));
        const mint = createGithubAppMintProvider({ appId: "app-1", privateKey, httpRequest, resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git" });
        await assert.rejects(() => mint("ws-a", "asg-a"), (error) => {
          assert.equal(error.code, "github-app-mint-failed", "a malformed installation-lookup body is the coded mint failure, never a raw SyntaxError");
          return true;
        });
      }
      // Row B — the token-exchange response returns 2xx with a body whose .json() throws.
      {
        const httpRequest = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation")
          ? jsonResponse(200, { id: 1 })
          : { ok: true, status: 201, json: async () => { throw new SyntaxError("Unexpected token in JSON"); } }));
        const mint = createGithubAppMintProvider({ appId: "app-1", privateKey, httpRequest, resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git" });
        await assert.rejects(() => mint("ws-a", "asg-b"), (error) => {
          assert.equal(error.code, "github-app-mint-failed", "a malformed token-exchange body is the coded mint failure, never a raw SyntaxError");
          return true;
        });
      }
    },
  },
];
