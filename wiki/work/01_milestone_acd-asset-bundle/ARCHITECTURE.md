---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 01 · ACD Asset Bundle + work init/update — Architecture Decisions

## ADR-001: The ACD bundle is a built-in, package-shipped set of aof resources located via the module path

**Status:** Accepted
**Date:** 2026-06-17

**Context.** Today the ACD actors live **loose** in the gitignored runtime: hand-written
`.claude/agents/aof-*.md` (8 agents, alongside an unmanaged `code-reviewer.md` and legacy `gsd-*`)
and `.claude/commands/aof/*.md` (14 files). The milestone templates live tracked under
`wiki/templates/`. None of these is aof-managed — the project's `.aof/aof.config.json` has
`resources: []`, and `.claude/` is in `.gitignore`, so nothing here is reproducible or shippable.
To ship ACD to other repos we need a *source of truth* that (a) travels inside the published `aof`
npm package, (b) the installed CLI can find with **no** dependence on cwd or the consumer's config,
and (c) reuses aof's own resource shape so the render pipeline already understands it. The package
already entry-points through `bin/aof.mjs → ../src/cli.mjs`, so any sibling tree is resolvable from
`import.meta.url`. The package has **no** `files` allowlist, so what ships is what is tracked and not
git-/npm-ignored — a tracked source tree ships automatically; the loose `.claude/` runtime does not.

**Decision.** The ACD bundle is a **first-class, built-in bundle baked into the aof source tree** —
a tracked directory (the bundle root) holding the bundle's resource bodies plus a single declarative
bundle descriptor that enumerates its members as aof resources (`kind` ∈ {agent, command, skill} and
a `template` member class for the milestone templates). It is **not** a consumer "package", **not** a
project asset of this repo, and **not** read from the gitignored runtime. The installed CLI locates
the bundle root by resolving a path **relative to its own module URL** (`import.meta.url`), never from
`process.cwd()` or a consumer config key. A loader reads the descriptor and presents the bundle to the
rest of the system as a normal aof `config`-shaped object so the existing render machinery consumes it
unchanged (see ADR-003). This repo's own `.claude`/`.codex` runtime ceases to be the source of truth
for the ACD actors; it becomes just another *render target* of the same bundle (dogfooding).

**Alternatives considered.**
- *Keep the actors loose in `.claude/` and ship those* — rejected: `.claude/` is gitignored, so it
  ships nothing; it mixes managed `aof-*` with unmanaged `code-reviewer.md`/`gsd-*`; and it has no
  declared membership, so nothing can drift-check it.
- *Model ACD as a consumer `package` (the `packages[]` pipeline)* — rejected: packages are an
  *external/managed-dependency* concept (namespacing, install attempts, framework intent). The ACD
  bundle is aof's **own** built-in payload; routing it through the package machinery would borrow
  semantics (namespacing/prefixing, `originalId`) that distort identity and complicate the
  drift-check. Keep it a built-in bundle.
- *Make it this repo's project assets (`resources[]` in `.aof/aof.config.json`)* — rejected: project
  assets render into *this* repo only and aren't enumerable by the installed CLI in a consumer repo;
  the bundle must be findable from the installed module, independent of any consumer's config.
- *Locate the bundle via cwd / a consumer config key* — rejected: makes the bundle non-portable and
  breaks when run from a subdirectory or a repo with no aof config yet.

**Consequences.** There is exactly one authored source for the ACD actors, tracked and versioned with
the code, and it ships by default. The installed CLI finds it deterministically from its own location.
Because the bundle presents as a `config`, the whole of `render-plan`/`adapters`/`lock` is reusable
(ADR-003). The cost: the loose runtime actors must be **migrated** into the bundle root and the legacy
`gsd-*`/unmanaged files dropped, and "the bundle's membership" becomes a load-bearing, enforced set
(ADR-002, fitness functions) rather than whatever happens to be in a folder.

**Invariant.** The bundle is located relative to the CLI module (`import.meta.url`), never from
`process.cwd()` or a consumer config value; and the bundle's members are exactly those declared in its
descriptor — no file in the bundle root is an undeclared member, no declared member is missing.
(Enforced by `acd-bundle-membership` and `acd-bundle-location`.)

## ADR-002: Bundle membership and content are pinned by a content-addressed manifest reusing `hashContent`

**Status:** Accepted
**Date:** 2026-06-17

