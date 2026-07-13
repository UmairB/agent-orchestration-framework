// test/mesh-worker-clone-credential-not-persisted.test.mjs — traceability for
// milestone 38 / story 01 task 03 (03_credential-not-persisted.feature). Every
// @executable scenario + Examples row wired to the real engine surface:
// cloneRepoForWorkspace's credential-env scoping, buildAskpassShim, and
// redactCredentialFromText (src/mesh-worker-execution.mjs). Hermetic over an
// INJECTED clone-exec seam + a FAKE token string — no real forge, no real
// credential, no network (the developer-amigo feasibility seat's verdict).
//
// MILESTONE 38 / STORY 01 task 05 (ADR-009) — the credential now enters ONLY through
// the async `requestCloneCredential({ assignmentId, workspaceId, cloneUrl }) =>
// Promise<string|null>` resolver (the static `cloneCredential` option this module
// used to inject was DELETED — a static string is per-handler and cannot be
// per-clone, SECURITY T4). Every injection below is `requestCloneCredential: async
// () => FAKE_TOKEN` — the SAME fake token, the SAME hermetic seam, just resolved
// per-clone instead of held statically; every T1/T2/T3 assertion this module makes
// (no credential in `.git/config`, none on `process.env`, none inherited by the
// spawned agent child, none logged/streamed) holds identically either way.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import {
  cloneRepoForWorkspace,
  createMeshWorkerExecutionHandler,
  buildAskpassShim,
} from "../src/mesh-worker-execution.mjs";

