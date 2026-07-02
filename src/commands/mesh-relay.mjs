// mesh:relay — the relay-mode FACE / probe command (milestone 23 / story 01, ADR-001).
// Thin over src/mesh-relay.mjs. `aof mesh relay` is a long-lived serve verb (it stands up
// the stateless ws@8 broker in `relay` mode), but its registered command run is the
// NON-BLOCKING status PROBE: it reports the configured control-node, the peer-push url,
// and whether THIS node is nominated — WITHOUT calling listen()/blocking. This keeps the
// acd-mesh-command-cli-bijection gate honest (`aof mesh relay --json` runs clean +
// parseable + RETURNS, never hanging on a listen). The actual long-lived serve is
// serveRelay/relayMode, invoked by the serve launcher, not by this one-shot probe.
//
// The relay imports the record side NOTHING (file-disjoint from story 00): this command
// is thin over src/mesh-relay.mjs's relayStatus probe, which reads config via the raw
// optional-chain and stands up no listener.
import { relayStatus } from "../mesh-relay.mjs";

export const meshRelayCommand = {
  id: "mesh:relay",
  input: {
    type: "object",
    // No input today — the probe reads config.mesh.relay.* off the workspace. Additive-
    // friendly: a future `--port` for the serve launcher appends here.
    properties: {},
    additionalProperties: false,
  },

  async run(_input, ctx) {
    const ws = ctx.workspace;
    const config = ws.config ?? {};
    // The NON-BLOCKING probe (no listen, no port taken): the configured control-node +
    // url + whether this node is nominated. The serve launcher (the long-lived face) is
    // what calls relayMode/serveRelay; this registered run never blocks.
    return relayStatus(config);
  },

  cli: {
    // `aof mesh relay` — no positional (the role is config-driven, not a named ref).
    argv: () => ({}),

    // The status line: who hosts the relay + whether this node is it.
    render(result) {
      if (result == null) return "No relay status.";
      const who = result.controlNode ?? "(unnominated)";
      const here = result.nominated ? " — this node is the control node" : "";
      const at = result.url ? ` at ${result.url}` : "";
      return `Relay control node: ${who}${at}${here}`;
    },

    // The --json face is the bare status probe (the non-blocking bijection-probe shape).
    json: (result) => result,
  },
};
