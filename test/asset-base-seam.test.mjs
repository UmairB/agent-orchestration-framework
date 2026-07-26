// Traceability wiring for milestone 28 / story 00, task 00 —
// tasks/00_asset-base-seam.feature (ADR-003).
//
// Covers every @executable scenario against the REAL src/asset-base.mjs, driven
// in-process by flipping the injectable "in a SEA?" sentinel + sidecar anchor
// (no built binary needed — the Build notes' developer-seat guidance).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assetBase,
  readAssetText,
  listAssetMembers,
  isPackaged,
  setSeaSentinelForTest,
  setSidecarAnchorForTest,
  packageVersionString,
} from "../src/asset-base.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Build a packaged-layout fixture: <tmp>/<execDirName>/{bundle/**, ui/dist/**, package.json}
// mirroring the real src/bundle + ui/dist trees + a trimmed package.json, so the
// SEA branch reads real bytes without a built binary.
async function makePackagedFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-sea-fixture-"));
  await cp(path.join(repoRoot, "src", "bundle"), path.join(tmp, "bundle"), { recursive: true });
  await mkdir(path.join(tmp, "ui"), { recursive: true });
  await cp(path.join(repoRoot, "ui", "dist"), path.join(tmp, "ui", "dist"), { recursive: true });
  await writeFile(path.join(tmp, "package.json"), JSON.stringify({ version: "9.9.9-fixture" }, null, 2), "utf8");
  return tmp;
}

function resetSeam() {
  setSeaSentinelForTest(undefined);
  setSidecarAnchorForTest(undefined);
}

