// The same-origin board server (finding F-1).
//
// The board's API calls are same-origin relative paths (ui/src/board/api.ts →
// fetch("/api/work/list")) and the terminal WS URL is built from
// window.location.host (ui/src/board/TerminalDock.tsx). So the board page MUST be
// served from ONE origin that also routes /api/work* and /ws/terminal. The single
// serveSetupUi server already routes all three on one port; this helper points it
// at the BUILT bundle (ui/dist) — not the vite-only dev source — and refuses to
// fall back to source when the build is missing.
//
// milestone 28 / story 00 (ADR-003): the default ui/dist location routes through
// the ONE SEA-safe asset-base seam instead of joining a path off a bare
// import.meta.url — dev behaviour is byte-for-byte unchanged (a caller-supplied
// repoRoot still wins, exactly as before; only the DEFAULT resolution changes
// carrier). A packaged binary reads the sidecar ui/dist tree instead.
//
// Original aof code (adapts nothing from vibeyard) — no attribution needed.
import { existsSync } from "node:fs";
import path from "node:path";
import { serveSetupUi } from "./setup-ui.mjs";
import { ensureWorktreeTrusted } from "./claude-trust.mjs";
import { assetPath } from "./asset-base.mjs";

export function boardUiDist(repoRoot) {
  return path.join(repoRoot, "ui", "dist");
}

// m42 wave (d) leg d1 (wave-3 tail) — the NON-BLOCKING probe behind work:ui's
// registered run (the launcher seam's probe rule: --json never launches). What
// WOULD serve: the resolved port/projectDir, whether the built board bundle is
// present (the ui-build-missing precheck), and the URL the launch would announce.
// Lives HERE so the probe and serveBoard resolve the dist identically.
export function boardUiProbe({ projectDir = process.cwd(), port = 4180, repoRoot } = {}) {
  const dist = repoRoot ? boardUiDist(path.resolve(repoRoot)) : assetPath("ui", "dist");
  return {
    mode: "board",
    port,
    projectDir: path.resolve(projectDir),
    uiDist: dist,
    uiBuildPresent: existsSync(path.join(dist, "index.html")),
    // milestone 45 / story 04 (ADR-002) — the board's ADR-002 PATH. The legacy
    // `?mode=board` form this used to advertise still works (ADR-003 translates it
    // once, client-side, at the entry); it is simply no longer MINTED here.
    boardUrl: `http://127.0.0.1:${port}/board`,
  };
}

export async function serveBoard({ projectDir = process.cwd(), port = 4178, repoRoot, spawn, which, recordSessions = true } = {}) {
  const dist = repoRoot ? boardUiDist(path.resolve(repoRoot)) : assetPath("ui", "dist");

  if (!existsSync(path.join(dist, "index.html"))) {
    const error = new Error(
      `The board UI build is missing at ${dist}. Build it first: npm --prefix ui run build`
    );
    error.code = "ui-build-missing";
    throw error;
  }

  // `trustCwd: ensureWorktreeTrusted` — a LITERAL key at THE production call site. The
  // terminal layer defaults it to a no-op precisely so no test can write the operator's
  // real ~/.claude.json; this is the one place the real writer is wired, so the board's
  // spawned agent never hits claude's blocking folder-trust dialog.
  const { server, url } = await serveSetupUi(null, { projectDir, port, uiRoot: dist, spawn, which, recordSessions, trustCwd: ensureWorktreeTrusted });
  // milestone 45 / story 04 (ADR-002) — the announced URL is the board's PATH:
  // e.g. http://127.0.0.1:PORT/board. Built with `new URL` against the server's own
  // origin rather than concatenated, so the path can never be glued onto a query the
  // origin string happens to carry. A bookmark of the legacy `?mode=board` form keeps
  // working — ADR-003 translates it at the entry — this simply stops minting it.
  const boardUrl = new URL("/board", url).toString();
  return { server, url, boardUrl };
}
