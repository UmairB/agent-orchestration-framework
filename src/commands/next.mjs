// work:next — the next actionable item, respecting `depends` (ADR-002).
//
// `run` returns the core `nextWork` result with its `path` left a RAW ABSOLUTE in
// its on-disk OS form — NO projection inside run (the ADR-002 keystone). Path
// display is a FACE adapter: the board projects to projectRoot + forward-slash,
// the CLI to cwd (path.relative). A `done` result carries no `path`.
//
// milestone 26 / story 01 (ADR-005) — the mesh-aware overlay, gated HERE: the
// command builds the lease view ONLY when mesh is configured
// (ctx.workspace.config?.mesh?.nodeId), composing mesh-lease's claim read with the
// m23 presence staleness read. The in-memory lease cache (ctx.leaseCache — story 02
// wires the real subscriber cache) overlays disk-first: it can only ADD a skip,
// never unlease an item (23/ADR-004's git-wins discipline).
//
// milestone 27 / story 01 (ADR-004) — the routing filter UNIFIES with the lease
// view into ONE injected `candidacyView`: under the SAME config.mesh.nodeId gate,
// read this node's own descriptor + the issuance directives, drop any directive
// whose issuer is REVOKED (SECURITY T4/S-2 — the live registry re-read per next,
// fail-safe: an absent/torn registry degrades to "nobody revoked", never blinds
// the lease half), and fold a `routed:"elsewhere"` verdict onto the SAME Map the
// lease view already builds (a targeted-elsewhere item is skipped BEFORE its lease
// is even consulted — the routing-runs-first precedence). `nextWork` still takes
// exactly ONE optional argument (the `leaseView` parameter renamed/widened to
// `candidacyView` — fitness #4, extending m26/#7 verbatim); `work.mjs` still
// imports NO mesh module. The unconfigured floor is BYTE-IDENTICAL to today —
// the exact two-argument nextWork call, unperturbed by this fold-in.
import path from "node:path";
import { nextWork } from "../work.mjs";
import { buildLeaseView, readLeaseClaims } from "../mesh-lease.mjs";
import { readPresenceRecord, resolveStalenessSeconds } from "../mesh-presence.mjs";
import { readIssuanceDirectives, nodeSatisfiesTarget } from "../mesh-issuance.mjs";
import { readNodeRecord } from "../mesh-store.mjs";
import { readRegistry, isRevoked } from "../mesh-registry.mjs";

