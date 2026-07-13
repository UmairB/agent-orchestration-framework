// milestone 28 / story 00 (ADR-001/ADR-003) — the asset-manifest generator.
//
// Walks the two runtime directory-asset trees (src/bundle/** — 41 files —
// and ui/dist/**) into the flat file list the SEA sidecar build copies
// verbatim beside the binary (ADR-003: directory assets are not a SEA `assets`
// map primitive — RESEARCH §1 — so the build recipe ships them as an on-disk
// sidecar tree the asset-base seam's SEA branch reads with a plain
// readdir/readFile, the SAME shape as its dev branch).
//
// A pure function over real trees: generateAssetManifest(repoRoot) returns
// { bundle: string[], ui: string[] } — POSIX-style relative paths, sorted.
// Consumed by:
//   - scripts/build-sea.mjs (copies every listed file into the sidecar dir)
//   - test/bundle-asset-manifest-complete.test.mjs (fitness #4 — a set-equality
//     over the manifest's output vs the real trees, so nothing is silently
//     omitted from the binary)
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

// Recursively list every FILE under `dir`, returned as POSIX-style paths
// relative to `dir`, sorted. Symlinks are treated as regular files/dirs via
// statSync (not lstatSync) — matches the plain readdirSync/readFileSync walk
// the asset-base seam performs at runtime.
function walkFiles(dir) {
  const out = [];
  function recurse(current) {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        recurse(full);
      } else if (st.isFile()) {
        out.push(path.relative(dir, full).split(path.sep).join("/"));
      }
    }
  }
  recurse(dir);
  return out.sort();
}

// generateAssetManifest(repoRoot) -> { bundle: string[], ui: string[] }
//   bundle — every file under <repoRoot>/src/bundle/**, relative to that root
//            (e.g. "bundle.json", "commands/next.md").
//   ui     — every file under <repoRoot>/ui/dist/**, relative to that root
//            (e.g. "index.html", "assets/index.js").
export function generateAssetManifest(repoRoot) {
  const bundleDir = path.join(repoRoot, "src", "bundle");
  const uiDistDir = path.join(repoRoot, "ui", "dist");
  return {
    bundle: walkFiles(bundleDir),
    ui: walkFiles(uiDistDir),
  };
}
