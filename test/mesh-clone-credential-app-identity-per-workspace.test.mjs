// test/mesh-clone-credential-app-identity-per-workspace.test.mjs — traceability for
// milestone 38 / story 03, task 00
// (00_per-workspace-app-identity-resolution.feature, ADR-011). Every @executable
// scenario / Scenario Outline row is driven against the REAL `createGithubAppMintProvider`
// (src/mesh-clone-credential-provider.mjs) fed the REAL, LAUNCHER-EXPORTED
// `createResolveWorkspaceAppIdentity`/`createResolveWorkspaceCloneUrl`
// (src/mesh-launcher.mjs — the EXACT builders `startLauncher`'s production wiring
// site calls; not a hand-built stand-in, ADR-008) — composed over REAL committed
// workspace configs (a temp `AOF_GLOBAL_HOME`, real `aof.config.json` files, real
// `global_workspace_descriptors` rows) and REAL throwaway RSA keys read off REAL disk
// files. The ONLY injected seam is the HTTP client (a recording fake — no real
// GitHub, no network); the App JWT is still signed by the REAL default `node:crypto`
// signer.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGithubAppMintProvider } from "../src/mesh-clone-credential-provider.mjs";
import { createResolveWorkspaceAppIdentity, createResolveWorkspaceCloneUrl } from "../src/mesh-launcher.mjs";
import { createFakeHttpRequest, jsonResponse } from "./support/mesh-clone-credential-mint-fixture.mjs";
import { withPerOrgAppIdentityFixture, generateThrowawayPrivateKeyPem } from "./support/mesh-per-org-app-identity-fixture.mjs";