**Context.** `work update` is how bugfixes reach users: it must tell, per member, whether the shipped
bundle content has changed since the consumer's last install. That requires a content-addressed record
of *what the bundle is* — its member set and each member's hash — computed from the **rendered** output
(what actually lands on disk), not the raw body, because rendering injects frontmatter/stamps (ADR-005)
and a consumer's on-disk file is the rendered form. aof already has the primitive: `hashContent` →
`sha256:<hex>` (`src/lock.mjs`), and lock v2 already records `{path, runtime, resource, hash}` per
generated file. We should not invent a second hashing scheme or a parallel manifest format.

**Decision.** The shipped bundle carries a **content-addressed bundle manifest** that, for the canonical
render of the bundle, lists each rendered member as `{ path, runtime, resource: {id, kind}, hash }`
where `hash` is `hashContent(renderedContent)` — i.e. the **same shape and the same `sha256:` hashing**
as a lock `files[]` entry. The bundle manifest is the *catalogue of the shipped bundle*; it is derived
from the bundle, not hand-maintained, and a fitness function asserts it matches the shipped files so
drift detection is sound. It carries a `bundleVersion` (the aof package version) so a consumer can see
which bundle release they are on. This is distinct from — but format-compatible with — the **per-repo
install manifest** of ADR-004: the bundle manifest describes *the product*; the install manifest
records *one consumer's installation*.

**Alternatives considered.**
- *A new hashing/manifest format* — rejected: a second source of truth that drifts from the lock format
  and forces `update` to reconcile two schemes; reuse `hashContent` + the lock entry shape.
- *Hash the raw bodies, not the rendered output* — rejected: the consumer's on-disk file is the
  *rendered* form (frontmatter + stamp), so a raw-body hash never matches what `update` reads back; the
  comparison must be render-to-disk apples-to-apples.
- *No manifest; re-render and diff at update time only* — rejected: still works for "did the consumer
  edit it" (the install manifest covers that), but without a shipped catalogue there is no cheap,
  verifiable statement of *what release the bundle is* and no fitness function can prove the shipped
  files are internally consistent.

**Consequences.** `update` (ADR-004) reduces to a hash comparison across three points it already has:
the *shipped bundle* (bundle manifest / fresh render), the *consumer's last install* (install
manifest), and the *consumer's disk* (`hashFileIfExists`). Reusing the lock entry shape means the same
`planApplyActions` classification applies with no new comparison code. The manifest must be regenerated
when bundle bodies change (a fitness function guards this, so a stale manifest fails CI rather than
shipping).

## ADR-003: init/update synthesize an aof `config` from the bundle and reuse the existing render/lock pipeline

**Status:** Accepted
**Date:** 2026-06-17

**Context.** `render-plan.mjs` already implements the entire install/update mechanic against a generic
`config` + a `previousLock`: `createRenderPlan(config)` → desired outputs, `planApplyActions(desired,
previousLock, {force, targetDir})` classifies **create / update / skip / drift-warning / delete** by
comparing desired hash vs. on-disk hash (`hashFileIfExists`) vs. prior lock hash, with `--force`
semantics, `executeApplyActions` writes, and `createLockManifest` produces a lock-v2 record. `aof apply`
already drives exactly this loop for *this* repo's resources. Building a second drift engine for the
bundle would duplicate — and inevitably diverge from — battle-tested code.

**Decision.** `work init` and `work update` **do not implement their own drift logic**. They (1) load
the bundle (ADR-001) and synthesize a standard aof `config` object whose `resources[]` are the bundle's
members, (2) call `createRenderPlan(config, {targetDir, runtimes})`, (3) call `planApplyActions(desired,
previousLock, {force, targetDir})` where `previousLock` is the consumer's **install manifest** (ADR-004)
— absent on `init`, present on `update`, (4) `executeApplyActions`, and (5) write the install manifest
via `createLockManifest`. `init` and `update` differ **only** in whether a prior install manifest
exists; the classification, drift-warning, `--force`, and delete-stale behaviour are inherited
unchanged. Any bundle-specific concern (the milestone-template members, the codex capability mapping of
ADR-006) is expressed as properties of the synthesized `config`/resources, not as a fork of the engine.

**Alternatives considered.**
- *A dedicated bundle install/update path* — rejected: re-derives create/update/skip/drift/delete and
  `--force`, the highest-risk logic, and guarantees drift from the canonical engine the rest of aof
  relies on. The reuse is the whole point of building *on* aof.
- *Reuse `sync.mjs` (`createSyncPlan`) instead of `render-plan`* — rejected for the install path:
  `render-plan` is the layer that already does content-addressed create/update/skip/drift/delete against
  a lock + on-disk hash, which is precisely the install/update contract; `sync` is a different concern.

