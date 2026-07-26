#!/usr/bin/env node
// milestone 28 / story 00 (ADR-001) — the greenfield SEA build recipe.
//
// Produces an UNSIGNED, working, self-contained binary on the REFERENCE OS
// (KR4 minus signing; the per-OS matrix + signing is Story 01). Steps:
//
//   1. esbuild --bundle --platform=node --format=cjs --target=node22 the ESM
//      app (scripts/sea-entry.mjs, which imports bin/aof.mjs's shape via
//      src/cli.mjs's run()) into ONE CJS file — node-pty + the two asset
//      trees EXTERNALIZED (they are sidecars, ADR-002/ADR-003), asserted from
//      the esbuild --metafile so a silently-inlined native addon / asset tree
//      is a build-time failure, not a downstream crash.
//   2. Generate the sidecar layout: <outDir>/bundle/**, <outDir>/ui/dist/**,
//      a trimmed <outDir>/package.json ({ version }), and the node-pty
//      sidecar (the reference-OS prebuild copied verbatim from
//      node_modules/node-pty/prebuilds/<platform>-<arch>/).
//   3. sea-config.json -> `node --experimental-sea-config` -> sea-prep.blob.
//   4. Copy the running node binary -> postject the blob in, with the
//      NODE_SEA_FUSE sentinel (useCodeCache OFF — RESEARCH §1).
//
// Output lands under a git-ignored dir (dist-sea/ by default; override with
// --out <dir>). This script is REFERENCE-OS only (no cross-compile — ADR-001);
// it targets process.platform/process.arch as it runs.
//
// F8 (craft-review): on darwin, postject BREAKS the copied node binary's
// existing Apple signature (ARCHITECTURE ADR-005's ordering constraint), and
// arm64 macOS refuses to run unsigned/invalidly-signed code (RESEARCH §4/§6) —
// without a codesign dance around postject, "an unsigned WORKING binary on the
// reference OS" is false on a mac leg (it is SIGKILLed at exec). This script
// therefore runs `codesign --remove-signature` immediately BEFORE postject and
// an ad-hoc `codesign --sign -` immediately AFTER, on darwin ONLY (a no-op
// empty step list on win32/linux — codesign is never invoked off-darwin);
// skippable via --skip-macos-codesign / AOF_SEA_SKIP_MACOS_CODESIGN=1 for a CI
// leg whose own signing pipeline (sign-macos.mjs, `codesign --force`) runs
// immediately after this script. The mac EXECUTION of this path cannot be run
// on this authoring box (Windows) — it is an @manual verification row for
// CI/aof:verify; the command PLANNING (planMacCodesignSteps) is unit-tested
// here without invoking the real codesign binary.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, copyFileSync, chmodSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { inject as postjectInject } from "postject";
import { generateAssetManifest } from "./sea-asset-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = { out: path.join(repoRoot, "dist-sea"), skipMacosCodesign: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out" && argv[i + 1]) {
      options.out = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--skip-macos-codesign") {
      options.skipMacosCodesign = true;
    }
  }
  // Env override for CI legs that run their OWN codesign dance immediately
  // after this script (skippable, never the default — F8: ad-hoc-by-default
  // is safe since Story 01's sign-macos.mjs re-signs with --force regardless).
  if (process.env.AOF_SEA_SKIP_MACOS_CODESIGN === "1") options.skipMacosCodesign = true;
  return options;
}

// F14 — refuse to rmSync a user-supplied --out that resolves to the repo root,
// the current cwd, or any directory that looks like a SOURCE workspace (a
// `.git` dir + package.json together, or this repo's own `bin/aof.mjs` entry
// alongside package.json), so `--out .` (or an equivalent alias) can never
// nuke the working tree. Exported for a direct unit assert (no build/exec
// needed to test it).
//
// Deliberately does NOT ban a bare package.json/src alone: build-sea.mjs's own
// OUTPUT directory carries a trimmed package.json (the sidecar version stamp)
// and a `bundle/` (not `src/`) copy — a re-run into the SAME --out (the normal,
// expected "build again" case, which rmSync's it clean first) must stay
// allowed. Only SOURCE-workspace markers (.git, or the repo's own bin/aof.mjs)
// are refused.
export function assertSafeOutDir(outDir, { repoRoot: root = repoRoot, cwd = process.cwd() } = {}) {
  const resolved = path.resolve(outDir);
  const resolvedRoot = path.resolve(root);
  const resolvedCwd = path.resolve(cwd);
  if (resolved === resolvedRoot) {
    throw new Error(`Refusing to build into the repo root (${resolved}) — pass a dedicated --out directory.`);
  }
  if (resolved === resolvedCwd) {
    throw new Error(`Refusing to build into the current working directory (${resolved}) — pass a dedicated --out directory.`);
  }
  const hasGitAndPackage = existsSync(path.join(resolved, ".git")) && existsSync(path.join(resolved, "package.json"));
  const hasAofEntryAndPackage = existsSync(path.join(resolved, "bin", "aof.mjs")) && existsSync(path.join(resolved, "package.json"));
  if (hasGitAndPackage || hasAofEntryAndPackage) {
    throw new Error(`Refusing to build into ${resolved} — it looks like a SOURCE workspace (.git/bin/aof.mjs alongside package.json). Pass a dedicated --out directory.`);
  }
  return resolved;
}