function base64urlToBuffer(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function decodeJwtIss(jwt) {
  const [, payloadB64] = jwt.split(".");
  return JSON.parse(base64urlToBuffer(payloadB64).toString("utf8")).iss;
}

// httpRequestRecordingIss() — a fake HTTP client that scripts every mint step to
// succeed and records the App JWT `iss` claim each installation-lookup call carried —
// lets a test assert WHICH App identity signed each mint without decoding manually.
function httpRequestRecordingIss() {
  const seen = [];
  const httpRequest = createFakeHttpRequest(async ({ url, init }) => {
    if (url.endsWith("/installation")) {
      seen.push(decodeJwtIss(init.headers.Authorization.slice("Bearer ".length)));
      return jsonResponse(200, { id: 1 });
    }
    return jsonResponse(201, { token: `TOKEN-${seen.at(-1)}` });
  });
  return { httpRequest, seen };
}

// withThrowawayKeyFiles(names, fn) — writes ONE real throwaway RSA key file per name
// under a temp dir (GitHub App keys are PEM files on disk — the config a workspace
// commits is a PATH, never the key bytes) and hands back { [name]: absolutePath }.
async function withThrowawayKeyFiles(names, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-app-identity-keys-"));
  try {
    const paths = {};
    for (const name of names) {
      const keyPath = path.join(dir, `${name}.pem`);
      await mkdir(path.dirname(keyPath), { recursive: true });
      await writeFile(keyPath, generateThrowawayPrivateKeyPem(), "utf8");
      paths[name] = keyPath;
    }
    return await fn(paths);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// withThreeWorkspaceHarness(fn) — the ONE shared fixture this whole file's scenarios
// drive: a launch workspace ("ws-launch") configuring App "app-launch"; a non-launch
// workspace "ws-b" with its OWN committed App "app-b"; a non-launch workspace "ws-c"
// with NO credential override of its own (falls through to the launch default).
// `fn` receives { resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl } — the REAL
// launcher-exported builders, composed exactly as `startLauncher`'s production
// wiring composes them (same `(ws, options)` shape).
async function withThreeWorkspaceHarness(fn) {
  return withThrowawayKeyFiles(["app-launch", "app-b"], (keys) => withPerOrgAppIdentityFixture(async (fx) => {
    const options = { globalWorkStoreOptions: { env: fx.env } };
    const resolveWorkspaceAppIdentity = createResolveWorkspaceAppIdentity(fx.ws, options);
    const resolveWorkspaceCloneUrl = createResolveWorkspaceCloneUrl(fx.ws, options);
    return fn({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl });
  }, {
    launch: {
      workspaceId: "ws-launch",
      cloneUrl: "https://github.com/launch-org/launch-repo.git",
      credential: { provider: "github-app", githubApp: { appId: "app-launch", privateKeyPath: keys["app-launch"] } },
    },
    others: [
      {
        workspaceId: "ws-b",
        cloneUrl: "https://github.com/org-b/repo-b.git",
        credential: { githubApp: { appId: "app-b", privateKeyPath: keys["app-b"] } },
      },
      {
        workspaceId: "ws-c",
        cloneUrl: "https://github.com/org-c/repo-c.git",
        // NO credential block at all — the "no override" case.
      },
    ],
  }));
}

export const meshCloneCredentialAppIdentityPerWorkspaceTests = [
  // ------------------------------------------------------------------
  // Scenario: the provider resolves identity keyed by the mint's workspaceId, not a
  // single static App
  // ------------------------------------------------------------------
  {
    name: "task00/38 per-workspace-app-identity-resolution: the provider resolves identity keyed by the mint's workspaceId, not a single static App reused across every mint",
    run: async () => withThreeWorkspaceHarness(async ({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl }) => {
      let consultedWith = null;
      const spyResolve = async (workspaceId) => {
        consultedWith = workspaceId;
        return resolveWorkspaceAppIdentity(workspaceId);
      };
      const { httpRequest, seen } = httpRequestRecordingIss();
      const mint = createGithubAppMintProvider({ resolveWorkspaceAppIdentity: spyResolve, resolveWorkspaceCloneUrl, httpRequest });

      await mint("ws-b", "asg-1");
      assert.equal(consultedWith, "ws-b", "resolveWorkspaceAppIdentity is consulted with EXACTLY the mint's own workspaceId");
      assert.deepEqual(seen, ["app-b"], "the App JWT is signed with the appId/privateKey resolveWorkspaceAppIdentity returned for ws-b");

      // The SAME provider closure, minting for a DIFFERENT workspace, signs with a
      // DIFFERENT identity — proves the closure does not carry a single static
      // appId/privateKey reused across every mint.
      await mint("ws-launch", "asg-2");
      assert.equal(consultedWith, "ws-launch");
      assert.deepEqual(seen, ["app-b", "app-launch"], "a DIFFERENT identity signs a DIFFERENT workspace's mint — no static App reused across every mint");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: a NON-launch assigned workspace's OWN committed override takes effect
  // ------------------------------------------------------------------
  {
    name: "task00/38 per-workspace-app-identity-resolution: a NON-launch assigned workspace's OWN committed override takes effect (the gap ADR-011 closes) — ws-b's App JWT iss is app-b, signed with ws-b's own key, never app-launch",
    run: async () => withThreeWorkspaceHarness(async ({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl }) => {
      const { httpRequest, seen } = httpRequestRecordingIss();
      const mint = createGithubAppMintProvider({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl, httpRequest });

      await mint("ws-b", "asg-b");
      assert.deepEqual(seen, ["app-b"], "the App JWT iss is app-b — never app-launch — even though ws-b is not the daemon's launch workspace");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: absent a per-workspace override, resolution falls through to the
  // launch-workspace default
  // ------------------------------------------------------------------
  {
    name: "task00/38 per-workspace-app-identity-resolution: absent a per-workspace override, resolution falls through to the launch-workspace default — ws-c's App JWT iss is app-launch, the SAME singular behaviour as today, now reached for a non-launch assigned workspace",
    run: async () => withThreeWorkspaceHarness(async ({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl }) => {
      const { httpRequest, seen } = httpRequestRecordingIss();
      const mint = createGithubAppMintProvider({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl, httpRequest });

      await mint("ws-c", "asg-c");
      assert.deepEqual(seen, ["app-launch"], "ws-c carries no credential override of its own, so its mint falls through to the control node's own global-merged default");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario Outline: the signing App identity is the assigned workspace's own
  // config, else the launch default
  // ------------------------------------------------------------------
  {
    name: "task00/38 per-workspace-app-identity-resolution: Examples — the signing App identity is the assigned workspace's own config, else the launch default",
    run: async () => withThreeWorkspaceHarness(async ({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl }) => {
      const rows = [
        { workspaceId: "ws-launch", signingApp: "app-launch", label: "IS the launch workspace, configuring app-launch" },
        { workspaceId: "ws-b", signingApp: "app-b", label: "has its OWN committed appId app-b" },
        { workspaceId: "ws-c", signingApp: "app-launch", label: "has NO credential override of its own" },
      ];
      for (const row of rows) {
        let consultedWith = null;
        const spyResolve = async (workspaceId) => {
          consultedWith = workspaceId;
          return resolveWorkspaceAppIdentity(workspaceId);
        };
        const { httpRequest, seen } = httpRequestRecordingIss();
        const mint = createGithubAppMintProvider({ resolveWorkspaceAppIdentity: spyResolve, resolveWorkspaceCloneUrl, httpRequest });
        await mint(row.workspaceId, "asg-row");
        assert.equal(consultedWith, row.workspaceId, `[${row.label}] resolveWorkspaceAppIdentity is consulted with exactly ${row.workspaceId}`);
        assert.deepEqual(seen, [row.signingApp], `[${row.label}] the App JWT is signed with appId ${row.signingApp}`);
      }
    }),
  },
];
