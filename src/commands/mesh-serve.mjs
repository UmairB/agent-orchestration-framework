// mesh:serve — the per-node presence and global propagation daemon FACE / probe command (milestone 33 /
// story 01, ADR-003). Thin over src/mesh-launcher.mjs. `aof mesh serve` is a long-lived
// serve verb (it stands up the fabric presence/global propagation daemon), but its registered command
// run is the NON-BLOCKING probe (the mesh:relay precedent, ADR-003.2): it reports the
// fabric state + this node's resolved self-address + the peer count + whether this node
// is the control node — WITHOUT starting the long-lived daemon. This keeps the
// acd-mesh-command-cli-bijection gate honest (`aof mesh serve --json` runs clean + parseable +
// RETURNS, never hanging on a daemon). The actual long-lived daemon is startLauncher, invoked
// by the CLI's `--serve` face, not by this one-shot probe.
import { launcherProbe } from "../mesh-launcher.mjs";

export const meshServeCommand = {
  id: "mesh:serve",
  input: {
    type: "object",
    // No input today — the probe reads config.mesh.* off the workspace. Additive-
    // friendly for a future flag.
    properties: {},
    additionalProperties: false,
  },

  async run(_input, ctx) {
    // The NON-BLOCKING probe (no listen, no loop started): fabric state + self-address
    // + peer count + control-node. The `--serve` CLI face is what calls
    // startLauncher (the long-lived daemon); this registered run never blocks.
    return await launcherProbe(ctx.workspace);
  },

  cli: {
    // `aof mesh serve` — no positional (the daemon publishes/syncs THIS node, not a
    // named ref).
    argv: () => ({}),

    // The status line: fabric health + self-address + peer count + control-node role.
    render(result) {
      if (result == null) return "No launcher status.";
      const address = result.selfAddress ?? "(no address — fabric degraded)";
      const role = result.issuanceAuthority ? " — this node is the control node" : "";
      return `Fabric ${result.fabricState} (healthy: ${result.healthy}) — self-address ${address} — ${result.peerCount} peer(s)${role}`;
    },

    // The --json face is the bare probe (the non-blocking bijection-probe shape).
    json: (result) => result,
  },
};