**Consequences.** init and update are thin orchestrators over proven code; their *behaviour* (the exact
action set, exit codes, messages) is task-level and tested there. The synthesized-config seam is the one
new structural surface, and it is small. A risk to guard: init/update must pass the install manifest as
`previousLock` and must set `targetDir` to the consumer repo (not cwd of the CLI) — enforced behaviourally
by the task features and structurally by ADR-004's manifest contract, not by a new comparison routine.

## ADR-004: The per-repo install manifest is a lock-v2 record at a fixed path — the locked shared contract for init↔update

**Status:** Accepted
**Date:** 2026-06-17

**Context.** `work init` (one story) writes a record of what it installed; `work update` (a separate,
parallel story) reads that record to drift-check. The *only* thing coupling those two stories is the
shape of that record plus how a managed file is recognised (ADR-005). If we pin that contract now, the
two stories build in parallel against a frozen interface and never touch each other's code. The existing
lock format (v2) already records exactly the per-file content-addressed data `update` needs, and
`planApplyActions` already consumes a `previousLock` of that shape — so the install manifest *is* a lock.

**Decision.** `work init`/`update` write a **per-repo install manifest** that is a **lock-v2 record**
(the structure produced by `createLockManifest`) written to a **fixed path in the consumer repo**:
`.aof/aof.work.lock.json` (distinct from `.aof/aof.lock.json`, which `apply` owns for the consumer's own
resources — the two never collide). Its `files[]` entries are the lock shape `{ path, runtime, resource:
{id, kind}, hash, generatedAt }`; `hash` is `hashContent` of the rendered file. It adds a top-level
`bundle: { version }` recording which bundle release produced it (from ADR-002's `bundleVersion`).
`update` passes this manifest to `planApplyActions` as `previousLock`; `init` passes `null`. This record
**is** the locked shared contract — see the verbatim schema below. It is frozen at refine time; the two
stories depend on it, not on each other.

**The locked shared contract — install-manifest schema (frozen 2026-06-17):**

```jsonc
{
  "version": 2,                         // LOCK_VERSION — reuse src/lock.mjs
  "generatedAt": "<ISO-8601>",          // when this install/update ran
  "bundle": { "version": "<semver>" },  // the bundle release installed (ADR-002 bundleVersion)
  "runtimes": ["claude"],               // runtimes this repo selected at init (ADR-006)
  "files": [
    {
      "path": ".claude/agents/aof-architect.md", // repo-relative, forward slashes
      "runtime": "claude",
      "resource": { "id": "aof-architect", "kind": "agent" },
      "hash": "sha256:<hex>",           // hashContent(rendered file) — ADR-002
      "generatedAt": "<ISO-8601>"
    }
    // … one entry per rendered, managed file
  ],
  "packages": [],                       // present for lock-format compatibility; empty for the bundle
  "frameworks": [],                     // present for lock-format compatibility; empty for the bundle
  "frameworkInstallAttempts": []        // present for lock-format compatibility; empty for the bundle
}
```

**Alternatives considered.**
- *A bespoke install-manifest format* — rejected: forces `planApplyActions` to learn a second
  `previousLock` shape; the lock format already carries exactly the right per-file content-addressed
  data.
- *Reuse `.aof/aof.lock.json` itself* — rejected: that lock is owned by `apply` for the consumer's own
  resources; co-mingling bundle install state would make `apply` and `work update` fight over one file.
  Separate, fixed paths keep the two lifecycles independent.
- *Leave the manifest path/shape to the implementing stories* — rejected: that *is* the coupling between
  the init story and the update story; leaving it unpinned forces them to serialise. Freezing it here is
  what buys the parallelism.

**Consequences.** Story 01 (`init`) and Story 02 (`update`) share only this frozen record + the stamp
(ADR-005) and the bundle (Story 00) — they have no code dependency on each other and parallelise.
`update` is sound because it compares three content-addressed points (shipped bundle, this manifest,
on-disk) all in the same `sha256:` scheme. The fixed path is load-bearing: a fitness function asserts
init/update read and write exactly `.aof/aof.work.lock.json` and never the consumer's own
`.aof/aof.lock.json`.

## ADR-005: Every bundle-rendered file is self-identifying as aof-managed via the `aof-generated` stamp

**Status:** Accepted
**Date:** 2026-06-17

**Context.** `update` must distinguish *aof content* from *a user's edits* to never silently clobber a
hand-edit (and to recognise stale managed files for deletion). The install manifest (ADR-004) is the
primary signal — a file's hash either matches the prior install (untouched) or not (user-edited). But a
manifest can be deleted or a consumer can adopt a file by hand; a file should also **declare itself
managed in-band**, so tooling and humans can identify aof-owned files without the manifest. aof's
renderer already does this in two existing forms: a YAML frontmatter key `aof-generated: true` for
files that have frontmatter (skills, commands, agents, claude rules) and an HTML comment `<!-- Generated
by AOF. Do not edit directly; update .aof/ instead. -->` for files that cannot carry frontmatter (codex
`AGENTS.md` rules, workflows). The bundle's members are agents/commands/skills — all frontmatter-bearing
— plus the milestone-template files, which are markdown docs.

**Decision.** Every file rendered by `work init`/`update` carries the **`aof-generated` stamp** in one
of two canonical forms, chosen by whether the file format admits YAML frontmatter:

- **Frontmatter form** (agents, commands, skills — the existing renderer output): the rendered file's
  YAML frontmatter contains `aof-generated: true`.
- **Comment form** (the milestone-template markdown members, which are not resources with frontmatter):
  the file's content begins with the HTML-comment marker `<!-- aof-generated: bundle … -->` (the
  existing "Generated by AOF" comment family).

