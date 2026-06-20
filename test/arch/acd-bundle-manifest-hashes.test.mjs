// Fitness function for milestone 01 / ADR-002:
// "Every entry in the shipped bundle manifest has hash === hashContent(renderedContent)
//  of the member it names — the manifest is a true content-address of the shipped
//  bundle (so update's drift detection is sound)."
//
// Render each declared member with the REAL renderer; assert each rendered hash
// equals the manifest's hash, and that the manifest's member set equals the
// rendered set. A stale shipped manifest fails here rather than shipping.
import assert from "node:assert/strict";
import { loadBundle, renderBundleOutputs } from "../../src/work-bundle.mjs";
import { readShippedManifest } from "../../src/work-bundle-manifest.mjs";
import { hashContent } from "../../src/lock.mjs";

function normalize(p) {
  return String(p).replaceAll("\\", "/");
}

export const archTests = [
  {
    name: "arch/ADR-002: every shipped manifest entry hash equals hashContent of the re-rendered member",
    run: async () => {
      const manifest = readShippedManifest();
      const rendered = renderBundleOutputs(loadBundle(), { runtimes: manifest.runtimes });
      const renderedByPath = new Map(rendered.map((o) => [normalize(o.path), o]));

      for (const entry of manifest.entries) {
        const output = renderedByPath.get(entry.path);
        assert.ok(output, `rendered output exists for manifest path ${entry.path}`);
        assert.equal(entry.hash, hashContent(output.content), `manifest hash for ${entry.path} is a true content address`);
      }
    }
  },
  {
    name: "arch/ADR-002: the manifest member set equals the rendered set (no missing, no extra entry)",
    run: async () => {
      const manifest = readShippedManifest();
      const rendered = renderBundleOutputs(loadBundle(), { runtimes: manifest.runtimes });

      const manifestPaths = manifest.entries.map((e) => normalize(e.path)).sort();
      const renderedPaths = rendered.map((o) => normalize(o.path)).sort();
      assert.deepEqual(manifestPaths, renderedPaths, "manifest paths == rendered paths");

      // Resource identity (id+kind) per entry matches the rendered output.
      const renderedByPath = new Map(rendered.map((o) => [normalize(o.path), o]));
      for (const entry of manifest.entries) {
        const output = renderedByPath.get(entry.path);
        assert.equal(entry.resource.id, output.resource.id, `${entry.path} resource id`);
        assert.equal(entry.resource.kind, output.resource.kind, `${entry.path} resource kind`);
      }
    }
  },
  {
    name: "arch/ADR-002: every manifest hash uses the sha256 lock scheme",
    run: async () => {
      const manifest = readShippedManifest();
      for (const entry of manifest.entries) {
        assert.match(entry.hash, /^sha256:[0-9a-f]{64}$/, `${entry.path} hash is sha256:<hex>`);
      }
    }
  }
];
