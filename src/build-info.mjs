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
import { isPackaged, sidecarAnchor } from "./asset-base.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

export const BUILD_ID_FILENAME = "BUILD_ID.json";

// runtimeMode({ env }) → "source" | "payload" | "embedded". Outside a SEA the
// mode is always "source" regardless of env; inside one, sea-entry.mjs's stamp
// decides, defaulting to "embedded" (a binary whose entry predates the stamp is
// by definition running its embedded bundle).
export function runtimeMode({ env = process.env } = {}) {
  if (!isPackaged()) return "source";
  return env.AOF_RUNTIME_MODE === "payload" ? "payload" : "embedded";
}

// readBuildInfo({ env }) → { mode, buildId, installedAt }. buildId/installedAt
// are null outside a SEA (git is the authority there) and on an unstamped
// install (absent-not-error, the packageVersionString degrade discipline).
export function readBuildInfo({ env = process.env } = {}) {
  const mode = runtimeMode({ env });
  let buildId = null;
  let installedAt = null;
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
// startup lines: "source" | "payload b3319d6.20260726T134012" |
// "embedded, no build stamp".
export function buildInfoString(info = readBuildInfo()) {
  if (info.mode === "source") return "source";
  return info.buildId ? `${info.mode} ${info.buildId}` : `${info.mode}, no build stamp`;
}
