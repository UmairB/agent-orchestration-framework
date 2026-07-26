// src/build-info.mjs — which code is this process actually running? (TECH_DEBT
// item 1: "nothing anywhere reports which build a process is running" — measured
// live 2026-07-26, one daemon on the new build while its sibling executed a
// renamed .bak image for hours.)
//
// Three answers, one seam:
//   - "source"   — a plain node run (npm symlink / repo checkout); the code IS
//                  the working tree, git answers any further question.
//   - "payload"  — the SEA launcher loaded <exeDir>/src/cli.mjs from disk (the
//                  installed payload; sea-entry.mjs stamps AOF_RUNTIME_MODE).
//   - "embedded" — the SEA ran its compiled-in bundle (a release artefact, an
//                  AOF_SEA_EMBEDDED=1 run, or a pre-payload install).
//
// The build id comes from BUILD_ID.json beside the exe, written by
// scripts/install-local.mjs at every payload/SEA install ({ buildId,
// installedAt }). Absent-not-error: an old install has no stamp, and the answer
// is then honestly "no build stamp", never a fabricated id. Anchored at
// asset-base.mjs's sidecarAnchor() — the ONE exe-dir anchor every sidecar uses.
import path from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isPackaged, sidecarAnchor } from "./asset-base.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

export const BUILD_ID_FILENAME = "BUILD_ID.json";

// ── the SOURCE-mode build id (git) ────────────────────────────────────────────
//
// "source" alone is a blind spot, measured 2026-07-26: the Mac worker's presence
// said `build source` while it executed 74-minute-stale code — neither operator
// nor tooling could see WHICH commit a source-mode daemon runs, so a pulled-but-
// not-restarted worker was indistinguishable from a current one. In source mode
// the working tree is the build; git names it. Resolved ONCE per process (a
// presence tick calls this every few seconds — the id is what the process LOADED
// at start, so caching is correctness, not just economy): `<shortHash>` plus
// `+dirty` when the tree has uncommitted changes (the same marker
// scripts/install-local.mjs stamps). A repo without git (a tarball) degrades to
// null — buildInfoString then honestly says just "source".
let sourceBuildIdCache;

// Test seam (the setSeaSentinelForTest idiom): a string/null forces the answer;
// undefined resets to the real resolver.
export function setSourceBuildIdForTest(value) {
  sourceBuildIdCache = value;
}

function resolveSourceBuildId() {
  if (sourceBuildIdCache !== undefined) return sourceBuildIdCache;
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const hash = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8", timeout: 5000, windowsHide: true }).trim();
    if (!/^[0-9a-f]{4,40}$/.test(hash)) {
      sourceBuildIdCache = null;
      return null;
    }
    let dirty = "";
    try {
      const status = execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8", timeout: 5000, windowsHide: true });
      if (status.trim().length > 0) dirty = "+dirty";
    } catch (error) {
      // the hash stands alone — a failed dirty probe never discards it.
      reportDegrade("build-info", error);
    }
    sourceBuildIdCache = `${hash}${dirty}`;
  } catch (error) {
    // no git / not a repo — the honest answer is "source" with no id.
    reportDegrade("build-info", error);
    sourceBuildIdCache = null;
  }
  return sourceBuildIdCache;
}

// runtimeMode({ env }) → "source" | "payload" | "embedded". Outside a SEA the
// mode is always "source" regardless of env; inside one, sea-entry.mjs's stamp
// decides, defaulting to "embedded" (a binary whose entry predates the stamp is
// by definition running its embedded bundle).
export function runtimeMode({ env = process.env } = {}) {
  if (!isPackaged()) return "source";
  return env.AOF_RUNTIME_MODE === "payload" ? "payload" : "embedded";
}

// readBuildInfo({ env }) → { mode, buildId, installedAt }. In source mode the
// buildId is the repo's own git hash (resolveSourceBuildId above — null without
// git); installedAt is null. In a SEA the stamp file answers; an unstamped
// install is null (absent-not-error, the packageVersionString degrade
// discipline).
export function readBuildInfo({ env = process.env } = {}) {
  const mode = runtimeMode({ env });
  let buildId = null;
  let installedAt = null;
  if (mode === "source") {
    buildId = resolveSourceBuildId();
  }
  if (isPackaged()) {
    try {
      const raw = JSON.parse(readFileSync(path.join(sidecarAnchor(), BUILD_ID_FILENAME), "utf8"));
      if (typeof raw?.buildId === "string" && raw.buildId.length > 0) buildId = raw.buildId;
      if (typeof raw?.installedAt === "string" && raw.installedAt.length > 0) installedAt = raw.installedAt;
    } catch (error) {
      // Absent/corrupt stamp (an install that predates BUILD_ID.json): the
      // honest answer is "no build stamp", reported as such by buildInfoString.
      reportDegrade("build-info", error); }
  }
  return { mode, buildId, installedAt };
}

// buildInfoString(info?) → the one-line human form for --version and daemon
// startup lines: "source f623a6a" (or "source f623a6a+dirty") | "source" (no
// git) | "payload b3319d6.20260726T134012" | "embedded, no build stamp".
export function buildInfoString(info = readBuildInfo()) {
  if (info.mode === "source") return info.buildId ? `source ${info.buildId}` : "source";
  return info.buildId ? `${info.mode} ${info.buildId}` : `${info.mode}, no build stamp`;
}