// The node-pty prebuild directory for THIS reference OS/arch, per RESEARCH §2 —
// darwin-arm64/darwin-x64/win32-x64/win32-arm64 ship in the package; linux has
// no prebuild here (Story 01 compiles it in CI on a Linux runner).
function ptyPrebuildDir() {
  const platform = process.platform;
  const arch = process.arch;
  const dir = path.join(repoRoot, "node_modules", "node-pty", "prebuilds", `${platform}-${arch}`);
  if (!existsSync(dir)) {
    throw new Error(
      `No node-pty prebuild for ${platform}-${arch} at ${dir}. ` +
      `Linux has no shipped prebuild (RESEARCH §2) — it is compiled in CI (Story 01).`
    );
  }
  return dir;
}

function step(label, fn) {
  console.log(`\n=== ${label} ===`);
  const result = fn();
  console.log(`--- done: ${label} ---`);
  return result;
}

// F8 — the macOS codesign dance around postject. postject/injection BREAKS an
// existing signature (ARCHITECTURE ADR-005's ordering constraint): the runner's
// own `node` binary is Apple-signed, so copying it verbatim then postjecting
// into it leaves an INVALID signature — on darwin (especially arm64, which
// REFUSES to run unsigned/invalidly-signed code — RESEARCH §4/§6) the result is
// SIGKILLed at exec, so "a working binary on the reference OS" is false on a
// mac leg without this step.
//
// The fix: `codesign --remove-signature` BEFORE postject (strip the now-stale
// Apple signature so injection does not leave a corrupt one), then an AD-HOC
// `codesign --sign -` AFTER (re-sign so the binary is at least validly
// self-signed and will exec locally — arm64's mandatory-signing requirement).
// Ad-hoc-by-default is safe: Story 01's sign-macos.mjs re-signs with the real
// Developer ID cert via `codesign --force` (ARCHITECTURE ADR-005), so an
// ad-hoc signature here is always superseded, never load-bearing for a
// DISTRIBUTED artifact — it only makes the REFERENCE-OS build runnable.
//
// Returns the ordered list of { label, cmd, args } steps WITHOUT running them —
// callers execute each with execFileSync. This split (plan, then run) is what
// lets a non-darwin box unit-test the COMMAND PLANNING (the exact args, the
// ordering, the platform gate) without ever invoking the real `codesign`
// binary (which does not exist outside macOS).
export function planMacCodesignSteps(exePath, { platform = process.platform, skip = false } = {}) {
  if (platform !== "darwin") return [];
  if (skip) return [];
  return [
    { label: "codesign --remove-signature (strip the stale Apple signature before postject)", cmd: "codesign", args: ["--remove-signature", exePath], when: "before-postject" },
    { label: "codesign --sign - (ad-hoc re-sign after postject; superseded by Story 01's --force real-cert sign)", cmd: "codesign", args: ["--sign", "-", exePath], when: "after-postject" },
  ];
}

