// Adapted from elirantutia/vibeyard (MIT) — the CliProvider seam
// (resolveBinaryPath / validatePrerequisites / buildArgs / buildEnv → pty.spawn),
// re-homed onto aof's terminal WebSocket. vibeyard is MIT-licensed; see the repo
// NOTICE file. ADR-003: one provider interface for claude / codex / gemini,
// selected per-session by a providerId.
//
// The provider seam is the part that decides WHICH CLI gets spawned and HOW. It
// is deliberately content-free of transport: it resolves a binary, validates its
// prerequisites, and builds the spawn args/env — node-pty (terminal-ws.mjs) does
// the actual fork. Binary resolution is injectable (an optional `which` override)
// so the @executable scenarios can assert "the selected provider is the CLI that
// runs" and "a stubbed-absent binary → error" with no real PATH lookup and no PTY.
import { delimiter, join } from "node:path";
import { existsSync } from "node:fs";

// The exclusive provider vocabulary (DESIGN §4 picker; ADR-003).
export const PROVIDER_IDS = ["claude", "codex", "gemini"];

// Per-provider metadata: the id, the binary name to resolve on PATH, and the
// default args the CLI is launched with. Ported from vibeyard's per-provider
// impls (e.g. claude-provider.ts) — the shape, not the package.
const PROVIDER_META = {
  claude: { id: "claude", label: "Claude Code", bin: "claude", args: [] },
  codex: { id: "codex", label: "Codex", bin: "codex", args: [] },
  gemini: { id: "gemini", label: "Gemini", bin: "gemini", args: [] },
};

// Default PATH lookup for an executable name. On win32 we honour PATHEXT so a
// `claude.cmd`/`claude.exe` shim resolves like the shell would. Returns the
// resolved absolute path, or null when nothing on PATH matches.
function defaultWhich(bin, env = process.env) {
  const pathValue = env.PATH ?? env.Path ?? "";
  if (!pathValue) return null;
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const exts = process.platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, ext ? `${bin}${ext}` : bin);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        // ignore unreadable PATH entries
      }
    }
  }
  return null;
}

// A CliProvider — vibeyard's interface shape, re-homed. `which` is injected so
// tests can stub a present/absent binary without touching the real PATH.
class CliProvider {
  constructor(meta, which) {
    this.meta = meta;
    this.id = meta.id;
    this._which = which ?? defaultWhich;
  }

  // The resolved absolute binary path, or null when the CLI is not installed.
  resolveBinaryPath(env) {
    return this._which(this.meta.bin, env);
  }

  // True only when the binary resolves; the honest-degrade gate (ADR-003) — a
  // false here surfaces as the dock error control-frame, never a spawn attempt.
  validatePrerequisites(env) {
    return this.resolveBinaryPath(env) !== null;
  }

  // The args to pass to pty.spawn for this provider.
  buildArgs() {
    return [...this.meta.args];
  }

  // The env for the spawned session, layered over the server's base env.
  buildEnv(sessionId, baseEnv = {}, _opts = {}) {
    return {
      ...baseEnv,
      AOF_TERMINAL_SESSION: sessionId ?? "",
      AOF_TERMINAL_PROVIDER: this.id,
    };
  }
}

// Resolve a providerId to its CliProvider, or null for an unknown id. `which` is
// the injectable PATH lookup (default: real PATH); tests pass a stub.
export function resolveProvider(providerId, which) {
  const meta = PROVIDER_META[providerId];
  if (!meta) return null;
  return new CliProvider(meta, which);
}

export { CliProvider };