Exactly one of the two forms is present on every managed file; the **detection contract** is: a file is
recognised as aof-managed iff it carries the `aof-generated` marker (frontmatter key OR the comment
form). This is the second half of the locked shared contract: both init (which writes the stamp) and
update (which reads it) bind to this marker definition, frozen here.

**The locked shared contract — `aof-generated` stamp (frozen 2026-06-17):**

- Frontmatter-bearing members → YAML key, literal line `aof-generated: true`, inside the leading
  `---` … `---` block (as the existing `renderResource` already emits).
- Non-frontmatter members (templates) → leading HTML comment whose first marker is
  `<!-- aof-generated: bundle -->` (the comment-form stamp; may be followed on the same comment-family
  lines by the existing "Do not edit directly" guidance).
- Managed-file detection (used by update): present-iff the frontmatter key `aof-generated` is truthy
  **or** the file's head contains the `aof-generated:` comment marker.

**Alternatives considered.**
- *Rely on the install manifest alone* — rejected: if the manifest is lost/relocated, update can no
  longer tell aof files from user files; an in-band stamp degrades gracefully and lets humans see
  ownership.
- *A single stamp form for all files* — rejected: agents/commands/skills already carry frontmatter and
  the renderer already emits `aof-generated: true` there; markdown templates can't take frontmatter
  without changing the template format. Two forms, one detection contract, is the minimal honest model.
- *A separate sentinel file listing managed paths* — rejected: that is just the install manifest again;
  duplicating it as a sentinel invites drift.

**Consequences.** `update` never overwrites a user-modified managed file without `--force` because
`planApplyActions` already classifies a hash-divergent managed file as `drift-warning`; the stamp makes
"is this file ours" answerable even without the manifest. The cost is the two-form rule, made safe by a
fitness function that asserts every rendered member carries the correct form. A user who strips the
stamp converts the file to "not aof-managed" — an acceptable, explicit opt-out.

## ADR-006: Bundle members map across runtimes by the existing capability matrix; `--runtime` selects, it never forces an unsupported render

**Status:** Accepted
**Date:** 2026-06-17

**Context.** ACD's actors are Claude **commands** and **agents** (plus skills). The capability matrix
(`src/model.mjs` `CAPABILITIES`) declares `command` as `unsupported-fail` on codex, while `agent` and
`skill` are `native` on both, and `rule` is `mapped`. `renderConfigOutputs`/`assertRenderableResource`
already throw if a `command` is rendered for codex. `work init` must let a consumer choose a runtime
(`--runtime`), and the bundle is mostly commands — so on codex, naively rendering the whole bundle would
hard-fail. We must decide what `--runtime codex` means for a command-heavy bundle without inventing new
capability rules.

**Decision.** Bundle members map to runtimes by the **existing `CAPABILITIES` matrix — no new rules, no
per-bundle special-casing.** `work init --runtime <r>` selects which runtime(s) to render; selection
means "render every bundle member that the matrix supports for `r`, and surface the unsupported ones per
their declared status" — it does **not** override capability. Concretely: on `claude`, all members
(agents, commands, skills) render natively. On `codex`, agents and skills render natively; **command**
members are `unsupported-fail` and are reported as not-installable on codex rather than silently dropped
or force-rendered. The milestone-template members are plain markdown docs rendered to a fixed bundle
location, runtime-independent. The default `--runtime` is `claude` (ACD's native home and where every
member is supported). The capability decision lives in `model.mjs`; init/update read it, never restate
it.

