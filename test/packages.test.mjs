import assert from "node:assert/strict";
import { normalizePackage, packageInstallSpec, resolvedPackageEntry } from "../src/packages.mjs";

export const packageTests = [
  {
    name: "normalizes package descriptors and direct dependencies",
    run: normalizesDescriptors
  },
  {
    name: "rejects package descriptors without namespace",
    run: rejectsMissingNamespace
  }
];

function normalizesDescriptors() {
  const npm = normalizePackage({
    id: "assistant-pack",
    namespace: "vendor",
    source: { type: "npm", package: "@vendor/assistant-pack", version: "1.2.3" },
    dependencies: ["base-pack"],
    runtimes: ["codex"]
  });

  assert.equal(npm.source, "npm:@vendor/assistant-pack@1.2.3");
  assert.equal(npm.sourceDescriptor.package, "@vendor/assistant-pack");
  assert.equal(packageInstallSpec(npm), "@vendor/assistant-pack@1.2.3");
  assert.deepEqual(npm.dependencies, ["base-pack"]);
  assert.equal(resolvedPackageEntry(npm).resolution.status, "resolved");

  const git = normalizePackage({
    id: "git-pack",
    namespace: "vendor",
    source: "git:https://example.test/vendor/git-pack.git#v1"
  });
  assert.equal(git.sourceDescriptor.ref, "v1");
  assert.equal(packageInstallSpec(git), "https://example.test/vendor/git-pack.git#v1");

  const file = normalizePackage({
    id: "local-pack",
    namespace: "vendor",
    source: { type: "file", path: "../packs/local" }
  });
  assert.equal(file.source, "file:../packs/local");
  assert.equal(packageInstallSpec(file), "../packs/local");
}

function rejectsMissingNamespace() {
  assert.throws(
    () => normalizePackage({ id: "assistant-pack", source: "npm:assistant-pack@latest" }),
    /namespace is required/
  );
}
