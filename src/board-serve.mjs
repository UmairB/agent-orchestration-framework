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
  // `url` already ends with "/", so this yields e.g. http://127.0.0.1:PORT/?mode=board.
  const boardUrl = `${url}?mode=board`;
  return { server, url, boardUrl };
}
