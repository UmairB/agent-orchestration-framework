// Traceability wiring for milestone 33 / story 01 — fabric-native transport.
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// tasks/00_fabric-seam.feature, exercising src/mesh-fabric.mjs's three exported
// functions (probeFabric / selfAddress / resolvePeers) over an INJECTED fabric-exec
// closure (the `exec` options key) — no real tailnet, no live binary. One test object
// per @executable scenario (Scenario-Outline rows folded into one entry iterating the
// rows), each name tracing to feature + scenario. node:assert/strict.
//
//   00_fabric-seam.feature — probeFabric's two-stage refusal-reason matrix (Running /
//     ENOENT / NeedsLogin / Stopped / NeedsMachineAuth / unparseable-JSON); the Windows
//     install-path fallback tried before concluding not-installed; selfAddress parses
//     Self.TailscaleIPs[0] (null on a degraded fabric); resolvePeers' HostName/DNSName
//     join matrix (including the unjoined-peer + DNSName-leading-label rows); a
//     non-tailscale config.mesh.fabric is a clean fabric-unsupported refusal with NO
//     spawn attempted; an absent config.mesh.fabric is fabric-undeclared.
import assert from "node:assert/strict";
import { probeFabric, selfAddress, resolvePeers } from "../src/mesh-fabric.mjs";
import { sanitizeHostname } from "../src/node-identity.mjs";

const STATUS_FIXTURE = {
  Version: "1.80.0",
  BackendState: "Running",
  Self: {
    HostName: "umairs-msi",
    DNSName: "umairs-msi.tail1a2b.ts.net.",
    OS: "windows",
    TailscaleIPs: ["100.121.112.23", "fd7a:115c:a1e0::1"],
    Online: true,
  },
  Peer: {
    "nodekey:aaa": {
      HostName: "umairs-mbp",
      DNSName: "umairs-mbp.tail1a2b.ts.net.",
      OS: "macOS",
      TailscaleIPs: ["100.90.11.5", "fd7a:115c:a1e0::5"],
      Online: true,
      LastSeen: "0001-01-01T00:00:00Z",
    },
    "nodekey:bbb": {
      HostName: "build-linux",
      DNSName: "build-linux.tail1a2b.ts.net.",
      OS: "linux",
      TailscaleIPs: ["100.70.22.9"],
      Online: false,
      LastSeen: "2026-07-04T09:12:00Z",
    },
  },
};

const CONFIG = { mesh: { fabric: "tailscale" } };

// An injected fabric-exec closure scripted to a fixed outcome — one of:
//   { stdout } — a successful spawn (resolve);
//   { enoent: true } — a spawn-error rejection shaped like Node's real ENOENT;
//   { fallback: { [bin]: stdout } } — different stdout per bin (the Windows-fallback row).
function scriptedExec(outcome) {
  return async (bin) => {
    if (outcome.enoentAlways) {
      const error = new Error(`spawn ${bin} ENOENT`);
      error.code = "ENOENT";
      throw error;
    }
    if (outcome.byBin) {
      const entry = outcome.byBin[bin];
      if (entry === undefined) {
        const error = new Error(`spawn ${bin} ENOENT`);
        error.code = "ENOENT";
        throw error;
      }
      if (entry.enoent) {
        const error = new Error(`spawn ${bin} ENOENT`);
        error.code = "ENOENT";
        throw error;
      }
      return { stdout: entry.stdout, status: 0 };
    }
    return { stdout: outcome.stdout ?? "", status: 0 };
  };
}

