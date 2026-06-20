// Fitness function for milestone 06 / ADR-005:
// "aof never references headroom as a dependency or installs it — headroom is a
//  PATH-detected external tool. It appears nowhere in package.json deps/devDeps nor
//  as a package node in package-lock.json, and the plugin source never imports a
//  headroom package nor invokes an installer (npm/pip/cargo install …)."
//
// State now: the MANIFEST asserts (package.json / package-lock.json) are GREEN
// immediately — headroom is not, and must never become, a dependency. The SOURCE-
// import assert is CONDITIONAL: it is skipped until src/headroom.mjs exists, then
// enforced. That keeps this test honest at every stage (no false red for a file
// that isn't built yet, no false green once it is) — the no-install guarantee is
// purely structural, so this is arch-tests only, NOT a build story (mirrors the
// milestone 05 derived-index invariant being arch-tests only).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkgPath = path.join(repoRoot, "package.json");
const lockPath = path.join(repoRoot, "package-lock.json");
// ADR-005 names "the plugin source (src/headroom.mjs AND any sibling)". The plugin's
// source surface is the resolver runtime + the enable/disable surface; both must
// reference headroom only as the PATH binary name, never an import or installer.
const pluginSourcePaths = [
  path.join(repoRoot, "src", "headroom.mjs"),
  path.join(repoRoot, "src", "work-headroom.mjs"),
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

export const archTests = [
  {
    name: "arch/ADR-005: headroom is absent from package.json dependencies and devDependencies",
    run: async () => {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      const deps = Object.keys(pkg.dependencies ?? {});
      const devDeps = Object.keys(pkg.devDependencies ?? {});
      assert.ok(!deps.includes("headroom"), "headroom is not a dependency");
      assert.ok(!devDeps.includes("headroom"), "headroom is not a devDependency");
      // Defend against scoped/aliased smuggling too.
      assert.ok(![...deps, ...devDeps].some((name) => /headroom/i.test(name)), "no headroom-named dependency of any form");
    }
  },
  {
    name: "arch/ADR-005: headroom is absent from package-lock.json package nodes",
    run: async () => {
      if (!existsSync(lockPath)) {
        // No lock to audit (e.g. a fresh checkout pre-install): the package.json
        // assert above already enforces the surface; nothing to do here.
        return;
      }
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      const packages = lock.packages && typeof lock.packages === "object" ? lock.packages : {};
      const offenders = Object.keys(packages).filter((p) => /(^|\/)headroom(@|$|\/)/i.test(p) || /node_modules\/headroom/i.test(p));
      assert.deepEqual(offenders, [], `no headroom package node in the lock: ${offenders.join(", ")}`);
    }
  },
  {
    name: "arch/ADR-005: the plugin source (src/headroom.mjs + src/work-headroom.mjs) never imports a headroom package nor invokes an installer",
    run: async () => {
      // Audit every plugin-source file that EXISTS (each is RED-until-built then
      // enforcing the moment it lands; until then the manifest asserts above carry
      // the no-dependency guarantee).
      const present = pluginSourcePaths.filter((p) => existsSync(p));
      for (const sourcePath of present) {
        const where = path.relative(repoRoot, sourcePath);
        const code = stripComments(await readFile(sourcePath, "utf8"));
        // headroom must be referenced ONLY as a PATH binary name, never imported as a
        // PACKAGE. A bare specifier containing "headroom" is forbidden; a RELATIVE
        // import of a sibling aof module (e.g. "./work-headroom.mjs") is fine and is
        // excluded by the leading-./ / leading-/ negative lookahead.
        assert.ok(!/\bfrom\s+["'](?![./])[^"']*headroom[^"']*["']/.test(code), `${where}: no \`import ... from '<headroom package>'\``);
        assert.ok(!/\brequire\(\s*["'](?![./])[^"']*headroom[^"']*["']\s*\)/.test(code), `${where}: no require('<headroom package>')`);
        // Never shell out to an installer for headroom (or anything).
        assert.ok(!/npm\s+(install|i)\b/.test(code), `${where}: no \`npm install\` shell-out`);
        assert.ok(!/pip\s+install\b/.test(code), `${where}: no \`pip install\` shell-out`);
        assert.ok(!/cargo\s+install\b/.test(code), `${where}: no \`cargo install\` shell-out`);
      }
    }
  }
];
