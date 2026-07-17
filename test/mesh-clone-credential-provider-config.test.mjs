// test/mesh-clone-credential-provider-config.test.mjs — traceability for milestone 38
// / story 02, task 00 (00_provider-config-driven.feature, ADR-010 §6.1). Every
// @executable scenario / Scenario Outline row wired to the REAL production surface:
//   - the SELECTOR: resolveCloneCredentialProvider (src/mesh-clone-credential-provider.mjs).
//   - the PRODUCTION WIRING: startLauncher's control-role `startServer({...})` call
//     site (src/mesh-launcher.mjs) — driven with NO controlStreamServerOptions
//     credential-shaped override (the ADR-009 F12 discipline this story re-arms for
//     the provider): a test that only proved the seam via the test-injection spread
//     would prove nothing about production.
//   - the UNCHANGED authorization gates: applyCloneCredentialRequestFrame
//     (src/control-stream-server.mjs) — reused verbatim from story 01, never
//     hand-authored here.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { startLauncher } from "../src/mesh-launcher.mjs";
import {
  defaultMintCloneCredential,
  applyCloneCredentialRequestFrame,
  CLONE_CREDENTIAL_NOT_HOLDER,
  CLONE_CREDENTIAL_WORKSPACE_MISMATCH,
  CLONE_CREDENTIAL_ASSIGNMENT_INACTIVE,
} from "../src/control-stream-server.mjs";
import { resolveCloneCredentialProvider, CLONE_CREDENTIAL_PROVIDER_UNKNOWN } from "../src/mesh-clone-credential-provider.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { createDirectiveChannelFixture } from "./support/mesh-directive-channel-fixture.mjs";
import { withMeshAssignFixture, seedAssignment } from "./support/mesh-assign-fixture.mjs";