**Alternatives considered.**
- *Render commands as codex skills automatically* — rejected: that is a semantic transform (a command is
  not a skill), it would be an undeclared capability mapping, and it hides from the consumer that codex
  doesn't natively support the command. If a codex equivalent is wanted it is an explicit future bundle
  member, not an implicit rewrite.
- *Silently skip unsupported members on codex* — rejected: silent drops make an incomplete install look
  complete; the matrix's `unsupported-fail`/`unsupported-warning` status must be surfaced.
- *Add a bundle-specific capability table* — rejected: a second capability source of truth that drifts
  from `model.mjs`; the matrix already encodes this — reuse it.

**Consequences.** Cross-runtime behaviour is entirely a function of the existing matrix, so there is no
new place for runtime conditionals to accrete. init/update contain **no** `runtime === "codex"` /
`=== "claude"` branch deciding member installability — they delegate to the matrix
(`CAPABILITIES`/`assertRenderableResource`). The consumer gets an honest report on codex. The practical
consequence is that codex consumers get agents + skills + templates but not the Claude commands until a
codex-native command surface is shipped (out of scope here).

## ADR-007: Bundle command members render under the `aof` command namespace — `commands/aof/<id>.md`, invoked `/aof:<id>`

**Status:** Accepted
**Date:** 2026-06-17

**Context.** ACD's command surface has always been invoked under the `/aof:` namespace
(`/aof:refine`, `/aof:continue`, …) — that prefix is its established, recognisable invocation
identity. The bundle's command members are synthesized as ordinary aof `command` resources (ADR-001,
ADR-003), and today's generic renderer flattens every command to a **flat** path:
`resourcePath` returns `commands/<id>.md` and `renderResource`'s command branch emits
`aof-invocation: ${adapter.commandPrefix}${resource.id}` — i.e. `/<id>` on claude
(`RUNTIMES.claude.commandPrefix = "/"`). Landing the ACD commands flat in a consumer repo would
invoke them as `/continue`, `/verify`, `/recent`, `/refine` — collision-prone bare names that also
drop the `/aof:` surface ACD users already know. We must restore the namespace **without** forking
the render engine, which ADR-003 forbids.

**Decision.** Bundle **command** members render under a namespace subdirectory and are invoked with
the `aof:` namespace prefix:

- A command member carries a **declared namespace property** on its synthesized resource (a
  `commandNamespace: "aof"` field on the member — a data property of the declared resource, not a
  hard-coded bundle branch).
- The adapter gains **one general rule**: when a command resource declares this namespace,
  `resourcePath` renders it to `commands/<namespace>/<id>.md`, and the command frontmatter's
  `aof-invocation` becomes `${commandPrefix}<namespace>:<id>`. For the ACD bundle on claude that is
  `commands/aof/<id>.md` (e.g. `.claude/commands/aof/refine.md`) invoked `/aof:refine`. Claude Code
  derives the `/aof:` invocation from the `commands/aof/` subdirectory; the rendered frontmatter
  records it as `aof-invocation: /aof:<id>`.
- **Agent** members are unaffected: they remain `agents/<id>.md`. **Template** members are
  unaffected: the fixed bundle template location is unchanged.

Because the namespace is a property of the declared member, there is **no**
`runtime === "claude"`/bundle-specific conditional in the engine — any future namespaced command
set reuses the same general rule. This honours ADR-003's "reuse the pipeline unchanged, express
bundle concerns as config properties".

**Why.** In a consumer repo, flat command names (`/continue`, `/verify`, `/recent`, `/refine`) are
collision-prone and drop ACD's established `/aof:` invocation surface. Namespacing groups the ACD
commands and avoids clashes. Expressing it as a declared member property — rather than a bundle
branch in the renderer — keeps the render engine generic.

