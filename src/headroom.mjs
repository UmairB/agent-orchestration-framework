// The headroom plugin's whole runtime decision — milestone 06 / ADR-003. ONE pure
// function `resolveHeadroomLaunch` decides "should this session be wrapped, and if so
// how", and it is the single place the off / gemini / degrade logic lives (so the CLI
// toggle and the terminal seam couple through this frozen contract, not scattered
// branches). It is PURE: no spawn, no real PATH walk — the headroom-on-PATH lookup is
// the INJECTED `which`, exactly the idiom terminal-providers.mjs uses, so every
// decision-table branch is a unit case with a stubbed `which` and no PTY.
//
// headroom (github.com/chopratejas/headroom) is referenced ONLY as the PATH binary
// name string "headroom" — never an aof import, never an installer shell-out (ADR-005).
import { delimiter, join } from "node:path";
import { existsSync } from "node:fs";

// The set of providers headroom can ever front. headroom's proxy is OpenAI- and
// Anthropic-compatible only; gemini (Google GenAI) is not OpenAI-compatible, so it is
// NEVER routable — it can never enter the routable set even when listed in config.
const ROUTABLE = ["claude", "codex"];

// Default PATH lookup for an executable name — the same shape terminal-providers.mjs
// uses (honour PATHEXT on win32 so a `.cmd`/`.exe` shim resolves like the shell would).
// Returns the resolved absolute path, or null when nothing on PATH matches. Defined
// LOCALLY (not imported) so the resolver stays self-contained and the headroom lookup
// is purely a PATH binary-name probe. Injected via the `which` param so the resolver
// is total and side-effect-free under test.
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

// resolveHeadroomLaunch — the frozen seam ↔ runtime contract (ADR-003). It is a pure
// decoration of an already-computed raw launch: it takes the raw { bin, args } plus the
// loaded config and returns EITHER the raw launch untouched OR a headroom-wrapped one.
//
//   resolveHeadroomLaunch({ providerId, config, rawBin, rawArgs, env, which }) => { bin, args, wrapped }
//
// DECISION TABLE (first match wins):
//   1. config.work?.headroom absent OR enabled !== true   → { bin: rawBin, args: rawArgs, wrapped: false }
//   2. providerId not in the routable set                 → { bin: rawBin, args: rawArgs, wrapped: false }
//        routable = (headroom.providers ?? ["claude","codex"]) ∩ {"claude","codex"}
//        (gemini is NEVER routable — it can never enter the set, even if listed)
//   3. routable, but which("headroom", env) === null      → { bin: rawBin, args: rawArgs, wrapped: false }
//        (enabled-but-unavailable DEGRADES to raw — never breaks the terminal)
//   4. enabled + routable + headroom on PATH              → {
//          bin: <resolved headroom path>,                  // the which result, NOT rawBin
//          args: ["wrap", providerId, ...rawArgs],         // `headroom wrap <provider>` then the raw args
//          wrapped: true
//        }
export function resolveHeadroomLaunch({ providerId, config, rawBin, rawArgs, env, which } = {}) {
  // The raw launch, returned unchanged on every off / not-routable / degrade branch
  // (object-identical field values + wrapped:false), so an absent-or-degraded plugin
  // is byte-for-byte today's behaviour.
  const raw = { bin: rawBin, args: rawArgs, wrapped: false };

  // Branch 1 — plugin absent or disabled (the master switch is the gate read first).
  const headroom = config?.work?.headroom;
  if (!headroom || headroom.enabled !== true) return raw;

  // Branch 2 — provider not in the routable set. The configured subset is intersected
  // with the immutable routable set, so gemini can never enter it even when listed.
  const configured = Array.isArray(headroom.providers) ? headroom.providers : ROUTABLE;
  const routable = configured.filter((p) => ROUTABLE.includes(p));
  if (!routable.includes(providerId)) return raw;

  // Branch 3 — enabled + routable but headroom is not on PATH: the honest degrade. We
  // return the raw launch (never an error, never a spawn failure). The lookup is the
  // injected `which`, defaulted lazily to the real PATH probe so callers can stub it.
  const lookup = which ?? defaultWhich;
  const headroomBin = lookup("headroom", env);
  if (headroomBin === null || headroomBin === undefined) return raw;

  // Branch 4 — enabled + routable + headroom on PATH: front the session with
  // `headroom wrap <provider>`, then the provider's own raw args flow through underneath
  // (headroom runs the provider as its child).
  return {
    bin: headroomBin,
    args: ["wrap", providerId, ...rawArgs],
    wrapped: true,
  };
}