const NODE_ID = "control-a";
const NOW = "2026-07-14T09:00:00.000Z";
const STATUS_FIXTURE = {
  BackendState: "Running",
  Self: { HostName: NODE_ID, DNSName: `${NODE_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true },
  Peer: {},
};

function manualTicker() {
  const handles = [];
  return {
    handles,
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) { handle.stopped = true; },
  };
}

function fixturedExec() {
  return async () => ({ stdout: JSON.stringify(STATUS_FIXTURE), status: 0 });
}

// makeRepo({ credential }) — a minimal control-role fixture repo, carrying a
// committed `mesh.repo.cloneUrl` (ADR-010's control-trusted source) and an OPTIONAL
// `mesh.repo.credential` block — exactly the shape `startLauncher`'s control block
// reads at the production call site.
async function makeRepo({ credential } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-clone-cred-provider-"));
  const workDir = path.join(repo, "wiki", "work");
  const milestoneDir = path.join(workDir, "38_milestone_demo");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(path.join(milestoneDir, "SPEC.md"), "---\ntype: milestone\nnumber: 38\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n", "utf8");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const meshRepo = { cloneUrl: "https://github.com/acme/secret.git" };
  if (credential !== undefined) meshRepo.credential = credential;
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: { nodeId: NODE_ID, fabric: "tailscale", relay: { controlNode: NODE_ID }, repo: meshRepo },
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return repo;
}

async function withProdWiring({ credential } = {}, fn) {
  const repo = await makeRepo({ credential });
  try {
    const ws = await loadWorkspace(repo);
    let startServerArgs = null;
    const startControlStreamServer = async (args) => {
      startServerArgs = args;
      return { stop() {}, updatePeers() {} };
    };
    return await fn({ ws, startControlStreamServer, getStartServerArgs: () => startServerArgs });
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

export const meshCloneCredentialProviderConfigTests = [
  // ------------------------------------------------------------------
  // Scenario: no provider configured -> the env-token default, byte-identical to today
  // ------------------------------------------------------------------
  {
    name: "task00/38 provider-config-driven: no `mesh.repo.credential` configured -> the PRODUCTION wiring's mintCloneCredential is the EXACT `defaultMintCloneCredential` reference (byte-identical to today), reads AOF_MESH_CLONE_TOKEN unchanged",
    run: async () => withProdWiring({}, async ({ ws, startControlStreamServer, getStartServerArgs }) => {
      const handle = await startLauncher(ws, {
        exec: fixturedExec(),
        platform: "linux",
        ticker: manualTicker(),
        peerPollTicker: manualTicker(),
        startControlStreamServer,
        // Deliberately NO controlStreamServerOptions override — production's own
        // literal-key wiring is what supplies mintCloneCredential here.
      });
      try {
        assert.equal(handle.role, "control");
        const args = getStartServerArgs();
        assert.ok(args != null, "startControlStreamServer was invoked");
        assert.equal(typeof args.mintCloneCredential, "function", "a mintCloneCredential is wired as a literal key");
        assert.equal(args.mintCloneCredential, defaultMintCloneCredential, "the resolved provider IS the exact defaultMintCloneCredential reference — byte-identical to today, never a re-implementation");

        const prevToken = process.env.AOF_MESH_CLONE_TOKEN;
        try {
          delete process.env.AOF_MESH_CLONE_TOKEN;
          assert.equal(await args.mintCloneCredential("ws-x", "asg-x"), null, "absent AOF_MESH_CLONE_TOKEN still resolves to null — the public-repo reply, unchanged");
          process.env.AOF_MESH_CLONE_TOKEN = "ENV-PAT-abc";
          assert.equal(await args.mintCloneCredential("ws-x", "asg-x"), "ENV-PAT-abc", "AOF_MESH_CLONE_TOKEN is still read exactly as today");
        } finally {
          if (prevToken === undefined) delete process.env.AOF_MESH_CLONE_TOKEN;
          else process.env.AOF_MESH_CLONE_TOKEN = prevToken;
        }
      } finally {
        handle.stop();
      }
    }),
  },
  {
    name: "task00/38 provider-config-driven: `mesh.repo.credential.provider` explicitly \"env-token\" resolves to the SAME default reference (an explicit, not merely absent, selection)",
    run: async () => withProdWiring({ credential: { provider: "env-token" } }, async ({ ws, startControlStreamServer, getStartServerArgs }) => {
      const handle = await startLauncher(ws, { exec: fixturedExec(), platform: "linux", ticker: manualTicker(), peerPollTicker: manualTicker(), startControlStreamServer });
      try {
        const args = getStartServerArgs();
        assert.equal(args.mintCloneCredential, defaultMintCloneCredential);
      } finally {
        handle.stop();
      }
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: github-app configured -> selected and wired as a LITERAL key
  // ------------------------------------------------------------------
  {
    name: "task00/38 provider-config-driven: `mesh.repo.credential.provider: github-app` -> the PRODUCTION wiring's mintCloneCredential is the github-app mint (distinct from the env-token default), supplied as a LITERAL key with NO controlStreamServerOptions override at all — never reachable only through the test-injection spread (the F12 guard, re-armed)",
    run: async () => withProdWiring(
      { credential: { provider: "github-app", githubApp: { appId: "app-1" } } },
      async ({ ws, startControlStreamServer, getStartServerArgs }) => {
        const handle = await startLauncher(ws, {
          exec: fixturedExec(),
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
          startControlStreamServer,
          // STILL no controlStreamServerOptions — if mintCloneCredential were reachable
          // ONLY through that spread (the F12 shape), it would be undefined here.
        });
        try {
          const args = getStartServerArgs();
          assert.equal(typeof args.mintCloneCredential, "function", "a mintCloneCredential is present without any test-injection override");
          assert.notEqual(args.mintCloneCredential, defaultMintCloneCredential, "the resolved provider is NOT the env-token default");
          assert.equal(args.mintCloneCredential.providerName, "github-app", "the resolved provider is genuinely the github-app mint, not merely some function");
        } finally {
          handle.stop();
        }
      },
    ),
  },

  // ------------------------------------------------------------------
  // Scenario Outline: an unknown or malformed provider fails LOUD at startup
  // ------------------------------------------------------------------
  {
    name: "task00/38 provider-config-driven: Examples — an unknown/blank/wrong-type provider throws a loud coded startup error naming the bad provider; the control stream server NEVER starts (never a silent env-token degrade)",
    run: async () => {
      const rows = [
        { label: '"gitlab-app"', value: "gitlab-app" },
        { label: '"" (blank)', value: "" },
        { label: "42 (wrong type)", value: 42 },
      ];
      for (const { label, value } of rows) {
        await withProdWiring({ credential: { provider: value } }, async ({ ws }) => {
          let serverStarted = false;
          await assert.rejects(
            () => startLauncher(ws, {
              exec: fixturedExec(),
              platform: "linux",
              ticker: manualTicker(),
              peerPollTicker: manualTicker(),
              startControlStreamServer: async () => {
                serverStarted = true;
                return { stop() {}, updatePeers() {} };
              },
            }),
            (error) => {
              assert.equal(error.code, CLONE_CREDENTIAL_PROVIDER_UNKNOWN, `[${label}] the thrown error is coded`);
              // QA nit — `error.message.includes(String(value))` was ALWAYS true for the
              // `""` (blank) row (`String("")` is the empty string, a no-op sub-assertion).
              // `JSON.stringify(value)` is the LITERAL substring the production error
              // message embeds (`JSON.stringify(provider)`, mesh-clone-credential-
              // provider.mjs) — for the blank row this requires the literal two
              // characters `""` to be present, a genuine (non-vacuous) check for every
              // row, not merely the two non-blank ones.
              assert.ok(error.message.includes(JSON.stringify(value)), `[${label}] the error message names the bad provider value`);
              return true;
            },
            `[${label}] startLauncher rejects loudly`,
          );
          assert.equal(serverStarted, false, `[${label}] no control stream server starts with an unresolved mint`);
        });
      }
    },
  },

  // ------------------------------------------------------------------
  // Scenario: the provider is invoked ONLY behind the unchanged authorization gates
  // ------------------------------------------------------------------
  // F-QA2 — the T6 holder / F15 workspace-match / F16 active-state gates ALL precede
  // the mint for the github-app provider (the feature's own Background: "a
  // clone-credential-request that fails the holder / workspace-match / active-state
  // gate"), not merely the holder gate: each row below refuses a DIFFERENT one of the
  // three named gates and proves the github-app provider's own resolveWorkspaceCloneUrl
  // seam is NEVER reached for ANY of them.
  {
    name: "task00/38 provider-config-driven: Examples — a clone-credential-request that fails the holder (T6) / workspace-match (F15) / active-state (F16) gate NEVER calls the selected github-app provider's mint — all THREE named gates precede the mint, not merely the holder gate",
    run: async () => {
      const GATES = [
        {
          label: "the holder gate (T6)",
          code: CLONE_CREDENTIAL_NOT_HOLDER,
          assignmentId: "asg-task00-notholder",
          seedState: "accepted",
          requesterNodeId: "worker-b", // genuinely NOT the holder (row's target_node_id is worker-a)
          frameWorkspaceId: (workspaceId) => workspaceId,
        },
        {
          label: "the workspace-match gate (F15)",
          code: CLONE_CREDENTIAL_WORKSPACE_MISMATCH,
          assignmentId: "asg-task00-wsmismatch",
          seedState: "accepted",
          requesterNodeId: "worker-a", // genuinely IS the holder — only the workspaceId disagrees
          frameWorkspaceId: () => "ws-SOMEONE-ELSES-REPO",
        },
        {
          label: "the active-state gate (F16, terminal state 'done')",
          code: CLONE_CREDENTIAL_ASSIGNMENT_INACTIVE,
          assignmentId: "asg-task00-terminal",
          seedState: "done", // a terminal state — assignment-record.mjs's own TERMINAL_ASSIGNMENT_STATES
          requesterNodeId: "worker-a",
          frameWorkspaceId: (workspaceId) => workspaceId,
        },
      ];

      for (const gate of GATES) {
        await withMeshAssignFixture(async ({ home, workspaceId, ctx }) => {
          let resolverCalls = 0;
          const { mintCloneCredential } = resolveCloneCredentialProvider(
            { mesh: { repo: { credential: { provider: "github-app", githubApp: { appId: "app-1" } } } } },
            {
              resolveWorkspaceCloneUrl: async () => {
                resolverCalls += 1;
                return "https://github.com/acme/should-never-resolve.git";
              },
            },
          );

          await seedAssignment({ home }, {
            assignmentId: gate.assignmentId, itemRef: "35/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: gate.seedState, assignedAt: NOW,
          });
          const channel = createDirectiveChannelFixture();
          const socket = channel.connectWorker(gate.requesterNodeId);
          const store = await openGlobalWorkProjectionStore(ctx.globalWorkStoreOptions);
          try {
            const frame = { kind: "clone-credential-request", nodeId: gate.requesterNodeId, assignmentId: gate.assignmentId, workspaceId: gate.frameWorkspaceId(workspaceId), at: NOW };
            const result = await applyCloneCredentialRequestFrame(store, frame, {
              nodeId: gate.requesterNodeId,
              directiveTargets: channel.targets,
              mintCloneCredential,
              now: NOW,
            });
            assert.equal(result.applied, false, `[${gate.label}] the request is refused before any mint is attempted`);
            assert.equal(result.code, gate.code, `[${gate.label}] the coded refusal names the gate`);
          } finally {
            store.close();
          }
          assert.equal(resolverCalls, 0, `[${gate.label}] the github-app provider's own resolveWorkspaceCloneUrl seam is NEVER reached — the gate refused before the mint was ever invoked`);
          assert.equal(socket.frames.length, 1, `[${gate.label}] a coded reply IS sent — never a silent drop`);
          assert.equal(socket.frames[0].code, gate.code, `[${gate.label}] the existing coded refusal fires unchanged`);
        });
      }
    },
  },
];
