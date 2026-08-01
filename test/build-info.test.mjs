// TECH_DEBT item 1 — build-info: which code is this process actually running?
// The seam behind `aof --version`'s "(payload <id>)" suffix and the daemons'
// startup "Build:" line. Pins:
//   - outside a SEA the mode is ALWAYS "source" (env stamps are ignored — a
//     stray AOF_RUNTIME_MODE can never make a repo run claim to be an install)
//   - inside a SEA, sea-entry's AOF_RUNTIME_MODE stamp decides payload/embedded,
//     defaulting to "embedded" (a pre-launcher binary runs its embedded bundle)
//   - BUILD_ID.json beside the exe is read tolerantly: absent/corrupt is the
//     honest "no build stamp", never a throw and never a fabricated id
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setSeaSentinelForTest, setSidecarAnchorForTest } from "../src/asset-base.mjs";
import { runtimeMode, readBuildInfo, buildInfoString, setSourceBuildIdForTest, BUILD_ID_FILENAME } from "../src/build-info.mjs";

async function withPackagedAnchor(fn) {
  const anchor = await mkdtemp(path.join(os.tmpdir(), "aof-build-info-"));
  setSeaSentinelForTest(true);
  setSidecarAnchorForTest(anchor);
  try {
    return await fn(anchor);
  } finally {
    setSeaSentinelForTest(undefined);
    setSidecarAnchorForTest(undefined);
    await rm(anchor, { recursive: true, force: true });
  }
}

export const buildInfoTests = [
  {
    name: "build-info/item-1 outside a SEA the mode is source and env stamps are ignored; source carries the repo's own GIT HASH as its build id",
    async run() {
      setSeaSentinelForTest(false);
      try {
        assert.equal(runtimeMode({ env: {} }), "source");
        assert.equal(runtimeMode({ env: { AOF_RUNTIME_MODE: "payload" } }), "source", "a stray env stamp never makes a repo run claim to be an install");

        // The git resolver injected (the setSeaSentinelForTest idiom): source mode
        // stamps the working tree's OWN hash — the blind spot that hid a
        // 74-minute-stale worker (2026-07-26: `build source` said nothing about
        // WHICH commit the daemon actually loaded).
        setSourceBuildIdForTest("f623a6a+dirty");
        const info = readBuildInfo({ env: {} });
        assert.deepEqual(info, { mode: "source", buildId: "f623a6a+dirty", installedAt: null });
        assert.equal(buildInfoString(info), "source f623a6a+dirty");

        // No git (a tarball run) degrades to the bare "source" — never a throw.
        setSourceBuildIdForTest(null);
        const bare = readBuildInfo({ env: {} });
        assert.deepEqual(bare, { mode: "source", buildId: null, installedAt: null });
        assert.equal(buildInfoString(bare), "source");
      } finally {
        setSeaSentinelForTest(undefined);
        setSourceBuildIdForTest(undefined);
      }
    },
  },
  {
    name: "build-info/item-1 the REAL source resolver answers this very repo's HEAD (short hash shape, cached) — un-injected",
    async run() {
      setSeaSentinelForTest(false);
      setSourceBuildIdForTest(undefined);
      try {
        const info = readBuildInfo({ env: {} });
        assert.equal(info.mode, "source");
        // This test runs inside the aof repo, so git MUST resolve — a null here
        // means the resolver broke, not that git is absent.
        assert.match(info.buildId ?? "", /^[0-9a-f]{4,40}(\+dirty)?$/, "the source build id is the repo's short HEAD hash, optionally +dirty");
        assert.equal(readBuildInfo({ env: {} }).buildId, info.buildId, "resolved once per process — the cached answer is stable");
      } finally {
        setSeaSentinelForTest(undefined);
        setSourceBuildIdForTest(undefined);
      }
    },
  },
  {
    name: "build-info/item-1 a stamped payload install reads its BUILD_ID.json beside the exe",
    async run() {
      await withPackagedAnchor(async (anchor) => {
        await writeFile(
          path.join(anchor, BUILD_ID_FILENAME),
          JSON.stringify({ buildId: "b3319d6.20260726T134012", installedAt: "2026-07-26T13:40:12.000Z" }),
          "utf8",
        );
        const info = readBuildInfo({ env: { AOF_RUNTIME_MODE: "payload" } });
        assert.equal(info.mode, "payload");
        assert.equal(info.buildId, "b3319d6.20260726T134012");
        assert.equal(info.installedAt, "2026-07-26T13:40:12.000Z");
        assert.equal(buildInfoString(info), "payload b3319d6.20260726T134012");
      });
    },
  },
  {
    name: "build-info/item-1 an unstamped or corrupt install degrades to embedded + no build stamp — never a throw",
    async run() {
      await withPackagedAnchor(async (anchor) => {
        // No BUILD_ID.json at all (a pre-launcher install).
        const absent = readBuildInfo({ env: {} });
        assert.equal(absent.mode, "embedded", "no stamp + no env -> the embedded default");
        assert.equal(absent.buildId, null);
        assert.equal(buildInfoString(absent), "embedded, no build stamp");

        // A corrupt stamp reads the same as an absent one.
        await writeFile(path.join(anchor, BUILD_ID_FILENAME), "{ not json", "utf8");
        const corrupt = readBuildInfo({ env: { AOF_RUNTIME_MODE: "payload" } });
        assert.equal(corrupt.mode, "payload", "the mode stamp is independent of the build stamp");
        assert.equal(corrupt.buildId, null, "a corrupt stamp is null, never a fabricated id");
      });
    },
  },
];
