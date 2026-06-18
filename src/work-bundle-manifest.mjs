// The content-addressed bundle manifest (milestone 01 / story 00, ADR-002).
//
// The shipped manifest catalogues the canonical render of the bundle: one entry
// per RENDERED file as `{ path, runtime, resource: {id, kind}, hash }` where
// `hash === hashContent(renderedContent)` — the SAME sha256 scheme and the SAME
// entry shape as a lock `files[]` entry (src/lock.mjs). It carries a top-level
// `bundleVersion` (the aof package version) so a consumer can see their release.
//
// Determinism (the byte-for-byte stable-regeneration scenario): entries are
// sorted by (path, runtime) and the manifest embeds NO timestamps.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle, renderBundleOutputs, bundleRoot } from "./work-bundle.mjs";

// The runtimes the shipped manifest is generated for. Claude is ACD's native
// home where every member (agents, commands, templates) is supported (ADR-006).
export const MANIFEST_RUNTIMES = ["claude"];

// The aof package version (ADR-002 bundle version). Read straight from
// package.json — exported so init/update can stamp the install manifest's
// `bundle.version` WITHOUT re-rendering the bundle just to read a string.
export function packageVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
  return pkg.version;
}

function manifestEntry(output) {
  return {
    path: String(output.path).replaceAll("\\", "/"),
    runtime: output.runtime,
    resource: { id: output.resource.id, kind: output.resource.kind },
    hash: output.hash
  };
}

function byPathThenRuntime(a, b) {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.runtime < b.runtime ? -1 : a.runtime > b.runtime ? 1 : 0;
}

// Build the manifest object from a loaded bundle. Pure + deterministic.
export function generateBundleManifest(bundle = loadBundle(), options = {}) {
  const runtimes = options.runtimes ?? MANIFEST_RUNTIMES;
  const outputs = renderBundleOutputs(bundle, { runtimes });
  const entries = outputs.map(manifestEntry).sort(byPathThenRuntime);
  return {
    bundleVersion: options.bundleVersion ?? packageVersion(),
    runtimes,
    entries
  };
}

// The exact bytes the shipped manifest file holds (and that regeneration must
// reproduce byte-for-byte).
export function serializeBundleManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function manifestPath() {
  return path.join(bundleRoot(), "manifest.json");
}

export function readShippedManifest() {
  return JSON.parse(readFileSync(manifestPath(), "utf8"));
}
