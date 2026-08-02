// Fitness function for milestone 01 / ADR-001:
// "The CLI resolves the bundle root from its own module URL (import.meta.url),
//  never from process.cwd() or a consumer config value."
//
// milestone 28 / story 00 (ADR-003) CO-TOUCH: bundleRoot() now delegates to the
// ONE SEA-safe asset-base seam (src/asset-base.mjs) rather than joining
// import.meta.url directly, so the import.meta.url-resolution assert below
// re-points at asset-base.mjs (where that resolution now LIVES) and adds an
// assert that bundleRoot() routes through assetBase(). The cwd-independence +
// no-process.cwd()/no-config-lookup asserts stay green (dev behaviour is
// byte-for-byte unchanged — assetBase()'s dev branch IS the prior resolution).
//
// Three proofs:
//  1. Behavioural — load the bundle from a temp cwd unrelated to the repo and
//     assert the full member set still resolves.
//  2. Source — grep the bundle-loader source: bundleRoot() routes through
//     assetBase(), and asset-base.mjs's dev resolution uses import.meta.url;
//     work-bundle.mjs contains no `process.cwd(` and no config lookup.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle, readDescriptor, bundleRoot } from "../../src/work-bundle.mjs";

const loaderSourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "work-bundle.mjs");
const manifestSourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "work-bundle-manifest.mjs");
const assetBaseSourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "asset-base.mjs");

export const archTests = [
  {
    name: "arch/ADR-001: the bundle resolves from a temp cwd unrelated to the repo",
    run: async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-arch-loc-"));
      const originalCwd = process.cwd();
      try {
        process.chdir(tmp);
        const descriptorCount = readDescriptor().members.length;
        const bundle = loadBundle();
        // m43 — `assets` is the fourth member kind (an aof-EXCLUSIVE file installed
        // verbatim; the artifact-sync enqueue script is the first). Counted here so the
        // invariant stays what it says: EVERY descriptor member resolves from an
        // unrelated cwd, with no kind quietly falling outside the sum.
        const loaded = bundle.resources.length + bundle.hooks.length + bundle.templates.length + bundle.assets.length;
        assert.equal(loaded, descriptorCount, "full member set resolves from an unrelated cwd");
        // The resolved root is inside the source tree, not the cwd.
        assert.ok(!bundleRoot().startsWith(tmp), "bundle root is not derived from cwd");
      } finally {
        process.chdir(originalCwd);
        await rm(tmp, { recursive: true, force: true });
      }
    }
  },
  {
    name: "arch/ADR-001 (m28 co-touch, ADR-003): bundleRoot() routes through the asset-base seam, whose dev resolution uses import.meta.url; work-bundle.mjs has no process.cwd() / config lookup",
    run: async () => {
      const source = await readFile(loaderSourcePath, "utf8");
      const code = stripComments(source);

      // bundleRoot() now delegates to assetBase("bundle") — the resolution
      // ITSELF (the import.meta.url join) lives in src/asset-base.mjs, not here.
      const bundleRootFn = extractFunction(code, "bundleRoot");
      assert.ok(/assetBase\(\s*["']bundle["']\s*\)/.test(bundleRootFn), "bundleRoot() routes through assetBase(\"bundle\")");
      assert.ok(/from\s+["']\.\/asset-base\.mjs["']/.test(code), "work-bundle.mjs imports from the asset-base seam");

      // The import.meta.url resolution the bundle root rests on now lives in
      // asset-base.mjs's dev-path resolver.
      const assetBaseSource = stripComments(await readFile(assetBaseSourcePath, "utf8"));
      assert.ok(/import\.meta\.url/.test(assetBaseSource), "src/asset-base.mjs resolves the dev base via import.meta.url");

      // No cwd dependence and no consumer-config lookup anywhere in the loader
      // CODE (comments stripped — the invariant is about the executable path).
      assert.ok(!/process\.cwd\s*\(/.test(code), "loader code contains no process.cwd(");
      assert.ok(!/aof\.config\.json/.test(code), "loader code does not read a consumer config");
      assert.ok(!/readConfig|loadConfig/.test(code), "loader code does not call a config loader");
    }
  },
  {
    name: "arch/ADR-001: the manifest module locates the bundle the same way (no cwd / config on its path)",
    run: async () => {
      const code = stripComments(await readFile(manifestSourcePath, "utf8"));
      assert.ok(!/process\.cwd\s*\(/.test(code), "manifest code contains no process.cwd(");
      assert.ok(!/aof\.config\.json/.test(code), "manifest code does not read a consumer config");
    }
  }
];

// Strip `//` line comments and `/* */` block comments so the grep sees only
// executable code (the invariant is about the resolution path, not prose).
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// Crude single-function extractor: from `function <name>(` to the next
// top-level `\n}` line. Good enough to scope the grep to the resolver.
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in source`);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end + 2);
}