// invokeAskpassShim(shimPath) — runs the GIT_ASKPASS one-shot shim exactly as git
// would (the documented contract: "the user's input is read from its standard
// output") and returns what it emits — the ONE sanctioned way to observe the
// credential riding the clone-exec's per-invocation env without ever asserting on a
// literal env VALUE (which the shim deliberately never carries — only a POINTER to a
// one-shot file does).
function invokeAskpassShim(shimPath) {
  return new Promise((resolve, reject) => {
    execFile(shimPath, [], { windowsHide: true, shell: process.platform === "win32" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
import {
  withMeshCloneFixture,
  createStatusRecorder,
  createRecordingCloneExec,
  scriptedSpawnRuntime,
} from "./support/mesh-worker-clone-fixture.mjs";

const FAKE_TOKEN = "FAKE-TOKEN-abc123-not-a-real-credential";

export const meshWorkerCloneCredentialNotPersistedTests = [
  // Scenario: the finished checkout carries no credential in .git/config
  {
    name: "task03/38 worker-repo-checkout: the finished checkout's .git/config carries no credential value, no url.<cred>@ rewrite, no durable credential.helper store",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env, git }) => {
      // A REAL local bare repo as the clone source (RESEARCH.md §1.1 precedent — the
      // mechanics are identical whether the transport is file://, https://, or a real
      // forge; nothing here depends on genuine HTTPS). The credential is carried on
      // the clone-exec's scoped env; the REAL git clone must leave no trace of it.
      const bareRoot = path.join(workspace.projectRoot, "..", "bare.git");
      git(["init", "--bare", "-q", bareRoot]);
      git(["push", bareRoot, "HEAD:refs/heads/main"]);

      const checkoutPath = await cloneRepoForWorkspace(workspace, {
        workspaceId,
        nodeId: "worker-a",
        cloneUrl: bareRoot,
        now: "2026-07-10T09:00:00.000Z",
        options: { requestCloneCredential: async () => FAKE_TOKEN, globalWorkStoreOptions: { env } },
      });

      const gitConfig = await readFile(path.join(checkoutPath, ".git", "config"), "utf8");
      assert.ok(!gitConfig.includes(FAKE_TOKEN), "the literal credential value appears nowhere in .git/config");
      assert.ok(!/url\s*=.*FAKE-TOKEN/i.test(gitConfig), "no url.<cred>@ rewrite");
      assert.ok(!/credential\.helper\s*=\s*store/i.test(gitConfig), "no durable credential.helper store");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario: the credential never reaches the worker's ambient env or the spawned agent child
  {
    name: "task03/38 worker-repo-checkout: the credential is set only on the clone spawn's per-invocation env; absent from process.env after the clone; the agent child does not inherit it",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const status = createStatusRecorder();
      let emittedByAskpass = null;
      // The shim is a ONE-SHOT, deleted in cloneRepoForWorkspace's own `finally`
      // immediately after the clone exec call returns (correct-by-design — the
      // ephemeral discipline SECURITY requires). So the shim must be invoked
      // SYNCHRONOUSLY INSIDE the clone-exec call itself — before that cleanup runs —
      // never after the handler has fully completed.
      const cloneExec = createRecordingCloneExec(async (args, opts) => {
        if (opts?.env?.GIT_ASKPASS) {
          emittedByAskpass = (await invokeAskpassShim(opts.env.GIT_ASKPASS)).trim();
        }
        return { status: 0, stdout: "", stderr: "" };
      });
      let agentChildEnv = null;
      const handler = createMeshWorkerExecutionHandler({
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
        requestCloneCredential: async () => FAKE_TOKEN,
        // scriptedSpawnRuntime never spawns a real child, so the "agent child does
        // not inherit" fact is confirmed structurally by F2's process.env proof AND
        // behaviourally by asserting process.env is untouched at every observation
        // point below (a real agent-child spawn inherits process.env verbatim, per
        // RESEARCH.md §1.5 — since nothing was ever written to process.env, there is
        // nothing for it to inherit).
        spawnRuntime: async (brief) => {
          agentChildEnv = { ...process.env };
          return { outcome: "done" };
        },
        globalWorkStoreOptions: { env },
      });

      const beforeKeys = new Set(Object.keys(process.env));
      await handler({ assignmentId: "asg-03-envscope", itemRef, workspaceId });
      const afterKeys = new Set(Object.keys(process.env));

      // The clone exec received the credential on its OWN per-invocation env — via a
      // GIT_ASKPASS pointer whose invocation (the documented contract git itself
      // uses) emits the token. The env VALUE itself is deliberately never the literal
      // token (only a path to the one-shot shim) — invoking the shim (captured
      // DURING the clone-exec call, before the shim's one-shot cleanup) is the
      // sanctioned observation point.
      assert.equal(cloneExec.calls.length, 1);
      assert.ok(cloneExec.calls[0].env, "the clone exec call received an env object");
      assert.ok(cloneExec.calls[0].env.GIT_ASKPASS, "the clone exec's env carries a GIT_ASKPASS pointer");
      assert.equal(emittedByAskpass, FAKE_TOKEN, "invoking the askpass shim the clone exec's env points at emits the credential");

      // process.env is untouched — no new key, no credential value anywhere in it —
      // both DURING the handler run (captured at spawnRuntime time, the earliest the
      // agent child would read it) and AFTER.
      assert.deepEqual([...afterKeys].sort(), [...beforeKeys].sort(), "no key was added to process.env");
      assert.ok(!Object.values(process.env).some((v) => typeof v === "string" && v.includes(FAKE_TOKEN)), "the credential is absent from process.env after the clone");
      assert.ok(agentChildEnv && !Object.values(agentChildEnv).some((v) => typeof v === "string" && v.includes(FAKE_TOKEN)), "the agent child's (ambient-inherited) env carries no credential");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario: a clone failure surfaces a redacted error with no credential value
  {
    name: "task03/38 worker-repo-checkout: a clone failure with an authenticated-URL error surfaces a redacted error/frame with no credential value",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const authenticatedUrlStderr = `fatal: Authentication failed for 'https://x-access-token:${FAKE_TOKEN}@git.example.com/acme/secret.git/'`;

      // The SURFACED ERROR MESSAGE surface (cloneRepoForWorkspace's own thrown
      // error — the redactCredentialFromText call site, src/mesh-worker-
      // execution.mjs:378) — asserted directly, not only via the downstream frame.
      const cloneExec = createRecordingCloneExec({ status: 128, stdout: "", stderr: authenticatedUrlStderr });
      await assert.rejects(
        () => cloneRepoForWorkspace(workspace, {
          workspaceId,
          nodeId: "worker-a",
          cloneUrl: "https://git.example.com/acme/secret.git",
          now: "2026-07-10T09:00:00.000Z",
          options: { cloneExec: cloneExec.exec, requestCloneCredential: async () => FAKE_TOKEN, globalWorkStoreOptions: { env } },
        }),
        (error) => {
          assert.ok(!error.message.includes(FAKE_TOKEN), "the surfaced error message carries no credential value");
          assert.ok(error.message.includes("[redacted]"), "the surfaced error message is redacted, not merely silent");
          return true;
        },
      );

      // The STREAMED FAILED FRAME surface — the full handler bracket.
      const status = createStatusRecorder();
      const cloneExec2 = createRecordingCloneExec({ status: 128, stdout: "", stderr: authenticatedUrlStderr });
      const handler = createMeshWorkerExecutionHandler({
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec2.exec,
        requestCloneCredential: async () => FAKE_TOKEN,
        globalWorkStoreOptions: { env },
      });
      await handler({ assignmentId: "asg-03-redact", itemRef, workspaceId });

      const serialized = JSON.stringify(status.frames);
      assert.ok(!serialized.includes(FAKE_TOKEN), "the streamed failed frame carries no credential value");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario Outline: the finished checkout's .git/config persists no credential in any shape
  {
    name: "task03/38 worker-repo-checkout: Examples — the finished checkout's .git/config persists no credential in ANY shape (url embedding, extraheader, insteadOf, credential.helper store)",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env, git }) => {
      const bareRoot = path.join(workspace.projectRoot, "..", "bare2.git");
      git(["init", "--bare", "-q", bareRoot]);
      git(["push", bareRoot, "HEAD:refs/heads/main"]);

      const checkoutPath = await cloneRepoForWorkspace(workspace, {
        workspaceId,
        nodeId: "worker-a",
        cloneUrl: bareRoot,
        now: "2026-07-10T09:00:00.000Z",
        options: { requestCloneCredential: async () => FAKE_TOKEN, globalWorkStoreOptions: { env } },
      });
      const gitConfig = await readFile(path.join(checkoutPath, ".git", "config"), "utf8");

      assert.ok(!gitConfig.includes(FAKE_TOKEN), "the literal credential value appears nowhere in .git/config");
      assert.ok(!new RegExp(`x-access-token:${FAKE_TOKEN}@`).test(gitConfig), "no x-access-token embedded-credential origin URL");
      assert.ok(!/extraheader\s*=\s*Authorization/i.test(gitConfig), "no [http] extraheader = Authorization entry");
      assert.ok(!/insteadOf/i.test(gitConfig), "no url.<x>.insteadOf credential rewrite");
      assert.ok(!/credential\.helper\s*=\s*store/i.test(gitConfig), "no durable credential.helper = store");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario: the clone spawn uses no persisting credential flag
  {
    name: "task03/38 worker-repo-checkout: the git clone argv contains no --config http.extraHeader, no x-access-token embedded URL; the clone is spawned argv-form (execFile)",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      const cloneExec = createRecordingCloneExec();
      await cloneRepoForWorkspace(workspace, {
        workspaceId,
        nodeId: "worker-a",
        cloneUrl: "https://git.example.com/acme/secret.git",
        now: "2026-07-10T09:00:00.000Z",
        options: { cloneExec: cloneExec.exec, requestCloneCredential: async () => FAKE_TOKEN, globalWorkStoreOptions: { env } },
      });
      assert.equal(cloneExec.calls.length, 1);
      const argv = cloneExec.calls[0].args;
      assert.ok(Array.isArray(argv), "argv-form (an array), never a shell string");
      assert.ok(!argv.some((a) => typeof a === "string" && a.includes("--config")), "no --config http.extraHeader= argument");
      assert.ok(!argv.some((a) => typeof a === "string" && a.includes("x-access-token:")), "no x-access-token embedded authenticated URL");
      assert.ok(!argv.some((a) => typeof a === "string" && a.includes(FAKE_TOKEN)), "the credential itself is never an argv element");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario Outline: the credential env is scoped to the clone spawn and never leaks onward
  {
    name: "task03/38 worker-repo-checkout: Examples — the credential is present ONLY on the clone spawn's per-invocation env; absent from process.env, the agent child's env, and the addWorktree git spawn's env",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const worktreeExecCalls = [];
      let agentChildSawProcessEnv = null;

      // A RECORDING-but-delegating exec (mirrors the task 02 traceability module's
      // idiom): records every worktree call's { args, env } then spawns the REAL git
      // binary, so the worktree genuinely materializes and the handler reaches
      // spawnRuntime — only the CLONE step is faked.
      const recordingExec = (args, opts) => {
        worktreeExecCalls.push({ args, env: opts?.env });
        return new Promise((resolve, reject) => {
          execFile("git", args, { cwd: opts?.cwd, windowsHide: true }, (error, stdout, stderr) => {
            if (error && (error.code === "ENOENT" || error.killed || error.signal)) {
              reject(error);
              return;
            }
            resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), status: error ? (typeof error.code === "number" ? error.code : 1) : 0 });
          });
        });
      };

      const handler = createMeshWorkerExecutionHandler({
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
        requestCloneCredential: async () => FAKE_TOKEN,
        exec: recordingExec,
        spawnRuntime: async () => {
          agentChildSawProcessEnv = { ...process.env };
          return { outcome: "done" };
        },
        globalWorkStoreOptions: { env },
      });
      await handler({ assignmentId: "asg-03-scoping", itemRef, workspaceId });

      // 1. Present on the clone spawn's own per-invocation env (via GIT_ASKPASS).
      assert.equal(cloneExec.calls.length, 1);
      assert.ok(cloneExec.calls[0].env?.GIT_ASKPASS, "the clone exec's env carries a GIT_ASKPASS pointer");

      // 2. Absent from process.env after the clone.
      assert.ok(!Object.values(process.env).some((v) => typeof v === "string" && v.includes(FAKE_TOKEN)), "absent from worker process.env");

      // 3. Absent from the agent child's inherited environment.
      assert.ok(agentChildSawProcessEnv, "the agent child ran");
      assert.ok(!Object.values(agentChildSawProcessEnv).some((v) => typeof v === "string" && v.includes(FAKE_TOKEN)), "absent from the agent child's inherited env");

      // 4. Absent from the addWorktree git spawn's env (the worktree add is a local,
      // credential-free step — RESEARCH.md §1.6).
      assert.ok(worktreeExecCalls.length > 0, "the worktree exec was called");
      for (const call of worktreeExecCalls) {
        const envValues = call.env ? Object.values(call.env) : [];
        assert.ok(!envValues.some((v) => typeof v === "string" && v.includes(FAKE_TOKEN)), "the addWorktree git spawn's env carries no credential");
      }
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario Outline: a failed clone redacts the credential on every surfaced surface
  {
    name: "task03/38 worker-repo-checkout: Examples — a failed clone (authenticated-URL error / auth-rejected header / stderr quoting argv) redacts the credential on every surfaced surface",
    run: async () => {
      const failures = [
        { label: "authenticated-URL error echoing the remote URL", stderr: `fatal: unable to access 'https://x-access-token:${FAKE_TOKEN}@git.example.com/acme/secret.git/'` },
        { label: "auth-rejected (401/403) error carrying a header", stderr: `fatal: The requested URL returned error: 403\nAuthorization: Bearer ${FAKE_TOKEN}` },
        { label: "git stderr quoting the credential-bearing argv", stderr: `fatal: could not read Username for 'https://git.example.com': terminal prompts disabled (token=${FAKE_TOKEN})` },
      ];
      for (const { label, stderr } of failures) {
        await withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
          // Surface 1 — the SURFACED ERROR MESSAGE: cloneRepoForWorkspace's own
          // thrown error (the redactCredentialFromText call site, src/mesh-worker-
          // execution.mjs:378), asserted directly against the real thrown error.
          const directCloneExec = createRecordingCloneExec({ status: 128, stdout: "", stderr });
          await assert.rejects(
            () => cloneRepoForWorkspace(workspace, {
              workspaceId,
              nodeId: "worker-a",
              cloneUrl: "https://git.example.com/acme/secret.git",
              now: "2026-07-10T09:00:00.000Z",
              options: { cloneExec: directCloneExec.exec, requestCloneCredential: async () => FAKE_TOKEN, globalWorkStoreOptions: { env } },
            }),
            (error) => {
              assert.ok(!error.message.includes(FAKE_TOKEN), `[${label}] the surfaced error message carries no credential value`);
              assert.ok(error.message.includes("[redacted]"), `[${label}] the surfaced error message is redacted`);
              return true;
            },
          );

          // Surface 2 (log line) + Surface 3 (streamed failed frame) — the full
          // handler bracket, with an injected logger capturing every log call so the
          // "any log line written for the failure redacts the credential" clause is
          // asserted directly rather than only inferred from the frame.
          const status = createStatusRecorder();
          const logLines = [];
          const cloneExec = createRecordingCloneExec({ status: 128, stdout: "", stderr });
          const handler = createMeshWorkerExecutionHandler({
            loadWs: () => Promise.resolve(workspace),
            nodeId: "worker-a",
            sendAssignmentStatus: status.sendAssignmentStatus,
            cloneExec: cloneExec.exec,
            requestCloneCredential: async () => FAKE_TOKEN,
            globalWorkStoreOptions: { env },
          });
          const originalConsoleError = console.error;
          console.error = (...args) => { logLines.push(args.map(String).join(" ")); };
          try {
            await handler({ assignmentId: `asg-03-redact-${label}`, itemRef, workspaceId });
          } finally {
            console.error = originalConsoleError;
          }

          const serialized = JSON.stringify(status.frames);
          assert.ok(!serialized.includes(FAKE_TOKEN), `[${label}] the streamed failed frame carries no credential value`);
          assert.ok(!logLines.some((line) => line.includes(FAKE_TOKEN)), `[${label}] no log line written for the failure carries the credential value`);
        }, { cloneUrl: "https://git.example.com/acme/secret.git" });
      }
    },
  },
  // Structural: the GIT_ASKPASS one-shot shim plumbing itself — a real (but hermetic) exercise
  {
    name: "task03/38 worker-repo-checkout: buildAskpassShim writes a one-shot script that emits the token to stdout, then cleanup() removes it entirely",
    run: async () => withMeshCloneFixture(async ({ env }) => {
      const { execFile } = await import("node:child_process");
      const { meshCheckoutsRoot } = await import("../src/mesh-worker-execution.mjs");
      const scriptsRoot = meshCheckoutsRoot({ env });
      const shim = await buildAskpassShim(scriptsRoot, FAKE_TOKEN);
      try {
        assert.ok(shim.shimPath, "a shim path is returned");
        const isWindows = process.platform === "win32";
        assert.ok(isWindows ? shim.shimPath.endsWith(".cmd") : shim.shimPath.endsWith(".sh"), "a platform-appropriate one-shot executable is generated");

        const output = await new Promise((resolve, reject) => {
          execFile(shim.shimPath, [], { windowsHide: true, shell: isWindows }, (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout);
          });
        });
        assert.equal(output.trim(), FAKE_TOKEN, "invoking the askpass shim emits the token to stdout — the documented GIT_ASKPASS contract");
      } finally {
        await shim.cleanup();
      }
      // After cleanup, the whole one-shot directory is gone.
      await assert.rejects(() => readFile(shim.shimPath, "utf8"), "the shim file is removed after cleanup");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
];
