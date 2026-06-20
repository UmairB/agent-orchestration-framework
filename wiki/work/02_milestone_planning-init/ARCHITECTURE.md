---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 02 · Planning Init (the bought seam) — Architecture Decisions

## ADR-001: `aof planning init` wraps the runtime's own plugin CLI — aof owns the seam, not the install

**Status:** Accepted — marketplace-source Invariant superseded by ADR-007 (2026-06-18)
**Date:** 2026-06-18

**Context.** ACD's `/planning` surface is *bought, not owned* (`wiki/planning.md`, "Planning is
bought, delivery is owned"). The chosen planner — `phuryn/pm-skills` — is a native Claude Code /
Codex plugin marketplace, and the runtimes already ship first-class non-interactive plugin CLIs:
RESEARCH §1 verified live on `claude 2.1.178` that `claude plugin marketplace add <source>` and
`claude plugin install <plugin>@<marketplace>` exist as scriptable subcommands. aof must NOT
reimplement marketplace resolution, plugin caching, or `settings.json` wiring — Claude already owns
that state (RESEARCH §2: registrations live in `~/.claude/plugins/known_marketplaces.json`, enabled
plugins in `settings.json`, content in a versioned cache). aof's sole job at this seam is to *drive*
the runtime's installer reproducibly and record provenance. aof already has the exact shape to mirror:
the GSD framework installer (`src/cli.mjs:1176-1206`, `src/frameworks.mjs:94-116`) — a plan of
commands, a `--dry-run` that prints and runs nothing, then a per-item **network boundary** print +
warning before each networked, code-executing step, executed via `argv`-based `spawnSync` (no shell
string), with a simulation hook for tests.

