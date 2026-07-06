---
type: story
number: 00
slug: per-install-node-identity
title: "Per-install node identity — split config.mesh into fleet-shared (committed) vs per-install identity (git-ignored sidecar); derive from hostname; hydrate at loadWorkspace; back-compat fallback + doctor migrate-warn; self-heal on hostname mismatch (F-3203)"
parent: 33
status: done
owner: product-owner
created: 2026-07-04
updated: 2026-07-05
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · Per-install node identity — identity is never inherited on clone

## User story

As an operator **cloning an aof workspace onto a fresh machine** (a real cross-OS fleet node),
I want this node's identity (`nodeId` + `salt`) to derive from **THIS machine's hostname** and persist to a
**git-ignored sidecar** (`.aof/mesh/identity.json`), never to the committed `.aof/aof.config.json`,
so that a clone/copy **never inherits the origin machine's identity** — two machines never share a `nodeId`
(never clobber each other's `nodes/<id>.json` at one path), and the m22 one-node-per-path partition
invariant (`acd-mesh-partition-write`) holds on real hardware. This is the direct fix for **UAT 32 ·
F-3203** (the macOS node deriving `umairs-msi`, the Windows node's id, off inherited committed config).

<!-- The clean-cut identity story: it re-points where identity is PERSISTED (committed config → git-ignored
     sidecar) + hydrates it back on load, so every downstream `config.mesh.nodeId` reader is unchanged.
     Graph-isolated from the transport work: `node-identity.mjs` has only two dependents
     (commands/mesh-heartbeat, commands/mesh-identity) — it cuts away from the relay/presence bus cleanly. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 33 --autonomous`, Contract stage). Each behaviour task
     is one `.feature` under tasks/; done when its feature is green. The fitness function is an arch-test
     (structural invariant → never a behaviour feature) tracked as a buildable unit below. -->

- [x] `tasks/00_identity-sidecar-persist.feature` — `@executable @finding-F-3203` — `deriveNodeId`'s persist
  target is re-pointed from committed `config.mesh.nodeId` to the git-ignored sidecar
  `.aof/mesh/identity.json`, via the SAME read-merge-write idiom `persistNodeId` uses (ADR-004.2): a fresh
  install derives from its OWN hostname and writes the sidecar — the committed config is left byte-unchanged
  (no `nodeId`/`salt` written there); a second clone of the same repo on a DIFFERENT host derives its OWN
  distinct id (the F-3203 inherited-id fixed); the pinned-id-wins-verbatim precedence (`node-identity.mjs:74`)
  is preserved but the pin now lives per-install, so it no longer travels on clone.
- [x] `tasks/01_loadworkspace-hydration.feature` — `@executable @finding-F-3203` — `work.mjs loadWorkspace`
  overlays the sidecar's `nodeId`/`salt` onto `config.mesh` in the returned in-memory workspace (ADR-004.3),
  so every downstream reader (`mesh-presence`, issuance, lease, `mesh-relay`'s optional-chain) sees the
  per-install id with ZERO change; precedence is **sidecar > committed-fallback > hostname-derive**; a
  workspace with a sidecar and a (legacy) committed `nodeId` uses the SIDECAR value; hydration lands in
  `loadWorkspace`, never `runtime-config.mjs`.
- [x] `tasks/02_backcompat-migrate-doctor.feature` — `@executable @finding-F-3203` — a legacy committed
  `mesh.nodeId` with NO sidecar stays a working **fallback** (ADR-004.4) AND `work doctor` warns
  "per-install identity is in committed config — migrate it to `.aof/mesh/identity.json` (F-3203)"; the
  migrate moves `nodeId`/`salt` to the sidecar and strips them from the committed config (turning the
  `acd-mesh-identity-not-committed` fitness green); the migrate is idempotent (a second run is a clean no-op)
  and absence-tolerant (no committed identity ⇒ nothing to migrate, no warn).
- [x] `tasks/03_self-heal-hostname-mismatch.feature` — `@executable @finding-F-3203` — a sidecar whose
  `nodeId` was derived from a hostname that **no longer matches** this machine's current hostname (the
  copied-`.aof/mesh/identity.json` symptom) re-derives from the CURRENT hostname and rewrites the sidecar
  (ADR-004.5), so a copied identity sidecar self-corrects — not only committed config; an operator-pinned id
  (explicitly set, not hostname-derived) is honoured and NOT auto-healed (the pin wins).
- [ ] `tasks/04_cross-os-distinct-identity.feature` — `@manual @finding-F-3203` — the real-hardware lane:
  two machines (Windows + macOS) each cloned from one shared remote derive **distinct** `nodeId`s from their
  own hostnames, publish to DISTINCT `nodes/<id>.json` partition paths, and neither clobbers the other — the
  exact F-3203 scenario, confirmed on real hosts (a VERIFICATION-time observation, not a CI assert; feeds the
  UAT 32 re-run).
- [x] **Fitness `acd-mesh-identity-not-committed`** (arch-test, ADR-004/ADR-006 — authored PENDING at Decide)
  — no per-install identity (`nodeId`/`salt`) appears in committed config (`.aof/aof.config.json`) or the
  config schema. **DoD of this story: un-skip it and make it GREEN** by migrating the committed
  `.aof/aof.config.json` (which still carries `salt` + `nodeId: umairs-msi`) to the sidecar. It is RED until
  that migration lands — build the migration IN, do not leave the guard pending.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) — **ADR-004** (the identity split: fleet-shared
committed `relay.controlNode`/`fabric` vs per-install `nodeId`/`salt` → the git-ignored sidecar
`.aof/mesh/identity.json`; derive-from-hostname kept, persist target re-pointed; hydrate at `loadWorkspace`;
back-compat committed fallback + doctor migrate-warn; self-heal on hostname mismatch) and **ADR-006** (the
`acd-mesh-identity-not-committed` encoding: a JSON/AST read of the committed config + schema, not a grep).

This story **owns**: `src/node-identity.mjs` (re-point `persistNodeId`'s target to the sidecar + the self-heal
re-derive), the NEW sidecar read/write seam (`.aof/mesh/identity.json`, under the already-`mesh/`-ignored
tree — **no new `.gitignore` entry**, confirmed), `src/work.mjs` (`loadWorkspace` sidecar hydration — the ONE
read-merge-write hydration seam, 22/R2), the `work doctor` migrate-warn (`src/work-doctor*.mjs`) + the migrate
action, and the migration of `.aof/aof.config.json` (strip `mesh.nodeId`/`mesh.salt`).

**Graph-grounded independence:** `node-identity.mjs`'s only dependents are `commands/mesh-heartbeat.mjs` +
`commands/mesh-identity.mjs` (fresh graph, actual edges) — so re-pointing the persist target + adding the
sidecar read/write is a clean cut that touches nothing in the transport/launcher bus. `acd-mesh-partition-write`
(the invariant F-3203 broke) is RESTORED the moment identity is per-install and stays green throughout.

**Sequenced FIRST (soft edge, not a hard compile dep):** story 01's fabric peer→nodeId join (ADR-002.2)
assumes per-install identity is correct — a fleet with inherited nodeIds would mis-join peers. Land identity
first so the transport joins on trustworthy per-node ids. The two stories are file-disjoint.

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Overall verdict: all 5 tasks stay as tagged.** Tasks `00`–`03` stay `@executable` — every RAISED flag
resolves to "feasible, here's the minimal concrete change" against the real tree, with no scenario requiring
real hardware. Task `04` stays `@manual` — confirmed correct: it genuinely needs two real,
differently-hostnamed machines (Windows + macOS) reading real `os.hostname()` over a real shared git remote,
which is irreducible to a local fixture without collapsing into task 00's injected-hostname unit (which
already exists and covers the deterministic core). It is not `@uat` either — no human acceptance judgement is
needed, just a mechanical cross-OS observation.

**Flag 00 — injected sidecar path + salt-must-travel: RESOLVED, feasible.**
`deriveNodeId` already takes an injected `configPath` (`node-identity.mjs:73,99`) and `persistNodeId(configPath,
id)` (`node-identity.mjs:112`) takes it as a plain arg — never hard-derived from `process.cwd()`/`os`. An
analogous `sidecarPath` (computed by the caller from the already-injected `aofDir`, `work.mjs:57`) is trivially
threadable — confirmed against the two real call sites, `commands/mesh-identity.mjs:139-144` and
`commands/mesh-heartbeat.mjs:78-83`, both of which already pass `configPath: ws.configPath`. **Confirmed gap:**
today `persistNodeId:123` writes `config.mesh.nodeId` only — `salt` is a separate persist done by
`resolveInstallSalt` (`commands/mesh-identity.mjs:98-114`), which read-merge-writes `config.mesh.salt` into the
**committed** file. The re-point must carry both: the sidecar-targeted persist writes `{nodeId, salt}` in one
read-merge-write, and `resolveInstallSalt`'s committed-config write is retired in the same change (else the
"committed config byte-unchanged" scenarios go red). Keeps the same read-merge-write idiom (`fs.mjs:5,14`'s
`readJson`/`writeText`), just re-pointed and widened to the two-key object task 03's self-heal needs.

**Flag 01 — hydration anchored on `aofDir`, overlay-not-derive: RESOLVED, feasible.**
`loadWorkspace` (`work.mjs:42-59`) computes `aofDir` at line 57, fixture-relative, and returns it at line 58 in
`{ configPath, config, projectRoot, workDir, aofDir }`. A test plants a fixture `.aof/mesh/identity.json` under
the fixture project root and `loadWorkspace` resolves the identical path — no new injection seam needed. The
overlay is symmetric to the existing config read (`work.mjs:44-49`'s try/catch-to-`{}`): read the sidecar the
same tolerant way, merge `nodeId`/`salt` onto `config.mesh` before the `return`, no `writeText` call added — the
"loadWorkspace writes no file" assertion holds because nothing but the in-memory object about to be returned is
touched. `os.hostname()`/`deriveNodeId` are not called from `loadWorkspace` in the common path (confirmed via
`commands/mesh-identity.mjs:139-144`, where derive+persist stays at the command boundary), so the "neither
present ⇒ absent" row holds. Note: task 03's self-heal write is the one deliberate exception to this —
reconciled in that task's resolution.

**Flag 02 — migrate as a testable unit + doctor reads RAW disk config: RESOLVED, feasible, with one concrete
wiring gap identified.**
The migrate is feasible as a plain exported unit `migrateIdentity(configPath, sidecarPath)` mirroring
`persistNodeId`'s injected-path precedent — no prompt dependency, hermetic. **Confirmed real gap:**
`commands/doctor.mjs:30` passes `ctx.workspace.config` (the **hydrated**, post-task-01 config) into `doctorWork`,
and `work-doctor.mjs:389` stores it verbatim as `ctx.config`. Every existing check-group
(`work-doctor-coherence.mjs`, `work-doctor-freshness.mjs`, `work-doctor-budget.mjs`) trusts `ctx.config` as-is —
none re-reads the committed file independently. So on a correctly-migrated repo, `ctx.config.mesh.nodeId` is
still populated (sourced from the sidecar via hydration), and a warn-group naively reading `ctx.config.mesh`
would false-positive forever. The fix: the new `mesh-identity-committed` check-group must independently read the
RAW committed config off disk (e.g. via `ctx.workspace.configPath`, threaded through the same impure-edge
boundary `commands/doctor.mjs:28-33` already uses for `Date.now()`) — never `ctx.config`. This is the one
concrete wiring change beyond appending a new check-group function to `CHECK_GROUPS` (`work-doctor.mjs:288-296`).

**Flag 03 — sidecar schema discriminator: RESOLVED — the load-bearing decision.**
Sidecar schema: `{ nodeId: string, salt: string, derivedFrom?: string, pinned?: true }`. Mutually exclusive by
construction: a hostname-derived id records `derivedFrom: <hostname fed to sanitizeHostname>`; an
operator-pinned id records `pinned: true` and no `derivedFrom`. Heal predicate: fires iff `sidecar.pinned !==
true` AND `typeof sidecar.derivedFrom === "string"` AND `sanitizeHostname(currentHostname) !== sidecar.nodeId`.
An old sidecar with neither key (pre-schema) is treated as "unknown origin, do not heal" — never silently
churned. **Heal site: `loadWorkspace`** (not `deriveNodeId`), because it must fire on every load regardless of
which command runs (e.g. `mesh:status` never calls `deriveNodeId` — `commands/mesh-identity.mjs:205` reads
`ws.config?.mesh?.nodeId` directly), matching ADR-004.5's load-time framing. `os.hostname()` is read at the
`loadWorkspace` boundary (mirroring `commands/doctor.mjs:31`'s `Date.now()` pattern) and threaded as an
injectable option for tests, mirroring `deriveNodeId`'s own injected-hostname seam (`node-identity.mjs:73`).
**Reconciliation with task 01's "writes no file":** the heal write is a deliberate, narrowly-discriminated
exception — it fires only when schema says "derived" AND hostname mismatches; every other load (no sidecar,
matching host, pinned) stays a pure read. `loadWorkspace`'s header comment should state this carve-out
explicitly so it isn't mistaken for drift from ADR-004.3.

Each `tasks/*.feature` (00–03) now carries a `# RESOLVED (developer-amigo): …` block beneath its
`# QA FEASIBILITY FLAG … RAISED` block (the house pattern); `04` was read-only (its `@manual` tag confirmed).
No production code was touched at refine.
