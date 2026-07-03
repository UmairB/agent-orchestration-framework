// Fitness function #1: acd-sea-safe-asset-base (milestone 28 / story 00, ADR-003).
//
// "Every runtime bundle/UI/schema/version asset read routes through the single
//  SEA-safe base resolver (src/asset-base.mjs); no runtime module under src/
//  joins an asset path off a bare import.meta.url / fileURLToPath(import.meta.url)
//  root OUTSIDE that seam. Allow-list: the seam itself + the dev-only vite
//  re-exec (cli.mjs, never on the shipped path)."
//
// Comment/string-stripped source-grep across src/**.mjs: assert no module (except
// src/asset-base.mjs and the allow-listed vite re-exec line in cli.mjs) constructs
// an asset path from fileURLToPath(import.meta.url)/import.meta.dirname/
// import.meta.url joined to "bundle"/"ui"/"dist"/"package.json"; the 7 known sites
// reference assetBase()/the seam's export instead.
//
// m03 non-vacuous self-check: the matcher fires on a planted
// `path.join(fileURLToPath(import.meta.url), "bundle")` and does NOT fire on a
// call to `assetBase()`.
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(repoRoot, "src");

// The ONE seam file — exempt from the ban (it IS the resolution).
const SEAM_FILE = path.join(srcRoot, "asset-base.mjs");

// The allow-listed dev-only vite re-exec — re-homed for correctness (routes
// through assetBase("version") for the repoRoot) but it no longer constructs a
// bare import.meta.url join at all, so nothing to allow-list against today;
// kept as a named exemption in case a future edit reintroduces a literal join
// on that exact line, per ADR-003's explicit allow-list.
const ALLOWLISTED_FILE = path.join(srcRoot, "cli.mjs");

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

async function collectMjsFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectMjsFiles(full)));
    } else if (entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

// The banned shape: a bare import.meta.url/import.meta.dirname resolution
// joined (directly, or via path.dirname/path.resolve) to one of the asset
// leaf names — "bundle", "ui", "dist", "package.json" — OUTSIDE the seam. We
// scan a WINDOW of ~200 chars after each import.meta.{url,dirname} occurrence
// for one of those leaf string literals, which is exactly the shape the 7
// pre-seam sites used (`path.join(path.dirname(fileURLToPath(import.meta.url)), "bundle")`
// and siblings) and exactly what a regression would reintroduce.
function findViolations(code) {
  const violations = [];
  const metaRe = /import\.meta\.(url|dirname)/g;
  let match;
  while ((match = metaRe.exec(code)) !== null) {
    const windowEnd = Math.min(code.length, match.index + 220);
    const window = code.slice(match.index, windowEnd);
    if (/["'](bundle|ui|dist|package\.json)["']/.test(window)) {
      violations.push(window.slice(0, 120).replace(/\s+/g, " "));
    }
  }
  return violations;
}

export const archTests = [
  {
    name: "arch/ADR-003: no src/**.mjs module (outside the seam) joins an asset path off a bare import.meta.url root",
    run: async () => {
      const files = await collectMjsFiles(srcRoot);
      assert.ok(files.length > 10, "found src/**.mjs files to scan");
      const offenders = [];
      for (const file of files) {
        if (file === SEAM_FILE) continue;
        const raw = await readFile(file, "utf8");
        const code = stripComments(raw);
        const violations = findViolations(code);
        if (violations.length > 0) {
          offenders.push({ file: path.relative(repoRoot, file), violations });
        }
      }
      assert.deepEqual(offenders, [], `no module outside the seam joins an asset path off a bare import.meta.url root: ${JSON.stringify(offenders)}`);
    },
  },
  {
    name: "arch/ADR-003: the 7 known sites route through assetBase()/the seam's exports, not a bare import.meta.url join",
    run: async () => {
      const sites = [
        "work-bundle.mjs",
        "board-serve.mjs",
        "setup-ui.mjs",
        "mesh-ui-serve.mjs",
        "work-bundle-manifest.mjs",
        path.join("commands", "mesh-identity.mjs"),
      ];
      for (const rel of sites) {
        const file = path.join(srcRoot, rel);
        const code = stripComments(await readFile(file, "utf8"));
        assert.ok(
          /from\s+["'](\.\.?\/)*asset-base\.mjs["']/.test(code),
          `${rel} imports from the asset-base seam`
        );
      }
      // cli.mjs's dev-only vite re-exec also routes through the seam now.
      const cliCode = stripComments(await readFile(path.join(srcRoot, "cli.mjs"), "utf8"));
      assert.ok(/from\s+["']\.\/asset-base\.mjs["']/.test(cliCode), "cli.mjs imports from the asset-base seam");
    },
  },
  {
    name: "arch/ADR-003 (m03 non-vacuous self-check): the matcher fires on a planted bare import.meta.url join and does NOT fire on assetBase()",
    run: async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-arch-seam-"));
      try {
        const violatingCode = `
          import path from "node:path";
          import { fileURLToPath } from "node:url";
          export function bundleRoot() {
            return path.join(path.dirname(fileURLToPath(import.meta.url)), "bundle");
          }
        `;
        const legitCode = `
          import { assetBase } from "./asset-base.mjs";
          export function bundleRoot() {
            return assetBase("bundle");
          }
        `;
        const violatingPath = path.join(tmp, "planted-violation.mjs");
        const legitPath = path.join(tmp, "planted-legit.mjs");
        await writeFile(violatingPath, violatingCode, "utf8");
        await writeFile(legitPath, legitCode, "utf8");

        const violatingViolations = findViolations(stripComments(violatingCode));
        assert.ok(violatingViolations.length > 0, "self-check: the matcher FIRES on a planted bare import.meta.url join");

        const legitViolations = findViolations(stripComments(legitCode));
        assert.equal(legitViolations.length, 0, "self-check: the matcher does NOT fire on assetBase()");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
];