function runMacCodesignSteps(steps, when) {
  for (const step of steps) {
    if (step.when !== when) continue;
    console.log(`\n=== ${step.label} ===`);
    execFileSync(step.cmd, step.args, { stdio: "inherit" });
    console.log(`--- done: ${step.label} ---`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = assertSafeOutDir(options.out);
  const bundleOut = path.join(outDir, "aof-bundle.cjs");
  const metafileOut = path.join(outDir, "meta.json");

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // --- 1. esbuild -> one CJS bundle, node-pty + asset trees externalized ---
  const buildResult = step("esbuild bundle (ESM -> CJS, node22, externalized node-pty + asset trees)", () =>
    esbuild.buildSync({
      entryPoints: [path.join(repoRoot, "scripts", "sea-entry.mjs")],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      outfile: bundleOut,
      metafile: true,
      // node-pty is a native addon reached ONLY via the guarded dynamic
      // load/createRequire inside terminal-ws.mjs's defaultSpawn — it must
      // never be inlined (a .node cannot inline; ADR-002), hence the ONE
      // external entry. The two asset trees (src/bundle, ui/dist) need no
      // entry here: they are read at runtime (readFile/readdir through the
      // ADR-003 seam), never `import`ed, so esbuild never sees them as
      // inputs — they ship as the sidecar this script copies below.
      external: ["node-pty"],
      logLevel: "info",
    })
  );
  writeFileSync(metafileOut, JSON.stringify(buildResult.metafile, null, 2), "utf8");

  // --- assert externalization from the --metafile (fail loudly at build time) ---
  step("assert node-pty is externalized (not inlined)", () => {
    const inputs = Object.keys(buildResult.metafile.inputs);
    const inlinedPty = inputs.filter((file) => file.includes("node-pty") && !file.includes("node_modules/node-pty/package.json"));
    // node-pty's OWN source files must not appear as bundle inputs — only the
    // external marker keeps it out of the inputs list entirely (esbuild does
    // not include externalized packages' source among metafile.inputs).
    if (inlinedPty.length > 0) {
      throw new Error(`node-pty appears to be inlined into the bundle (metafile inputs): ${JSON.stringify(inlinedPty)}`);
    }
    const bundledSource = readFileSync(bundleOut, "utf8");
    if (/require\(["'][^"']*\.node["']\)/.test(bundledSource.replace(/\/\/[^\n]*/g, ""))) {
      throw new Error("the bundled CJS output contains an inlined require of a .node file");
    }
    console.log("node-pty is externalized — no .node inlined into the CJS bundle");
  });

  // --- 2. the sidecar layout ---
  step("generate the sidecar asset tree (src/bundle/** + ui/dist/**)", () => {
    const manifest = generateAssetManifest(repoRoot);
    for (const rel of manifest.bundle) {
      const src = path.join(repoRoot, "src", "bundle", rel);
      const dest = path.join(outDir, "bundle", rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
    for (const rel of manifest.ui) {
      const src = path.join(repoRoot, "ui", "dist", rel);
      const dest = path.join(outDir, "ui", "dist", rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
    console.log(`sidecar bundle: ${manifest.bundle.length} files, ui/dist: ${manifest.ui.length} files`);
  });

  step("write the trimmed sidecar package.json ({ version })", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ version: pkg.version }, null, 2), "utf8");
  });

  step("copy the node-pty sidecar (.node + Windows companions) for the reference OS/arch", () => {
    const prebuildDir = ptyPrebuildDir();
    const destDir = path.join(outDir, "node-pty-sidecar");
    mkdirSync(destDir, { recursive: true });
    cpSync(prebuildDir, destDir, { recursive: true });
    // node-pty's own loader resolves `../prebuilds/<platform>-<arch>` relative
    // to ITS OWN install; under a SEA it is reached via
    // createRequire(process.execPath)("node-pty") (ADR-002), so the sidecar
    // also needs node-pty's package.json + lib/ so createRequire can resolve
    // the module id at all. Copy the whole installed package next to the
    // binary as the sidecar module tree; the prebuilds/ subdir above is kept
    // for direct addon inspection/verification too.
    const nodePtyPkgDir = path.join(repoRoot, "node_modules", "node-pty");
    const sidecarModuleDir = path.join(outDir, "node_modules", "node-pty");
    mkdirSync(path.dirname(sidecarModuleDir), { recursive: true });
    cpSync(nodePtyPkgDir, sidecarModuleDir, { recursive: true });
    console.log(`node-pty sidecar copied from ${prebuildDir}`);
  });

  // --- 3 & 4. sea-config.json -> blob -> copy node -> postject ---
  const seaConfigPath = path.join(outDir, "sea-config.json");
  const blobPath = path.join(outDir, "sea-prep.blob");
  const exeName = process.platform === "win32" ? "aof.exe" : "aof";
  const exePath = path.join(outDir, exeName);

  step("write sea-config.json (useCodeCache OFF)", () => {
    const seaConfig = {
      main: bundleOut,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    };
    writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), "utf8");
  });

  step("node --experimental-sea-config -> sea-prep.blob", () => {
    execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], { cwd: outDir, stdio: "inherit" });
  });

  step("copy the running node binary as the SEA base", () => {
    copyFileSync(process.execPath, exePath);
    if (process.platform !== "win32") chmodSync(exePath, 0o755);
  });

  // F8 — the macOS codesign dance around postject (ARCHITECTURE ADR-005's
  // ordering constraint: injection breaks an existing signature). Vacuous
  // (empty steps) on every non-darwin platform and never invokes codesign
  // there. Skippable via --skip-macos-codesign / AOF_SEA_SKIP_MACOS_CODESIGN=1
  // for a CI leg whose OWN signing pipeline runs immediately after.
  const macCodesignSteps = planMacCodesignSteps(exePath, { skip: options.skipMacosCodesign });
  runMacCodesignSteps(macCodesignSteps, "before-postject");

  await step("postject the blob into the copied node binary (NODE_SEA_FUSE sentinel)", async () => {
    const blob = readFileSync(blobPath);
    await postjectInject(exePath, "NODE_SEA_BLOB", blob, {
      sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
      ...(process.platform === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
    });
  });

  runMacCodesignSteps(macCodesignSteps, "after-postject");

  console.log(`\nSEA build complete: ${exePath}`);
  console.log(`Sidecar: ${path.join(outDir, "bundle")}, ${path.join(outDir, "ui", "dist")}, ${path.join(outDir, "node-pty-sidecar")}`);
  return { exePath, outDir };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}

export { main as buildSea };