**Decision.** `aof planning init` is a **thin wrapper over the runtime plugin CLI**, structured
exactly like the framework installer. It builds a *plan* of runtime commands — one
`<runtime> plugin marketplace add …` followed by one `<runtime> plugin install <plugin>@pm-skills`
per recommended plugin — and:
- under `--dry-run` prints the exact commands and performs **no** network access or process spawn;
- otherwise, before each executing step, prints a `network-boundary:` line and a warning that the
  command **accesses the network and executes plugin/marketplace code** (RESEARCH §1: plugins "can
  execute arbitrary code on your machine"), then spawns the runtime via `argv` (never a shell string).

The commands use the verbs and tokens RESEARCH pinned: the marketplace name in `plugin@marketplace`
syntax is the manifest `name` **`pm-skills`** (not the repo path `phuryn/pm-skills`), and the
per-plugin verb is **`install`**, NOT `add` (RESEARCH §1, §6 — the ROADMAP's `plugin add` is wrong).
aof does not write Claude's plugin state itself; the only artifact aof authors is the provenance
manifest (ADR-002/003). The recommended plugin set is fixed data (ROADMAP §1, names verified in
RESEARCH §6): `pm-execution`, `pm-product-discovery`, `pm-product-strategy`, with
`pm-market-research` optional; `pm-ai-shipping` is never installed.

**Alternatives considered.**
- *Reimplement marketplace fetch/cache/enable in aof* — rejected: duplicates state the runtime owns
  (RESEARCH §2), would drift from Claude's cache layout, and contradicts "buy the planning
  implementation" (`wiki/planning.md`). aof owns the seam, not the installer.
- *Invent a new install-and-warn flow* — rejected: the framework installer's plan→dry-run→boundary
  shape is the established, tested pattern (RESEARCH §8); reuse its structure, just change the
  boundary wording from "npm package code" to "plugin/marketplace code".
- *Emit a shell string and run it through a shell* — rejected: the precedent spawns by `argv` to
  avoid injection; the plugin tokens (sha, plugin names) are aof-controlled but `argv` keeps the
  habit and the simulation hook.

**Consequences.** Install behaviour follows the runtime CLI, so when the runtime fixes/changes its
plugin mechanics aof inherits it for free. aof's surface is small: a command plan + a provenance
manifest. The exact emitted verbs/tokens are load-bearing (a wrong verb installs nothing) and become
a fitness function over the dry-run output (`acd-planning-install-commands`). The dry-run must never
spawn — also fitness-checkable.

**Invariant.** `aof planning init --dry-run` emits, for the recommended set, exactly
`<runtime> plugin marketplace add phuryn/pm-skills@<sha>` then
`<runtime> plugin install <plugin>@pm-skills` (verb `install`, marketplace token `pm-skills`), and
performs no network call or process spawn. (Enforced by `acd-planning-install-commands`.)

## ADR-002: A resolved 40-hex commit sha is the integrity anchor — aof resolves and pins it itself

**Status:** Accepted
**Date:** 2026-06-18

**Context.** The milestone's headline requirement is *pinned-sha provenance* (SPEC, Objective).
RESEARCH §4 is decisive: Claude's **marketplace source** supports a `ref` (branch/tag) **but not a
`sha` flag** ("Supports `ref` (branch/tag) but not `sha`"), and `pm-skills` uses **relative-path**
plugin entries that carry no per-plugin sha — so their version resolves to the marketplace repo's
commit. Consequently `claude plugin marketplace add phuryn/pm-skills` floats on `main` and is **not
reproducible**, and there is no `--sha` flag to pin it. The only reproducible anchor RESEARCH found:
resolve the commit out-of-band (`git ls-remote https://github.com/phuryn/pm-skills HEAD` →
`d384f0c9eb81fe74656a4f6da168587836939edb` at research time) and pass it as the **`@ref`** — a full
40-hex sha IS a valid clone/checkout ref, so it pins the marketplace to an exact commit even though
the field is named `ref`. This is also the supply-chain control: a recorded immutable sha is what a
later run / CI compares against to detect drift, and what makes a PRD traceable to *how it was made*.
We fold the security consideration here rather than spawning a separate SECURITY doc — the sha *is*
the supply-chain anchor.

**Decision.** aof **resolves the marketplace commit sha itself** (`git ls-remote` against the
configured source, the same `argv`-spawn discipline as ADR-001 — a read-only network call, gated
behind the same dry-run/boundary rules), and pins the `marketplace add` at `@<sha>`. The resolved sha
is recorded in aof's own provenance manifest (ADR-003) as the integrity anchor. aof **never** records
or pins a floating ref (a branch like `main`, a tag, `HEAD`): the recorded `sha` MUST be a 40-char
lowercase hex commit id. aof must NOT assume a `--sha` flag (none exists) and must NOT treat a bare
`marketplace add phuryn/pm-skills` as reproducible. (Auto-update would defeat the pin; third-party
marketplaces default auto-update off — aof relies on that default and records the pin so drift is
detectable, RESEARCH §4.)

**Alternatives considered.**
- *Pass a `--sha` flag to the runtime* — rejected: it does not exist (RESEARCH §4); the only lever is
  `@ref`, and a full sha is a valid ref.
- *Pin a branch/tag (`@main`, `@v2.0.0`)* — rejected: a branch floats; the marketplace `version`
  (`2.0.0`) is a single number bumped across all plugins (ROADMAP §1) and is not a commit anchor.
  Only an immutable commit sha is reproducible.
- *Trust pm-skills' marketplace.json to carry per-plugin shas* — rejected: RESEARCH §4 confirmed its
  entries are relative paths with no sha field, resolving to the repo commit — so aof must supply it.
- *Skip pinning, accept floating `main`* — rejected: directly violates the SPEC's "pinned-sha
  provenance" and removes the supply-chain anchor; a PRD would be untraceable to a commit.

**Consequences.** Reproducibility and supply-chain integrity rest on aof's own sha resolution +
record, independent of any runtime feature. The 40-hex constraint is structurally checkable on the
written manifest (`acd-planning-provenance-sha`). aof carries a small `git ls-remote` dependency
(git on PATH) for the live path; CI can fixture/inject the sha to stay offline (RESEARCH A3/A6). The
recorded sha enables a future drift-check (compare recorded vs current `ls-remote HEAD`) — a behaviour
for a later task, not an invariant here.

## ADR-003: Provenance is an aof-owned lock-shaped manifest at `.aof/aof.planning.lock.json`

**Status:** Superseded by ADR-009 (2026-06-19) — provenance moves to the `planning` section of the unified lock `.aof/aof.lock.json`; the separate `aof.planning.lock.json` file is eliminated. The provenance *schema* (source / marketplaceName / marketplaceVersion / sha / runtime / plugins / codex) and the 40-hex `sha` anchor (ADR-002) carry over unchanged; only the storage location moves. See ADR-009.
**Date:** 2026-06-18

**Context.** RESEARCH §2 establishes the runtime owns its own plugin state
(`known_marketplaces.json`, `settings.json`, the cache) — so aof's provenance is a **separate,
aof-owned artifact**, not a write into the runtime's files. Milestone 01 set the precedent that an
aof-managed install record is a JSON lock file under `.aof/` (`work init` writes
`.aof/aof.work.lock.json`; `apply` owns `.aof/aof.lock.json`). For consistency and discoverability the
planning provenance should be a sibling lock with a distinct, non-colliding name, owned solely by
`aof planning init`. The schema the SPEC and ROADMAP §1 call for is
`{ source, marketplaceVersion, sha, plugins[] }`.

**Decision.** `aof planning init` writes provenance to the fixed path
**`.aof/aof.planning.lock.json`** (sibling of `aof.work.lock.json` and `aof.lock.json`; the three
never collide and each is owned by one writer). Its schema is frozen here:

```jsonc
{
  "version": 1,                                    // PLANNING_LOCK_VERSION
  "generatedAt": "<ISO-8601>",                     // when planning init ran
  "source": "phuryn/pm-skills",                    // the marketplace source (owner/repo)
  "marketplaceName": "pm-skills",                  // manifest name used in plugin@marketplace
  "marketplaceVersion": "2.0.0",                   // marketplace.json `version` at the pinned sha
  "sha": "d384f0c9eb81fe74656a4f6da168587836939edb", // resolved 40-hex commit (ADR-002)
  "runtime": "claude",                             // the runtime this provenance was produced against (ADR-004)
  "plugins": [                                      // the recommended set installed
    { "name": "pm-execution", "marketplace": "pm-skills" },
    { "name": "pm-product-discovery", "marketplace": "pm-skills" },
    { "name": "pm-product-strategy", "marketplace": "pm-skills" }
    // … pm-market-research if --with-optional
  ],
  "codex": null                                    // present iff runtime degraded — ADR-004's fallback record
}
```

The `sha` field is the integrity anchor of ADR-002 and MUST be 40-hex. `aof planning init` reads and
writes only this path; it never writes `aof.work.lock.json` or `aof.lock.json`, and never edits the
runtime's `known_marketplaces.json`/`settings.json`.

**Alternatives considered.**
- *Reuse `aof.work.lock.json`* — rejected: that file is the ADR-004 (m01) bundle-install record owned
  by `work init/update`; co-mingling planning provenance would make two commands fight over one file
  (same reasoning m01-ADR-004 used to separate from `aof.lock.json`).
- *Reuse the lock-v2 `files[]` shape* — rejected: lock-v2 is content-addressed *rendered files* aof
  owns; here aof owns no rendered files (the runtime caches the plugins), so a `files[]` hash record
  is meaningless. The provenance shape is purpose-built (`source/sha/plugins`).
- *Write provenance into the runtime's plugin state* — rejected: that state is the runtime's
  (RESEARCH §2); aof keeping its own manifest degrades gracefully and stays portable.
- *Leave the path/shape to the implementing task* — rejected: the shatter seam and any future
  drift-check read this record; freezing the path + schema here is the contract.

**Consequences.** Provenance is a single, greppable, aof-owned record at a fixed path; its location
and the 40-hex `sha` are structurally checkable (`acd-planning-provenance-sha`,
`acd-planning-lock-isolation`). A consumer/CI can read `sha` to verify reproducibility without
touching runtime internals. The shape is frozen, so a later drift-check or `origin` read-out binds to
a stable contract.

## ADR-004: Claude-first; Codex is a documented, honest degrade — never a silent success

**Status:** Accepted
**Date:** 2026-06-18

**Context.** RESEARCH §5 is the genuine decision the researcher flagged, verified live on
`codex-cli 0.130.0`: `codex plugin` exposes **only** `codex plugin marketplace {add|upgrade|remove}`
— there is **no `codex plugin install`** (and no `add`/`list`); both error `unrecognized subcommand`.
So the ROADMAP's `<runtime> = claude | codex` symmetry is **false today**: on Codex you can register
the marketplace but **cannot script a per-plugin install**. Worse, even when pm-skills installs on
Codex its slash-commands "don't run as Codex slash commands" (RESEARCH §5). The Codex CLI is also
young/in-flux (subcommand shape changing across releases), so hard-coding its surface is fragile.

**Decision.** **Claude is the default and the only fully-scripted runtime.** `aof planning init`
defaults to `--runtime claude` and emits the full marketplace-add + per-plugin-install plan there.
For `--runtime codex` aof takes the safe, honest degrade:
1. it emits and runs only the step Codex actually supports — `codex plugin marketplace add
   phuryn/pm-skills@<sha>` (same sha pin, ADR-002);
2. it records provenance (ADR-003) with `codex: { marketplaceRegistered: true,
   pluginsInstalled: false }` and the plugin set left **uninstalled**, so the manifest never claims an
   install that did not happen;
3. it emits a **documented manual fallback** — the exact `claude plugin install …` commands (or the
   manual skill-folder copy, RESEARCH §5) the user must run to enable the plugins, and a note that
   pm-skills' `/write-prd` runs as plain language, not a Codex slash command.

aof **never** prints an unconditional success for Codex per-plugin installs, and it does **not**
hard-code a `codex plugin install` invocation that RESEARCH proved absent. The Codex behaviour is a
*reported degrade*, not a failure (registering the marketplace is genuine progress).

**Alternatives considered.**
- *Claim parity and emit `codex plugin install …`* — rejected: that subcommand does not exist
  (RESEARCH §5); it would error at runtime or, worse, look scripted while installing nothing.
- *Refuse Codex entirely (hard error)* — rejected: registering the marketplace + recording
  provenance is real, reproducible progress; an honest partial beats a flat refusal.
- *Silently skip the per-plugin step on Codex* — rejected: a silent skip makes an incomplete install
  look complete — the exact dishonesty the SPEC's "never silently claim success" guards against.

**Consequences.** A Codex consumer gets the marketplace pinned + provenance recorded + an explicit
manual path, and the manifest truthfully shows `pluginsInstalled: false`. aof has no
`codex plugin install` literal anywhere — structurally checkable (`acd-planning-no-codex-install`).
The degrade is version-sensitive (RESEARCH A8): when Codex ships a real install verb this ADR is
superseded, not edited. Honesty over symmetry is the rule.

## ADR-005: The PRD seam rests on the `PRD-*.md` convention; aof does not pretend it is tool-guaranteed, and create-prd tailoring is deferred

**Status:** Accepted — read-out contract CORRECTED by ADR-010 (2026-06-19, Finding F3). This ADR's claim
that the milestone "confirms `shatter`'s discovery consumes a representative pm-skills-shaped `PRD-*.md`"
was FALSE for the read-out half: the story-01 fixtures (`PRD-acme-notify.md`, `write-prd-output.md`) were
shaped to the *parser* (`## Scope`/`## Milestones` headings) — not to the *producer*. The real
`create-prd` skill emits an 8-section template with NO such headings, so the seam read-out came back
objective-only on genuine output (F3). The discovery contract + the convention-not-guarantee decision in
this ADR's body stand unchanged; the read-out *extraction* contract is now pinned by ADR-010. (ADRs are
superseded-not-edited — only this status line records the correction; the body below is unchanged.)
**Date:** 2026-06-18

**Context.** RESEARCH §7 surfaces the milestone's main hidden risk. The `create-prd` **skill**
mandates the filename `PRD-[product-name].md` — but specifies **no directory** and exposes **no path
config** (the skill leaves the directory to the agent). The sibling `/write-prd` **command** uses a
different template and says only "save … to the user's workspace" — it does **not** state the
`PRD-` filename at all. So `aof:shatter`'s `PRD-*.md` glob (`src/bundle/commands/shatter.md`, step 1)
is reliable **only when the skill convention is honoured**; a `/write-prd`-produced PRD may lack the
prefix or sit elsewhere. The seam rests on an **agent-honoured naming convention, not a tool-enforced
path**. Separately, the ROADMAP frames "vendor a pinned snapshot / tailor create-prd to emit ACD's
seam read-out + a stable PRD id" as a FUTURE/eventual tailoring; this milestone's SPEC scopes the
*live install + provenance + confirming the seam consumes a PRD*, not full vendoring.

**Decision.** aof treats `PRD-*.md` discovery as a **convention, not a guarantee**, and documents it
as such — `shatter` already does the honest thing (auto-discover `PRD-*.md`, else **stop and ask for
a path**, never fabricate). This milestone:
- **confirms** that `shatter`'s discovery consumes a representative pm-skills-shaped `PRD-*.md`
  (a fixture at the workspace root following the skill convention) and produces the seam read-out
  (objective / scope / milestone chunks) with `origin` stamping;
- **pins the contract** that discovery (a) accepts an explicit path argument and (b) on a missing or
  unprefixed PRD asks rather than guesses — so a `/write-prd` PRD that breaks the convention degrades
  to "pass the path", not a silent miss;
- **explicitly defers** create-prd tailoring (a stable PRD id + an ACD seam read-out section) and
  snapshot vendoring to a **future milestone**. aof does not fork/edit pm-skills markdown here, and
  it does not claim the filename/location is tool-guaranteed.

**Alternatives considered.**
- *Loosen `shatter` to glob `*.md` and auto-pick a PRD* — rejected: guessing which markdown is the
  PRD is the kind of inference ACD avoids; the explicit-path + ask-on-miss path is honest and bounded.
- *Vendor + tailor `create-prd` now to force the filename/location* — rejected: out of this SPEC's
  scope (it scopes live install + provenance); tailoring is the ROADMAP's *future* "vendor-pinned +
  tailored" work. Keep scope tight.
- *Silently normalise any produced PRD's filename* — rejected: post-hoc renaming hides which producer
  ran and where it wrote; surfacing "pass the path" is clearer than masking the discrepancy.

**Consequences.** The seam is honest about its single soft spot (RESEARCH §7) and bounded: convention
when honoured, explicit path otherwise. The discovery contract — auto-find `PRD-*.md` OR accept a
path OR ask, never silently miss — is behaviourally testable against fixtures (Story 01, RESEARCH A4),
not a structural invariant, so it lives in that story's `.feature`, not as a fitness function here. A
future milestone may tighten the seam by vendoring/tailoring `create-prd`; this ADR will be superseded
then, not edited.

## ADR-006: `aof planning init` is idempotent via a manifest guard with `--force` (mirrors `work init`)

**Status:** Accepted
**Date:** 2026-06-18

**Context.** Re-running an installer must not silently re-do networked, code-executing steps or
clobber an existing provenance record. Milestone 01's `work init` set the precedent
(`src/work-init.mjs:53-68`): if the install manifest already exists and `--force` was not given, it
**refuses and writes nothing**, directing the user to `update`/`--force`. `aof planning init` should
mirror that guard against its own manifest (ADR-003) for consistency.

**Decision.** `aof planning init` is guarded by the presence of `.aof/aof.planning.lock.json`: if the
manifest exists and `--force` was not passed, the command **refuses, performs no network/spawn, writes
nothing**, and instructs the user to re-run with `--force` to re-pin/re-install. With `--force` it
re-resolves the sha, re-emits the plan (behind the same dry-run/boundary gate, ADR-001), and rewrites
the manifest. `--dry-run` always previews regardless of the guard. The guard semantics mirror
`work init` exactly so the two installers behave consistently for a consumer.

**Alternatives considered.**
- *Always re-install on every run* — rejected: re-runs would repeat the network/code-execution
  boundary needlessly and could surprise a user; the m01 guard precedent is the established UX.
- *Auto-update on re-run (no flag)* — rejected: re-pinning silently could move the recorded sha
  without intent, defeating ADR-002's reproducibility anchor; re-pin must be explicit (`--force`).

**Consequences.** A second bare `aof planning init` is a no-op refusal (consistent with `work init`),
so accidental re-runs are safe; intentional re-pin is `--force`. The guard reads/writes only the
planning manifest path (ADR-003), reinforcing `acd-planning-lock-isolation`. The exact refusal
behaviour (exit code, message) is task-level and tested there, not a fitness function.

## ADR-007: The marketplace source is an HTTPS git URL pinned by `#<sha>`, not the `owner/repo` shorthand (which clones over SSH)

**Status:** Superseded by ADR-008 (2026-06-19) — the `#<sha>` pin does not clone (Finding F2). The
HTTPS-URL decision stands; only the *pinned ref* changes (sha → immutable tag). See ADR-008.
**Date:** 2026-06-18

**Context.** ADR-001's Invariant emitted the marketplace source as the GitHub `owner/repo`
**shorthand** with the sha pinned via `@<sha>` (`phuryn/pm-skills@<sha>`). The live `@uat`
prerequisite proved this defective (VERIFICATION.md **Finding F1**): `aof planning init --runtime
claude` failed all 4 steps because Claude resolves the bare `owner/repo` shorthand to an **SSH clone**
(`git@github.com:phuryn/pm-skills.git`) → `Permission denied (publickey)` for the common case of a
machine that authenticates to GitHub over **HTTPS only** (no SSH key configured, no git `insteadOf`
rewrite). aof's honesty gate correctly wrote no provenance, but the milestone's headline ("install the
pm-skills planner") fails for that common case and blocks the `@uat`. RESEARCH §4 already carries the
remedy verbatim: *"you pin a ref by appending `@ref` to the GitHub shorthand or `#ref` to a git URL"*
— the source can equally be a **git URL** with the sha pinned as a `#<sha>` fragment ref, and a full
40-hex sha is a valid ref (ADR-002 still holds: the integrity anchor is the resolved commit). aof
already holds the HTTPS URL (`MARKETPLACE_HEAD_URL = https://github.com/phuryn/pm-skills`, used for the
read-only `git ls-remote` that resolves the sha), and HTTPS `ls-remote` works on the failing machine —
so switching the `marketplace add` source from shorthand to the HTTPS `.git` URL forces an HTTPS clone
and removes the SSH dependency.

**Decision.** `aof planning init` emits the marketplace source as the **HTTPS git URL with the sha
pinned as a `#<sha>` fragment ref**:
`<runtime> plugin marketplace add https://github.com/phuryn/pm-skills.git#<sha>` — never the
`phuryn/pm-skills@<sha>` shorthand. ADR-001's plan→dry-run→network-boundary→`argv`-spawn structure is
unchanged (the source is still one aof-controlled token built into the argv, no shell string), and the
per-plugin install is **unchanged**: `<runtime> plugin install <plugin>@pm-skills` keeps the manifest
**name** `pm-skills` (the `plugin@marketplace` token is the manifest name, not the clone source — only
the source needs to be HTTPS). `planPlanningInstall` builds ONE shared marketplace-add argv used by
BOTH `claude` and `codex`, so this HTTPS form applies to both runtimes (codex carries the same SSH
defect today, ADR-004's degrade otherwise stands). The sha is still aof-resolved and 40-hex (ADR-002),
the manifest path/shape is unchanged (ADR-003), and the dry-run still performs no network call or
process spawn. This **supersedes ADR-001's marketplace-source Invariant ONLY** — ADR-001's verb/token
decisions (per-plugin verb `install` not `add`; marketplace token `pm-skills`; argv-not-shell;
dry-run-no-spawn) all still stand.

**Alternatives considered.**
- *Keep the `owner/repo` shorthand, document an SSH-key prerequisite* — rejected: it makes the headline
  install fail for HTTPS-only users (F1) and pushes setup work onto the consumer; the HTTPS URL just
  works with the auth they already have.
- *Rewrite git config (`insteadOf` ssh→https) on the user's machine* — rejected: aof must not mutate
  the user's global git config to paper over a source-format choice it controls; emit the right source.
- *Pin via `#main` / a branch ref on the URL* — rejected: a branch floats (ADR-002); the `#<sha>`
  fragment pins the exact commit, preserving the reproducibility anchor.
- *Change the `plugin@marketplace` install token to the URL too* — rejected: the install token is the
  marketplace **manifest name** (`pm-skills`), not a clone source (RESEARCH §1); only the
  `marketplace add` source clones, so only it needs the HTTPS URL.

**Consequences.** The live install works for HTTPS-only GitHub auth (F1 cleared), unblocking the
`@uat`. The emitted source string is load-bearing and stays a fitness function over the dry-run output
(`acd-planning-install-commands`), now pinned to the HTTPS `#<sha>` form and guarding against a
regression back to the SSH-able shorthand. ADR-002's sha resolution (`git ls-remote` over the same
HTTPS URL) and ADR-003's manifest are untouched. The fitness tests are RED until the developer lands
the source change in `planPlanningInstall`; that red is expected.

**Invariant.** `aof planning init` emits
`<runtime> plugin marketplace add https://github.com/phuryn/pm-skills.git#<sha>` (HTTPS git URL,
`#<sha>` fragment ref), never the `phuryn/pm-skills@<sha>` shorthand; per-plugin install stays
`<plugin>@pm-skills`; the dry-run still performs no network call or process spawn. (Enforced by
`acd-planning-install-commands`.)

## ADR-008: The marketplace command pins the immutable release TAG (`#v2.0.0`); the sha is the recorded audit anchor, not the clone ref

**Status:** Accepted
**Date:** 2026-06-19

**Context.** ADR-007 fixed F1's SSH defect by emitting the HTTPS git URL with the sha pinned as a
`#<sha>` fragment ref. The live `@manual`/`@uat` lanes then surfaced **Finding F2** (VERIFICATION.md):
`claude plugin marketplace add <url>#<ref>` runs **`git clone --branch <ref>`**, which resolves only a
**branch or tag name — NOT a bare commit sha**. So
`claude plugin marketplace add https://github.com/phuryn/pm-skills.git#d384f0c9…edb` aborts with
`Could not find remote branch d384f0c9…edb … not found in upstream origin`, the three plugin installs
then fail (marketplace absent), and aof's honesty gate correctly writes no provenance. The headline
install now fails for **everyone**, not just HTTPS-only users. This was verified directly in this
repo's environment: `git clone --branch <40-hex-sha> …` fails identically to the live error, whereas
`git clone --branch v2.0.0 …` succeeds (annotated tag → commit `5042ff6169e0df49086c846f69bf7b6cdb67a6de`)
and `git clone --branch main …` succeeds (→ `d384f0c9eb81fe74656a4f6da168587836939edb`); the pm-skills
repo's only named refs are branch `main` and tag `v2.0.0`.

This is a **contradiction ADR-007 introduced against RESEARCH §4**, which already documented the true
constraint verbatim: *"Marketplace source … Supports `ref` (branch/tag) but not `sha`."* ADR-007's F1
correction misread the resolved 40-hex sha as a usable `#ref`; F2 is the consequence. RESEARCH §4 must
be corrected: a commit sha is **not** a clonable `#ref` for `git clone --branch`. Same blind-spot class
as F1 — `acd-planning-install-commands` asserted the command *string* (HTTPS `#<sha>`), which proves the
string, not that the ref *clones*. The string-only assertion is precisely the gap that let F1 and then
F2 reach the verify gate.

**Decision.** Decouple **the clone ref** (what goes in the command's `#<ref>`) from **the provenance
sha** (the manifest `sha` field):
- **Command ref = the immutable release TAG** (`v2.0.0`, = `MARKETPLACE_VERSION`). aof emits
  `<runtime> plugin marketplace add https://github.com/phuryn/pm-skills.git#v2.0.0`. A tag is the only
  sha-free, clonable, *immutable-by-convention* pin the runtime's `git clone --branch` accepts. (A
  branch like `#main` clones but **floats** — it is not an integrity anchor — so it is explicitly
  rejected as the pin.)
- **Provenance sha = the 40-hex commit the tag resolves to**, resolved by aof out-of-band via
  `git ls-remote <url> refs/tags/v2.0.0` (dereferencing an annotated tag with `^{}` when the peeled
  entry is present). It is recorded in the manifest `sha` field. **ADR-002 is UNCHANGED**: `manifest.sha`
  is still a 40-char lowercase-hex commit, and a floating ref is still refused before any write.
- ADR-001's verb/token decisions (per-plugin verb `install` not `add`; marketplace token `pm-skills`;
  argv-not-shell; dry-run-no-spawn) and ADR-007's HTTPS-URL decision both **stand** — only the *pinned
  ref* changes from a bare sha to the immutable tag. `planPlanningInstall` keeps building ONE shared
  marketplace-add argv used by BOTH `claude` and `codex`; ADR-003's manifest path/shape and ADR-004's
  Codex degrade are untouched.

**The integrity tradeoff (stated honestly).** Because the runtime CLI cannot clone by sha, the
*command* trusts the **tag** (which upstream could theoretically re-point), and the recorded commit
becomes the **audit anchor**: a later `aof`/CI run re-resolves the tag and compares against the recorded
sha to detect drift. This is a deliberate, documented downgrade from "clone exactly this sha"
(impossible against this CLI) to "clone this release tag, record + later verify the exact commit." The
supply-chain story of ADR-002 survives — the recorded immutable sha is still what drift-detection binds
to — but the *clone* is pinned one level looser (release tag, not commit) because that is the tightest
pin the runtime accepts.

**Nice side effect.** The dry-run can now preview the **real** tag (`#v2.0.0`) with NO network call —
the tag is statically known (`MARKETPLACE_VERSION`), so the preview no longer shows a `<sha>`
placeholder. ADR-001's dry-run-no-network/no-spawn invariant still holds.

**Alternatives considered.**
- *Keep the `#<sha>` pin (ADR-007 as written)* — rejected: `git clone --branch <sha>` cannot resolve a
  bare commit (F2, verified directly). It pins reproducibly but does not clone, so the headline install
  fails for everyone.
- *Pin a branch ref `#main`* — rejected: `#main` clones (verified) but **floats** — it is not an
  immutable integrity anchor (ADR-002's reproducibility requirement). A consumer cloning `#main` next
  week may get a different commit; the only fixed clonable pin is the release **tag**.
- *Vendor a pinned snapshot of pm-skills into aof so the clone-by-sha problem disappears* — rejected:
  out of scope per **ADR-005**, which explicitly defers snapshot vendoring (and create-prd tailoring) to
  a future milestone. aof does not fork/edit pm-skills markdown here.

**Consequences.** The live install works for everyone (F2 cleared): `#v2.0.0` is a real, clonable,
immutable tag, unblocking the `@uat`. The recorded `sha` is the tag's resolved commit, so ADR-002/003
hold unchanged and a future drift-check (re-resolve tag, compare to recorded sha) has a stable anchor.
The string-only blind spot is closed by **two** fitness functions: `acd-planning-install-commands` now
asserts the pin is a clonable named ref (`#v2.0.0`) and explicitly that it is **not** a 40-hex sha (the
cheap deterministic F2 catch), and a **new networked clone-smoke** (`acd-planning-clonable-ref`)
proves the *actually emitted* `#<ref>` resolves to a real branch/tag upstream via
`git ls-remote --exit-code` — tri-stating on exit so a real-but-unclonable ref FAILS, a reachable ref
PASSES, and an offline/infra error LOUD-SKIPS (never silently passes, never fails on infra). The fitness
tests are RED until the developer lands the tag pin + tag-resolving `git ls-remote` in `src/`; that red
is expected.

**Invariant.** `aof planning init` emits
`<runtime> plugin marketplace add https://github.com/phuryn/pm-skills.git#v2.0.0` — the marketplace
`#<ref>` is the immutable release tag (`MARKETPLACE_VERSION`), a clonable branch/tag name, **never** a
bare 40-hex commit sha and never the `phuryn/pm-skills@<sha>` shorthand; per-plugin install stays
`<plugin>@pm-skills`; the recorded `manifest.sha` is still the tag's resolved 40-hex commit (ADR-002);
the dry-run previews the real tag with no network call or process spawn. (Enforced by
`acd-planning-install-commands` and the clone-smoke `acd-planning-clonable-ref`.)

## ADR-009: `.aof/aof.lock.json` is the SINGLE authoritative project lock; per-vertical lock files are eliminated and folded into named sections; every writer preserves the sections it does not own

**Status:** Accepted
**Date:** 2026-06-19

**Context.** Three aof commands each wrote their own lock file under `.aof/`: `aof assets apply`
owned the consumer-resource lock `.aof/aof.lock.json` (the lock-v2 `files[]` record consumed by
`planApplyActions`'s `previousLock`, by `aof assets clean`, and by the framework
install/replay), `aof work init/update` owned a SEPARATE bundle-install manifest at
`.aof/aof.work.lock.json` (m01-ADR-004), and `aof planning init` owned a SEPARATE provenance
manifest at `.aof/aof.planning.lock.json` (ADR-003). Three sibling files were justified at the time
as "one writer per file, they never collide" — but a project's pinned state is now scattered across
three artifacts a maintainer must find, diff, and reason about independently, and there is no single
source of truth to read. The PO decided (2026-06-19, SPEC Scope → "Unified project lock") that
`.aof/aof.lock.json` becomes the ONE authoritative lock for ALL of a project's pinned
dependencies/state; the two per-vertical files are eliminated and folded into named sections of that
one lock. The user chose to fold the work-lock vertical in here rather than defer it, accepting that
this reopens m01's accepted surface (`work init/update` + its install-manifest fitness function).

The enabling fact: the consumer lock already carries a flat top-level field set
(`version/generatedAt/runtimes/files/packages/frameworks/frameworkInstallAttempts`), and adding two
sibling OBJECT keys (`planning`, `work`) alongside those flat fields does not disturb any existing
reader — `planApplyActions`, `clean`, and `frameworkPlanFromLock` all key off the flat top-level
fields and ignore unknown keys. `clean.mjs`'s `createCleanPlan` ALREADY spreads `{ ...lock, files }`,
so it preserves any foreign section for free — that spread is the pattern this ADR generalises to
every writer. The hazard is the opposite case: `createLockManifest` (`src/render-plan.mjs`) and
`mergeFrameworkInstallAttempts` (`src/lock.mjs`) RECONSTRUCT the lock from a fixed field set and would
therefore DROP a `planning`/`work` section on the next `assets apply` / `packages install`.

**Decision.** There is exactly ONE lock file per project — `.aof/aof.lock.json` (resolved via
`workspacePaths(targetDir).lockPath`, `src/workspace.mjs`). No writer creates any other
`.aof/*.lock.json`. The lock has THREE ownership domains, each owned by exactly one writer, and every
writer performs a **read-merge-write that PRESERVES the domains it does not own** — it reads the
current lock, replaces ONLY its own keys, and writes the merged whole. A writer NEVER reconstructs the
lock from a fixed field set (the regression this ADR exists to forbid).

The frozen unified-lock shape (the contract the developer + the shatter/drift consumers bind to):

```jsonc
{
  // ── ASSET domain — owned by `aof assets apply` (+ `packages install`/replay for
  //    frameworkInstallAttempts). These stay FLAT at the top level, byte-compatible
  //    with today's lock so planApplyActions/clean/frameworkPlanFromLock are untouched.
  "version": 2,                       // LOCK_VERSION — the asset/top-level lock version
  "generatedAt": "<ISO-8601>",        // when the ASSET sections were last written
  "runtimes": ["claude"],             // runtimes the consumer's own resources target
  "files": [ /* lock-v2 entries: { path, runtime, resource:{id,kind}, hash, generatedAt } */ ],
  "packages": [ /* package intent */ ],
  "frameworks": [ /* framework intent */ ],
  "frameworkInstallAttempts": [ /* recorded install attempts */ ],

  // ── PLANNING domain — owned by `aof planning init` (was aof.planning.lock.json,
  //    ADR-003). The ADR-003 provenance object minus its own `version` (the unified
  //    lock carries ONE top-level version); its `generatedAt` is the planning-run time.
  //    Absent (key missing) until `aof planning init` runs.
  "planning": {
    "generatedAt": "<ISO-8601>",                       // when planning init ran
    "source": "phuryn/pm-skills",                       // marketplace source (owner/repo)
    "marketplaceName": "pm-skills",                     // manifest name in plugin@marketplace
    "marketplaceVersion": "2.0.0",                      // marketplace.json version at the pinned tag
    "sha": "d384f0c9eb81fe74656a4f6da168587836939edb",  // resolved 40-hex commit (ADR-002) — STILL 40-hex
    "runtime": "claude",                                // runtime this provenance was produced against
    "plugins": [
      { "name": "pm-execution", "marketplace": "pm-skills" }
      // … the recommended set; empty on a Codex degrade (ADR-004)
    ],
    "codex": null                                       // present iff runtime degraded (ADR-004)
  },

  // ── WORK domain — owned by `aof work init`/`aof work update` (was aof.work.lock.json,
  //    m01-ADR-004). The m01 install-manifest object minus its own `version` (unified
  //    lock carries ONE top-level version). Absent (key missing) until `aof work init` runs.
  "work": {
    "generatedAt": "<ISO-8601>",        // when work init/update ran
    "bundle": { "version": "<semver>" },// the bundle release installed (ADR-002 bundleVersion)
    "runtimes": ["claude"],             // runtimes selected at `work init`
    "files": [ /* lock-v2 entries, repo-relative forward-slash paths */ ],
    "packages": [],                     // present for lock-format compatibility; empty for the bundle
    "frameworks": [],                   // present for lock-format compatibility; empty for the bundle
    "frameworkInstallAttempts": []      // present for lock-format compatibility; empty for the bundle
  }
}
```

Domain ownership and the read-merge-write each writer MUST follow:
- `aof assets apply` owns the FLAT asset fields. It reads the current lock, runs `createLockManifest`,
  and writes `{ ...currentLock, ...assetFields }` — it must NOT emit an object that omits a present
  `planning`/`work` key. (Today it writes the bare `createLockManifest` result and would drop them.)
- `aof packages install` / framework replay own `frameworkInstallAttempts`. `mergeFrameworkInstallAttempts`
  must spread the current lock and replace only that array, preserving `planning`/`work` (and `files`).
- `aof planning init` owns ONLY the `planning` key. It reads the current lock and writes
  `{ ...currentLock, planning: <provenance> }`. It never writes `version`/`files`/`work`, never a
  separate `aof.planning.lock.json`, and never the runtime's `known_marketplaces.json`/`settings.json`.
  Its re-run guard (ADR-006) and `--force` key off the PRESENCE of the `planning` section, not a file.
- `aof work init`/`update` own ONLY the `work` key. They read the current lock and write
  `{ ...currentLock, work: <manifest> }`, preserving the asset fields and `planning`. The init guard
  keys off the presence of the `work` section; `update`'s drift-check reads the `work` section's
  recorded `files[]` hashes; neither writes a separate `aof.work.lock.json`.
- `aof assets clean` operates on the FLAT asset `files[]` only. Its `createCleanPlan` already spreads
  `{ ...lock, files }`, so it carries `planning`/`work` through unchanged — it MUST continue to (it
  must never delete or null those sections). This is the pattern; it is already correct and is the
  baseline the other writers must reach.

A consumer reading the lock treats an ABSENT section as "that vertical has not run" (key missing, not
`null`); a present section is that vertical's authoritative record.

**Alternatives considered.**
- *Keep three sibling lock files (the status quo, ADR-003 + m01-ADR-004)* — rejected by the PO: a
  project's pinned state is then scattered across three files with no single source of truth to read
  or diff; the "one writer per file" justification does not outweigh the maintainer cost.
- *Nest the asset fields under an `assets` section too (full symmetry: `assets`/`planning`/`work`)* —
  rejected: it would force a migration of every existing `aof.lock.json` and a rewrite of
  `planApplyActions`/`clean`/`frameworkPlanFromLock`, which all key off the flat top-level fields.
  Keeping the asset domain FLAT (and only the two folded verticals nested) is backward-compatible and
  the minimal change; the asset writer was the lock's original owner, so its fields keep pride of
  place at the top level.
- *Let each writer blindly overwrite the whole lock (no merge)* — rejected: that is exactly the
  section-clobbering this ADR forbids; the unified lock is only safe if every writer preserves foreign
  sections (read-merge-write).
- *A migration step that imports an existing `aof.planning.lock.json`/`aof.work.lock.json`* — out of
  scope: these are dogfood/greenfield projects; the writers simply stop emitting the old files and the
  arch-tests assert exactly one lock. (A consumer with legacy per-vertical files can re-run the verticals.)

**Consequences.** One greppable lock holds every vertical's pinned state; a maintainer reads/diffs one
file. The load-bearing mechanic is read-merge-write: every writer must preserve foreign sections, which
is structurally checkable behaviourally (run several writers in sequence into a temp repo, assert one
lock file remains and all sections survive). The asset domain stays flat and byte-compatible, so the
existing render/clean/framework readers are untouched. This **supersedes ADR-003** (this milestone —
planning provenance at the separate `aof.planning.lock.json`) and **supersedes m01-ADR-004** ("The
per-repo install manifest is a lock-v2 record at a fixed path — the locked shared contract for
init↔update", milestone 01_acd-asset-bundle — the install manifest at the separate
`aof.work.lock.json`); both ADRs' SCHEMAS survive as the `planning`/`work` section shapes, only their
storage location moves into the one lock. The two file-isolation fitness functions are reframed to
section-isolation and a new single-lock / foreign-section-preservation fitness function is added; all
three are RED until the developer migrates the three writers (`createLockManifest` /
`mergeFrameworkInstallAttempts` callers, `planning init`, `work init`/`update`) to read-merge-write.

**Invariant.** A project has exactly ONE `.aof/*.lock.json` — `aof.lock.json` (no
`aof.planning.lock.json`, no `aof.work.lock.json`). Every writer (`assets apply`, `packages
install`/replay, `planning init`, `work init`/`update`) preserves the sections it does not own:
`planning init` writes only the `planning` section, `work init`/`update` write only the `work`
section, `assets apply`/`packages` write only the flat asset fields, and none reconstructs the lock
from a fixed field set. (Enforced by `acd-unified-lock-sections` behaviourally, and by the
section-isolation reframes of `acd-planning-lock-isolation` and `acd-install-manifest-contract`.)

## ADR-010: The PRD read-out contract — `readSeam` derives objective / scope / milestone-chunks from the REAL create-prd 8-section template, deterministically, with a fallback precedence that keeps the hand-shaped and `/write-prd` inline shapes working

**Status:** Accepted
**Date:** 2026-06-19

**Context.** ADR-005 deferred create-prd *tailoring* but committed the milestone to *confirming the seam
reads out a representative create-prd PRD*. Story 01 did so against two hand-shaped fixtures
(`PRD-acme-notify.md`, `write-prd-output.md`) that BOTH carry literal `## Scope` and `## Milestones`
headings — exactly what `extractScope`/`extractMilestones` (`src/planning-prd.mjs`) title-match on
(`/scope/`, `/milestone/`). At the live `@uat` round-trip the installed pm-execution `create-prd` skill
(pm-skills v2.0.0, commit `5042ff61…`) authored a real PRD; `discoverPrd` auto-found it, but `readSeam`
returned **objective ✓ / scope `{in:[],out:[]}` / milestones `[]`** (VERIFICATION.md Finding F3). Root
cause: the **real `create-prd` skill emits an 8-section template** — `## 1. Summary`, `## 2. Contacts`,
`## 3. Background`, `## 4. Objective`, `## 5. Market Segment(s)`, `## 6. Value Proposition(s)`,
`## 7. Solution` (with `### 7.1 UX / Prototypes`, `### 7.2 Key Features` = a numbered feature list,
`### 7.3 Technology`, `### 7.4 Assumptions`), `## 8. Release` (bulleted **First version (MVP)** /
**Fast follow** / **Later**) — and there is **NO `## Scope` heading and NO `## Milestones` heading**. The
fixtures were shaped to the parser, not to the producer; the `@manual` read-out lane was green against a
PRD shape the bought planner never emits. This ADR records what ADR-005 assumed implicitly and got wrong
(the read-out *structure*) and pins the extraction contract so a genuine create-prd PRD is a first-class
test case. A captured genuine output lives at
`stories/01_story_shatter-consumes-prd/fixtures/PRD-oncall-compass.real-create-prd.md` (the canonical
example of the real template). This closes the F1/F2/F3 "fixture-shaped-to-pass, not producer-shaped"
blind-spot class for this seam: from here the seam read-out is asserted against the producer's real shape.

**Decision.** `readSeam(prdPath)` MUST return a non-empty `objective`, a non-empty `scope.in` AND
`scope.out`, and a non-empty `milestones` list across ALL THREE shapes — the real 8-section create-prd
template, the hand-shaped `## Scope`/`## Milestones` fixture, and the `/write-prd` inline `In:`/`Out:`
shape — with NO regression to the existing two. The structural parse (group the body into
heading-delimited sections via the existing `headingText`/`isHeading`; note `headingText("### 7.2 Key
Features")` → `"key features"` and `"## 8. Release"` → `"release"`, so the existing normalizer already
strips the nested `7.2`/`8.` numbering) is unchanged. Each read-out element is derived deterministically
as follows, each with a fixed fallback PRECEDENCE so the existing shapes keep matching first:

- **objective** ← unchanged: the first section whose title matches `/objective/` (`## 4. Objective` in
  the real template, `## 2. Problem & Objective` / `## Objective` in the fixtures), preferring a
  `**Objective.**` lead-in then the first prose paragraph, joined across line-wraps. Already green on all
  three shapes — keep `extractObjective` as-is.

- **milestone-sized chunks** ← `extractMilestones`, in this precedence (first match that yields ≥1 item
  wins; later steps are NOT consulted once a step yields items):
  1. a section whose title matches `/milestone/` → its `listItems` (the existing path; keeps both
     hand-shaped fixtures' `## Milestones` green — 3 chunks each);
  2. else a section whose title matches `/key features/` → its `listItems` (the real template's
     `### 7.2 Key Features` numbered list — one chunk per feature: schedule model, rotation engine,
     notifications & escalation, calendar sync, web UI = 5 chunks);
  3. else a section whose title matches `/\bfeatures\b/` → its `listItems` (a looser fallback for a
     "Features"/"Key features" heading that did not match step 2).
  `## 8. Release` CORROBORATES but does NOT itself supply the chunks: it is the release-sequencing of the
  same features, not an independent chunk list, so deriving chunks from `Key Features` (the canonical
  feature inventory) and leaving `Release` to the scope rule below avoids double-counting. (If a future
  PRD has neither a `/milestone/` nor a `/features/` section, milestones is `[]` — an honest empty, not a
  fabrication; that PRD shape is out of scope here.)

- **scope in/out** ← `extractScope`, in this precedence (first step that produces a section wins):
  1. a section whose title matches `/scope/` → the EXISTING two-shape logic unchanged: sub-heading/bold
     `In scope`/`Out of scope` buckets AND inline `In: …`/`Out: …` (keeps `PRD-acme-notify.md`'s
     `## 3. Scope` and `write-prd-output.md`'s inline `In:/Out:` green — 3-in/3-out each);
  2. else (no `## Scope` heading — the real template) derive from the `## 8. Release` section by
     classifying each top-level `listItems` entry on its **bold-lead label**:
     - **in** ← items whose lead matches `/^(first version|mvp|now|v1|initial|launch|fast follow)\b/i`
       (the committed/sequenced-for-this-initiative capabilities — "First version (MVP)…" and "Fast
       follow…" on the real fixture = 2 in-scope items);
     - **out** ← items whose lead matches
       `/^(later|future|deferred|out of scope|not in v1|won.?t|non-goals?)\b/i` (the explicitly-deferred
       items — "Later. The full web UI…" on the real fixture = 1 out-of-scope item);
     - items matching neither label (e.g. "Timeframes are relative; no fixed dates.") are IGNORED.
     The lead label is matched on the item text after stripping emphasis (the existing `listItems`
     already strips `*_\``), tolerating a trailing `.`/`(MVP)`. This yields non-empty in AND out on the
     real fixture without requiring any `## Scope` heading.
  (Why Release, not `7.4 Assumptions`: Release carries an explicit in-vs-deferred partition with stable
  labels; Assumptions are caveats, not a scope partition — keying scope off Release is the simplest
  deterministic rule that stays green. `7.4 Assumptions` MAY later enrich `out`, but is NOT required by
  this contract.)

The fallbacks are strictly additive: an existing fixture (which HAS `## Scope`/`## Milestones`) never
reaches the new branches, so the contract is backward-compatible by construction (verified: the existing
`/milestone/` and `/scope/` matches fire first on both old fixtures; only the real template falls through
to `Key Features` + `Release`). `readSeam`'s signature/return shape (`{ objective, scope:{in,out},
milestones }`) is unchanged — only the extraction internals harden.

**Alternatives considered.**
- *Derive milestone chunks from `## 8. Release` (first-version/fast-follow/later as the three chunks)* —
  rejected: Release is the *sequencing* of the feature set, not the feature inventory; it would yield 3
  coarse phase-buckets instead of the 5 real capabilities the PO actually framed milestones from, and it
  collides with the scope rule (which already keys off Release). `Key Features` is the canonical chunk
  source; Release corroborates the in/out split.
- *Require scope to come only from a literal `## Scope` heading and accept empty scope on real output* —
  rejected: that IS the F3 defect — the bought planner never emits `## Scope`, so the headline seam would
  stay half-true (objective-only) on every real PRD.
- *Tailor/vendor create-prd to emit an explicit ACD seam read-out section (a `## Scope`/`## Milestones`
  block)* — rejected here: that is ADR-005's explicitly-DEFERRED future-milestone tailoring; this fix
  reads the producer's *real current* shape rather than forking pm-skills markdown.
- *Loosen matching to "any numbered/bulleted list anywhere"* — rejected: it would grab `## 5. Market
  Segment(s)`, `## 6. Value Proposition(s)`, `### 7.1 UX`, `### 7.3 Technology`, etc., producing noisy,
  non-deterministic chunks. The named-section precedence is the bounded, deterministic rule.

**Consequences.** The seam read-out is non-empty on the real producer's output (F3 cleared): the milestone's
headline — "`aof:shatter` consumes the resulting `PRD-*.md` → objective / scope / milestone-chunks" — is
fully true against the bought planner, not just a hand-shaped fixture. The extraction is deterministic and
bounded (named sections + fixed label vocabulary), so it stays green on the real fixture and is asserted as
a first-class case in `test/planning-prd.test.mjs` (the developer adds the real-producer fixture's read-out
assertions; the two existing fixtures keep their assertions unchanged as the no-regression guard). Per
ADR-005's note and the ARCHITECTURE.md preamble, the read-out is observable BEHAVIOUR (the story `.feature`,
exercised by `test/planning-prd.test.mjs`), NOT a structural invariant — so it does NOT get a fitness
function (`test/arch`); the producer-shape regression is guarded behaviourally by the genuine-create-prd
fixture becoming a permanent test case. If a future milestone tailors create-prd to emit an explicit seam
read-out section, THIS ADR is superseded (the derivation rule changes), not edited.

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature. -->

| Invariant | Enforced by (arch-test) | From |
|---|---|---|
| `aof planning init --dry-run` emits, for the recommended set, `<runtime> plugin marketplace add https://github.com/phuryn/pm-skills.git#v2.0.0` — the marketplace add pins the **clonable release tag** `#v2.0.0` (HTTPS git URL, a named branch/tag ref — **never a bare 40-hex commit sha** and never the SSH-able `phuryn/pm-skills@<sha>` shorthand) then `<runtime> plugin install <plugin>@pm-skills` (verb `install`, marketplace token `pm-skills`, never `add`/`plugin add`) and previews the real tag with no network call or process spawn | `test/arch/acd-planning-install-commands.test.mjs` (build the dry-run plan; assert the marketplace-add command ends `…git#v2.0.0` and is NOT the bare shorthand; assert the `#<ref>` does NOT match `/#[0-9a-f]{40}$/` — the F2 regression guard; assert each install command matches the pinned verbs/tokens for the 3 core plugins; assert the dry-run path makes no spawn — a simulation hook records zero launches and previews the `#v2.0.0` tag) | ADR-001 → ADR-007 → **ADR-008** (marketplace-source/ref) |
| The marketplace `#<ref>` the plan *actually emits* resolves to a real clonable branch/tag upstream (`git clone --branch <ref>` would succeed) — closing the string-only blind spot that let F1/F2 reach the verify gate | `test/arch/acd-planning-clonable-ref.test.mjs` (networked clone-smoke: build the plan, extract the emitted `#<ref>`, run `git ls-remote --exit-code <url> refs/tags/<ref> refs/heads/<ref>`; tri-state: exit 0 → PASS, exit 2 → FAIL `the emitted marketplace ref <ref> is not a clonable branch/tag upstream (F2 regression)`, any other non-zero → LOUD SKIP `# SMOKE SKIPPED (offline)…` without throwing) | **ADR-008** |
| The provenance manifest's `sha` is a 40-char lowercase-hex commit id — never a branch/tag/`HEAD`/floating ref | `test/arch/acd-planning-provenance-sha.test.mjs` (produce a manifest with a fixtured/injected sha; assert `manifest.sha` matches `/^[0-9a-f]{40}$/`; assert a branch-name input is rejected before write) | ADR-002 |
| `aof planning init` writes ONLY the `planning` section of `.aof/aof.lock.json` — it never writes a separate `aof.planning.lock.json`, never clobbers the asset (`files`/`packages`/`frameworks`) or `work` sections, and never writes the runtime's `known_marketplaces.json`/`settings.json` | `test/arch/acd-planning-lock-isolation.test.mjs` (source: grep planning-init — names `aof.lock.json`, NEVER `aof.planning.lock.json`/`aof.work.lock.json`, no `known_marketplaces`/`settings.json`; behavioural: seed `.aof/aof.lock.json` with asset + `work` sections, run init, assert only `aof.lock.json` under `.aof/`, the `planning` section carries the frozen schema, and the seeded asset/`work` sections survive byte-intact) | ADR-003 → **ADR-009** |
| `aof work init`/`update` write ONLY the `work` section of `.aof/aof.lock.json` — never a separate `aof.work.lock.json` — preserving the asset and `planning` sections; the bundle drift-check reads the `work` section's recorded hashes | `test/arch/acd-install-manifest-contract.test.mjs` (source: grep work-init/update — name `aof.lock.json`, NEVER `aof.work.lock.json`; behavioural: seed asset + `planning` sections, run init/update, assert the `work` section conforms to the frozen lock-v2 manifest schema, only `aof.lock.json` exists under `.aof/`, and the seeded sections survive byte-intact) | m01-ADR-004 → **ADR-009** |
| A project has exactly ONE `.aof/*.lock.json` (`aof.lock.json`); every writer preserves the sections it does not own (`assets apply`, `packages install`/replay, `planning init`, `work init`/`update` each touch only their own domain and read-merge-write, never reconstruct from a fixed field set) | `test/arch/acd-unified-lock-sections.test.mjs` (behavioural: into one temp repo run a sequence — `work init` → `planning init` → `assets apply` — then `readdir(.aof)` shows only `aof.lock.json` AND the `work`, `planning`, and flat asset sections are all present and intact; plus a focused case asserting `assets apply` carries a pre-seeded `planning`+`work` through unchanged) | **ADR-009** |
| The planning-init source contains no `codex plugin install` / `codex plugin add` literal (the absent Codex verb is never emitted); Codex provenance records `pluginsInstalled: false` rather than claiming success | `test/arch/acd-planning-no-codex-install.test.mjs` (grep the source: no `codex plugin install` / `codex plugin add` string; build the codex plan → asserts only `codex plugin marketplace add` is present and the produced manifest's `codex.pluginsInstalled === false`) | ADR-004 |

<!-- NOT fitness functions (deliberately): the PRD discovery contract (auto-find `PRD-*.md` / accept a
     path / ask-on-miss) is observable BEHAVIOUR → Story 01 `.feature` (ADR-005). The re-run guard's
     exit code/message is task-level behaviour → Story 00 `.feature` (ADR-006). Sha resolution against
     the live network and an end-to-end plugin install are @manual/@uat (RESEARCH A6–A9), not CI arch-tests.
     The PRD read-out *extraction* contract (objective/scope/milestone-chunks from the real 8-section
     create-prd template — ADR-010, Finding F3) is likewise observable BEHAVIOUR → Story 01 `.feature`
     (`tasks/03_real-template-readout.feature`), exercised by `test/planning-prd.test.mjs`. It is NOT a
     structural invariant, so it gets NO arch-test; the producer-shape regression is guarded behaviourally
     by making the genuine create-prd output a first-class read-out test case (the developer adds it). -->
