// The headroom plugin's whole runtime decision — milestone 06 / ADR-003. ONE pure
// function `resolveHeadroomLaunch` decides "should this session be wrapped, and if so
// how", and it is the single place the off / gemini / degrade logic lives (so the CLI
// toggle and the terminal seam couple through this frozen contract, not scattered
// branches). It is PURE: no spawn, no real PATH walk — the headroom-on-PATH lookup is
// the INJECTED `which`, exactly the idiom terminal-providers.mjs uses, so every
// decision-table branch is a unit case with a stubbed `which` and no PTY.
//
// headroom (github.com/chopratejas/headroom) is referenced ONLY as the PATH binary
// name string "headroom" — never an aof import of the headroom PACKAGE, never an
// installer shell-out (ADR-005). The relative import of ./tool-store.mjs below is
// aof's OWN module (the store-first resolver), NOT the headroom package — the
// no-dependency guard (acd-headroom-no-dependency) excludes relative siblings.
//
// milestone-12 / ADR-004 RE-POINT: headroom's DEFAULT binary lookup now resolves
// the managed store copy first (~/.aof/tools/headroom/<version>/{Scripts|bin}/
// headroom[.exe]) and falls back to the existing PATH probe — so a provisioned
// headroom wins over a stray global, exactly as graphify does (story 02). ONLY the
// default lookup moves: resolveHeadroomLaunch's decision table (branches 1–4) and
// its injected `which ?? defaultWhich` seam are UNCHANGED.
import { resolveManagedBinary, HEADROOM_DESCRIPTOR } from "./tool-store.mjs";

// The set of providers headroom can ever front. headroom's proxy is OpenAI- and
// Anthropic-compatible only; gemini (Google GenAI) is not OpenAI-compatible, so it is
// NEVER routable — it can never enter the routable set even when listed in config.
const ROUTABLE = ["claude", "codex"];

// resolveHeadroomBinary(options?) — the store-first binary-resolution seam (ADR-004),
// mirroring story 02's resolveGraphifyBinary. It DELEGATES to tool-store.mjs's
// resolveManagedBinary, keyed on headroom's name/pinned-version/binary, so the managed
// store copy wins over a stray global and, on a store miss, it falls back to the SAME
// PATH walk milestone 06 did (now living inside the shared resolver). A total miss is
// the structured no-throw { found:false, hint } — never an opaque ENOENT.
//
// `options` forwards the resolver's injectable seams (env/platform/pathValue/
// useLocator/probe) so callers and tests can drive store/PATH/probe hermetically
// without mutating process-global state. The production default lookup passes only
// env + the env's PATH (see defaultWhich below).
export function resolveHeadroomBinary(options = {}) {
  return resolveManagedBinary({
    name: HEADROOM_DESCRIPTOR.name,
    version: HEADROOM_DESCRIPTOR.version,
    binary: "headroom",
    ...options,
  });
}

// Default lookup for the "headroom" binary — RE-POINTED STORE-FIRST (ADR-004). It
// resolves the managed store copy first, falling back to the PATH probe milestone 06
// used. Its (bin, env) => path|null CONTRACT is preserved exactly (resolveHeadroomLaunch
// branch 3 depends on it): an absent headroom still yields `null`, so the honest
// raw-launch degrade is untouched. Injected via the `which` param so the resolver is
// total and side-effect-free under test; ONLY the default resolution moves store-first.
// `_bin` is intentionally unused: this default lookup is headroom-specific (it resolves
// the headroom descriptor), and its sole caller (resolveHeadroomLaunch branch 3) always
// passes the literal "headroom". The (bin, env) shape is kept to satisfy the `which` seam.
function defaultWhich(_bin, env = process.env) {
  const pathValue = env.PATH ?? env.Path ?? "";
  const resolved = resolveHeadroomBinary({ env, pathValue });
  return resolved.path ?? null;
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
