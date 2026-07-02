// mesh:invite — the control-node-only device-code MINT (milestone 24 / story 01 /
// ADR-002 move 1 + ADR-005). A registered command-core command carrying the frozen
// { id, input, run, cli } contract (08/ADR-002), thin over story 00's registry seam:
//
//   1. GUARD — only the nominated enrollment authority mints (the relayMode /
//      isControlNode predicate). A non-control invocation is a STRUCTURED refusal —
//      no code minted, no registry write, the registry file byte-unchanged.
//   2. MINT — a 6-digit numeric code (crypto.randomInt — the 10^6 space SECURITY.md
//      T2 quantifies; TTL + single-use + the endpoint attempt-cap are the three
//      bounds that make it defensible).
//   3. HASH — the code is reduced through the ONE enrollment hash seam (sha256Hex in
//      mesh-relay.mjs — the same seam the endpoint matches through) BEFORE anything
//      durable sees it. The durable pending record carries codeHash ONLY — never a
//      plaintext code field (SECURITY T3, acd-enrollment-code-hashed-at-rest: the
//      registry is git-synced fleet-wide and lives in git history forever).
//   4. RECORD — append { codeHash, issuedAt, expiresAt, consumedAt: null } through
//      story 00's writeRegistry (THE single control-node-guarded write seam —
//      acd-registry-write-scope: this module writes no registry file itself), where
//      expiresAt = issuedAt + resolveCodeTtlSeconds(config) (ADR-005's documented
//      knob, default 300 s).
//   5. RETURN the plaintext code ONCE in the result — the operator reads it aloud /
//      pastes it into `aof mesh join <code>`; it is never persisted anywhere.
//
// issuedAt is an INJECTED white-box input (the 22/R2 inject-the-clock discipline —
// the task feature drives the TTL arithmetic over it); the live CLI face passes no
// flag for it, so production mints against wall-clock.
import crypto from "node:crypto";
import {
  isControlNode,
  readRegistry,
  writeRegistry,
  appendPendingInvite,
} from "../mesh-registry.mjs";
import { resolveCodeTtlSeconds, sha256Hex } from "../mesh-relay.mjs";

// A structured command error the mesh face renders as ONE { ok:false, error, code }
// envelope. The property is ASSIGNED (not an object-literal field) deliberately — the
// hashed-at-rest fitness forbids a bare code-named field on any enrollment-surface
// module that also writes, and this module keeps the discipline uniformly.
function refusal(message, token) {
  const error = new Error(message);
  error.code = token;
  return error;
}

export const meshInviteCommand = {
  id: "mesh:invite",
  input: {
    type: "object",
    // The injected mint instant (ISO-8601) — a white-box test input, never a CLI flag.
    properties: { issuedAt: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ws = ctx.workspace;
    const config = ws.config ?? {};

    // (1) The control-node guard — minting is an AUTHORITY decision (the same
    // predicate relayMode serves under). A non-control node refuses cleanly: no code,
    // no write, nothing for the registry to reflect.
    if (!isControlNode(config)) {
      throw refusal(
        "mesh:invite requires the control node — only the nominated enrollment authority (config.mesh.relay.controlNode === config.mesh.nodeId) can mint an invite.",
        "not-control-node"
      );
    }

    // The mint instant: injected when supplied (deterministic TTL arithmetic), else
    // wall-clock. An unparseable injected instant is an input error, not a mint.
    const issuedAt =
      typeof input?.issuedAt === "string" && input.issuedAt.length > 0
        ? input.issuedAt
        : new Date().toISOString();
    const issuedMs = Date.parse(issuedAt);
    if (Number.isNaN(issuedMs)) {
      throw refusal(`mesh:invite could not parse the injected issuedAt "${issuedAt}" as an instant.`, "invalid-input");
    }

    // (2)+(3) Mint the 6-digit code (leading zeros preserved — the full 10^6 space)
    // and reduce it through the ONE enrollment hash seam.
    const minted = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const codeHash = sha256Hex(minted);

    // (4) The TTL arithmetic (ADR-005's resolveCodeTtlSeconds — default 300 s, any
    // malformed knob → the documented default) + the add-only pending append, persisted
    // through story 00's single write seam.
    const ttlSeconds = resolveCodeTtlSeconds(config);
    const expiresAt = new Date(issuedMs + ttlSeconds * 1000).toISOString();
    const registry = await readRegistry(ws);
    const next = appendPendingInvite(registry, { codeHash, issuedAt, expiresAt });
    const persisted = await writeRegistry(ws, next, config);
    if (!persisted.written) {
      // Belt-and-braces: the seam re-checks the same predicate — a refused persist
      // must never return a code that was recorded nowhere.
      throw refusal("mesh:invite could not persist the pending invite (the registry seam refused a non-control write).", "not-control-node");
    }

    // (5) The plaintext code is returned ONCE — this result is its only existence
    // outside the operator's head; the durable record holds only codeHash.
    return { code: minted, issuedAt, expiresAt, ttlSeconds };
  },

  cli: {
    // `aof mesh invite` — no positional (the code is RETURNED, not supplied; the
    // injected issuedAt is a white-box input, not a flag).
    argv: () => ({}),

    render(result) {
      return [
        `Invite code ${result.code} — read it to the joining machine (aof mesh join ${result.code}).`,
        `Expires ${result.expiresAt} (${result.ttlSeconds}s). Shown once — the registry keeps only its hash.`,
      ].join("\n");
    },

    // The --json face is the bare mint result (the one place the plaintext exists).
    json: (result) => result,
  },
};
