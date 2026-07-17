// test/mesh-clone-credential-app-key-not-relayed.test.mjs — traceability for
// milestone 38 / story 02, task 02 (02_app-key-not-relayed.feature, ADR-010 §6.2 /
// SECURITY T8/T11/F5). Every @executable scenario driven against the REAL producer
// chain: createGithubAppMintProvider (src/mesh-clone-credential-provider.mjs) mints
// through the REAL applyCloneCredentialRequestFrame (src/control-stream-server.mjs),
// and — for the "not left at rest" scenario — the REAL cloneRepoForWorkspace
// (src/mesh-worker-execution.mjs) against a REAL local bare git repo. A THROWAWAY
// (test-generated, never a real GitHub App's) RSA private key stands in for the App
// key throughout — its exact string value is asserted absent from every frame, log
// line, and ambient process.env snapshot.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  applyCloneCredentialRequestFrame,
  CLONE_CREDENTIAL_MINT_FAILED,
} from "../src/control-stream-server.mjs";
import { createGithubAppMintProvider } from "../src/mesh-clone-credential-provider.mjs";
import { cloneRepoForWorkspace } from "../src/mesh-worker-execution.mjs";
import { createWorkerStreamClient } from "../src/worker-stream-client.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { createDirectiveChannelFixture, createFakeWorkerTransport } from "./support/mesh-directive-channel-fixture.mjs";
import { withMeshAssignFixture, seedAssignment } from "./support/mesh-assign-fixture.mjs";
import { withMeshCloneFixture } from "./support/mesh-worker-clone-fixture.mjs";
import { generateThrowawayKeypair, createFakeHttpRequest, jsonResponse, driveCloneCredentialReply } from "./support/mesh-clone-credential-mint-fixture.mjs";

const NOW = "2026-07-14T09:00:00.000Z";

function captureConsole() {
  const lines = [];
  const originals = { log: console.log, warn: console.warn, error: console.error, debug: console.debug };
  console.log = (...args) => lines.push(args.map(String).join(" "));
  console.warn = (...args) => lines.push(args.map(String).join(" "));
  console.error = (...args) => lines.push(args.map(String).join(" "));
  console.debug = (...args) => lines.push(args.map(String).join(" "));
  return { lines, restore: () => Object.assign(console, originals) };
}

