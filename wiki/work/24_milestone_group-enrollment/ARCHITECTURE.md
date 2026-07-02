---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 24 · Device-Code Group Enrollment — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the load-bearing deliverables: **device-code
> enrollment** shipping as `aof mesh invite` / `aof mesh join <code>` / `aof mesh revoke`, the **control node
> as the enrollment authority** owning issuance / match / admission / revocation, the **group registry** as
> the group-level durable git-of-record — the roster of admitted nodes + the set of registered boards + the
> pending-invite records + the revocation list, and **group membership as the v1 trust boundary** —
> single-group / trusted-operator, git-remote access provisioned alongside admission; the load-bearing
> invariant that the join needs **no** manual credential copying — a single 6-digit code admits a fresh
> machine on all three OSes, KR6) and `STATE.md` (the open contract points refined here: the device-code
> issuance / match / TTL flow; what the **mesh credential** contains — relay auth + stream identity + the
> git-remote grant — and its revocation path; the **group registry** schema — roster + registered boards +
> pending invites + revocations — as its own git stream of record, and how git-remote access is provisioned
> alongside admission, PRD A3). Prior art: `PRD-decentralized-agent-orchestration.md` (§7.2 KF9 the control
> node as issuing + enrollment hub, KF10 device-code group enrollment; §7.3 "**two levels of git-of-record**"
> — each board keeps its own git, "**the group gets its own small durable registry — the roster of nodes and
> the set of registered boards — naturally another lightweight git stream of record**", and "Enrollment:
> device-code group join on the control node … presents it to the control node's **relay endpoint**, and on
> match is admitted to the group and issued a mesh credential (relay auth + stream identity)"; §7.4 A3 trust =
> group membership via device code, "git remote access is provisioned alongside", untrusted / cross-org
> deferred Phase-5+). This milestone **pays the deferral milestone 23 recorded**: `23/ADR-001` stood the relay
> up **PRE-AUTH** ("the relay in m23 stands up PRE-AUTH: it has no group credential / relay auth … the full
> threat model is authored in m24, not here … the relay binds loopback / a trusted LAN by default") — m24 is
> where the credential is minted, checked at the relay auth-gate, and revoked.
>
> **The substrate seams this milestone BUILDS ON (already shipped — the actual code, not reinvented).** The
> relay `src/mesh-relay.mjs` (`23/ADR-001`) is a single `http.createServer` (today it serves only a terse
> `426` on any non-upgrade request — **the natural host for the device-flow enrollment HTTP endpoint, ADR-2**)
> + a `ws@8` `WebSocketServer` via `noServer` + `server.on('upgrade')` routing to `RELAY_PATH = "/ws/relay"`
> (**this upgrade handler is where the credential auth-gate is added, ADR-3**), carrying the FROZEN
> payload-agnostic `{ kind, nodeId, signal }` envelope, `resolveMaxFrameBytes`, `relayMode(config)` (serve only
> when `config.mesh.relay.controlNode === config.mesh.nodeId`), `relayStatus(config)`; it binds `127.0.0.1`
> (loopback), pre-auth. The mesh-store `src/mesh-store.mjs` (`22/ADR-002`) is the **per-node** partition spine
> — `meshDir(workspace)` = `<workDir>/.mesh`, `nodeRecordPath` / `presenceRecordPath` keyed by a `flatLeaf(id)`
> path-traversal-safe leaf, the atomic `writeText` (temp+rename, 19/R2) seam, opaque per-node persist. **Its
> ADR-002 explicitly forbids "a shared or aggregate file two nodes co-write (no `nodes.json` roster)"** — the
> per-node partition avoids multi-writer merges; the group registry resolves that tension explicitly (ADR-1:
> the registry is a legitimately DIFFERENT artifact because it is **SINGLE-WRITER** — the control node owns it
> — so there is no multi-writer merge to avoid). The git-sync engine `src/mesh-sync.mjs` (`22/ADR-004`) is
> payload-agnostic — it stages ONLY paths under `meshDir` (`git add -- <meshDir>`) and moves files as bytes
> without parsing them, so a NEW registry file under the mesh tree syncs with **ZERO** engine change, and it
> already owns the shell-less `git` argv-spawn (`spawnSync("git", args)`, the `13/ADR-002` no-shell-string
> discipline) the git-remote provisioning re-uses. The node-side push client `src/mesh-relay-client.mjs`
> (`23/ADR-003`) reads `config.mesh.relay.url` and pushes the presence signal (`pushPresenceSignal`,
> `PRESENCE_SIGNAL_KIND`). Node identity `src/node-identity.mjs` (`deriveNodeId`; `config.mesh.nodeId` the
> stable node id; `resolveInstallSalt`) + the read-merge-write of the free-form `config.mesh.*` subtree
> (`resolveInstallSalt` in `src/commands/mesh-identity.mjs`) is the precedent for storing the joining node's
> credential in config (`config.mesh.*` is free-form — the top-level schema has no `additionalProperties:false`,
> `schemas/aof.schema.json` has no mesh block).
>
> **The precedents this milestone APPLIES and never re-litigates: milestone 08 (cli-command-core), milestone
> 03 (the terminal-WS wire envelope), milestone 22 (the mesh foundation), milestone 23 (the pre-auth relay +
> presence), milestone 13 (the read-only-source git-argv idiom), and milestone 07 (the additive co-touch
> precedent).** The new `mesh:*` verbs (`invite`/`join`/`revoke`) are authored *as registered command-core
> commands + a thin face*, inheriting wholesale: `08/ADR-001` (CLI-as-contract over ONE in-process command
> core; a serve/face is a thin adapter over a one-shot core); `08/ADR-002` (the frozen `{ id, input, run, cli }
> → result` contract); `03/ADR-001` (one `http.createServer`; the WS attaches via `ws` noServer +
> `server.on('upgrade')`, never a second server/port — the enrollment endpoint is an HTTP ROUTE on the SAME
> server, NOT a second server); `03/ADR-003` (a **frozen wire envelope** whose control-frames never crash the
> process — the enrollment endpoint mirrors the never-crash discipline over HTTP); `22/ADR-002` (the path-
> partition seam + the atomic `writeText` write-scope discipline — the registry adopts it, ADR-1); `22/ADR-004`
> (the **payload-agnostic** git-sync engine — the registry syncs over it unchanged, ADR-1); `23/ADR-001` (the
> pre-auth relay + the frozen `{ kind, nodeId, signal }` envelope — the auth-gate is ADDITIVE to the upgrade
> handler, ADR-3; enrollment stays OFF the ws envelope so the envelope stays payload-agnostic, ADR-2);
> `13/ADR-002` (the read-only-on-source shell-less `git`-argv-spawn — git-remote provisioning re-uses it,
> ADR-3); `07/ADR-006` (the additive co-touch precedent this milestone leans on for the relay-side co-touch,
> the break-down rationale). ADRs below cite these as `08/ADR-00n` / `03/ADR-00n` / `22/ADR-00n` / `23/ADR-00n`
> / `13/ADR-002` / `07/ADR-006` / `SPEC §…` / `STATE §…` / `PRD §…`.
>
> **The security posture is a POINTER, not a threat model.** A parallel `aof-security` agent owns
> `SECURITY.md` + the security fitness (device-code brute-force resistance; hashed-code-at-rest; constant-time
> / single-use match). This ARCHITECTURE.md authors the **STRUCTURAL** fitness only — the registry write-scope
> + single-writer discipline, the assertion that the pending code is stored **hashed** (a structural
> write-scope claim: the registry write site never persists a plaintext code — the *crypto* strength of the
> hash + the constant-time compare are SECURITY.md's), the relay auth-gate's structural presence, the
> enrollment endpoint keeping the ws envelope payload-agnostic, and the new-verb bijection. Where a decision
> below touches the trust boundary it defers the crypto to SECURITY.md by name.
>
> The seam (confirmed against the codebase graph, `aof graph build src` → **1174 nodes / 3143 edges**, builtAt
> 2026-07-01; `aof graph impact` consulted at author time — cited as **actual** structure, not inferred).
> `src/mesh-relay.mjs` reports dependents ← `src/commands/mesh-relay.mjs`, `src/mesh-presence-subscriber.mjs`
> (2) and dependencies → **0** (a leaf serve unit — nothing it imports couples it to a record; the auth-gate
> ADR-3 keeps that leaf property by importing the registry's VERIFY seam, not a record schema). `src/mesh-store
> .mjs` reports dependents ← `src/commands/mesh-identity.mjs`, `src/mesh-presence.mjs`, `src/mesh-sync.mjs` (3)
> and dependencies → `src/fs.mjs`, `src/run-store.mjs` (2) — a clean spine the new `src/mesh-registry.mjs`
> sits beside (it re-uses `meshDir`/`flatLeaf`/the `writeText` seam from the same spine, adding the SINGLE
> single-writer aggregate the spine deliberately does not hold). `src/mesh-relay-client.mjs` reports dependents
> ← `src/commands/mesh-heartbeat.mjs` (1), dependencies → **0** (the leaf push seam the `join` client mirrors).
> `src/command-core.mjs` is the one additive door — dependents ← `board-ui.mjs`, `cli.mjs`, `graph-mcp-server
> .mjs`, `memory/graphify-backend.mjs` (4); dependencies → 25 `src/commands/*.mjs` + `work.mjs` (already
> carrying `mesh-identity.mjs`, `mesh-sync.mjs`, `mesh-heartbeat.mjs`, `mesh-relay.mjs`) — a new `mesh:*`
> command is one import + one `COMMANDS` entry + one `meshCommand` `subcommand === "<sub>"` branch + one `cli`
> adapter, additive.
>
> **Prior-lesson recall.** Recall surfaced these near-misses; each is honoured or a conscious departure:
> - **22/R6 — a designed mechanic with no data source at its only call site is dead code.** **HONOURED —
>   load-bearing here:** the mesh credential MUST be CHECKED at a real call site (the relay upgrade-handler
>   auth-gate, ADR-3) and the git-remote grant must actually RUN (`git remote add` at admission + the
>   revoke de-provision, ADR-3) — an issued-but-never-verified credential is exactly this anti-pattern. Every
>   mechanic below pins the data source it reads: the auth-gate reads the roster/revocation via the registry
>   VERIFY seam (ADR-3); `match` reads the pending-invite hash from the registry (ADR-2); `revoke` reads the
>   roster (ADR-4). The security-owned `acd-relay-auth-gate-checked` (SECURITY.md; NOT mine) exists precisely
>   so the CHECK cannot be dropped — the enforcement residue of this 22/R6 pin.
> - **22/R1 — enumerate every registry-derived fitness gate a new command trips, AND the inverse.** The new
>   `mesh:*` verbs (`invite`/`join`/`revoke`) RIDE the EXISTING `acd-mesh-command-cli-bijection` gate
>   (provided each adds its `meshCommand` dispatch branch + `cli` adapter + `argsFor` case). The namespace
>   already exists (m22 authored the gate), so the inverse-of-22/R1 check is CLEAN — m24 authors **NO** new
>   command-FACE gate. The genuinely-new STRUCTURAL fitness I author are three (the crypto/enforcement residue
>   — hashed-code-at-rest, single-use/constant-time match, and the auth-gate enforcement — belongs to
>   aof-security's SECURITY.md, so I do NOT author those): `acd-registry-write-scope` (registry write-scope +
>   single-writer), `acd-enroll-endpoint-http-not-ws` (the enrollment endpoint keeps the ws envelope
>   payload-agnostic), and `acd-enroll-git-argv-no-shell` (the git-remote provisioning uses the read-only-source
>   shell-less argv idiom). The 22/R1 enumeration is folded into each ADR + the fitness table.
> - **23/ADR-001 — the pre-auth relay is the seam.** **HONOURED:** the auth-gate is ADDITIVE to `serveRelay`'s
>   upgrade handler — it does NOT rewrite the frozen `{ kind, nodeId, signal }` envelope, does NOT break
>   statelessness (the relay still persists nothing authoritative — the roster it checks is the registry's,
>   READ not written), and loopback stays the local default (a credential is required only for a group /
>   non-loopback connection — ADR-3).
> - **22/ADR-004 — payload-agnostic git-sync.** **HONOURED:** the registry syncs over the engine UNCHANGED
>   (the engine stages `meshDir` and never imports a record schema; the registry file is another `meshDir`
>   file). Enrollment is kept OFF the ws envelope — it is an HTTP device-flow endpoint on `serveRelay`'s
>   existing `http.createServer`, NOT a new ws `kind` — so the ws envelope stays payload-agnostic and m26
>   leasing still adds a `kind` with zero relay change (ADR-2; `acd-enroll-endpoint-http-not-ws`).
> - **22/R4 (self-host `.gitignore wiki/work/.mesh/`) + 22/R5 (`.gitattributes **/.mesh/** text eol=lf`).**
>   **HONOURED — already landed in m23 and confirmed present:** `.gitignore` line `wiki/work/.mesh/` (m23/R4)
>   and `.gitattributes` `**/.mesh/** text eol=lf` (m23/R5) already cover any file under `.mesh/`. The registry
>   lands UNDER `.mesh/` (`meshDir/registry/…`, ADR-1), so it is ALREADY covered by both pins — no new
>   `.gitignore` / `.gitattributes` deliverable is owed (the confirmation is recorded in ADR-1; the inverse
>   check that the registry is NOT placed outside `.mesh/` is a design constraint, not a new pin).
> - **13/ADR-002 — read-only-on-source git via the shell-less `git`-argv-spawn idiom.** **HONOURED:** the
>   git-remote provisioning (ADR-3) shells out to git ONLY via `spawnSync("git", [<verb>, …])` (the
>   `mesh-sync.mjs` `git(cwd, args)` precedent), never a shell string; on the CONTROL node's own registry repo
>   it may write (`git remote add`), but it makes **no** write verb against a joining node's foreign source
>   tree — `acd-enroll-git-argv-no-shell` (mine) enforces the shell-less argv discipline.

## ADR-001: The group registry — the group-level, control-node-owned SINGLE-WRITER second git-of-record (roster + registered boards + pending invites + revocations), a NEW `src/mesh-registry.mjs` store under `meshDir/registry/`, synced by the payload-agnostic engine unchanged; single-writer resolves 22/ADR-002's "no aggregate roster" tension

**Status:** Accepted
**Date:** 2026-07-01

**Context.** PRD §7.3 names **two levels of git-of-record**: each board keeps its own git (unchanged), and
"**the group gets its own small durable registry — the roster of nodes and the set of registered boards —
naturally another lightweight git stream of record**." This milestone AUTHORS that registry; milestone 25's
`aof mesh ui` RENDERS it (`SPEC §Scope` out-of-scope). The registry must hold four facts the enrollment flow
reads/writes: the **roster** of admitted nodes, the **set of registered boards**, the **pending-invite
records** (device codes awaiting a match), and the **revocation list** (`SPEC §Scope`; `STATE §Notes`). The
structural tension is with `22/ADR-002`, which explicitly forbids "a shared or aggregate file two nodes
co-write (no `nodes.json` roster)" — the per-node partition exists precisely to make git merges add-only, so a
node never rewrites another node's file. The registry is a **roster** — the very artifact m22 forbade — so the
tension must be resolved, not glossed.

**Decision.** Author a NEW store module `src/mesh-registry.mjs` beside the mesh-store spine, holding the
group-level aggregate under a NEW subtree of the SAME partition root:

1. **The registry is SINGLE-WRITER — the control node / enrollment authority OWNS it.** This is the resolution
   of the `22/ADR-002` tension, stated explicitly: `22/ADR-002` forbids an aggregate that **TWO nodes
   co-write**, because a multi-writer roster forces a three-way content merge git cannot do add-only. The
   group registry is a legitimately DIFFERENT artifact **because exactly one writer mutates it** — the
   nominated control node (`config.mesh.relay.controlNode === config.mesh.nodeId`, the `relayMode` gate). A
   non-control node NEVER writes the registry (it READS it — the roster is public within the group; a joining
   node reads its own admission back). Single-writer ⇒ no multi-writer merge ⇒ the m22 hazard does not apply.
   The registry write path is guarded by the SAME control-node predicate `relayMode` uses, so a non-authority
   invocation is a structured no-op, never a rogue write (`acd-registry-write-scope` asserts the SINGLE
   registry write seam).

2. **It lives under `meshDir/registry/` — the SAME partition root, so it syncs over the payload-agnostic
   engine UNCHANGED.** `meshDir(workspace)` = `<workDir>/.mesh` (`22/ADR-002`); the registry is
   `join(meshDir(workspace), "registry", <leaf>.json)`, an m22-style path builder in `src/mesh-registry.mjs`
   (`registryDir` / `registryPath`), routed through the SAME `flatLeaf` path-traversal boundary where a leaf is
   id-keyed. `22/ADR-004`'s engine stages ONLY paths under `meshDir` and moves files as bytes without parsing
   them — so the registry file syncs with **ZERO** engine change (the engine never imports the registry
   schema). This is the direct application of `22/ADR-004`: a new record type under the mesh tree rides the
   existing bus.

3. **The schema (additive-friendly, top-level keys append — the `20/ADR-001` / `22/ADR-003` discipline),
   persisted OPAQUE / AS-IS through the atomic `writeText` seam (19/R2, the SAME write discipline
   `publishNodeRecord` uses):**
   ```jsonc
   // wiki/work/<mesh-root>/.mesh/registry/group.json — the SINGLE-WRITER group-level git-of-record.
   // Written ONLY by the control node, through src/mesh-registry.mjs's writeRegistry (the one write seam),
   // via the atomic writeText temp+rename (19/R2). Synced by the 22/ADR-004 payload-agnostic engine unchanged.
   {
     "group":       string,      // the group name/id (PRD "group 'umair-fleet'") — provenance, additive.
     "roster":      [            // the admitted nodes (the KF9 group membership set).
       { "nodeId": string, "admittedAt": string /* ISO-8601 UTC-Z */, "boards": string[] }
     ],
     "boards":      string[],    // the set of REGISTERED boards (work streams) at the group level (PRD §7.3).
     "pending":     [            // the pending-invite records — a device code AWAITING a match. The code is
                                 //   stored HASHED, NEVER plaintext (ADR-2 + acd-enrollment-code-hashed-at-rest; crypto is
                                 //   SECURITY.md's). Each carries its TTL + single-use marker.
       { "codeHash": string, "issuedAt": string, "expiresAt": string, "consumedAt": string | null }
     ],
     "revocations": [            // the revocation list (ADR-4): a de-provisioned node the auth-gate rejects.
       { "nodeId": string, "revokedAt": string, "reason": string | null }
     ]
   }
   ```
   A reader tolerates absence (no registry file yet ⇒ an empty registry, the mesh-store ENOENT→absent
   discipline) and an unknown additive key survives byte-equivalent (the store never interprets a registry it
   is handed beyond the fields it reads).

4. **The self-host `.gitignore` + `.gitattributes` are ALREADY satisfied (the 22/R4 + 22/R5 carry-forwards).**
   The registry lands UNDER `.mesh/`, so the m23-landed `.gitignore wiki/work/.mesh/` (22/R4) and
   `.gitattributes **/.mesh/** text eol=lf` (22/R5) — CONFIRMED present in the repo at author time — already
   cover it. **No new ignore / EOL deliverable is owed** (unlike a registry placed outside `.mesh/`, which
   would owe both). The design constraint "the registry lives under `meshDir`" (decision 2) is what keeps this
   true; placing it elsewhere would re-open both carry-forwards.

**Security posture (a POINTER, ADR preamble).** The pending code is stored HASHED (decision 3); ADR-2 pins the
STRUCTURAL write-scope (the registry write site persists `codeHash`, never a plaintext `code`), and `SECURITY.md`
owns the crypto (hash choice, salting, constant-time match). This ADR asserts only the structural placement.

**Alternatives considered.**
- *Extend `src/mesh-store.mjs` with a `writeRoster` on the per-node partition (no new module)* — rejected: it
  either re-introduces the `22/ADR-002`-forbidden aggregate INTO the module whose whole contract forbids it,
  or scatters the roster across per-node files (then `aof mesh ui` must re-aggregate on every read, and there
  is no single place to hold the pending/revocation lists). A DISTINCT single-writer module keeps the
  per-node partition's add-only merge property intact (mesh-store stays multi-writer, add-only) and gives the
  group aggregate ONE owner + ONE write seam (`acd-registry-write-scope`).
- *A registry OUTSIDE `.mesh/` (e.g. a top-level `group.json` or a `.aof/` sidecar)* — rejected: it falls off
  the `22/ADR-004` payload-agnostic sync engine (which stages ONLY `meshDir`), so the registry would need its
  own transport (a new engine — the exact rebuild `22/ADR-004` exists to avoid), AND it re-opens the 22/R4 +
  22/R5 carry-forwards (a new ignore/EOL pin). Under `.mesh/` it rides the existing bus + the existing pins.
- *A per-node "I claim admission" record + a merge-time roster derivation (fully partitioned, no aggregate)* —
  rejected: admission is an AUTHORITY decision (only the control node admits), not a self-assertion; a node
  cannot admit itself. A single-writer aggregate is the faithful structure of "the control node is the
  enrollment authority" (PRD §7.2 KF9) — the roster is a record of the authority's decisions, not a merge of
  self-claims.
- *Author the code-hash crypto here* — rejected: the hash strength + constant-time compare are the security
  agent's `SECURITY.md`; this ADR asserts only the structural write-scope (hashed, not plaintext, at the one
  write seam). Splitting structure (here) from crypto (SECURITY.md) keeps each fitness on its owner's altitude.

**Consequences.** Story 00 builds `src/mesh-registry.mjs` — the path builders (`registryDir`/`registryPath`),
the single-writer `writeRegistry(workspace, registry)` (control-node-guarded, atomic `writeText`, opaque
persist) + `readRegistry(workspace)` (absence-tolerant) + the pure roster/pending/revocation accessors — and
arch-test `acd-registry-write-scope` (registry write-scope + single-writer); the code-hashed-at-rest crypto is
the security-owned `acd-enrollment-code-hashed-at-rest` (SECURITY.md).
It re-uses `meshDir`/`flatLeaf`/the `writeText` seam from the mesh-store spine (the graph shows that spine at 3
dependents / 2 dependencies — a clean neighbour to sit beside) and references **zero** record-doc filename. It
is the **dependency root** — buildable + testable standalone over git alone (no relay, no credential yet). The
*observable* (the control node writes a registry; a peer reads the roster back over git) is a story-00 task
`.feature`, not a fitness function.

## ADR-002: Device-code issuance + match + admission — `aof mesh invite` mints a short-lived single-use 6-digit code (recorded HASHED as a pending invite in the registry); the relay's device-flow HTTP endpoint on `serveRelay`'s existing `http.createServer` (NOT a ws `kind`) matches + consumes + admits + issues the credential; `aof mesh join <code>` presents it and stores the credential

**Status:** Accepted
**Date:** 2026-07-01

**Context.** PRD §7.2 KF10 + §7.4 A3: `aof mesh invite` (control node) mints a short-lived 6-digit code; a new
machine runs `aof mesh join <code>`, "**presents it to the control node's relay endpoint, and on match is
admitted to the group and issued a mesh credential**." The load-bearing structural facts: (1) the code must be
recorded so a later `join` can match it — it is a **pending invite in the registry** (ADR-1), stored HASHED
(`acd-enrollment-code-hashed-at-rest`, SECURITY-owned). (2) The match happens on the **control node's relay endpoint** — and `23/ADR-001`'s relay is
`serveRelay`'s single `http.createServer`, which today serves only a terse `426` on any non-upgrade request.
That HTTP server is the natural, ALREADY-STANDING host for a device-flow HTTP route (`03/ADR-001` — ONE server,
never a second). (3) Enrollment must stay OFF the ws envelope: a device-flow request/response is a discrete
HTTP exchange, not an ephemeral broadcast frame — putting it on the ws `{ kind, nodeId, signal }` envelope
would make the envelope no longer payload-agnostic (the relay would parse an enrollment `kind`), breaking
`22/ADR-004` / `23/ADR-001`'s forward-stability (m26 leasing adds a `kind` with zero relay change). So
enrollment is an HTTP route; the ws envelope is untouched (`acd-enroll-endpoint-http-not-ws`).

**Decision.** Three additive structural moves, applying 22/03/23:

1. **`aof mesh invite` (control node) mints + records a pending invite.** A registered `mesh:invite` command
   (control-node-guarded — the `relayMode` predicate) generates a short-lived 6-digit code, HASHES it, and
   appends a `pending` record `{ codeHash, issuedAt, expiresAt, consumedAt:null }` to the registry via ADR-1's
   `writeRegistry` (the single write seam). The TTL (`expiresAt`) and the single-use marker (`consumedAt`) are
   structural fields; the *crypto* of the hash + the code entropy are `SECURITY.md`'s. The command RETURNS the
   plaintext code to the operator ONCE (to read aloud / paste into `join`) — the plaintext is NEVER persisted
   (`acd-enrollment-code-hashed-at-rest`, SECURITY-owned, asserts the write persists `codeHash`, never `code`;
   the constant-time / single-use match is `acd-enrollment-code-single-use-constant-time`).

2. **The relay's device-flow HTTP endpoint matches + consumes + admits + issues.** `serveRelay`'s existing
   `http.createServer` request handler gains ONE device-flow route (e.g. `POST /enroll`) ABOVE the `426`
   fallback — the `03/ADR-001` one-server discipline (a NEW http ROUTE, not a new server, not a new port, not a
   ws `kind`). On a presented code it: (a) reads the pending invites from the registry (ADR-1), (b) MATCHES the
   presented code against a pending `codeHash` — **single-use consume** (mark `consumedAt`, so a second
   presentation of the same code fails) + **TTL check** (reject if `now > expiresAt`); the *constant-time /
   single-use match crypto* is `SECURITY.md`'s, the *structural* consume-then-admit ordering is here, (c) on a
   match, ADMITS the node — appends it to the registry roster (ADR-1's `writeRegistry`) — and ISSUES the
   credential (ADR-3), (d) on no match / expired / already-consumed, returns a structured rejection (the
   never-crash discipline over HTTP — a malformed body / bad code is a structured error response, never a
   throw, mirroring `03/ADR-003` server-side). The endpoint is on the control node ONLY (it is `serveRelay`,
   which runs in `relay` mode only on the nominated control node — `relayMode`).

3. **`aof mesh join <code>` presents the code + stores the issued credential.** A registered `mesh:join`
   command reads `config.mesh.relay.url` (the control node's endpoint, the `mesh-relay-client.mjs` precedent),
   POSTs the presented code to the device-flow endpoint, receives the credential on a match, and STORES it in
   `config.mesh.*` (the read-merge-write of the free-form mesh subtree — the `resolveInstallSalt` precedent in
   `mesh-identity.mjs`, `config.mesh.credential`). A rejection surfaces as a clean face-level error (no
   credential stored). The stored credential is the data source ADR-3's auth-gate + git-remote provisioning
   read — pinning the 22/R6 "a mechanic must have a real data source" invariant.

**Per 22/R6, every mechanic's data source is pinned.** `invite` reads/writes the registry pending list (ADR-1).
`match` reads the pending `codeHash` from the registry and consumes it there (single-use). `admit` writes the
roster (ADR-1). `join` reads `config.mesh.relay.url` and writes `config.mesh.credential`. The credential ADR-3
issues is CHECKED at the auth-gate (ADR-3, `acd-relay-auth-gate-checked`, SECURITY-owned) — an issued-but-never-verified credential is the exact
22/R6 dead-mechanic anti-pattern the auth-gate exists to prevent.

**Per 22/R1, the registry-derived gates the new verbs arm (+ the inverse-clean check).** `mesh:invite` +
`mesh:join` RIDE the EXISTING `acd-mesh-command-cli-bijection` gate (`id.startsWith("mesh:")`) — provided each
adds its `subcommand === "<sub>"` branch in `meshCommand` + `cli` adapter + `argsFor` case (ADR preamble). **No
new command-face gate** (the namespace already exists — the inverse-of-22/R1 is CLEAN). Board route-coverage
(`acd-work-command-route-coverage`) is NOT armed (`work:`-filtered; the mesh board face is m25).
`acd-command-namespace` is NOT armed (no new bundle skill `.md` members).

**Alternatives considered.**
- *Enrollment as a new ws `kind` on the relay envelope (`{ kind:"enroll", … }`)* — rejected: it makes the
  relay PARSE an enrollment payload, breaking the `23/ADR-001` / `22/ADR-004` payload-agnostic property (the
  relay would import an enrollment schema; m26 leasing would no longer add a `kind` with zero change), and a
  device-flow exchange is a discrete request/response, not an ephemeral broadcast the ws fan-out is for. An
  HTTP route on the ALREADY-standing server is the faithful shape (`acd-enroll-endpoint-http-not-ws` enforces the ws stays neutral).
- *A SECOND http server / port for enrollment* — rejected: it abandons `03/ADR-001` (ONE `http.createServer`;
  the relay already owns it and today only `426`s the non-upgrade path — the enrollment route slots in above
  the fallback) and complicates the control-node config (a second url). One server, one route.
- *Store the plaintext code in the registry so `join` can string-compare it* — rejected: it persists a live
  credential in the git-synced registry (a durable plaintext secret in the tree). The code is stored HASHED
  (`acd-enrollment-code-hashed-at-rest`); the match compares hashes (the constant-time compare is SECURITY.md's). Structure + crypto
  split by owner.
- *Admit without single-use consume / without a TTL* — rejected: a re-usable / never-expiring code is a
  standing credential a leaked code re-admits forever (the A3 "the code-issuance flow needs care" risk).
  Single-use consume + TTL are STRUCTURAL fields on the pending record (ADR-1) checked at match (this ADR); the
  brute-force resistance around them is SECURITY.md's.

**Consequences.** Story 01 builds `src/commands/mesh-invite.mjs` (`mesh:invite` — mint + record hashed
pending, control-node-guarded), the device-flow HTTP route added to `serveRelay`'s request handler in
`src/mesh-relay.mjs` (match/consume/TTL/admit/issue — the ONLY relay HTTP surface; it reads the registry VERIFY
seam, importing NO record schema beyond the registry), `src/commands/mesh-join.mjs` (`mesh:join <code>` —
present + store credential; re-uses the `mesh-relay-client.mjs` url read), the `argsFor` cases + dispatch
branches, and arch-test `acd-enroll-endpoint-http-not-ws` (mine — the enrollment endpoint keeps the ws
envelope payload-agnostic); the pending-code-hashed crypto is the security-owned
`acd-enrollment-code-hashed-at-rest` + `acd-enrollment-code-single-use-constant-time` (SECURITY.md). It
DEPENDS on story 00 (the registry). The *observable* (invite → join over the real
endpoint admits a node + issues a credential) is a story-01 task `.feature`, not a fitness function.

## ADR-003: The mesh credential + the relay auth-gate + git-remote provisioning — the credential carries a relay-auth token + stream identity + a git-remote grant, stored in `config.mesh.credential`; `serveRelay`'s upgrade handler gains an ADDITIVE credential check (the 23/ADR-001 pre-auth deferral paid), and git-remote access is provisioned alongside admission via the shell-less git-argv idiom (trusted-operator single-group)

**Status:** Accepted
**Date:** 2026-07-01

**Context.** This is the milestone's trust boundary — the deferral `23/ADR-001` recorded ("the full threat
model is authored in m24, not here … the relay binds loopback / a trusted LAN by default"). PRD §7.4 A3: a
machine is admitted by a device code; admission grants a **mesh credential (relay auth + stream identity)**;
"**git remote access is provisioned alongside**"; v1 is single-group / trusted-operator (untrusted/cross-org
deferred Phase-5+). Three structural facts: (1) the credential ADR-2 issues must be CHECKED somewhere real —
`22/R6` forbids an issued-but-never-verified credential (dead mechanic); the real call site is `serveRelay`'s
upgrade handler (`23/ADR-001` explicitly named "this upgrade handler is where a credential auth-gate is
added"). (2) git-remote access must actually RUN (`22/R6` — the git-remote grant is dead unless a `git remote
add` executes at admission); the read-only-source shell-less argv idiom (`13/ADR-002`, the `mesh-sync.mjs`
`git(cwd, args)` precedent) is how aof shells to git. (3) v1 is trusted-operator single-group — a documented
DEFAULT, not multi-tenant authz (that is the Phase-5+ fork, deliberately not built).

**Decision.** Three additive moves, each with a REAL call site (22/R6):

1. **The credential's shape (three halves, stored in `config.mesh.credential`).** Admission (ADR-2) issues a
   credential the joining node stores in the free-form `config.mesh.*` subtree (the `resolveInstallSalt`
   read-merge-write precedent):
   ```jsonc
   // config.mesh.credential — stored by `aof mesh join` on the joining node (ADR-2 step 3).
   {
     "relayAuth": string,   // the RELAY-AUTH half: the token presented on the ws upgrade; the auth-gate
                            //   (move 2) checks it against the registry roster/revocation. Its ENTROPY +
                            //   at-rest handling are SECURITY.md's; its STRUCTURAL presence is here.
     "nodeId":    string,   // the STREAM-IDENTITY half: which node this credential admits (matches the roster).
     "gitRemote": {         // the GIT-REMOTE GRANT half (A3 "provisioned alongside"): the group-registry
                            //   remote + board remotes the control node shares (trusted-operator single-group:
       "url": string,       //   a documented default — the control node shares the registry/board remote + an
       "name": string       //   access token as the stream-identity half; NOT multi-tenant per-user authz).
     }
   }
   ```

2. **The relay auth-gate — ADDITIVE to `serveRelay`'s upgrade handler (the 23/ADR-001 deferral paid).** The
   upgrade handler today routes by pathname to `RELAY_PATH` and destroys everything else (loopback pre-auth).
   The gate ADDS: for a **group (non-loopback) connection**, read the presented `relayAuth` token (a
   `Sec-WebSocket-Protocol` / auth header on the upgrade request), VERIFY it against the registry roster AND
   check it is NOT in the revocation list (ADR-4) — via a registry VERIFY seam (`verifyCredential(registry,
   token)`, a pure read the auth-gate imports from `src/mesh-registry.mjs`, NOT a record schema — the relay
   stays stateless, `23/ADR-001` fitness #1). A missing / invalid / revoked credential ⇒ `socket.destroy()`
   (the SAME reject shape the pathname mismatch uses — no ws is emitted). **Loopback stays the local default**:
   a loopback connection (the local node talking to its own relay) needs no credential — the credential is
   required only for a group / non-loopback connection (A3 "the relay binds loopback by default"; the gate is
   additive to that, not a rewrite). This is the REAL call site the ADR-2 credential is CHECKED at (22/R6);
   the security-owned `acd-relay-auth-gate-checked` (SECURITY.md, NOT mine) asserts the gate CHECKS +
   REJECTS an absent/invalid/revoked credential reading the LIVE roster/revocation — the enforcement residue of
   this structural decision (a ws upgrade is rejected without a valid credential).

3. **git-remote provisioning — provisioned alongside admission, via the shell-less git-argv idiom.** At
   admission (ADR-2 step 2c, control-node side) the enrollment authority PROVISIONS git-remote access — in v1
   trusted-operator single-group this is: the control node shares the group-registry remote + the board remotes
   as the credential's `gitRemote` grant, and (on the joining node, after `join`) `aof mesh join` RUNS
   `git remote add <name> <url>` against the JOINING node's OWN registry/board clone via `spawnSync("git",
   ["remote", "add", name, url])` — the `13/ADR-002` / `mesh-sync.mjs` shell-less argv idiom (NEVER a shell
   string; a shell would word-split a url on Windows). It makes NO write verb against a FOREIGN source tree it
   does not own — it configures the joining node's own clone (the read-only-source discipline: the joining node
   writes ITS OWN git config, never mutates the control node's tree remotely). This is the REAL call site the
   git-remote grant RUNS at (22/R6); `acd-enroll-git-argv-no-shell` (mine) asserts the shell-less argv
   discipline.

**Security posture (a POINTER).** The `relayAuth` entropy, the at-rest handling of the credential, the
constant-time token compare at the gate, and the brute-force resistance of the whole flow are `SECURITY.md`'s.
This ADR asserts only the STRUCTURAL invariants: the credential has a relay-auth + stream-identity + git-remote
shape (move 1), the gate CHECKS it at a real call site on the upgrade handler (move 2 — the enforcement test is
security-owned `acd-relay-auth-gate-checked`), and provisioning RUNS via the shell-less argv idiom (move 3,
`acd-enroll-git-argv-no-shell`).

**Alternatives considered.**
- *No relay auth-gate — leave the relay loopback-only forever* — rejected: it never pays the `23/ADR-001`
  deferral (the relay could never serve a real group over a LAN), and it makes the ADR-2 credential a dead
  mechanic (issued, never checked — the exact 22/R6 anti-pattern). The gate is the whole point of admission:
  the credential must gate a group connection.
- *A separate auth service / an OAuth-style token server* — rejected: it is the heavy auth control plane the
  PRD explicitly rejects (§7.3 "Explicitly NOT … an auth control plane") and the Phase-5+ multi-tenant fork
  (A3). v1 trusted-operator single-group is a shared group credential checked against the single-writer
  registry — the lightest structure that meets the requirement.
- *git-remote provisioning via a shell string (`exec("git remote add …")`) or a manual doc step* — rejected:
  a shell string word-splits a url on Windows (the `13/ADR-002` hazard `acd-enroll-git-argv-no-shell` guards) and a manual step
  makes the grant a dead mechanic (22/R6 — "provisioned alongside" must RUN, not be a README line). The
  shell-less `spawnSync("git", […])` argv idiom is the established, cross-platform-safe form.
- *Multi-tenant per-user git authz at admission* — rejected: `SPEC §Out of scope` / A3 — untrusted / cross-org
  / multi-tenant authz is the deferred Phase-5+ fork. v1 provisions the trusted-operator single-group default;
  the door stays clean (the credential shape has room for a richer grant) but the machinery is not built.

**Consequences.** Story 02 builds the relay auth-gate in `src/mesh-relay.mjs`'s upgrade handler (the additive
credential check, importing the registry VERIFY seam only — the relay stays stateless), the credential shape +
storage in `src/commands/mesh-join.mjs` (`config.mesh.credential`), the git-remote provisioning
(`spawnSync("git", ["remote","add",…])` on the joining node), and arch-test `acd-enroll-git-argv-no-shell`
(mine — git-argv no-shell); the auth-gate enforcement test is the security-owned `acd-relay-auth-gate-checked`
(SECURITY.md). It DEPENDS on 00 (the registry VERIFY seam) + 01 (the credential ADR-2 issues). It
co-touches `src/mesh-relay.mjs` with story 01 (01 the HTTP enrollment route, 02 the ws auth-gate) — an additive
co-touch sanctioned by `07/ADR-006` (the break-down rationale grounds this in the graph). The *observable* (a
credentialed ws connection is accepted, an uncredentialed group connection is rejected; a joined node has the
git remote configured) is a story-02 task `.feature`, not a fitness function.

## ADR-004: Credential revocation — `aof mesh revoke <node>` removes the node from the roster, appends a revocation, and de-provisions git-remote; the relay auth-gate rejects a revoked credential (the revocation list lives in the registry, ADR-1)

**Status:** Accepted
**Date:** 2026-07-01

**Context.** A3 names the credential-**revocation** flow as the counterpart of issuance ("the code-issuance /
credential-revocation flow needs care"); `SPEC §Scope` puts single-group revocation in scope (scaled/audited
revocation is the deferred Phase-5+ fork). Revocation must be ENFORCEABLE — a revoked node's credential must
stop working at the SAME real call site the credential is checked (the auth-gate, ADR-3), else revocation is a
dead mechanic (22/R6). The revocation list is one of the four registry facts (ADR-1).

**Decision.** A registered `mesh:revoke <node>` command (control-node-guarded — the `relayMode` predicate,
since revocation is an authority decision) that:

1. **Removes the node from the roster** (ADR-1's `writeRegistry` — the single write seam) — the node is no
   longer an admitted member.
2. **Appends a revocation record** `{ nodeId, revokedAt, reason }` to the registry revocation list (ADR-1) —
   so the auth-gate can reject a still-presented credential even before the roster removal syncs to every node
   (the revocation is an explicit deny, not merely an absence).
3. **De-provisions git-remote** — the control node removes the revoked node's git-remote access (the
   trusted-operator single-group default: revoke the shared token / remove the remote grant, the inverse of
   ADR-3 move 3, via the SAME shell-less git-argv idiom where a local `git remote remove` applies —
   `acd-enroll-git-argv-no-shell` covers the argv discipline for both provision and de-provision).

**The auth-gate rejects a revoked credential (the real enforcement call site, 22/R6).** ADR-3's
`verifyCredential(registry, token)` — read by the auth-gate on every group ws upgrade — checks BOTH the roster
(admitted?) AND the revocation list (revoked?): a token whose `nodeId` is in `revocations` is rejected
(`socket.destroy()`) even if a stale roster entry lingers. So revocation ENFORCES at the same structural gate
issuance is checked at — revocation is not a dead mechanic (it changes what the auth-gate accepts). The
security-owned `acd-relay-auth-gate-checked` (SECURITY.md) asserts the gate consults the LIVE revocation/roster,
which is the revocation enforcement point (SECURITY T6 revocation completeness).

**Per 22/R1.** `mesh:revoke` RIDES the EXISTING `acd-mesh-command-cli-bijection` gate (provided it adds its
`subcommand === "revoke"` branch + `cli` adapter + `argsFor` case). No new command-face gate (inverse-clean).

**Alternatives considered.**
- *Revocation = roster removal only (no explicit revocation list)* — rejected: roster removal alone relies on
  the removal SYNCING to the control node's relay before the revoked node reconnects; an explicit revocation
  record is an immediate deny the auth-gate honours regardless of sync lag (and gives `aof mesh ui` an audit
  line — m25). The revocation list is the faithful "explicit deny" structure.
- *A credential expiry / rotation scheme instead of revocation* — rejected: expiry is a different mechanism
  (a standing credential that lapses); A3 asks for revocation (an authority DECIDING to remove a member).
  Expiry/rotation is a clean-door Phase-5+ addition (the credential shape has room), not the v1 revoke flow.
- *Scaled / audited revocation (a revocation log service)* — rejected: `SPEC §Out of scope` — scaled
  credential revocation is the Phase-5+ platform fork. v1 is a single revocation list in the single-writer
  registry, enforced at the auth-gate.

**Consequences.** Story 02 builds `src/commands/mesh-revoke.mjs` (`mesh:revoke <node>` — roster removal +
revocation append + git-remote de-provision, control-node-guarded, writing the registry via ADR-1's single
seam), its dispatch branch + `cli` adapter + `argsFor` case, and rides `acd-registry-write-scope` (registry
write-scope) + `acd-enroll-git-argv-no-shell` (git-argv no-shell for de-provision); the security-owned
`acd-relay-auth-gate-checked` enforces the revocation at the auth-gate. It DEPENDS on 00
(the registry + its revocation list) + 01 + the ADR-3 auth-gate. The *observable* (a revoked node's credential
is rejected at the relay; its git-remote is de-provisioned) is a story-02 task `.feature`, not a fitness
function.

## ADR-005: Enrollment brute-force bounding — an attempt-cap / rate-limit on the device-flow endpoint (per-code and/or per-source, within the TTL window) + the documented config knobs `config.mesh.enrollment.codeTtlSeconds` / `maxAttempts` (the `resolveMaxFrameBytes` resolver shape); the attempt counter is EPHEMERAL in-memory relay state, so it does NOT violate `23/ADR-001` / `acd-relay-stateless`

**Status:** Accepted
**Date:** 2026-07-01

**Context.** A 6-digit device code is a **10^6** space. ADR-2 already pins the two structural fields that bound
it in TIME and in RE-USE — the TTL (`expiresAt`) and single-use consume (`consumedAt`) — but those alone do NOT
stop an attacker on a trusted-but-hostile LAN from **enumerating** the space *within* the TTL window: at a few
thousand HTTP `POST /enroll` attempts per second, 10^6 is walkable in minutes, well inside a multi-minute TTL.
The parallel `aof-security` agent's `SECURITY.md` (T2 the online-guessing / brute-force analysis; T7 the
rate-limit control) is emphatic that the **attempt-cap** is THE single load-bearing control that turns the code
space from *walkable* into *safe*, and explicitly routes a finding to the developer if the architect's ADR does
not surface the cap + its config knobs as **documented structural config**. This ADR closes that at design
time. It applies ADR-2 (the cap lives on the SAME `POST /enroll` device-flow handler ADR-2 authors, alongside
the TTL + single-use checks) and honours `23/ADR-001` / `acd-relay-stateless` (the counter is ephemeral, never a
durable record). It does NOT re-litigate ADR-1..4 (immutable); it ADDS the bounding control ADR-2's endpoint
was missing.

**Decision.** Three additive moves, all on the ADR-2 device-flow endpoint (story-01 scope):

1. **The attempt-cap / rate-limit is an in-scope story-01 structural deliverable on the `POST /enroll`
   handler.** After **N** failed presentations (counted **per-code and/or per-source** — per presented
   code-hash bucket, and/or per source address of the request) within the TTL window, the endpoint **refuses
   further attempts** (a structured `429`-class rejection, the never-crash HTTP discipline ADR-2 already uses)
   so the 10^6 space **cannot be enumerated before a code expires**. The cap sits alongside ADR-2's TTL check +
   single-use consume in the same handler: a presentation is checked for (a) TTL not expired, (b) not already
   consumed, (c) **the attempt budget for this code/source not exhausted** — (c) is this ADR's addition. A
   successful match resets/retires the bucket (the code is consumed, ADR-2). This makes the TTL + single-use +
   attempt-cap the **three** structural bounds on the device-flow, closing the enumeration gap T2 identifies
   (SECURITY.md T2/T7).

2. **The documented config knobs + v1 defaults, read via the `resolveMaxFrameBytes` resolver shape.** Two
   free-form `config.mesh.enrollment.*` knobs (the top-level schema has no `additionalProperties:false`; there
   is no mesh schema block — the same free-form subtree `config.mesh.relay.maxFrameBytes` lives in), each read
   through the SAME raw optional-chain + malformed-value→default tolerance `resolveMaxFrameBytes` uses:
   ```jsonc
   // src/mesh-relay.mjs (or the enrollment surface story 01 adds) — resolvers mirroring
   // resolveMaxFrameBytes(config) EXACTLY: a valid positive integer verbatim; ANY malformed
   // value (absent / non-number / non-finite / non-integer / <= 0) falls back to the
   // documented default WITHOUT crashing.
   export const DEFAULT_CODE_TTL_SECONDS = 300;   // 5 minutes — a code is presentable for a
                                                  //   few minutes, then expires (ADR-2 expiresAt).
   export const DEFAULT_MAX_ATTEMPTS   = 5;       // single-digit — 5 failed presentations per
                                                  //   code/source within the TTL, then refuse.
   //   config.mesh.enrollment.codeTtlSeconds  → the TTL (ADR-2's expiresAt = issuedAt + this).
   //   config.mesh.enrollment.maxAttempts     → the attempt-cap N (this ADR).
   ```
   With `maxAttempts = 5` over a `300 s` TTL, an attacker gets **5 guesses per code** before the endpoint
   refuses — against a 10^6 space that is a ~1-in-200 000 per-window chance, and the window closes at TTL
   expiry (SECURITY.md's T2 arithmetic). An operator on a hostile LAN can **raise the TTL floor / lower
   `maxAttempts`** (or, for a laggy human, raise the TTL) via config — the knobs are the documented tuning
   surface. The resolvers are `resolveCodeTtlSeconds(config)` / `resolveMaxAttempts(config)`, structurally
   identical to `resolveMaxFrameBytes` (a test can assert the malformed-value→default tolerance the same way).

3. **The attempt counter is EPHEMERAL in-memory relay state — NOT a durable/authoritative record (the
   `acd-relay-stateless` reconciliation, the load-bearing part).** The per-code/per-source failed-attempt
   counter lives in an **in-memory map on the control-node relay endpoint** (the same `serveRelay` process that
   holds the in-memory `clients` Set), is **never written to git**, imports **no** record/persist seam, and is
   **reset on restart** — acceptable for v1 (a restart merely re-opens the attempt window, and admission STILL
   requires the live control node + a non-expired code, so a restart is not a bypass of TTL/single-use). This
   does **NOT** violate `23/ADR-001` / `acd-relay-stateless`, which forbids the relay being a **system of
   record** (a durable/authoritative persist), NOT ephemeral in-memory guarding: it is **exactly** the
   precedent m23 already set with `resolveMaxFrameBytes` + the in-memory over-limit check (an ephemeral,
   in-memory, restart-resettable guard on the same endpoint that persists nothing). The counter stages a count,
   not a field — the same "frames not fields" property `acd-relay-stateless` defends. So the attempt-cap is a
   guard, not a record; the relay stays stateless.

**Per 22/R6 — the data source the cap reads is pinned.** The cap reads the in-memory attempt map keyed by
code-hash/source (this ADR) + `resolveMaxAttempts(config)` (move 2); the TTL check reads `resolveCodeTtlSeconds`
(move 2) against ADR-2's `expiresAt`. Both are real reads at the real `POST /enroll` call site — not a designed
mechanic with no data source.

**Per 22/R1 — the inverse stays CLEAN.** The cap adds **NO** new `mesh:*` command verb (it is logic ON the
existing device-flow endpoint story 01 already owns, and two config resolvers) — so it arms **NO** new
command-face gate; the `acd-mesh-command-cli-bijection` inverse-check stays clean, exactly as the rest of m24.
The knobs are free-form `config.mesh.enrollment.*` reads (no `schemas/aof.schema.json` change).

**Alternatives considered.**
- *TTL + single-use only, no attempt-cap (leave the enumeration gap)* — rejected: this is precisely the T2
  finding — within a multi-minute TTL the 10^6 space is walkable at HTTP speed, so the code is not safe from an
  on-LAN attacker. The attempt-cap is the load-bearing control (SECURITY.md T2/T7); omitting it routes a
  finding to the developer.
- *A durable, git-synced attempt counter (per-code, persisted to the registry)* — rejected: it makes the relay
  a **system of record** for attempt state (the exact `23/ADR-001` / `acd-relay-stateless` violation), bloats
  the git-synced registry with high-churn ephemeral counts, and buys nothing for v1 (a restart re-opening the
  window is acceptable — admission still needs a live control node + a non-expired code). Ephemeral in-memory,
  the `resolveMaxFrameBytes` precedent, is the faithful shape.
- *A hard-coded cap / TTL with no config knobs* — rejected: SECURITY.md requires the cap + TTL be **documented
  config knobs** so an operator on a hostile LAN can tune them; a hard-coded value is not tunable and is the
  half-measure the finding warns against. The `resolveMaxFrameBytes` resolver shape (documented default +
  malformed→default tolerance) is the established pattern.
- *A new arch-test for the cap's behaviour* — rejected: the cap's OBSERVABLE ("attempt-cap rejects after N
  tries; a TTL-expired code is rejected") is an end-to-end behaviour over the real HTTP endpoint — an
  `@executable` story-01 task scenario (SECURITY.md already plans it), NOT a structural source-grep. Authoring a
  structural arch-test for a runtime count would be the wrong altitude (behaviour, not structure). The
  resolver-tolerance (malformed→default) IS structurally testable, but it rides the same shape
  `resolveMaxFrameBytes` already proves — no NEW arch-test file is owed (see the fitness-table note).

**Consequences.** Story 01 adds, to the ADR-2 `POST /enroll` device-flow handler: the per-code/per-source
in-memory attempt counter + the refuse-after-N check (alongside the TTL + single-use checks), and the two
config resolvers `resolveCodeTtlSeconds(config)` / `resolveMaxAttempts(config)` (the `resolveMaxFrameBytes`
shape, `DEFAULT_CODE_TTL_SECONDS = 300` / `DEFAULT_MAX_ATTEMPTS = 5`). It arms **NO** new arch-test (move 3 /
the fitness-table note) and **NO** new command-face gate (22/R1 inverse-clean). The *observable* (the endpoint
refuses after `maxAttempts` failed presentations within the TTL; a TTL-expired code is rejected; the knobs
tune both; a malformed knob falls back to the default) is a story-01 `@executable` task `.feature` +
SECURITY.md's T2/T7 coverage — NOT a fitness function. The attempt-cap is bounded to the story-01 device-flow
endpoint; it does not touch the registry (ADR-1), the auth-gate (ADR-3), or revocation (ADR-4).

## Fitness functions

<!-- Each STRUCTURAL invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature. RED-until-built is
     the correct state now: src/mesh-registry.mjs, the mesh:invite/join/revoke commands, the enrollment HTTP
     endpoint, and the relay auth-gate do not exist yet; the tests reference them so they fail cleanly until
     the owning story lands. "From" names the owning story. The SECURITY fitness (device-code brute-force
     resistance, hashed-code-at-rest crypto, constant-time/single-use match) is authored by aof-security in
     SECURITY.md — NOT here; this table is the STRUCTURAL residue only. -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| **Registry write-scope + single-writer (STRUCTURAL — mine).** The group registry has EXACTLY ONE write seam (`writeRegistry` in `src/mesh-registry.mjs`), that write is control-node-guarded (the `relayMode`/control-node predicate — a non-authority invocation never writes), routes through the atomic `writeText` seam (19/R2, never a bare `writeFile`), joins the `registryDir`/`registryPath`/`meshDir` partition seam (never a record doc), and NO OTHER module writes the registry file (ADR-1). | `test/arch/acd-registry-write-scope.test.mjs` — source-grep `src/mesh-registry.mjs` (+ a repo-wide grep that no other `src/**` module writes `registry/`): assert every write joins `registryPath`/`registryDir`/`meshDir` + routes through `writeText`, the write path is gated by the control-node predicate, and it references zero record-doc filename (mirroring `22/ADR-002`'s `acd-mesh-write-scope` + `23`'s `acd-presence-write-scope`). | RED until `src/mesh-registry.mjs` exists | **00 · group registry** |
| **Enrollment endpoint keeps the ws envelope payload-agnostic (STRUCTURAL — mine).** Enrollment is an HTTP route on `serveRelay`'s existing `http.createServer`, NOT a new ws `kind` — the ws `{ kind, nodeId, signal }` envelope is untouched: `parseEnvelope` / the ws message handler branch on NO enrollment `kind`, and the enrollment logic lives in the HTTP request handler, not the ws message path (ADR-2; preserving 22/ADR-004 + 23/ADR-001 payload-agnosticism so m26 leasing adds a `kind` with zero relay change). | `test/arch/acd-enroll-endpoint-http-not-ws.test.mjs` — source-analysis of `src/mesh-relay.mjs`: assert (a) `parseEnvelope` / the ws message handler contains no `"enroll"`/`"join"`/`"invite"` `kind` branch (the ws envelope stays `{ kind, nodeId, signal }`-neutral), and (b) an enrollment surface, when present, lives in the `http.createServer` request handler (an HTTP route above the `426` fallback), not the `wss.on("connection")` message path. Each proof carries the m03 non-vacuous self-check (a planted `kind === "enroll"` ws branch goes RED). | RED until the HTTP enrollment route lands | **01 · enrollment flow** |
| **git-remote provisioning uses the read-only-source shell-less git-argv idiom (STRUCTURAL — mine).** Every `git` spawn in the enrollment path (provision at join, de-provision at revoke) is a shell-less `spawnSync("git", [<verb>, …])` argv call — NEVER a shell string / `exec(` (a shell word-splits a url on Windows), and it makes no git WRITE verb against a FOREIGN source tree it does not own (it configures the joining node's OWN clone) (ADR-3/ADR-4; the 13/ADR-002 idiom). | `test/arch/acd-enroll-git-argv-no-shell.test.mjs` — source-grep of the enrollment git call sites (`src/commands/mesh-join.mjs` + `src/commands/mesh-revoke.mjs`): assert every `git` spawn is the `spawnSync("git", [ … ])` argv form (the argv-token extractor), no `exec(`/`execSync(` shell form, and no template/concatenated command string (the `acd-migrate-read-only-source` / `acd-import-read-only-source` idiom). Each proof carries the m03 non-vacuous self-check (a template command string goes RED). | RED until the provisioning lands | **02 · trust boundary** |
| **Mesh-namespace bijection (RIDES the existing gate — NO new gate, 22/R1).** Every new `mesh:*` verb (`invite`/`join`/`revoke`) carries a non-null `cli` adapter, has a reachable `aof mesh <sub>` dispatch branch, and `aof mesh <sub> --json` runs clean + parseable. | The **EXISTING** `test/arch/acd-mesh-command-cli-bijection.test.mjs` (22/fitness #3, `id.startsWith("mesh:")`) — auto-covers the new verbs **provided** their story adds the `subcommand === "<sub>"` branch in `meshCommand` + the `cli` adapter + the `argsFor` case. **No new gate authored** (the inverse-22/R1 check is CLEAN: the namespace gate already exists; unlike m22, which had to author it). Board route-coverage is **m25**. | GREEN gate exists (m22); RED on the NEW verbs until their dispatch branch + `argsFor` land | **01 / 02 (per verb)** |

**Security fitness authored by aof-security in SECURITY.md (POINTERS — NOT mine to author; the trust-boundary crypto/enforcement residue).** These already exist as RED-until-built files, are wired into `scripts/test.mjs`, and anticipate this ADR's `src/mesh-registry.mjs`. My structural fitness above is deliberately DISJOINT from them (I assert write-scope / envelope-neutrality / argv-discipline; security asserts the crypto + the enforcement — no overlapping file):

| Invariant (SECURITY-owned) | Enforced by (arch-test) | From |
|---|---|---|
| **Pending device code is stored HASHED at rest, never plaintext (crypto).** The enrollment surface hashes the code (`node:crypto`) and persists a `codeHash`/`hash`/`digest`, never a bare `code`/`deviceCode`/`plaintext` field on the durable git-synced registry record (SECURITY.md T3; the crypto counterpart of ADR-1/ADR-2's structural placement). | `test/arch/acd-enrollment-code-hashed-at-rest.test.mjs` | 00 / 01 |
| **Code match is SINGLE-USE + CONSTANT-TIME.** The presented-code match consumes the pending invite (single-use) and compares via `timingSafeEqual` — no `===` timing oracle on the 10^6 space (SECURITY.md T2/T4; the crypto counterpart of ADR-2's structural consume-then-admit). | `test/arch/acd-enrollment-code-single-use-constant-time.test.mjs` | 01 |
| **The relay ws auth-gate REJECTS an absent/invalid/revoked credential, reading the LIVE roster/revocation before brokering (enforcement).** The upgrade admission calls a credential-verify seam, rejects on failure, and consults the LIVE revocation/roster (importing `mesh-registry.mjs`/`mesh-credential.mjs`) — the 22/R6 "the credential is actually USED" guard + the pre-auth→authenticated transition (SECURITY.md T1/T6; the enforcement counterpart of ADR-3's structural auth-gate + ADR-4's revocation). | `test/arch/acd-relay-auth-gate-checked.test.mjs` | 02 |

**Enrollment brute-force bounding (ADR-005) — NO new arch-test; covered `@executable` (story 01) + by
SECURITY.md.** The attempt-cap / rate-limit + the TTL are a **runtime behaviour** on the `POST /enroll`
device-flow endpoint, not a structural source-grep — so ADR-005 authors **no** new arch-test file. Its
observable ("the endpoint refuses after `config.mesh.enrollment.maxAttempts` failed presentations within the
TTL; a TTL-expired code is rejected; a malformed knob falls back to the documented default") is a **story-01
`@executable` task `.feature`** (which SECURITY.md's T2/T7 coverage already plans), NOT a fitness function. The
one structurally-testable piece — the `resolveCodeTtlSeconds` / `resolveMaxAttempts` malformed-value→default
tolerance — rides the SAME resolver shape the existing `resolveMaxFrameBytes` already proves (m23), so no NEW
structural gate is owed. The counter's ephemeral in-memory nature keeps the existing `acd-relay-stateless`
(m23 fitness #1) GREEN — that gate already forbids a durable relay record, and the attempt counter is
in-memory (a guard, not a record), so it is not re-armed and needs no new file. **22/R1 inverse stays CLEAN:**
the cap adds no `mesh:*` verb, so no new command-face gate.

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors m22/m23's split):
     - REGISTRY WRITE-SCOPE + SINGLE-WRITER, PENDING-CODE-HASHED (structural write-scope), the RELAY
       AUTH-GATE PRESENCE, the ENROLLMENT-ENDPOINT-IS-HTTP-NOT-WS neutrality, the GIT-ARGV NO-SHELL
       provisioning idiom, and the (existing) MESH BIJECTION are true STRUCTURAL invariants over the
       registry module's write surface, the invite/registry write site, the relay upgrade handler, the ws
       envelope path, the enrollment git call sites, and the command registry/dispatch → arch-tests (this
       table). They are the milestone's load-bearing STRUCTURAL deliverable.
     - The OBSERVABLE behaviours — "the control node writes a registry a peer reads over git", "invite → join
       over the real endpoint admits a node + issues a credential", "a credentialed ws connection is accepted,
       an uncredentialed group connection is rejected", "a revoked node's credential is rejected + its
       git-remote de-provisioned", and "a fresh machine joins with a single 6-digit code on all three OSes
       (KR6)" — exercise the real seams, the real filesystem, real git, and a real http/ws server. They belong
       in story 00's / 01's / 02's task .feature files, NOT here.
     - The SECURITY invariants (device-code brute-force resistance, hashed-code-at-rest CRYPTO strength,
       constant-time / single-use match) are authored by aof-security in SECURITY.md with their own security
       fitness — NOT in this table (this table is the STRUCTURAL residue only). Where a structural fitness
       above touches the trust boundary (pending-code-hashed #2, auth-gate #3) it asserts only the structural
       write-scope / gate-presence and defers the crypto to SECURITY.md by name. -->

## Story break-down rationale

<!-- Informs the PO's break-down; does NOT itself create stories. The PO partitions milestone 24 into
     exactly three stories. The partition follows the real call/dependency coupling the codebase graph
     reports, not inferred coupling. -->

The PO will partition milestone 24 into **exactly three stories**, and the boundary follows the **real
call/dependency coupling** the codebase graph reports (`aof graph build src` → **1174 nodes / 3143 edges**,
builtAt 2026-07-01; `aof graph impact` consulted at author time — cited as **actual** structure, not inferred).
I VALIDATE the candidate 3-story partition (`00 · group registry` → `01 · device-code enrollment flow` → `02 ·
enforceable trust boundary`); the graph supports this cut, with one deliberate call on the relay-side co-touch:

- **00 · the group registry (the dependency root — the durable group-level git-of-record)** — owns
  `src/mesh-registry.mjs` (the single-writer store: `registryDir`/`registryPath` beside the mesh-store spine,
  `writeRegistry` control-node-guarded through the atomic `writeText` seam, `readRegistry` absence-tolerant,
  the roster/boards/pending/revocation schema, ADR-1) + my arch-test `acd-registry-write-scope` (write-scope +
  single-writer). The code-hashed-at-rest crypto (`acd-enrollment-code-hashed-at-rest`) is SECURITY-owned.
  Buildable + testable STANDALONE over git alone — no relay, no credential yet. The **dependency root**
  (00 → {01, 02}).
- **01 · device-code enrollment flow** — owns `src/commands/mesh-invite.mjs` (`mesh:invite` — mint + record
  hashed pending), the device-flow HTTP endpoint added to `serveRelay`'s request handler in `src/mesh-relay.mjs`
  (match/consume/TTL/admit/issue, ADR-2), `src/commands/mesh-join.mjs` (`mesh:join <code>` — present + store
  credential) + my arch-test `acd-enroll-endpoint-http-not-ws` (enrollment endpoint is HTTP, not a ws `kind`).
  The pending-code crypto (`acd-enrollment-code-hashed-at-rest` + `acd-enrollment-code-single-use-constant-time`)
  is SECURITY-owned. DEPENDS on 00.
- **02 · the enforceable trust boundary** — owns the relay ws auth-gate in `src/mesh-relay.mjs`'s upgrade
  handler (ADR-3, the credential CHECK), the credential storage + git-remote provisioning in
  `src/commands/mesh-join.mjs` (ADR-3), `src/commands/mesh-revoke.mjs` (`mesh:revoke`, ADR-4) + my arch-test
  `acd-enroll-git-argv-no-shell` (git-argv no-shell). The auth-gate enforcement (`acd-relay-auth-gate-checked`)
  is SECURITY-owned. DEPENDS on 00 + 01 — the genuine
  enforcement / integration story.

**Why this boundary is grounded in the graph, not inferred:**

1. **The registry (00) sits BESIDE the mesh-store spine the graph shows as a clean low-fan-out mechanic — and
   it is the topological root.** `aof graph impact src/mesh-store.mjs` reports **3 dependents**
   (`src/commands/mesh-identity.mjs`, `src/mesh-presence.mjs`, `src/mesh-sync.mjs`) and **2 dependencies**
   (`src/fs.mjs`, `src/run-store.mjs`) — a low-fan-out spine that already exports `meshDir`/`flatLeaf`/the
   `writeText`-backed persist. The new `src/mesh-registry.mjs` re-uses those exact exports (the single
   single-writer aggregate the spine deliberately does NOT hold, `22/ADR-002`) and adds the ONE new dependency
   the enrollment flow reads: everything downstream (the invite/join match, the auth-gate verify, the revoke)
   reads or writes the registry. So 00 is the dependency root the call graph dictates (00 → {01, 02}),
   buildable over git alone with no relay or credential in the picture.

2. **The relay is the graph's leaf serve unit — and BOTH 01 and 02 co-touch it, additively.** `aof graph
   impact src/mesh-relay.mjs` reports **2 dependents** (`src/commands/mesh-relay.mjs`,
   `src/mesh-presence-subscriber.mjs`) and **0 dependencies** — a leaf serve unit that imports nothing
   coupling it to a record. Story 01 adds the device-flow HTTP route to its `http.createServer` request
   handler; story 02 adds the credential auth-gate to its `server.on("upgrade")` handler. **These are two
   DISJOINT surfaces of the same module** (the HTTP request path vs the ws upgrade path — the code already
   separates them: the `426` handler and the upgrade router are distinct functions in `serveRelay`), each an
   ADD (a new route above the `426` fallback; a new check above the `socket.destroy()` pathname reject).
   **The call:** this additive co-touch is ACCEPTABLE per `07/ADR-006` (the m23 co-touch precedent — m23's
   `command-core.mjs` + `cli.mjs` were add-only co-touched across all three stories). The graph does NOT argue
   for clustering all relay-side changes into one story: the two surfaces are file-disjoint WITHIN the module
   (HTTP route ≠ ws upgrade handler), the relay's `0` outbound dependencies mean neither surface drags a shared
   record dependency, and the two changes belong to genuinely different stories (enrollment MATCH is the flow;
   the auth-gate is the enforcement) with different dependency depths (01 depends on 00; 02 depends on 00 + 01).
   Splitting keeps 01 shippable (invite → join → credential issued) before the enforcement gate lands, and the
   auth-gate (02) is the milestone's genuine trust-boundary weight — isolating it in the integration story
   mirrors m23's "the novel structural weight lives in one sibling." Were the two surfaces NOT file-disjoint
   (e.g. both rewrote `parseEnvelope`), the graph would argue to cluster; here they are, so the additive
   co-touch stands.

3. **The two new command modules are leaf faces on the additive door — no new gate.** `aof graph impact
   src/command-core.mjs` reports **4 dependents** and **25 dependencies** (already carrying the four `mesh-*`
   commands). Registering `mesh:invite`/`mesh:join`/`mesh:revoke` is one import + one `COMMANDS` entry + one
   `meshCommand` `subcommand === "<sub>"` branch + one `cli` adapter + one `argsFor` case per verb — the
   additive `22/ADR-001` idiom on a door that already routes `mesh:*`. `src/commands/mesh-join.mjs` re-uses the
   `src/mesh-relay-client.mjs` url read (graph: that client is a leaf, 1 dependent / 0 dependencies — the join
   client mirrors its shape). The new verbs RIDE the existing `mesh:`-filtered bijection gate (22/fitness #3):
   m24 authors **NO** new registry-derived command-face gate (the inverse-22/R1 check is CLEAN because the
   namespace gate already exists — unlike m22, which had to author it). The only cross-story co-touched files
   are `command-core.mjs`'s `COMMANDS` array + `cli.mjs`'s `meshCommand` dispatcher (each add-only, one entry /
   one branch per verb) + `src/mesh-relay.mjs` (01 the HTTP route, 02 the ws gate) — all the acceptable
   additive co-touch `07/ADR-006` sanctions.

4. **The cross-story edges are exactly the dependency chain, and they are minimal.** 01 imports the registry
   (00) to record the pending invite + admit; 02 imports the registry VERIFY seam (00) at the auth-gate + the
   credential (01) at the check. The graph shows no OTHER coupling between the story file sets — so 00 is a
   clean root, 01 and 02 chain off it, and the relay co-touch (01+02) is the only within-module shared file,
   handled additively. The `24 → 23` seam (the enrollment endpoint on `serveRelay`; the auth-gate on its
   upgrade handler) and the `24 → 22` seam (the registry on `meshDir`, synced by the payload-agnostic engine;
   the shell-less git-argv idiom from `mesh-sync.mjs`) are inherited seams the ADRs cite, not new cross-story
   edges within m24.

**The one conscious refinement from milestone 23's partition.** In m23 story 00 (presence) and story 01 (the
relay) were **file-disjoint parallel siblings** — the relay never imported the presence record. Here the
enrollment flow (01) and the trust boundary (02) BOTH co-touch `src/mesh-relay.mjs` (01 the HTTP enrollment
route, 02 the ws auth-gate). This is a DEPARTURE from m23's clean parallel split — and it is deliberate: the
relay is the one module both the enrollment endpoint and the auth-gate must live on (`03/ADR-001` — ONE server;
`23/ADR-001` — the upgrade handler is where auth lands). The graph confirms the two surfaces are file-disjoint
WITHIN the module (the `http.createServer` request handler vs the `server.on("upgrade")` handler are separate
functions), and `07/ADR-006` sanctions the additive co-touch, so the split holds rather than forcing a single
"all relay changes" story that would couple the enforcement gate to the flow it enforces. The registry (00)
remains the clean parallel root — it is file-disjoint from the relay entirely (the registry is a store module,
the relay a serve unit; the auth-gate READS the registry via a pure verify seam, importing no record schema, so
the relay stays a leaf).

The coupling is **advisory**: it informs why registry-first (00) + an enrollment flow (01) + an enforcement
boundary (02) is the right cut (the call graph's dependency root at the registry + the file-disjoint-within-the-
module relay co-touch + the minimal dependency chain), but the PO draws the final partition. The graph
confirms — it does not dictate.
