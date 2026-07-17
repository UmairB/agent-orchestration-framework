// Fitness function #4: bundle-asset-manifest-complete (milestone 28 / story 00,
// ADR-001/ADR-003) — a BUILD-SCRIPT UNIT test (not an arch-grep): a set-equality
// over the real src/bundle/** (37 files) + ui/dist/** trees vs. the generated
// assets map/sidecar file list (empty diff both directions), driven by the
// manifest generator's OWN output.
//
// m03 non-vacuous self-check: planting an un-manifested file under src/bundle/
// (a fixture copy, never the real tree) fails the set-equality.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, cp } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAssetManifest } from "../scripts/sea-asset-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Independent, direct-from-disk enumeration (deliberately NOT reusing
// generateAssetManifest's own walker) — the set-equality has to be checked
// against a SEPARATE reader, or a bug in the generator's walk would trivially
// pass against itself.
function listFilesDirect(dir) {
  const out = [];
  function recurse(current) {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) recurse(full);
      else if (st.isFile()) out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  }
  recurse(dir);
  return out.sort();
}

export const bundleAssetManifestCompleteTests = [
  {
    name: "bundle-asset-manifest-complete/00 the generated manifest covers every file under src/bundle/** (42 files), empty diff both directions",
    run: async () => {
      const manifest = generateAssetManifest(repoRoot);
      const direct = listFilesDirect(path.join(repoRoot, "src", "bundle"));

      assert.equal(direct.length, 42, "the real src/bundle/** tree carries exactly 42 files (37 milestone-01 baseline + 4 milestone-37 spike/chore assets + 1 milestone-39 OUTCOME.md milestone template)");
      assert.deepEqual(manifest.bundle, direct, "the generated bundle manifest is byte-identical (set + order) to the real tree's direct enumeration");

      const manifestSet = new Set(manifest.bundle);
      const directSet = new Set(direct);
      const missingFromManifest = direct.filter((f) => !manifestSet.has(f));
      const extraInManifest = manifest.bundle.filter((f) => !directSet.has(f));
      assert.deepEqual(missingFromManifest, [], "no real bundle file is missing from the manifest");
      assert.deepEqual(extraInManifest, [], "the manifest lists no bundle file that does not exist on disk");
    },
  },
  {
    name: "bundle-asset-manifest-complete/01 the generated manifest covers every file under ui/dist/**, empty diff both directions",
    run: async () => {
      const manifest = generateAssetManifest(repoRoot);
      const direct = listFilesDirect(path.join(repoRoot, "ui", "dist"));

      assert.ok(direct.length > 0, "the real ui/dist/** tree carries at least one file (the built UI is present)");
      assert.deepEqual(manifest.ui, direct, "the generated ui manifest is byte-identical (set + order) to the real tree's direct enumeration");

      const manifestSet = new Set(manifest.ui);
      const directSet = new Set(direct);
      assert.deepEqual(direct.filter((f) => !manifestSet.has(f)), [], "no real ui/dist file is missing from the manifest");
      assert.deepEqual(manifest.ui.filter((f) => !directSet.has(f)), [], "the manifest lists no ui/dist file that does not exist on disk");
    },
  },
  {
    name: "bundle-asset-manifest-complete/02 (m03 non-vacuous self-check) planting an un-manifested file under a FIXTURE bundle tree fails the set-equality",
    run: async () => {
      // A fixture copy of the real bundle tree — NEVER the real src/bundle/**
      // (the self-check must not mutate the repo's shipped bundle).
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-arch-manifest-"));
      try {
        const fixtureRepo = path.join(tmp, "repo");
        await mkdir(path.join(fixtureRepo, "src"), { recursive: true });
        await mkdir(path.join(fixtureRepo, "ui"), { recursive: true });
        await cp(path.join(repoRoot, "src", "bundle"), path.join(fixtureRepo, "src", "bundle"), { recursive: true });
        await cp(path.join(repoRoot, "ui", "dist"), path.join(fixtureRepo, "ui", "dist"), { recursive: true });

        // Generate the manifest BEFORE planting the un-manifested file — it
        // freezes the member set at that moment, exactly like a real build
        // artifact would if a file were added after manifest generation.
        const staleManifest = generateAssetManifest(fixtureRepo);

        // Plant an un-manifested file directly on disk, after the manifest
        // was generated.
        await writeFile(path.join(fixtureRepo, "src", "bundle", "planted-unmanifested.md"), "# planted\n", "utf8");

        const direct = listFilesDirect(path.join(fixtureRepo, "src", "bundle"));
        const staleSet = new Set(staleManifest.bundle);
        const missingFromManifest = direct.filter((f) => !staleSet.has(f));

        assert.ok(missingFromManifest.includes("planted-unmanifested.md"), "self-check: the set-equality FAILS (finds a missing entry) when a file is planted after manifest generation");

        // And the sanity converse: regenerating the manifest AFTER planting
        // makes the set-equality pass again (the generator is not itself broken).
        const freshManifest = generateAssetManifest(fixtureRepo);
        assert.deepEqual(freshManifest.bundle, direct, "self-check converse: a freshly regenerated manifest matches the tree again (the generator itself is correct)");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
];