**Alternatives considered.**
- *Flat `commands/<id>.md` invoked `/<id>`* (today's behaviour) — rejected: collision-prone in
  consumer repos, and it drops the established `/aof:` surface ACD users already invoke.
- *Encode the namespace in the member id (`aof/refine`)* — rejected: pollutes resource identity and
  membership, which the `acd-bundle-membership` fitness function pins to **bare** ids (`refine`, the
  8 agents). The namespace is a rendering concern, not part of identity.
- *A bundle-specific render fork* (a `runtime === "claude"` / "is-bundle" branch in the adapter) —
  rejected: violates ADR-003's reuse-unchanged; the engine must stay generic.

**Consequences.** Agents and templates are unchanged; only command members gain the namespace. The
adapter gains exactly one general namespace rule, reusable by any future namespaced command set. The
`/aof:` invocation surface ACD users know is preserved, and consumer-repo command collisions are
avoided. The invariant is enforced by a new fitness function (`acd-command-namespace`).

**Invariant.** Every bundle command member renders to `commands/<namespace>/<id>.md` under the
runtime root and carries `aof-invocation: /<namespace>:<id>` in its frontmatter; agent members
remain `agents/<id>.md`. (Enforced by `acd-command-namespace`.)

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature. -->

| Invariant | Enforced by (arch-test) | From |
|---|---|---|
| The bundle root contains exactly the declared ACD actor set — the 8 agents (product-owner, researcher, architect, designer, developer, qa, security, compliance), the documented ACD commands, and the milestone templates — with no undeclared file in the bundle root and no declared member missing on disk | `test/arch/acd-bundle-membership.test.mjs` (load the bundle descriptor; assert declared-member set == set of files in the bundle root, and assert the declared agent ids equal the 8 ACD actors) | ADR-001, ADR-002 |
| The CLI resolves the bundle root from its own module URL (`import.meta.url`), never from `process.cwd()` or a consumer config value | `test/arch/acd-bundle-location.test.mjs` (load the bundle from a temp cwd unrelated to the repo and assert it resolves; grep the bundle-loader source for `process.cwd(` / `config` lookups → none on the resolution path) | ADR-001 |
| Every entry in the shipped bundle manifest has `hash === hashContent(renderedContent)` of the member it names — the manifest is a true content-address of the shipped bundle (so update's drift detection is sound) | `test/arch/acd-bundle-manifest-hashes.test.mjs` (render each declared member with the real renderer; assert each rendered hash equals the manifest's `hash`, and that the manifest's member set equals the rendered set) | ADR-002 |
| init/update do not implement their own create/update/skip/drift/delete logic — they go through `planApplyActions`/`createLockManifest` | `test/arch/acd-reuses-render-plan.test.mjs` (grep the init/update source: it imports and calls `planApplyActions` and `createLockManifest`; it contains no second drift-classification or `--force`-comparison block) | ADR-003 |
| The install manifest is read/written only at the fixed path `.aof/aof.work.lock.json`, never the consumer's own `.aof/aof.lock.json`; and it conforms to lock-v2 shape | `test/arch/acd-install-manifest-contract.test.mjs` (grep init/update source for the manifest path literal == `aof.work.lock.json` and assert no read/write of `aof.lock.json`; validate a produced manifest against the frozen schema: `version: 2`, `bundle.version`, lock-shaped `files[]`) | ADR-004 |
| Every file rendered by init/update carries the `aof-generated` stamp in its correct form (frontmatter key for resources, comment marker for templates); managed-file detection recognises exactly stamped files | `test/arch/acd-generated-stamp.test.mjs` (render every bundle member; assert each output is recognised by the frozen detection contract and carries the form-correct marker; assert an unstamped fixture is detected as not-managed) | ADR-005 |
| init/update never overwrite a user-modified managed file without `--force` (a hash-divergent managed file classifies as `drift-warning`, not `update`) | `test/arch/acd-no-clobber-without-force.test.mjs` (behavioural proof: install to a temp dir, mutate a managed file, re-run plan with a newer bundle → the mutated file is `drift-warning`; re-run with `force` → `update`) | ADR-004, ADR-005 |
| init/update contain no runtime conditional deciding member installability — cross-runtime mapping is delegated to the `CAPABILITIES` matrix | `test/arch/acd-capability-delegation.test.mjs` (grep init/update source for `=== "codex"` / `=== "claude"` installability branches → none; assert a codex render of a command member surfaces the matrix's `unsupported-fail` status rather than a custom branch) | ADR-006 |
| Every bundle command member renders to `commands/<namespace>/<id>.md` under the runtime root and carries `aof-invocation: /<namespace>:<id>`; agent members remain `agents/<id>.md` | `test/arch/acd-command-namespace.test.mjs` (render each declared command member with the real renderer; assert its path is `commands/aof/<id>.md` and its `aof-invocation` frontmatter is `/aof:<id>`; assert an agent member's path stays `agents/<id>.md`) | ADR-007 |
