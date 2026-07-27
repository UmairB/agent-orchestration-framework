// The `direct` fabric (2026-07-27) — the NO-OVERLAY fabric and the two changes it
// forced: a registration override for a machine that cannot describe itself, and
// connection identity by enrollment credential rather than by remote address.
//
// Covered here:
//   - probeFabric/selfAddress/resolvePeers on `direct` (no spawn, injected seams),
//     including the ONE genuine degrade (no bindable address) and the guarantee that
//     the tailscale branch is untouched;
//   - `mesh:identity --name/--address` — the hostname-collision escape hatch (a WSL2
//     guest inherits the Windows hostname, so BOTH its derived nodeId and its
//     advertised host collide with its host's), and its survival across reload and a
//     hostname change (the self-heal carve-out);
//   - credential admission over a REAL loopback socket: admitted with an EMPTY fabric
//     peer list, refused for absent/unknown/REVOKED credentials, and attributed to the
//     credential's nodeId rather than anything the client declared.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { probeFabric, selfAddress, resolvePeers, fabricGuidance } from "../src/mesh-fabric.mjs";
import { readSidecar } from "../src/node-identity.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { meshIdentityCommand } from "../src/commands/mesh-identity.mjs";
import { startControlStreamServer } from "../src/control-stream-server.mjs";
import { verifyCredential } from "../src/mesh-registry.mjs";
import { createWorkerWsTransport } from "../src/worker-stream-client.mjs";

const DIRECT = { mesh: { fabric: "direct", nodeId: "control-a" } };
const IFACES = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  eth0: [{ address: "192.168.1.102", family: "IPv4", internal: false }],
};

const sha = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");

// A throwaway project whose .aof config declares the direct fabric, PLUS its own
// private global identity home.
//
// The private home is essential, not tidiness: `mesh:identity --name` PINS a nodeId
// into the MACHINE-WIDE identity sidecar (AOF_GLOBAL_HOME/mesh/identity.json), and a
// pinned id wins verbatim for every later loadWorkspace in the same process. Sharing
// the suite's one AOF_GLOBAL_HOME would therefore make every subsequent test on this
// machine resolve as "aof-wsl" — which is exactly what it did before this seam was
// threaded (mesh-launcher-stream-role's role resolution flipped to the pinned id).
// loadWorkspace takes an injected `env`, so each case gets a hermetic identity home.
async function scaffoldProject() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aof-direct-"));
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".aof", "aof.config.json"),
    JSON.stringify({ name: "direct-fabric-probe", mesh: { fabric: "direct" } }, null, 2),
  );
  const globalHome = await mkdtemp(path.join(tmpdir(), "aof-direct-home-"));
  return { projectRoot, env: { ...process.env, AOF_GLOBAL_HOME: globalHome } };
}