export const meshCloneCredentialAppKeyNotRelayedTests = [
  // ------------------------------------------------------------------
  // Scenario: the App private key reaches only the signer
  // ------------------------------------------------------------------
  {
    name: "task02/38 app-key-not-relayed: the App private key reaches only the signer — it appears in NO frame the control stream server sends, in NO log/warn/error/debug message on the mint path, and is never assigned onto ambient process.env",
    run: async () => withMeshAssignFixture(async ({ home, workspaceId, ctx }) => {
      const { privateKey } = generateThrowawayKeypair();
      const httpRequest = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 1 }) : jsonResponse(201, { token: "MINTED-TOKEN-abc" })));
      const mintCloneCredential = createGithubAppMintProvider({
        appId: "app-1",
        privateKey,
        httpRequest,
        resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git",
      });

      await seedAssignment({ home }, {
        assignmentId: "asg-02-key", itemRef: "35/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });
      const channel = createDirectiveChannelFixture();
      const socket = channel.connectWorker("worker-a");
      const capture = captureConsole();
      const beforeKeys = new Set(Object.keys(process.env));
      let result;
      const store = await openGlobalWorkProjectionStore(ctx.globalWorkStoreOptions);
      try {
        const frame = { kind: "clone-credential-request", nodeId: "worker-a", assignmentId: "asg-02-key", workspaceId, at: NOW };
        result = await applyCloneCredentialRequestFrame(store, frame, {
          nodeId: "worker-a",
          directiveTargets: channel.targets,
          mintCloneCredential,
          now: NOW,
        });
      } finally {
        store.close();
        capture.restore();
      }
      const afterKeys = new Set(Object.keys(process.env));

      assert.equal(result.applied, true);
      assert.equal(result.minted, true);
      assert.equal(socket.frames.length, 1);
      const downFrame = socket.frames[0];
      assert.equal(downFrame.credential, "MINTED-TOKEN-abc", "the down-frame carries the minted TOKEN — never the key");
      assert.ok(!JSON.stringify(downFrame).includes(privateKey), "the private key value appears in NO frame the control stream server sends");
      assert.ok(!capture.lines.some((line) => line.includes(privateKey)), "the private key appears in no log/warn/error/debug message on the mint path");
      assert.deepEqual([...afterKeys].sort(), [...beforeKeys].sort(), "no key was added to process.env");
      assert.ok(!Object.values(process.env).some((v) => typeof v === "string" && v.includes(privateKey)), "the private key is never assigned onto ambient process.env");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: a mint FAILURE redacts both the key and the token from the surfaced error
  // ------------------------------------------------------------------
  {
    name: "task02/38 app-key-not-relayed: a mint FAILURE redacts both the key and the token from the surfaced error — the raw thrown error AND the worker's loud coded refusal carry neither",
    run: async () => withMeshAssignFixture(async ({ home, workspaceId, ctx }) => {
      const { privateKey } = generateThrowawayKeypair();
      const faultyResponder = async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 1 }) : jsonResponse(403, { message: "Resource not accessible by integration" }));

      // Direct proof against the RAW thrown error (not only through control's catch) —
      // its OWN httpRequest recorder, so `calls[0]` below is unambiguously the App JWT
      // THIS ONE invocation signed.
      const directHttpRequest = createFakeHttpRequest(faultyResponder);
      const directMint = createGithubAppMintProvider({
        appId: "app-1",
        privateKey,
        httpRequest: directHttpRequest,
        resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git",
      });
      await assert.rejects(() => directMint(workspaceId, "asg-x"), (error) => {
        assert.ok(!error.message.includes(privateKey), "the raw thrown error carries no key value");
        // F-QA1 — 02_app-key-not-relayed.feature:21-24 says the surfaced/coded error
        // carries neither the app private key NOR any token value; assert the TOKEN
        // half too, not merely the key half. The App JWT bearer this mint signed
        // (captured from its FIRST HTTP call — the installation lookup) is the only
        // token-shaped secret in play on this fault path: the exchange itself never
        // succeeds (403), so no installation token is ever minted.
        const appJwt = directHttpRequest.calls[0].init.headers.Authorization.slice("Bearer ".length);
        assert.ok(appJwt.length > 0, "captured a non-blank App JWT bearer to assert absence of");
        assert.ok(!error.message.includes(appJwt), "the raw thrown error carries no App JWT (token-shaped secret) value either");
        return true;
      });

      const httpRequest = createFakeHttpRequest(faultyResponder);
      const mintCloneCredential = createGithubAppMintProvider({
        appId: "app-1",
        privateKey,
        httpRequest,
        resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git",
      });

      await seedAssignment({ home }, {
        assignmentId: "asg-02-fail", itemRef: "35/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });
      const channel = createDirectiveChannelFixture();
      const socket = channel.connectWorker("worker-a");
      let result;
      const store = await openGlobalWorkProjectionStore(ctx.globalWorkStoreOptions);
      try {
        const frame = { kind: "clone-credential-request", nodeId: "worker-a", assignmentId: "asg-02-fail", workspaceId, at: NOW };
        result = await applyCloneCredentialRequestFrame(store, frame, {
          nodeId: "worker-a",
          directiveTargets: channel.targets,
          mintCloneCredential,
          now: NOW,
        });
      } finally {
        store.close();
      }
      assert.equal(result.applied, false);
      assert.equal(result.code, CLONE_CREDENTIAL_MINT_FAILED, "the worker receives the loud coded refusal, not a raw error carrying a secret");
      assert.equal(socket.frames.length, 1);
      const downFrame = socket.frames[0];
      assert.equal(downFrame.credential, null, "no credential is handed back on a mint failure");
      assert.equal(downFrame.code, CLONE_CREDENTIAL_MINT_FAILED);
      assert.ok(!JSON.stringify(downFrame).includes(privateKey), "the surfaced refusal carries no key value");

      // F-QA1 (token half) — the down-frame's OWN App JWT (this invocation's, captured
      // the same way) must be absent too, not merely the key.
      assert.ok(httpRequest.calls.length >= 1, "the mint made the installation-lookup HTTP call");
      const downFrameAppJwt = httpRequest.calls[0].init.headers.Authorization.slice("Bearer ".length);
      assert.ok(downFrameAppJwt.length > 0, "captured a non-blank App JWT bearer for the down-frame check");
      assert.ok(!JSON.stringify(downFrame).includes(downFrameAppJwt), "the surfaced refusal carries no App JWT (token-shaped secret) value either");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: the minted token is not left at rest on the worker (story-01 T1/T3 re-armed)
  // ------------------------------------------------------------------
  {
    name: "task02/38 app-key-not-relayed: the minted token is NOT left at rest on the worker — a REAL clone completed with a github-app-minted token leaves nothing in .git/config, is absent from process.env and the agent child's env, and appears in no log or streamed frame",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      const { privateKey } = generateThrowawayKeypair();
      const httpRequest = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 1 }) : jsonResponse(201, { token: "GH-APP-MINTED-TOKEN-777" })));
      const mintCloneCredential = createGithubAppMintProvider({
        appId: "app-1",
        privateKey,
        httpRequest,
        resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git",
      });

      const assignmentId = "asg-02-atrest";
      const bareRoot = path.join(workspace.projectRoot, "..", "bare-atrest02.git");
      const { spawnSyncHardened } = await import("./support/cli-spawn.mjs");
      const git = (args) => spawnSyncHardened("git", args, { cwd: workspace.projectRoot, encoding: "utf8", shell: process.platform === "win32" });
      git(["init", "--bare", "-q", bareRoot]);
      git(["push", bareRoot, "HEAD:refs/heads/main"]);

      await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
        assignmentId, itemRef: "38/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });

      const transport = createFakeWorkerTransport();
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW });

      const clonePromise = cloneRepoForWorkspace(workspace, {
        workspaceId,
        nodeId: "worker-a",
        assignmentId,
        cloneUrl: bareRoot, // a REAL local bare repo — real git, real .git/config
        now: NOW,
        options: { requestCloneCredential: (request) => client.requestCloneCredential(request), globalWorkStoreOptions: { env } },
      });

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
      assert.equal(downFrame.credential, "GH-APP-MINTED-TOKEN-777");

      const checkoutPath = await clonePromise;
      const gitConfig = await readFile(path.join(checkoutPath, ".git", "config"), "utf8");
      assert.ok(!gitConfig.includes("GH-APP-MINTED-TOKEN-777"), "the literal credential value appears nowhere in .git/config");
      assert.ok(!/url\s*=.*GH-APP-MINTED-TOKEN/i.test(gitConfig), "no url.<cred>@ rewrite");
      assert.ok(!/credential\.helper\s*=\s*store/i.test(gitConfig), "no durable credential.helper store");
      assert.ok(!/http\.extraheader/i.test(gitConfig), "no http.extraheader persisted");
      assert.ok(!Object.values(process.env).some((v) => typeof v === "string" && v.includes("GH-APP-MINTED-TOKEN-777")), "absent from process.env after the clone");
      const otherFrames = transport.frames.filter((f) => f.kind !== "clone-credential-request");
      assert.ok(!JSON.stringify(otherFrames).includes("GH-APP-MINTED-TOKEN-777"), "no OTHER streamed frame ever carries the credential value");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
];
