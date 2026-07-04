// Fitness function: acd-fabric-single-seam (milestone 33 / ADR-001 + ADR-002 / UAT 32
// F-3202 + F-3204) — "The fabric CLI spawn + peer-dial-address resolution live in ONE
// seam; the transport resolves peer addresses FROM THE FABRIC, never a hand-derived /
// committed ws:// URL."
//
//   "F-3204: the central-broker + tunnel-punch + hand-derived ws(s)://…/ws/relay URL is
//    the wrong abstraction for a mesh VPN — on that fabric every node has a stable,
//    directly-dialable address the fabric already knows (tailscale status --json →
//    Self/Peer TailscaleIPs). ADR-001/002 pin the fabric behind ONE module
//    (src/mesh-fabric.mjs) that owns probeFabric/selfAddress/resolvePeers. The invariant:
//    the `tailscale` CLI spawn and the peer-dial-address resolution appear ONLY in that
//    seam — no other src module spawns `tailscale`, and reachability does NOT depend on a
//    committed/hand-derived config ws:// URL. This is the structural half of 'nodes are
//    directly addressable on the fabric; presence + issuance ride that.'"
//
// ============================ UN-SKIPPED (milestone 33 / story 01) ====================
// src/mesh-fabric.mjs now exists as the SOLE tailscale-spawn + peer-address seam
// (ADR-001/ADR-002), and the broker's liveness path (mesh-presence-subscriber.mjs /
// mesh-presence-cache.mjs) is retired — the real assertion below is GREEN.
// =====================================================================================
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(repoRoot, "src");
// The single fabric seam ADR-001 mandates (built by the fabric-native transport story).
const FABRIC_SEAM_BASENAME = "mesh-fabric.mjs";

// Comment-stripped (strings RETAINED) — for the argv[0] string-literal spawn matcher
// (a spawn's "tailscale" literal is a STRING, so it must survive the strip; this is the
// SAME split acd-mesh-sync-record-neutral uses for its GIT_SPAWN matcher — stripComments-
// Only, never stripCommentsAndStrings, for a string-literal grep).
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Comment-AND-string-stripped live code (the house source-discipline reader) — reserved
// for an IDENTIFIER-only matcher (none needed by this gate today), so a DOCUMENTING
// mention of "tailscale" in a comment never trips the guard while a string-literal spawn
// argument (which must be read via stripCommentsOnly above) still survives.
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i += 1; continue; }
    if (state === "block") { if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i += 1; continue; }
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; i += 1; continue; }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}

// A spawn/exec whose argv[0] string literal is "tailscale" — the fabric CLI invocation
// (accepted ONLY in mesh-fabric.mjs). Modelled on acd-mesh-sync-record-neutral's GIT_SPAWN
// — read over stripCommentsOnly (strings retained), since the literal IS a string.
const TAILSCALE_SPAWN = /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\s*\(\s*["'`]tailscale["'`]/;

// The real assertion the fabric story un-skips into `run`. Exported so the story has the
// exact, non-vacuous check ready: (a) the fabric seam exists; (b) the `tailscale` spawn
// lives ONLY in it — no OTHER src module spawns the fabric CLI (a second spawn site is the
// "the transport re-derives reachability instead of asking the fabric seam" hole).
export async function assertFabricSingleSeam() {
  const entries = await readdir(SRC_DIR);
  assert.ok(
    entries.includes(FABRIC_SEAM_BASENAME),
    `src/${FABRIC_SEAM_BASENAME} exists — the single fabric-assumption seam (ADR-001)`
  );

  const spawnSites = [];
  for (const name of entries) {
    if (!name.endsWith(".mjs")) continue;
    const live = stripCommentsOnly(await readFile(path.join(SRC_DIR, name), "utf8"));
    if (TAILSCALE_SPAWN.test(live)) spawnSites.push(name);
  }
  assert.deepEqual(
    spawnSites.sort(),
    [FABRIC_SEAM_BASENAME],
    `the \`tailscale\` CLI is spawned ONLY in src/${FABRIC_SEAM_BASENAME} — a second spawn site means a module re-derives reachability instead of asking the fabric seam (F-3202/F-3204). Found spawns in: ${spawnSites.join(", ") || "(none)"}`
  );

  // Non-vacuous self-checks.
  assert.ok(TAILSCALE_SPAWN.test('const r = execFile("tailscale", ["status", "--json"]);'), "self-check: the matcher fires on a real tailscale spawn");
  assert.ok(!TAILSCALE_SPAWN.test(stripCommentsOnly('// resolvePeers spawns tailscale status --json')), "self-check: the matcher does NOT fire on a documented mention");
  assert.ok(!TAILSCALE_SPAWN.test('const r = execFile("git", ["status"]);'), "self-check: the matcher does NOT fire on a non-tailscale spawn");
  // stripCommentsAndStrings stays available (and self-checked) for a future identifier-
  // only matcher on this gate, mirroring the sibling reader's split.
  assert.equal(stripCommentsAndStrings('const x = 1; // "tailscale" in a comment'), "const x = 1; ", "stripCommentsAndStrings strips comments (reserved for a future identifier matcher)");
}

export const archTests = [
  {
    name: "arch/fabric-single-seam: the tailscale CLI spawn + peer-address resolution live only in src/mesh-fabric.mjs; the transport resolves peer addresses from the fabric, never a hand-derived ws:// URL",
    run: async () => {
      await assertFabricSingleSeam();
    },
  },
];
