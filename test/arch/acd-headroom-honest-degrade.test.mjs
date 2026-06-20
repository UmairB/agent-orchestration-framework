// Fitness function for milestone 06 / ADR-003:
// "`resolveHeadroomLaunch` is the single, pure wrap decision and it honest-degrades:
//   - work.headroom absent OR enabled !== true        → raw launch UNCHANGED
//   - provider not in the routable set ("gemini")      → raw launch UNCHANGED (never wrappable)
//   - enabled + routable but `headroom` not on PATH    → raw launch UNCHANGED (degrade, never break)
//   - enabled + routable + headroom on PATH            → { bin:<headroom>, args:['wrap', provider, ...rawArgs] }
//  It performs no spawn and no real PATH walk — the headroom lookup is the injected `which`."
//
// RED-until-built and CORRECT: src/headroom.mjs does not export
// `resolveHeadroomLaunch` yet, so the import below rejects with ERR_MODULE_NOT_FOUND
// (a missing-source red, not a syntax error). The wrap-routing story builds the
// module against this exact frozen signature; the test then drives every branch.
//
// Pure behavioural proof over the frozen resolver (a stubbed `which`, no PTY) —
// mirrors how terminal-providers injects `which` so degrade branches need no real PATH.
import assert from "node:assert/strict";

// LAZY resolution (NOT a top-level import): src/headroom.mjs does not exist yet, so
// each run() dynamically imports it. A missing module is then a CLEAN assertion red
// inside the case — not an ERR_MODULE_NOT_FOUND that crashes the whole suite at
// scripts/test.mjs load time (the established RED-until-built idiom, see
// acd-roundtrip-reuses-shipped-code).
const headroomUrl = new URL("../../src/headroom.mjs", import.meta.url).href;
async function loadResolver() {
  const mod = await import(headroomUrl);
  assert.equal(typeof mod.resolveHeadroomLaunch, "function", "src/headroom.mjs exports resolveHeadroomLaunch (RED until the wrap-routing story builds it)");
  return mod.resolveHeadroomLaunch;
}

const RAW_BIN = "/usr/local/bin/claude";
const RAW_ARGS = ["--print", "hello"];

// A `which` stub: headroom present at a fixed path, or always absent.
const whichPresent = (bin) => (bin === "headroom" ? "/usr/local/bin/headroom" : null);
const whichAbsent = () => null;

function rawLaunch(extra = {}) {
  return { providerId: "claude", rawBin: RAW_BIN, rawArgs: RAW_ARGS, env: {}, ...extra };
}

export const archTests = [
  {
    name: "arch/ADR-003: absent or disabled work.headroom returns the raw launch unchanged",
    run: async () => {
      const resolveHeadroomLaunch = await loadResolver();
      const off = resolveHeadroomLaunch(rawLaunch({ config: {}, which: whichPresent }));
      assert.equal(off.bin, RAW_BIN, "absent config → raw bin");
      assert.deepEqual(off.args, RAW_ARGS, "absent config → raw args");
      assert.equal(off.wrapped, false, "absent config → not wrapped");

      const disabled = resolveHeadroomLaunch(rawLaunch({ config: { work: { headroom: { enabled: false } } }, which: whichPresent }));
      assert.equal(disabled.bin, RAW_BIN, "enabled:false → raw bin");
      assert.equal(disabled.wrapped, false, "enabled:false → not wrapped");
    }
  },
  {
    name: "arch/ADR-003: gemini is NEVER wrapped, even when listed in providers and headroom is on PATH",
    run: async () => {
      const resolveHeadroomLaunch = await loadResolver();
      const result = resolveHeadroomLaunch(rawLaunch({
        providerId: "gemini",
        rawBin: "/usr/local/bin/gemini",
        config: { work: { headroom: { enabled: true, mode: "wrap", providers: ["claude", "codex", "gemini"] } } },
        which: whichPresent
      }));
      assert.equal(result.bin, "/usr/local/bin/gemini", "gemini → raw bin (never routable)");
      assert.deepEqual(result.args, RAW_ARGS, "gemini → raw args");
      assert.equal(result.wrapped, false, "gemini is never wrapped");
    }
  },
  {
    name: "arch/ADR-003: enabled + routable but headroom absent from PATH degrades to the raw launch (never breaks)",
    run: async () => {
      const resolveHeadroomLaunch = await loadResolver();
      const result = resolveHeadroomLaunch(rawLaunch({
        config: { work: { headroom: { enabled: true, mode: "wrap" } } },
        which: whichAbsent
      }));
      assert.equal(result.bin, RAW_BIN, "headroom absent → degrade to raw bin");
      assert.deepEqual(result.args, RAW_ARGS, "headroom absent → raw args (no `wrap` prefix)");
      assert.equal(result.wrapped, false, "headroom absent → not wrapped (degrade, never throw)");
    }
  },
  {
    name: "arch/ADR-003: enabled + routable + headroom on PATH wraps as `headroom wrap <provider> ...rawArgs`",
    run: async () => {
      const resolveHeadroomLaunch = await loadResolver();
      const result = resolveHeadroomLaunch(rawLaunch({
        config: { work: { headroom: { enabled: true, mode: "wrap", providers: ["claude", "codex"] } } },
        which: whichPresent
      }));
      assert.equal(result.bin, "/usr/local/bin/headroom", "bin is the resolved headroom path");
      assert.deepEqual(result.args, ["wrap", "claude", ...RAW_ARGS], "args are `wrap <provider>` then the raw args");
      assert.equal(result.wrapped, true, "the launch is wrapped");
    }
  },
  {
    name: "arch/ADR-003: a routable provider NOT in an explicit providers subset returns the raw launch unchanged",
    run: async () => {
      const resolveHeadroomLaunch = await loadResolver();
      // codex is routable but the developer scoped headroom to claude only.
      const result = resolveHeadroomLaunch(rawLaunch({
        providerId: "codex",
        rawBin: "/usr/local/bin/codex",
        config: { work: { headroom: { enabled: true, mode: "wrap", providers: ["claude"] } } },
        which: whichPresent
      }));
      assert.equal(result.bin, "/usr/local/bin/codex", "codex not in the subset → raw bin");
      assert.equal(result.wrapped, false, "not in the configured subset → not wrapped");
    }
  }
];