export const assetBaseSeamTests = [
  {
    name: "asset-base-seam/00 in a dev run the seam returns the current import.meta.url path verbatim (dev behaviour byte-for-byte)",
    async run() {
      resetSeam();
      try {
        setSeaSentinelForTest(false);
        const resolved = assetBase("bundle");
        const expected = path.join(repoRoot, "src", "bundle");
        assert.equal(resolved, expected, "the resolved base equals the pre-seam import.meta.url-derived bundle root exactly");

        const throughSeam = readAssetText("bundle", "bundle.json");
        const direct = readFileSync(path.join(expected, "bundle.json"), "utf8");
        assert.equal(throughSeam, direct, "reading src/bundle/bundle.json through the seam returns the same bytes as reading it directly");

        assert.equal(isPackaged(), false, "no SEA API is called on the dev path (isPackaged reports false with no throw)");
      } finally {
        resetSeam();
      }
    },
  },
  {
    name: "asset-base-seam/01 with the SEA sentinel on, the seam resolves the packaged base for bundle-root",
    async run() {
      resetSeam();
      const fixture = await makePackagedFixture();
      try {
        setSeaSentinelForTest(true);
        setSidecarAnchorForTest(fixture);
        const resolved = assetBase("bundle");
        assert.ok(resolved.startsWith(fixture), "the resolved path is under the packaged exec dir, not a src/ path");
        assert.equal(readAssetText("bundle", "bundle.json"), readFileSync(path.join(fixture, "bundle", "bundle.json"), "utf8"), "reading bundle/bundle.json through the seam returns its packaged bytes");
      } finally {
        resetSeam();
        await rm(fixture, { recursive: true, force: true });
      }
    },
  },
  {
    name: "asset-base-seam/01 with the SEA sentinel on, the seam resolves the packaged base for a nested bundle member",
    async run() {
      resetSeam();
      const fixture = await makePackagedFixture();
      try {
        setSeaSentinelForTest(true);
        setSidecarAnchorForTest(fixture);
        const throughSeam = readAssetText("bundle", "commands/autonomous.md");
        const direct = readFileSync(path.join(fixture, "bundle", "commands", "autonomous.md"), "utf8");
        assert.equal(throughSeam, direct, "reading a nested bundle member (commands/autonomous.md) through the seam returns its packaged bytes");
      } finally {
        resetSeam();
        await rm(fixture, { recursive: true, force: true });
      }
    },
  },
  {
    name: "asset-base-seam/01 with the SEA sentinel on, the seam resolves the packaged bundle manifest",
    async run() {
      resetSeam();
      const fixture = await makePackagedFixture();
      try {
        setSeaSentinelForTest(true);
        setSidecarAnchorForTest(fixture);
        const throughSeam = readAssetText("bundle", "manifest.json");
        const direct = readFileSync(path.join(fixture, "bundle", "manifest.json"), "utf8");
        assert.equal(throughSeam, direct, "reading bundle/manifest.json through the seam returns its packaged bytes");
      } finally {
        resetSeam();
        await rm(fixture, { recursive: true, force: true });
      }
    },
  },
  {
    name: "asset-base-seam/01 with the SEA sentinel on, the seam resolves the packaged ui/dist index",
    async run() {
      resetSeam();
      const fixture = await makePackagedFixture();
      try {
        setSeaSentinelForTest(true);
        setSidecarAnchorForTest(fixture);
        const resolved = assetBase("ui");
        assert.ok(resolved.startsWith(fixture), "the resolved ui base is under the packaged exec dir, not a src/ path");
        const throughSeam = readAssetText("ui", "dist/index.html");
        const direct = readFileSync(path.join(fixture, "ui", "dist", "index.html"), "utf8");
        assert.equal(throughSeam, direct, "reading ui/dist/index.html through the seam returns its packaged bytes");
      } finally {
        resetSeam();
        await rm(fixture, { recursive: true, force: true });
      }
    },
  },
  {
    name: "asset-base-seam/01 with the SEA sentinel on, the seam resolves a nested ui/dist asset",
    async run() {
      resetSeam();
      const fixture = await makePackagedFixture();
      try {
        setSeaSentinelForTest(true);
        setSidecarAnchorForTest(fixture);
        const nestedMembers = listAssetMembers("ui", "dist/assets");
        assert.ok(nestedMembers.length > 0, "the packaged ui/dist/assets directory has at least one member");
        const first = nestedMembers[0];
        const throughSeam = readAssetText("ui", `dist/assets/${first}`);
        const direct = readFileSync(path.join(fixture, "ui", "dist", "assets", first), "utf8");
        assert.equal(throughSeam, direct, "reading a nested ui/dist/assets/* member through the seam returns its packaged bytes");
      } finally {
        resetSeam();
        await rm(fixture, { recursive: true, force: true });
      }
    },
  },
  {
    name: "asset-base-seam/01 with the SEA sentinel on, the seam resolves the packaged version string",
    async run() {
      resetSeam();
      const fixture = await makePackagedFixture();
      try {
        setSeaSentinelForTest(true);
        setSidecarAnchorForTest(fixture);
        assert.equal(packageVersionString(), "9.9.9-fixture", "the packaged version string reads from the sidecar's package.json");
      } finally {
        resetSeam();
        await rm(fixture, { recursive: true, force: true });
      }
    },
  },
  {
    name: "asset-base-seam/02 under a SEA the seam enumerates the packaged bundle members (the walker's directory-list step)",
    async run() {
      resetSeam();
      const fixture = await makePackagedFixture();
      try {
        setSeaSentinelForTest(true);
        setSidecarAnchorForTest(fixture);
        const packagedMembers = listAssetMembers("bundle", "commands");
        const directMembers = (await import("node:fs")).readdirSync(path.join(fixture, "bundle", "commands")).sort();
        assert.deepEqual(packagedMembers, directMembers, "the walker lists exactly the packaged member set, not a src/ listing");
        for (const member of packagedMembers) {
          const throughSeam = readAssetText("bundle", `commands/${member}`);
          const direct = readFileSync(path.join(fixture, "bundle", "commands", member), "utf8");
          assert.equal(throughSeam, direct, `packaged member ${member} reads its packaged bytes through the seam`);
        }
      } finally {
        resetSeam();
        await rm(fixture, { recursive: true, force: true });
      }
    },
  },
  {
    name: "asset-base-seam/03 under a SEA a missing packaged asset fails with a locatable error, not a silent src/ fallback",
    async run() {
      resetSeam();
      const fixture = await makePackagedFixture();
      try {
        setSeaSentinelForTest(true);
        setSidecarAnchorForTest(fixture);
        assert.throws(
          () => readAssetText("bundle", "commands/does-not-exist.md"),
          (error) => {
            assert.equal(error.code, "asset-missing", "the error carries the asset-missing code");
            assert.match(error.message, /commands\/does-not-exist\.md/, "the error names the missing asset key/path");
            return true;
          },
          "resolving a missing packaged asset throws a locatable error"
        );
        // It never silently falls back to a src/-tree path that does not exist
        // in a binary — the throw's message names the SIDECAR path, not src/.
        try {
          readAssetText("bundle", "commands/does-not-exist.md");
          assert.fail("expected a throw");
        } catch (error) {
          assert.ok(!error.message.includes(path.join(repoRoot, "src", "bundle")), "the error does not reference a src/-tree fallback path");
        }
      } finally {
        resetSeam();
        await rm(fixture, { recursive: true, force: true });
      }
    },
  },
  {
    name: "asset-base-seam/03 under a SEA a missing packaged directory (sidecar ENOENT) fails with a locatable error",
    async run() {
      resetSeam();
      const fixture = await makePackagedFixture();
      try {
        setSeaSentinelForTest(true);
        setSidecarAnchorForTest(fixture);
        assert.throws(
          () => listAssetMembers("bundle", "no-such-subdir"),
          (error) => {
            assert.equal(error.code, "asset-missing");
            assert.match(error.message, /no-such-subdir/);
            return true;
          },
          "enumerating a missing packaged directory throws a locatable error, not an empty list"
        );
      } finally {
        resetSeam();
        await rm(fixture, { recursive: true, force: true });
      }
    },
  },
  {
    name: "asset-base-seam/04 flipping the sentinel re-homes every consumer's read base in lock-step (one seam, seven sites)",
    async run() {
      resetSeam();
      const fixture = await makePackagedFixture();
      try {
        setSeaSentinelForTest(false);
        const devBundle = assetBase("bundle");
        const devUi = assetBase("ui");
        const devVersion = assetBase("version");
        assert.ok(!devBundle.startsWith(fixture), "off: bundle base is the src/ tree");
        assert.ok(!devUi.startsWith(fixture), "off: ui base is the src/ tree");
        assert.ok(!devVersion.startsWith(fixture), "off: version base is the src/ tree");

        setSidecarAnchorForTest(fixture);
        setSeaSentinelForTest(true);
        const seaBundle = assetBase("bundle");
        const seaUi = assetBase("ui");
        const seaVersion = assetBase("version");
        assert.ok(seaBundle.startsWith(fixture), "on: bundle base is the packaged base");
        assert.ok(seaUi.startsWith(fixture), "on: ui base is the packaged base");
        assert.ok(seaVersion.startsWith(fixture), "on: version base is the packaged base");
      } finally {
        resetSeam();
        await rm(fixture, { recursive: true, force: true });
      }
    },
  },
];