export const meshDirectFabricTests = [
  {
    name: "mesh-direct-fabric: probeFabric is healthy without spawning anything, and degrades ONLY when there is no bindable address",
    async run() {
      assert.deepEqual(
        await probeFabric(DIRECT, { interfaces: IFACES }),
        { fabric: "direct", state: "direct", healthy: true, reason: null },
      );
      // The one honest degrade — loopback only is not a peer-facing address.
      assert.deepEqual(
        await probeFabric(DIRECT, { interfaces: { lo: IFACES.lo } }),
        { fabric: "direct", state: null, healthy: false, reason: "no-local-address" },
      );
      // A declared address wins even when no interface would have supplied one.
      assert.deepEqual(
        await probeFabric({ mesh: { fabric: "direct", address: "10.0.0.9" } }, { interfaces: { lo: IFACES.lo } }),
        { fabric: "direct", state: "direct", healthy: true, reason: null },
      );
      // An unimplemented fabric is still a CLEAN structured refusal, never a crash.
      assert.deepEqual(
        await probeFabric({ mesh: { fabric: "wireguard" } }),
        { fabric: "wireguard", state: null, healthy: false, reason: "fabric-unsupported" },
      );
    },
  },
  {
    name: "mesh-direct-fabric: selfAddress prefers the declared address, else the first non-internal IPv4",
    async run() {
      assert.equal(await selfAddress(DIRECT, { interfaces: IFACES }), "192.168.1.102");
      assert.equal(
        await selfAddress({ mesh: { fabric: "direct", address: "10.0.0.9" } }, { interfaces: IFACES }),
        "10.0.0.9",
      );
      // Loopback is never offered as a peer-facing address.
      assert.equal(await selfAddress(DIRECT, { interfaces: { lo: IFACES.lo } }), null);
    },
  },
  {
    name: "mesh-direct-fabric: resolvePeers resolves the roster through the kernel resolver — self excluded, unresolvable dropped, dual-homed fully surfaced",
    async run() {
      const lookup = async (host) => {
        if (host === "172.27.155.33") return [{ address: "172.27.155.33", family: 4 }];
        throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      };
      assert.deepEqual(
        await resolvePeers(DIRECT, {
          roster: [
            { nodeId: "control-a", host: "control-a" }, // SELF — a roster carries its own record
            { nodeId: "aof-wsl", host: "172.27.155.33" },
            { nodeId: "ghost", host: "nope.invalid" },  // unresolvable today
          ],
          lookup,
        }),
        [{ nodeId: "aof-wsl", dialAddress: "172.27.155.33", online: true, host: "172.27.155.33" }],
      );
      // A peer answering on several addresses surfaces every one — the caller picks.
      assert.deepEqual(
        await resolvePeers(DIRECT, {
          roster: [{ nodeId: "mac", host: "mac.lan" }],
          lookup: async () => [{ address: "192.168.1.50" }, { address: "10.1.1.4" }],
        }),
        [
          { nodeId: "mac", dialAddress: "192.168.1.50", online: true, host: "mac.lan" },
          { nodeId: "mac", dialAddress: "10.1.1.4", online: true, host: "mac.lan" },
        ],
      );
      // An absent roster is [], exactly as the tailscale branch degrades.
      assert.deepEqual(await resolvePeers(DIRECT, {}), []);
    },
  },
  {
    name: "mesh-direct-fabric: guidance is per-fabric — a direct node is never told to check a tailnet it does not have",
    async run() {
      const guidance = fabricGuidance(await probeFabric(DIRECT, { interfaces: IFACES }), { selfAddress: "192.168.1.102" });
      assert.equal(guidance.healthy, true);
      assert.ok(guidance.lines.some((line) => line.includes("192.168.1.102")), "the resolved self-address is named");
      assert.equal(
        guidance.lines.some((line) => /tailnet|tailscale|shields/i.test(line)),
        false,
        "no tailscale-specific remediation leaks onto a direct node",
      );
    },
  },
  {
    name: "mesh-direct-fabric: the tailscale branch is untouched by the second fabric",
    async run() {
      assert.deepEqual(
        await probeFabric({}),
        { fabric: null, state: null, healthy: false, reason: "fabric-undeclared" },
      );
      assert.deepEqual(
        await probeFabric({ mesh: { fabric: "tailscale" } }, {
          exec: async () => { throw Object.assign(new Error("nope"), { code: "ENOENT" }); },
          platform: "linux",
        }),
        { fabric: "tailscale", state: null, healthy: false, reason: "not-installed" },
      );
      assert.equal(await selfAddress({ mesh: { fabric: "tailscale" } }, { exec: async () => ({ stdout: "{}", status: 0 }) }), null);
    },
  },
  {
    name: "mesh-direct-fabric: `mesh:identity --name/--address` breaks a hostname collision and survives reload AND a hostname change",
    async run() {
      const { projectRoot, env } = await scaffoldProject();
      // The WSL case: the guest's real hostname IS its host's.
      let ws = await loadWorkspace(projectRoot, undefined, { hostname: "Umairs-MSI", env });
      const published = await meshIdentityCommand.run(
        { name: "aof-wsl", address: "172.27.155.33" },
        { workspace: ws },
      );
      assert.equal(published.nodeId, "aof-wsl", "the pinned id wins over the colliding hostname derivation");
      assert.equal(published.host, "172.27.155.33", "the advertised host is what peers should DIAL, not the inherited hostname");

      const sidecar = await readSidecar(ws.identityPath);
      assert.equal(sidecar.pinned, true, "the id is pinned so the load-time self-heal never churns it");
      assert.equal(sidecar.address, "172.27.155.33", "the address has ONE home — the sidecar");
      assert.equal(sidecar.derivedFrom, undefined, "a pinned id records no derivation host");

      ws = await loadWorkspace(projectRoot, undefined, { hostname: "Umairs-MSI", env });
      assert.equal(ws.config.mesh.nodeId, "aof-wsl", "reload hydrates the pinned id");
      assert.equal(ws.config.mesh.address, "172.27.155.33", "reload hydrates the address mesh-fabric reads");
      assert.equal(await selfAddress(ws.config), "172.27.155.33", "the fabric seam reads the override");

      // The self-heal carve-out: a pinned id is never re-derived, even off-host.
      ws = await loadWorkspace(projectRoot, undefined, { hostname: "some-other-box", env });
      assert.equal(ws.config.mesh.nodeId, "aof-wsl", "a hostname change never churns a pinned id");
    },
  },
  {
    name: "mesh-direct-fabric: an all-illegal --name is a clean coded refusal, never a silent empty id",
    async run() {
      const { projectRoot, env } = await scaffoldProject();
      const ws = await loadWorkspace(projectRoot, undefined, { hostname: "host-a", env });
      await assert.rejects(
        () => meshIdentityCommand.run({ name: "!!!" }, { workspace: ws }),
        (error) => error?.code === "invalid-node-name",
      );
    },
  },
  {
    name: "mesh-direct-fabric: the control server admits by CREDENTIAL over a real socket, with an EMPTY fabric peer list",
    async run() {
      const GOOD = "a".repeat(64);
      const REVOKED = "b".repeat(64);
      const registry = {
        roster: [
          { nodeId: "aof-wsl", relayAuthHash: sha(GOOD) },
          { nodeId: "old-node", relayAuthHash: sha(REVOKED) },
        ],
        revocations: [{ nodeId: "old-node" }],
      };
      // The resolver mesh-launcher.mjs wires, over a fixture registry (no disk).
      const resolveOrigin = async (request) => {
        const header = request?.headers?.authorization;
        const presented = typeof header === "string" ? header.replace(/^Bearer\s+/i, "").trim() : "";
        if (presented.length === 0) return { nodeId: null, authoritative: true };
        const verdict = verifyCredential(registry, presented);
        return { nodeId: verdict?.ok === true ? verdict.nodeId : null, authoritative: true };
      };

      const server = await startControlStreamServer({
        port: 0,
        bindAddress: "127.0.0.1",
        peerNodeIds: [],   // NOTHING is a fabric peer …
        peersByAddress: [], // … and no address maps to a nodeId
        resolveOrigin,
        openStore: async () => ({ applySnapshot: async () => {}, applyDelta: async () => {}, close: async () => {} }),
      });
      try {
        const url = `ws://127.0.0.1:${server.server.address().port}/`;
        const attempt = async (credential) => {
          const transport = createWorkerWsTransport(url, { credential });
          try {
            const handle = await Promise.race([
              transport.connect(),
              new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
            ]);
            transport.close(handle);
            return "admitted";
          } catch {
            return "refused";
          }
        };

        assert.equal(await attempt(GOOD), "admitted", "a valid credential is admitted with no fabric peer table at all");
        assert.equal(await attempt(null), "refused", "an absent credential is refused");
        assert.equal(await attempt("c".repeat(64)), "refused", "an unknown credential is refused");
        assert.equal(await attempt(REVOKED), "refused", "a REVOKED node is refused even though its token still hashes to a roster entry");

        // Attribution is the credential's nodeId — never anything self-declared.
        const transport = createWorkerWsTransport(url, { credential: GOOD });
        const handle = await transport.connect();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const connected = server.registry.entries().filter(([, entry]) => entry.connected).map(([id]) => id);
        assert.deepEqual(connected, ["aof-wsl"], "the connection is attributed to the credential's nodeId");
        transport.close(handle);
      } finally {
        await server.stop();
      }
    },
  },
];
