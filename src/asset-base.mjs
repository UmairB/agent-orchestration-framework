// The ONE SEA-safe asset-base seam (milestone 28 / story 00, ADR-003).
//
// Every runtime read of a bundle/UI/version asset routes through THIS module —
// no other src/**.mjs file joins an asset path off a bare
// fileURLToPath(import.meta.url)/import.meta.dirname/import.meta.url root
// (acd-sea-safe-asset-base, fitness #1). Mirrors the 12/ADR-001 frozen
// platform-aware resolver shape: ONE seam, keyed on "am I packaged", that every
// consumer calls instead of re-deriving its own base.
//
// Two branches:
//   - DEV (not a SEA): resolves EXACTLY the current import.meta.url-derived path —
//     byte-for-byte identical to the pre-seam resolution. ZERO SEA-API calls on
//     this path (sea.getAsset/getAssetKeys throw ERR_NOT_IN_SINGLE_EXECUTABLE_
//     APPLICATION outside a SEA — calling them here would be a correctness bug,
//     not just a style one).
//   - SEA (packaged): resolves a SIDECAR directory anchored at the directory
//     containing process.execPath (the same anchor ADR-002's node-pty sidecar
//     uses). Directory assets are not a SEA `assets`-map primitive (RESEARCH §1),
//     so the build recipe (ADR-001) ships src/bundle/** + ui/dist/** as real
//     on-disk sidecar directories next to the binary, and this seam's SEA branch
//     is a plain, uniform readdir/readFile over that sidecar tree — the SAME
//     enumeration shape as dev (no embedded-vs-sidecar member-set divergence, the
//     Build-notes QA feasibility flag).
//
// The "am I in a SEA?" sentinel is INJECTABLE (never a raw inline `require(
// "node:sea")` at each call site): it defaults to node:sea's isSea() (import-safe
// under a plain `node` run — verified live, it returns false without throwing),
// but a test can override it with no built binary (mirrors how terminal-ws.mjs
// injects its spawn). The sidecar anchor is ALSO injectable, so an in-process test
// can point it at a temp dir laid out like a packaged install.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- the injectable "in a SEA?" sentinel -------------------------------------

let seaOverride;

// `require` is not directly available in an ESM module; build one lazily,
// INSIDE realIsSea() below, anchored at process.execPath rather than
// import.meta.url — never a top-level `import "node:sea"` (the dev path must
// call NO SEA API) and never an eager import.meta.url read at module scope
// (esbuild's CJS bundle output — the SEA main, RESEARCH §1 — rewrites
// import.meta.url to undefined under --format=cjs, so anchoring on it would
// throw at load in the packaged binary; node:sea is a BUILT-IN module, so its
// resolution does not depend on the anchor path at all — process.execPath is
// always a valid absolute path in both dev and packaged runs).
import { createRequire } from "node:module";

// Real detection: node:sea's isSea(). Import-safe under a plain `node` run — it
// returns false, it does not throw (verified live: only sea.getAsset/
// getAssetKeys throw ERR_NOT_IN_SINGLE_EXECUTABLE_APPLICATION outside a SEA, not
// isSea() itself).
function realIsSea() {
  try {
    const nodeRequire = createRequire(process.execPath);
    const sea = nodeRequire("node:sea");
    return typeof sea.isSea === "function" ? sea.isSea() : false;
  } catch {
    return false;
  }
}

// Whether the current process is running inside a SEA. Defaults to the real
// node:sea sentinel; a test overrides via setSeaSentinelForTest.
export function isPackaged() {
  if (seaOverride !== undefined) return seaOverride;
  return realIsSea();
}

// Test-only override — flips the sentinel with no built binary (undefined resets
// to the real node:sea detection). Mirrors terminal-ws.mjs's injectable spawn.
export function setSeaSentinelForTest(value) {
  seaOverride = value;
}

// --- the injectable sidecar anchor -------------------------------------------

let sidecarAnchorOverride;

// The directory the SEA sidecar (bundle/, ui/dist/, node-pty) is anchored at —
// the directory containing process.execPath, the SAME anchor ADR-002's node-pty
// sidecar uses. A test overrides this to point at a temp dir laid out like a
// packaged install (undefined resets to the real process.execPath dir).
export function sidecarAnchor() {
  if (sidecarAnchorOverride !== undefined) return sidecarAnchorOverride;
  return path.dirname(process.execPath);
}

export function setSidecarAnchorForTest(value) {
  sidecarAnchorOverride = value;
}

// --- dev-path resolution (byte-for-byte the pre-seam behaviour) -------------

// The repo-root-relative dev bases, resolved off THIS module's own
// import.meta.url (src/asset-base.mjs lives directly in src/, exactly where
// work-bundle.mjs / board-serve.mjs / etc. resolved their own root before the
// seam existed — so "one level up from src/" is preserved verbatim).
function devSrcDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function devRepoRoot() {
  return path.resolve(devSrcDir(), "..");
}

// Per-class dev base — EXACTLY the pre-seam resolution for each of the 7 sites:
//   bundle  -> <src>/bundle           (work-bundle.mjs's old bundleRoot())
//   ui      -> <repoRoot>/ui          (setup-ui.mjs's old uiRoot default)
//   version -> <repoRoot>/package.json's directory (mesh-identity.mjs / work-bundle-manifest.mjs)
function devClassBase(assetClass) {
  if (assetClass === "bundle") return path.join(devSrcDir(), "bundle");
  if (assetClass === "ui") return path.join(devRepoRoot(), "ui");
  if (assetClass === "version") return devRepoRoot();
  throw new Error(`asset-base: unknown asset class "${assetClass}"`);
}

// --- SEA-path resolution (the sidecar) ---------------------------------------