export const nextCommand = {
  id: "work:next",
  input: {
    type: "object",
    // `now` (ISO-8601 UTC-Z) is an INJECTED clock for the lease-staleness read (the
    // mesh:status white-box idiom, 22/R2 — a test input, not a CLI flag). It is read
    // ONLY inside the configured-mesh branch; the unconfigured floor never touches it.
    properties: { scope: { type: "string" }, now: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const scope = scopeOf(input);
    const ws = ctx.workspace;

    // THE CONFIG GATE (ADR-005 / ADR-004): only a mesh-configured install pays for
    // the lease + routing read. With no config.mesh.nodeId the command builds NO
    // view — the exact two-argument call of today, byte-identical for the same tree.
    const nodeId = ws.config?.mesh?.nodeId;
    if (typeof nodeId === "string" && nodeId.length > 0) {
      const nowIso = typeof input?.now === "string" && input.now.length > 0 ? input.now : new Date().toISOString();
      const nowMs = Date.parse(nowIso);
      const thresholdMs = resolveStalenessSeconds(ws.config ?? {}) * 1000;
      // The git-read lease data: every claim + each holder's presence off disk.
      const claims = await readLeaseClaims(ws);
      const presenceById = new Map();
      for (const claim of claims) {
        if (typeof claim?.nodeId !== "string" || presenceById.has(claim.nodeId)) continue;
        const presence = await readPresenceRecord(ws, claim.nodeId);
        if (presence) presenceById.set(claim.nodeId, presence);
      }
      const candidacyView = buildLeaseView(claims, presenceById, {
        nowMs,
        thresholdMs,
        // The cache-shaped hint (disk ?? cache — git wins; add-skip-only). Absent in
        // story 01's CLI face; story 02 injects the real subscriber cache.
        hint: ctx.leaseCache ?? null,
      });

      // THE ROUTING FOLD-IN (ADR-004.2/.4; SECURITY T4/S-2) — folded onto the SAME
      // Map the lease view just built (disjoint keys per ref until a targeted-
      // elsewhere verdict lands; routing runs FIRST so a skip can never be
      // out-ranked by a lease entry the caller never offered). This node's own
      // descriptor is read ONCE, as data (ADR-003.4) — no node-identity import.
      const descriptor = await readNodeRecord(ws, nodeId);
      const directives = await readIssuanceDirectives(ws);
      // The live revocation list (S-2): readRegistry tolerates ONLY ENOENT
      // (absence ⇒ the empty registry — nobody revoked); the mesh-identity.mjs
      // boardsProjection precedent wraps the call so a torn/unparseable registry
      // degrades to "nobody revoked" too — a missing/torn seam must NEVER blind
      // the routing (or lease) half of the candidacy view.
      let registry;
      try {
        registry = await readRegistry(ws);
      } catch {
        registry = null;
      }
      for (const directive of directives) {
        if (directive?.state === "withdrawn" || directive?.state === "fulfilled") continue;
        if (typeof directive?.itemRef !== "string") continue;
        // A revoked issuer's directive is dropped BEFORE the matcher ever sees it —
        // it contributes NO verdict (fail-safe: it can neither target-here nor
        // skip-elsewhere; the item behaves as if the directive does not exist).
        if (registry != null && isRevoked(registry, directive.issuer)) continue;
        if (!nodeSatisfiesTarget(descriptor, directive.target)) {
          // TARGETED-ELSEWHERE ⇒ skip, overriding any lease entry for this ref (a
          // directive can only NARROW candidacy — never widen it, ADR-004.2's
          // fail-safe direction; routing precedes the lease).
          candidacyView.set(directive.itemRef, { ...candidacyView.get(directive.itemRef), routed: "elsewhere" });
        }
        // TARGETED-HERE / UNTARGETED ⇒ no routing verdict is set (absence already
        // means offer — the lease view's existing entry, if any, stands unchanged).
      }

      return await nextWork(ws.workDir, scope, { candidacyView });
    }

    // The raw nextWork result — its `path` (when present) is the OS-native
    // absolute item directory; the command does not relativise or slash it.
    return await nextWork(ws.workDir, scope);
  },

  cli: {
    // `aof work next [scope]` — an optional positional maps onto the input.
    argv: (positionals) => (positionals[0] ? { scope: positionals[0] } : {}),

    // Reproduces today's `aof work next` human render byte-for-byte: a scope-aware
    // (faceCtx.scope) done line, the blocked line naming the unmet drivers, or the
    // ready item's two-line `ref … / cwd-relative path` form. The lease annotation
    // (m26/ADR-005) is ADDITIVE: it appears ONLY on a reclaimable result, so every
    // lease-free render stays byte-identical to today's.
    render(result, faceCtx = {}) {
      if (result.state === "done") {
        return `Nothing actionable${faceCtx.scope ? ` in ${faceCtx.scope}` : ""} — everything is done.`;
      }
      if (result.state === "blocked") {
        return `Blocked: ${result.ref} (${result.slug}) waits on milestone(s) ${result.waitingOn.join(", ")} — not done.`;
      }
      const head = `${result.ref.padEnd(7)} ${result.type.padEnd(9)} ${(result.status ?? "-").padEnd(12)} ${result.slug}`;
      const leaseNote = result.reclaimable === true
        ? `\n        reclaimable — leased by ${result.leasedBy} (stale)`
        : "";
      return `${head}\n        ${path.relative(process.cwd(), result.path)}${leaseNote}`;
    },

    // `aof work next --json` relativises `path` to cwd (cli.mjs:611), passing the
    // rest of the result through (the additive reclaimable/leasedBy keys ride the
    // spread untouched); a path-less (done) result passes through whole.
    json: (result) =>
      typeof result.path === "string"
        ? { ...result, path: path.relative(process.cwd(), result.path) }
        : result,
  },
};

function scopeOf(input) {
  const scope = typeof input?.scope === "string" ? input.scope.trim() : "";
  return scope === "" ? undefined : scope;
}
