#!/usr/bin/env node
// milestone 28 / story 01 (ADR-002, task 00_ci-build-matrix.feature) — stages
// the Linux node-pty `.node`, compiled from source by `npm ci` (node-pty
// ships NO linux-* prebuild — RESEARCH §2 — so a normal `npm install` on a
// Linux runner naturally falls through to `node-gyp rebuild`, landing the
// compiled addon at node_modules/node-pty/build/Release/pty.node).
//
// Story 00's scripts/build-sea.mjs (untouched — not this story's file)
// expects a `node_modules/node-pty/prebuilds/<platform>-<arch>/` directory
// (ptyPrebuildDir()) shaped exactly like the shipped mac/Windows prebuilds.
// A source compile does NOT create that directory — it only populates
// build/Release/. This script bridges the gap WITHOUT editing build-sea.mjs:
// it copies the compiled build/Release/pty.node into the
// prebuilds/linux-<arch>/ shape build-sea.mjs already knows how to consume,
// so the CI Linux leg can run build-sea.mjs UNCHANGED after this step.
//
//   node scripts/release/stage-linux-node-pty-prebuild.mjs
//
// Verifies the freshly-staged .node actually process.dlopen()s on THIS
// runner before declaring success (the task feature's "the built linux .node
// loads under process.dlopen on that runner" assertion) — a compile that
// produces a file but fails to load is caught here, not downstream.
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);

function main() {
  if (process.platform !== "linux") {
    throw new Error(`stage-linux-node-pty-prebuild.mjs must run on a Linux runner (process.platform=${process.platform}).`);
  }

  const arch = process.arch;
  const nodePtyDir = path.join(repoRoot, "node_modules", "node-pty");
  const compiledPath = path.join(nodePtyDir, "build", "Release", "pty.node");

  if (!existsSync(compiledPath)) {
    throw new Error(
      `Compiled pty.node not found at ${compiledPath}. ` +
      `Expected 'npm ci' to have compiled node-pty from source (no linux-* prebuild is shipped, RESEARCH §2) — ` +
      `check that a C++ toolchain (build-essential/python3) is available on this runner.`
    );
  }

  const targetDir = path.join(nodePtyDir, "prebuilds", `linux-${arch}`);
  mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, "pty.node");
  copyFileSync(compiledPath, targetPath);
  console.log(`Staged compiled node-pty: ${compiledPath} -> ${targetPath}`);

  // Confirm it dlopens on THIS runner (a compile that produces a file but
  // does not actually load is a silent downstream failure otherwise).
  const loaded = require(targetPath);
  if (!loaded || typeof loaded !== "object") {
    throw new Error(`Staged pty.node at ${targetPath} did not produce a usable module object on require().`);
  }
  console.log(`Verified: ${targetPath} loads under process.dlopen (require() succeeded) on linux-${arch}.`);
}

main();