export const meshFabricSeamTests = [
  // ══ Scenario Outline: probeFabric maps the spawn outcome / BackendState to a
  //    structured healthy-or-refusal shape ══
  {
    name: "mesh-fabric-seam/00 probeFabric maps the spawn outcome / BackendState to a structured healthy-or-refusal shape (Scenario Outline, folded)",
    async run() {
      const rows = [
        { label: "Running", exec: scriptedExec({ stdout: JSON.stringify(STATUS_FIXTURE) }), healthy: true, reason: null },
        { label: "ENOENT", exec: scriptedExec({ enoentAlways: true }), healthy: false, reason: "not-installed" },
        { label: "NeedsLogin", exec: scriptedExec({ stdout: JSON.stringify({ ...STATUS_FIXTURE, BackendState: "NeedsLogin" }) }), healthy: false, reason: "needs-login" },
        { label: "Stopped", exec: scriptedExec({ stdout: JSON.stringify({ ...STATUS_FIXTURE, BackendState: "Stopped" }) }), healthy: false, reason: "stopped" },
        { label: "NeedsMachineAuth", exec: scriptedExec({ stdout: JSON.stringify({ ...STATUS_FIXTURE, BackendState: "NeedsMachineAuth" }) }), healthy: false, reason: "needs-machine-auth" },
        { label: "not valid JSON", exec: scriptedExec({ stdout: "not json {{{" }), healthy: false, reason: "degraded" },
      ];
      for (const row of rows) {
        // Non-Windows platform so the ENOENT row does not exercise the fallback (that is
        // its own scenario below).
        const result = await probeFabric(CONFIG, { exec: row.exec, platform: "linux" });
        assert.equal(result.fabric, "tailscale", `[${row.label}] the result's fabric is "tailscale"`);
        assert.equal(result.healthy, row.healthy, `[${row.label}] the result's healthy is ${row.healthy}`);
        assert.equal(result.reason, row.reason, `[${row.label}] the result's reason is ${JSON.stringify(row.reason)}`);
      }
    },
  },

  // ══ Scenario: on Windows a bare-tailscale ENOENT retries the well-known install path
  //    before concluding not-installed ══
  {
    name: "mesh-fabric-seam/00 on Windows a bare-tailscale ENOENT retries the well-known install path before concluding not-installed",
    async run() {
      const calls = [];
      const exec = async (bin) => {
        calls.push(bin);
        if (bin === "tailscale") {
          const error = new Error("spawn tailscale ENOENT");
          error.code = "ENOENT";
          throw error;
        }
        if (bin === "C:\\Program Files\\Tailscale\\tailscale.exe") {
          return { stdout: JSON.stringify(STATUS_FIXTURE), status: 0 };
        }
        throw new Error(`unexpected bin ${bin}`);
      };
      const result = await probeFabric(CONFIG, { exec, platform: "win32" });
      assert.ok(calls.length >= 2, "the fallback install-path exec was attempted before concluding");
      assert.equal(calls[0], "tailscale", "the bare tailscale spawn was attempted first");
      assert.equal(calls[1], "C:\\Program Files\\Tailscale\\tailscale.exe", "the well-known install path was attempted next");
      assert.deepEqual(
        { healthy: result.healthy, reason: result.reason },
        { healthy: true, reason: null },
        "the result is { healthy:true, reason:null } (never not-installed)"
      );
    },
  },

  // ══ Scenario (review Fix 4 — coverage): on Windows, when BOTH the bare spawn AND the
  //    first well-known install path ENOENT, the SECOND well-known install path
  //    ("Tailscale IPN") is tried before concluding not-installed — proving the
  //    fallback sequence tries BOTH documented folder names, not only the first ══
  {
    name: "mesh-fabric-seam/00 on Windows, when the bare spawn AND the first install-path fallback both ENOENT, the SECOND well-known install path (Tailscale IPN) is tried before concluding not-installed",
    async run() {
      const calls = [];
      const exec = async (bin) => {
        calls.push(bin);
        if (bin === "tailscale") {
          const error = new Error("spawn tailscale ENOENT");
          error.code = "ENOENT";
          throw error;
        }
        if (bin === "C:\\Program Files\\Tailscale\\tailscale.exe") {
          const error = new Error("spawn ENOENT");
          error.code = "ENOENT";
          throw error;
        }
        if (bin === "C:\\Program Files\\Tailscale IPN\\tailscale.exe") {
          return { stdout: JSON.stringify(STATUS_FIXTURE), status: 0 };
        }
        throw new Error(`unexpected bin ${bin}`);
      };
      const result = await probeFabric(CONFIG, { exec, platform: "win32" });
      assert.deepEqual(
        calls,
        ["tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe", "C:\\Program Files\\Tailscale IPN\\tailscale.exe"],
        "the sequence tries the bare spawn, THEN the first fallback, THEN the second fallback — all three attempted in order"
      );
      assert.deepEqual(
        { healthy: result.healthy, reason: result.reason },
        { healthy: true, reason: null },
        "the second fallback's success yields { healthy:true, reason:null } (never not-installed)"
      );
    },
  },

  // ══ Scenario: selfAddress returns this node's 100.x v4 dial address parsed from
  //    Self.TailscaleIPs ══
  {
    name: "mesh-fabric-seam/00 selfAddress returns this node's 100.x v4 dial address parsed from Self.TailscaleIPs",
    async run() {
      const exec = scriptedExec({ stdout: JSON.stringify(STATUS_FIXTURE) });
      const address = await selfAddress(CONFIG, { exec, platform: "linux" });
      assert.equal(address, "100.121.112.23", 'the returned dialAddress is "100.121.112.23"');
    },
  },

  // ══ Scenario: selfAddress on a degraded fabric returns null, never a crash ══
  {
    name: "mesh-fabric-seam/00 selfAddress on a degraded fabric returns null, never a crash",
    async run() {
      const exec = scriptedExec({ enoentAlways: true });
      const address = await selfAddress(CONFIG, { exec, platform: "linux" });
      assert.equal(address, null, "the returned dialAddress is null");
    },
  },

  // ══ Scenario Outline: resolvePeers joins each fabric peer to an aof nodeId by
  //    HostName/DNSName, or surfaces it unjoined ══
  {
    name: "mesh-fabric-seam/00 resolvePeers joins each fabric peer to an aof nodeId by HostName/DNSName, or surfaces it unjoined (Scenario Outline, folded)",
    async run() {
      const roster = [{ nodeId: "umairs-mbp", host: "umairs-mbp" }, { nodeId: "build-linux", host: "build-linux" }];
      const rows = [
        { host: "umairs-mbp", dnsname: "umairs-mbp.tail1a2b.ts.net.", ip: "100.90.11.5", online: true, nodeId: "umairs-mbp" },
        { host: "build-linux", dnsname: "build-linux.tail1a2b.ts.net.", ip: "100.70.22.9", online: false, nodeId: "build-linux" },
        { host: "stray-laptop", dnsname: "stray-laptop.tail1a2b.ts.net.", ip: "100.55.3.1", online: true, nodeId: null },
      ];
      for (const row of rows) {
        const fixture = {
          ...STATUS_FIXTURE,
          Peer: { x: { HostName: row.host, DNSName: row.dnsname, TailscaleIPs: [row.ip], Online: row.online } },
        };
        const exec = scriptedExec({ stdout: JSON.stringify(fixture) });
        const peers = await resolvePeers(CONFIG, { exec, platform: "linux", roster });
        assert.equal(peers.length, 1, `[${row.host}] exactly one peer resolved`);
        assert.deepEqual(
          peers[0],
          { nodeId: row.nodeId, dialAddress: row.ip, online: row.online, host: row.host },
          `[${row.host}] that peer resolves to the expected shape`
        );
      }
    },
  },

  // ══ Scenario: a peer joins on its DNSName leading label when HostName alone does not
  //    match a roster nodeId ══
  {
    name: "mesh-fabric-seam/00 a peer joins on its DNSName leading label when HostName alone does not match a roster nodeId",
    async run() {
      const roster = [{ nodeId: "umairs-mbp", host: "umairs-mbp" }];
      const fixture = {
        ...STATUS_FIXTURE,
        Peer: { x: { HostName: "MacBook-Pro", DNSName: "umairs-mbp.tail1a2b.ts.net.", TailscaleIPs: ["100.90.11.5"], Online: true } },
      };
      const exec = scriptedExec({ stdout: JSON.stringify(fixture) });
      const peers = await resolvePeers(CONFIG, { exec, platform: "linux", roster });
      assert.equal(peers.length, 1, "exactly one peer resolved");
      assert.equal(peers[0].nodeId, "umairs-mbp", "the peer joins on the trailing-dot-stripped DNSName label");
    },
  },

  // ══ REGRESSION (F-3302, milestone 33 verify): a macOS node's DERIVED aof nodeId joins
  //    its live Tailscale peer across the `.local` mDNS suffix ══
  // The fixtured rows above used idealized rosters where the aof nodeId already equalled
  // the Tailscale HostName. On real macOS `os.hostname()` is `Umairs-Mac-mini.local` while
  // Tailscale reports `umairs-mac-mini`; here the roster nodeId is DERIVED from the real
  // macOS hostname (via sanitizeHostname) so a revert of the `.local` strip makes it
  // `umairs-mac-mini-local` and this join goes RED — the fixture gap that let F-3302 ship
  // green over a real cross-OS integration break.
  {
    name: "mesh-fabric-seam/00 REGRESSION (F-3302): a macOS node's derived nodeId joins its Tailscale peer across the .local mDNS suffix",
    async run() {
      const macNodeId = sanitizeHostname("Umairs-Mac-mini.local");
      assert.equal(macNodeId, "umairs-mac-mini", "the macOS `.local` hostname derives the Tailscale-matching short id");
      const roster = [{ nodeId: macNodeId, host: macNodeId }];
      const fixture = {
        ...STATUS_FIXTURE,
        Peer: { x: { HostName: "umairs-mac-mini", DNSName: "umairs-mac-mini.tail1a2b.ts.net.", TailscaleIPs: ["100.114.105.64"], Online: true } },
      };
      const exec = scriptedExec({ stdout: JSON.stringify(fixture) });
      const peers = await resolvePeers(CONFIG, { exec, platform: "linux", roster });
      assert.equal(peers.length, 1, "exactly one peer resolved");
      assert.equal(peers[0].nodeId, macNodeId, "the macOS peer JOINS its derived aof nodeId (not unjoined)");
    },
  },

  // ══ Scenario Outline: a config.mesh.fabric other than "tailscale" is a clean
  //    fabric-unsupported refusal, no spawn attempted ══
  {
    name: "mesh-fabric-seam/00 a config.mesh.fabric other than tailscale is a clean fabric-unsupported refusal, no spawn attempted (Scenario Outline, folded)",
    async run() {
      for (const fabric of ["lan", "cloudflared", "wireguard"]) {
        let spawned = false;
        const exec = async () => {
          spawned = true;
          return { stdout: "{}", status: 0 };
        };
        const result = await probeFabric({ mesh: { fabric } }, { exec, platform: "linux" });
        assert.deepEqual(result, { fabric, state: null, healthy: false, reason: "fabric-unsupported" }, `[${fabric}] the result is the structured refusal`);
        assert.equal(spawned, false, `[${fabric}] no tailscale exec was spawned`);
      }
    },
  },

  // ══ Scenario: an absent config.mesh.fabric refuses cleanly as fabric-undeclared,
  //    never a crash ══
  {
    name: "mesh-fabric-seam/00 an absent config.mesh.fabric refuses cleanly as fabric-undeclared, never a crash",
    async run() {
      let spawned = false;
      const exec = async () => {
        spawned = true;
        return { stdout: "{}", status: 0 };
      };
      const result = await probeFabric({ mesh: {} }, { exec, platform: "linux" });
      assert.equal(result.healthy, false, "the result healthy is false");
      assert.equal(result.reason, "fabric-undeclared", 'the result reason is "fabric-undeclared"');
      assert.equal(spawned, false, "no tailscale exec was spawned");
    },
  },
];