// Per-class sidecar base, anchored at the exec dir. The build recipe (ADR-001)
// lays out the sidecar as:
//   <execDir>/bundle/**      (src/bundle/** verbatim)
//   <execDir>/ui/dist/**     (ui/dist/** verbatim — kept under ui/ so the class
//                              base below matches the dev shape's <repoRoot>/ui)
//   <execDir>/package.json   (a trimmed manifest carrying at least { version })
function seaClassBase(assetClass) {
  const anchor = sidecarAnchor();
  if (assetClass === "bundle") return path.join(anchor, "bundle");
  if (assetClass === "ui") return path.join(anchor, "ui");
  if (assetClass === "version") return anchor;
  throw new Error(`asset-base: unknown asset class "${assetClass}"`);
}

// --- the public seam -----------------------------------------------------------

// assetBase(assetClass) — THE seam. Returns the resolved base directory for one
// of the three runtime asset classes ("bundle" | "ui" | "version"). Dev: the
// current import.meta.url-derived path, verbatim. SEA: the sidecar dir anchored
// at process.execPath's directory. No SEA API is called by this function itself
// (a plain path join) — only readAsset/listAssetMembers touch the filesystem.
export function assetBase(assetClass) {
  return isPackaged() ? seaClassBase(assetClass) : devClassBase(assetClass);
}

// Read one asset's bytes as utf8 text, given its class + a path relative to that
// class's base (e.g. assetClass:"bundle", relativePath:"bundle.json" or
// "commands/next.md"; assetClass:"ui", relativePath:"index.html" or
// "assets/index.js"; assetClass:"version", relativePath:"package.json"). A
// missing packaged asset fails with ONE locatable error naming the key/path —
// never a silent fallback to a src-tree path (which does not exist in a binary).
export function readAssetText(assetClass, relativePath) {
  const base = assetBase(assetClass);
  const filePath = path.join(base, relativePath);
  if (isPackaged() && !existsSync(filePath)) {
    const key = `${assetClass}/${relativePath.replaceAll("\\", "/")}`;
    const error = new Error(
      `Packaged asset "${key}" is missing at ${filePath}. The install may be corrupt or incomplete.`
    );
    error.code = "asset-missing";
    error.assetKey = key;
    throw error;
  }
  return readFileSync(filePath, "utf8");
}

// Read one asset's raw bytes (Buffer) — the binary-safe sibling of
// readAssetText, for non-text UI assets (fonts, images) that a future consumer
// may need. Same missing-asset error discipline.
export function readAssetBuffer(assetClass, relativePath) {
  const base = assetBase(assetClass);
  const filePath = path.join(base, relativePath);
  if (isPackaged() && !existsSync(filePath)) {
    const key = `${assetClass}/${relativePath.replaceAll("\\", "/")}`;
    const error = new Error(
      `Packaged asset "${key}" is missing at ${filePath}. The install may be corrupt or incomplete.`
    );
    error.code = "asset-missing";
    error.assetKey = key;
    throw error;
  }
  return readFileSync(filePath);
}

// List the members of a directory INSIDE an asset class (the walker's LIST
// step — work-bundle.mjs's readdirSync(path.join(root, member.dir)) re-homed).
// dirRelativePath defaults to the class root itself (""). Dev: a plain readdir.
// SEA: a readdir over the sidecar (the SAME shape as dev — the seam's
// enumeration primitive returns one uniform member list regardless of the
// packaging carrier, the Build-notes QA feasibility answer). A missing packaged
// directory fails with the same locatable "asset-missing" error, never a silent
// empty list / src-tree fallback.
export function listAssetMembers(assetClass, dirRelativePath = "") {
  const base = assetBase(assetClass);
  const dirPath = dirRelativePath ? path.join(base, dirRelativePath) : base;
  if (isPackaged() && !existsSync(dirPath)) {
    const key = `${assetClass}/${(dirRelativePath || "").replaceAll("\\", "/")}`;
    const error = new Error(
      `Packaged asset directory "${key}" is missing at ${dirPath}. The install may be corrupt or incomplete.`
    );
    error.code = "asset-missing";
    error.assetKey = key;
    throw error;
  }
  return readdirSync(dirPath).sort();
}

// Whether an asset exists at class/relativePath, without throwing (used where a
// caller wants a boolean probe rather than a thrown "asset-missing" — e.g. the
// ui/dist index.html present-check board-serve.mjs / mesh-ui-serve.mjs already
// perform before serving).
export function assetExists(assetClass, relativePath) {
  const base = assetBase(assetClass);
  const filePath = relativePath ? path.join(base, relativePath) : base;
  return existsSync(filePath);
}

// The resolved absolute path for an asset (class + relative path), with NO
// existence check — used where a caller needs the path itself (e.g. to hand to
// a static file server that does its own read + 404 handling, board-serve.mjs's
// safeStaticPath idiom) rather than eagerly reading the bytes here.
export function assetPath(assetClass, relativePath = "") {
  const base = assetBase(assetClass);
  return relativePath ? path.join(base, relativePath) : base;
}

// The aof package version string. Dev: reads <repoRoot>/package.json (the exact
// prior resolution in mesh-identity.mjs / work-bundle-manifest.mjs). SEA: reads
// the sidecar's package.json (the build recipe ships a trimmed manifest carrying
// at least { version } at the exec dir). Tolerant: an unreadable/missing
// manifest degrades to "" (the pre-seam aofVersion() try/catch discipline),
// NEVER a thrown error — this one call site keeps its existing degrade contract
// rather than adopting the stricter "asset-missing" throw (callers already
// handle "" as the documented absent case).
export function packageVersionString() {
  try {
    const raw = readAssetText("version", "package.json");
    return JSON.parse(raw).version ?? "";
  } catch {
    return "";
  }
}
