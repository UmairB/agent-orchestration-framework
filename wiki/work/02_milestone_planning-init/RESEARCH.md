---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Report facts; the architect decides what to do about them (→ ARCHITECTURE.md).
-->
# 02 · Planning Init (the bought seam) — Research

**Gathered:** 2026-06-18
**Method:** Official Claude Code plugin docs (code.claude.com); official + community Codex docs
(developers.openai.com, codex.danielvaughan.com); the live `phuryn/pm-skills` repo (README,
`.claude-plugin/marketplace.json`, `pm-execution` skill/command files) sparse-cloned at its current
HEAD; `git ls-remote`; and the **locally installed CLIs** (`claude 2.1.178`, `codex-cli 0.130.0`)
queried directly via `--help`. Installed-CLI behavior is treated as ground truth over published docs.
**Status:** Desk + live-CLI research complete on Claude. Codex install-of-individual-plugins is a
confirmed *gap* (live). One PRD-path discrepancy flagged. Items needing a real end-to-end install run
are listed under Assumptions.
**Post-verify corrections:**
- **F1 (2026-06-18):** §1 and §4 were corrected after blocker finding F1 (VERIFICATION.md) — a live
  install proved the `owner/repo` shorthand clones over SSH and fails for HTTPS-only auth; the emitted
  command must use the HTTPS git URL `#ref` form. See the inline **Correction (2026-06-18, F1)** notes
  in §1 and §4.
- **F2 (2026-06-19):** §4 was corrected again after blocker finding F2 (VERIFICATION.md). F1's "fix"
  pinned `#<40-hex-sha>`, which is **not a usable ref** — `claude plugin marketplace add <url>#<ref>`
  does `git clone --branch <ref>`, which resolves only a branch or tag name, not a bare commit sha.
  The installable anchor is the immutable **release tag** (`#v2.0.0`), with the 40-hex commit resolved
  out-of-band and recorded as the audit/drift anchor. See the inline **Correction (2026-06-19, F2)**
  notes in §1 and §4 (and the annotated F1 blocks they supersede).
- **F3 (2026-06-19):** §7 was corrected after blocker finding F3 (VERIFICATION.md). The original §7
  captured the create-prd skill's output **filename** (`PRD-[name].md`) but NOT its **section
  structure**; a live round-trip proved the real `create-prd` skill emits an **8-section template** with
  **no `## Scope` and no `## Milestones` heading** — exactly what `readSeam`'s `extractScope`/
  `extractMilestones` title-match on — so the seam read-out came back objective-only on genuine output.
  Both story-01 fixtures were shaped to the parser, not the producer. See the inline **Correction
  (2026-06-19, F3)** note in §7; the read-out extraction contract is pinned by ADR-010.

---

## 1. Claude Code marketplace + plugin CLI surface (non-interactive)

- **Finding:** `claude plugin marketplace` and `claude plugin install` exist as **first-class
  non-interactive subcommands** (docs: "Claude Code provides non-interactive `claude plugin
  marketplace` subcommands for scripting and automation"). Confirmed live on `claude 2.1.178`:
  - `claude plugin marketplace add <source> [--scope user|project|local] [--sparse <paths...>]`
    — `<source>` accepts GitHub `owner/repo` shorthand (`phuryn/pm-skills`), git URL, remote
    `marketplace.json` URL, or local path. Default scope `user`.
    - **Correction (2026-06-18, F1):** all of those forms remain valid *as accepted input*, but the
      `owner/repo` **shorthand is not usable for a scriptable install** — Claude resolves the
      shorthand to an **SSH clone** (`git@github.com:phuryn/pm-skills.git`), which fails with
      `Permission denied (publickey)` on a machine with HTTPS-only GitHub auth (no SSH key configured,
      no git `insteadOf` HTTPS rewrite). A live `aof planning init --runtime claude` exercised exactly
      this and failed all four install steps (VERIFICATION.md F1). For a scriptable install aof must
      therefore emit the **HTTPS git URL** form (`https://github.com/phuryn/pm-skills.git`), *not* the
      shorthand, so the clone transport matches the HTTPS transport aof already uses to resolve the
      sha (`git ls-remote`, §4). This supersedes the shorthand-`@ref` recommendation that originally
      followed §4.
    - **Correction (2026-06-19, F2):** the `#<ref>` appended to the HTTPS URL is passed to
      `git clone --branch <ref>`, which resolves **only a branch or tag name — NOT a bare commit
      sha** (see §4 for the live proof). F1's "use `#<40-hex-sha>`" guidance is therefore wrong; the
      usable `#ref` is the immutable **release tag** (`#v2.0.0`). Do not append a bare sha here.
  - `claude plugin install <plugin>@<marketplace> [-s|--scope user|project|local] [--config k=v]`
    — `install` aliases to `i`. Default scope `user`. (There is **no** `claude plugin add`; the verb
    is `install`. The ROADMAP's `<runtime> plugin add pm-execution@pm-skills` is wrong for Claude —
    it must be `claude plugin install pm-execution@pm-skills`.)
  - Lifecycle also present live: `marketplace list|update|remove`, `plugin list|enable|disable|
    uninstall|update|details|validate`.
- **Constraint:** `aof planning init` CAN shell out to `claude` headlessly for both steps (mirror the
  existing `network-boundary` pattern in `src/cli.mjs:1186-1194`). The plan it prints/executes must
  use the verb **`install`**, not `add`, and use `plugin@marketplace` syntax. **For the marketplace
  source it must use the HTTPS git URL pinned to the release tag
  (`https://github.com/phuryn/pm-skills.git#v2.0.0`), not the `owner/repo` shorthand (SSH-clones,
  fails HTTPS-only auth — Correction F1) and not a `#<sha>` fragment (not a clonable ref —
  Correction F2).** Each install is a network + arbitrary-code-execution boundary (plugins "can
  execute arbitrary code on your machine") — the same dry-run-then-warn gate the GSD installer
  already uses applies.
- **Source:** https://code.claude.com/docs/en/plugin-marketplaces ("Manage marketplaces from the
  CLI"); https://code.claude.com/docs/en/discover-plugins ("Install plugins", `--scope` examples);
  live `claude plugin --help`, `claude plugin marketplace add --help`, `claude plugin install --help`;
  live `aof planning init --runtime claude` run (VERIFICATION.md F1) for the SSH-vs-HTTPS transport;
  live `aof planning init --runtime claude` run (VERIFICATION.md F2) for the `#<sha>`-not-a-ref proof.

## 2. Where Claude persists the result

- **Finding:** State is split. Marketplace registrations live per-user in
  `~/.claude/plugins/known_marketplaces.json` (docs: "Marketplace state is stored once per user in
  `~/.claude/plugins/known_marketplaces.json`, not per project"). Enabled plugins are recorded as
  `enabledPlugins` keyed `plugin@marketplace` in the relevant `settings.json` for the chosen scope
  (project scope writes `.claude/settings.json`). Plugin content is copied into a versioned cache at
  `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`.
- **Constraint:** aof does NOT need to write Claude's plugin state itself — the CLI owns it. aof's job
  is the **separate provenance manifest** (source / marketplaceVersion / pinned sha / plugins), an
  aof-owned artifact, independent of `known_marketplaces.json`/`settings.json`. The cache path being
  version-keyed means the *plugin* sha (not the marketplace ref) is what determines the cached copy
  (see §4).
- **Source:** https://code.claude.com/docs/en/plugin-marketplaces ("Require marketplaces for your
  team"; "Plugin sources"); https://code.claude.com/docs/en/discover-plugins (`enabledPlugins`).

## 3. `.claude-plugin/marketplace.json` schema (what a marketplace repo must expose)

- **Finding:** Required top-level fields: `name` (kebab-case, public-facing), `owner` (`{name}`
  required, `email` optional), `plugins[]`. Each plugin entry requires `name` + `source`. Optional
  marketplace fields include `description`, `version`, `metadata.pluginRoot`. `pm-skills` validates
  against this: `name: "pm-skills"`, `version: "2.0.0"`, owner Paweł Huryn, 9 plugin entries with
  relative `./<plugin>` sources. `claude plugin validate <path>` (live subcommand) checks the schema.
- **Constraint:** No work for aof here (the marketplace is bought, not authored) — but aof can *use*
  `claude plugin validate` as a CI/preflight check that a vendored/forked snapshot is still a valid
  marketplace. If aof later vendors a pinned snapshot (ROADMAP "Vendor-pinned + tailored"), it must
  preserve this exact file at `.claude-plugin/marketplace.json` with these required fields.
- **Source:** https://code.claude.com/docs/en/plugin-marketplaces ("Marketplace schema");
  pm-skills `.claude-plugin/marketplace.json` (sparse-cloned).

## 4. Sha pinning — marketplace source vs plugin source (the integrity control)

- **Finding (decisive):** Claude distinguishes two source layers with **different pinning powers**:
  - **Marketplace source** (what `claude plugin marketplace add` registers): supports a **`ref`
    (branch/tag) only — NOT `sha`.** Docs, verbatim: *"Marketplace source … Supports `ref`
    (branch/tag) but not `sha`."* On the CLI you pin a ref by appending `@ref` to the GitHub
    shorthand or `#ref` to a git URL. There is no sha argument to `marketplace add`.
  - **Plugin source** (the `source` object of each entry *inside* `marketplace.json`): supports both
    `ref` and a full **40-char `sha`** for `github` / `url` / `git-subdir` types ("When both `ref`
    and `sha` are set … the `sha` is the effective pin"). But `pm-skills` uses **relative `./<plugin>`
    sources**, which carry no sha field — their version resolves to the marketplace repo's commit SHA
    (resolution order: `plugin.json` `version` → marketplace-entry `version` → git commit SHA).
- **Finding (consequence for pm-skills specifically):** Because aof adds the *whole* `pm-skills`
  marketplace, and its plugins are relative-path entries, **the CLI gives no first-class way to pin
  the install to a commit sha.** A floating `marketplace add` of the bare source tracks `main`. The
  reproducible *and installable* anchor is the immutable **release tag**: pin `#v2.0.0` on the HTTPS
  git URL, and resolve that tag to its 40-hex commit out-of-band to record in the provenance
  manifest. (Relative-path plugins then resolve their version to that same commit.)
  - **~~Original (superseded by F2): "A full commit sha IS a valid `ref` for GitHub clone/checkout, so
    this pins the marketplace to an exact commit even though the field is named `ref`."~~** — This is
    **FALSE for the `marketplace add` path** and is the root error behind both F1's bad fix and F2.
    See the Correction (2026-06-19, F2) below.
- **Correction (2026-06-18, F1):** the *original* recommendation here was to emit the shorthand
  `@ref` form — `claude plugin marketplace add phuryn/pm-skills@d384f0c…`. **A live run proved that
  form unusable:** the `owner/repo` shorthand resolves to an SSH clone and fails with
  `Permission denied (publickey)` under HTTPS-only GitHub auth (VERIFICATION.md F1). F1 corrected the
  **source/transport form** from the shorthand `@ref` to the **HTTPS git URL `#ref`** form. *However,
  F1 also retained the false "a full 40-hex sha is a valid ref" claim and recommended pinning the
  fragment to a bare sha (`…pm-skills.git#<sha>`). That sha-fragment part is itself wrong and is
  superseded by the Correction (2026-06-19, F2) below.* The HTTPS-transport part of F1 stands; the
  what-goes-after-`#` part does not.
- **Correction (2026-06-19, F2):** **A bare 40-hex commit sha is NOT a usable `#ref` for
  `claude plugin marketplace add`.** That command resolves a git URL `#<ref>` via
  `git clone --branch <ref>`, which accepts **only a branch or tag name**, never a bare commit. The
  earlier "a full commit sha is a valid ref" statement (and F1's `#<sha>` fix that depended on it) are
  wrong for this code path, and that is what produced both the F1 bad fix and the F2 blocker.
  - **Live evidence (treat as ground truth):**
    - The live `aof planning init --runtime claude` emitting
      `…pm-skills.git#d384f0c9eb81fe74656a4f6da168587836939edb` (a real 40-hex commit, the tip of
      `main`) **failed for everyone** with:
      `warning: Could not find remote branch d384f0c9…edb to clone` /
      `fatal: Remote branch d384f0c9…edb not found in upstream origin` (VERIFICATION.md F2).
    - Direct git proof in this environment (2026-06-19):
      - `git clone --branch d384f0c9eb81fe74656a4f6da168587836939edb https://github.com/phuryn/pm-skills.git`
        **FAILS** identically:
        `warning: Could not find remote branch d384f0c9eb81fe74656a4f6da168587836939edb to clone` /
        `fatal: Remote branch d384f0c9eb81fe74656a4f6da168587836939edb not found in upstream origin`.
      - `git clone --branch v2.0.0 https://github.com/phuryn/pm-skills.git` **SUCCEEDS** →
        checks out commit `5042ff6169e0df49086c846f69bf7b6cdb67a6de`.
      - `git clone --branch main https://github.com/phuryn/pm-skills.git` **SUCCEEDS** →
        checks out commit `d384f0c9eb81fe74656a4f6da168587836939edb`.
      - `git ls-remote --heads --tags https://github.com/phuryn/pm-skills.git` shows the repo's only
        named refs are branch `main` (`d384f0c9…edb`) and tag `v2.0.0`; the tag is **lightweight**
        (points directly at commit `5042ff6169e0df49086c846f69bf7b6cdb67a6de` — `refs/tags/v2.0.0`
        and `refs/tags/v2.0.0^{}` deref to the same sha).
  - **The installable anchor the CLI actually supports:** pin the HTTPS git URL by the immutable
    **release tag**:

    ```
    claude plugin marketplace add https://github.com/phuryn/pm-skills.git#v2.0.0
    ```

    and resolve that tag to its 40-hex commit out-of-band — for an annotated tag dereference `^{}`:

    ```
    git ls-remote https://github.com/phuryn/pm-skills.git refs/tags/v2.0.0 'refs/tags/v2.0.0^{}'
    # v2.0.0 → 5042ff6169e0df49086c846f69bf7b6cdb67a6de (lightweight; both lines = same sha)
    ```

    Record that commit in the provenance manifest. A floating branch (`#main`) clones but is **not an
    integrity anchor** (it re-points as upstream advances).
  - **Honest tradeoff (fact, not a decision):** the CLI gives **no way to clone by sha**, so the
    *command* pins the **tag** (which upstream can re-point) and the *recorded commit* is the
    audit / drift-detection anchor. The command-pin and the integrity-pin are therefore two different
    values for this milestone. (The architect resolves what to do — ADR-008.)
- **Constraint:** The milestone's "pinned-sha provenance" is achievable but **aof must do the sha
  resolution itself** (`git ls-remote` over HTTPS), record it in the provenance manifest, and pass the
  **release tag (`#v2.0.0`) as the `#<ref>` fragment** on the HTTPS git URL to `marketplace add`
  (Correction F2 — NOT a `#<sha>` fragment, which is not a clonable ref; NOT the `owner/repo@<sha>`
  shorthand, which SSH-clones — Correction F1). aof must NOT rely on a `--sha` flag (none exists) and
  must NOT assume a bare `marketplace add` of the source is reproducible (it floats on `main`).
  Auto-update further threatens the pin: third-party marketplaces default auto-update **off**, but if
  ever enabled the pin drifts — `DISABLE_AUTOUPDATER` / leaving auto-update off is the guard. The
  recorded `sha` (the commit the tag points at) is what a later `aof` run / CI compares against to
  detect drift.
- **Source:** https://code.claude.com/docs/en/plugin-marketplaces ("Plugin sources" note +
  "github/url/git-subdir" tables + "Version resolution and release channels"); live
  `git ls-remote https://github.com/phuryn/pm-skills HEAD`; live
  `git ls-remote --heads --tags`, `git clone --branch {<sha>|v2.0.0|main}` (2026-06-19, this
  environment); live `aof planning init --runtime claude` runs (VERIFICATION.md F1 for SSH-vs-HTTPS
  transport; F2 for the `#<sha>`-not-a-ref clone failure).

## 5. Codex parity — partial, and weaker than the ROADMAP claims

- **Finding (live, ground truth):** On the installed `codex-cli 0.130.0`, `codex plugin` exposes
  **only** `codex plugin marketplace { add | upgrade | remove }`. There is **NO `codex plugin add`,
  NO `codex plugin install`, NO `codex plugin list`.** `codex plugin install …` and `codex plugin add
  …` both error `unrecognized subcommand`. So the ROADMAP/pm-skills-README line
  `codex plugin add pm-execution@pm-skills` **does not work on current Codex** — you can register the
  marketplace but there is no per-plugin install verb.
- **Finding:** `codex plugin marketplace add <SOURCE>` accepts `owner/repo[@ref]`, HTTP(S)/SSH git
  URLs, or a local path, plus `--ref <REF>` and `--sparse <PATH>`. Pinning is **ref-based only**
  (`@ref` / `--ref`); no sha flag (same shape as Claude's marketplace add). **Cross-reference (F2):**
  the §4 correction (a bare commit sha is not a clonable `ref` — `git clone --branch <ref>` takes only
  a branch/tag) applies to Codex's `@ref`/`--ref` as well; the integrity anchor for Codex is likewise
  the **release tag** (`v2.0.0`) plus the out-of-band-resolved commit, not a `@<sha>`. *Not
  separately live-tested on Codex — re-verify under A8.* The CLI is young / in-flux: upstream PRs
  (#17087, #21396) are still landing the marketplace CLI, and `remove`/`update` were "not confirmed
  in alpha" in community write-ups.
- **Finding:** Codex's native marketplace path differs: `$REPO_ROOT/.agents/plugins/marketplace.json`
  or `~/.agents/plugins/marketplace.json`, with **legacy compatibility** for
  `.claude-plugin/marketplace.json` — so `phuryn/pm-skills` (a `.claude-plugin/` marketplace) is
  reusable by Codex *as a marketplace*. State persists in `~/.codex/config.toml` (`[plugins."x@mkt"]
  enabled = …`).
- **Finding:** Even where pm-skills installs on Codex, its **slash-commands do not run as Codex slash
  commands** — pm-skills README: commands "install but don't run as Codex slash commands"; users
  invoke the workflows via plain language. Skills work; the `/write-prd` command UX does not.
- **Constraint:** The ROADMAP's `<runtime> = claude | codex` symmetry is **false today**. For Codex,
  `aof planning init` can register the marketplace but **cannot script a per-plugin install** — the
  honest options are: (a) Claude-first (only emit the `claude` plan, note Codex as manual/unsupported);
  or (b) for Codex, register the marketplace and rely on the user enabling plugins interactively /
  via `config.toml`, and document that `/write-prd` runs as plain-language not a slash command. The
  architect must pick; do not assume parity. The Codex CLI's instability also argues for not
  hard-coding its subcommand shape.
- **Source:** live `codex plugin --help`, `codex plugin marketplace --help`,
  `codex plugin marketplace add --help`, and failed `codex plugin install/add` (codex-cli 0.130.0);
  https://developers.openai.com/codex/plugins/build;
  https://codex.danielvaughan.com/2026/04/11/codex-marketplace-plugin-distribution/;
  https://codex.danielvaughan.com/2026/04/13/codex-cli-v0121-marketplace-agent-identity-plugin-distribution/;
  pm-skills README.

## 6. `phuryn/pm-skills` realities

- **Finding:** Repo exists; default branch `main`; HEAD =
  `d384f0c9eb81fe74656a4f6da168587836939edb` (verified `git ls-remote`); release tag `v2.0.0` →
  commit `5042ff6169e0df49086c846f69bf7b6cdb67a6de` (lightweight tag, verified `git ls-remote`
  2026-06-19). License **MIT** (LICENSE: "Copyright (c) 2026 Pawel Huryn"). It is a real Claude Code
  plugin marketplace (`.claude-plugin/marketplace.json`, `name: "pm-skills"`, `version: "2.0.0"`). All
  9 plugins from the ROADMAP table are present and named exactly: `pm-product-discovery`,
  `pm-product-strategy`, `pm-execution`, `pm-market-research`, `pm-data-analytics`, `pm-go-to-market`,
  `pm-marketing-growth`, `pm-toolkit`, `pm-ai-shipping`. Marketplace tagline: "68 domain-specific
  skills and 42 chained workflows across 9 PM plugins."
- **Finding:** `pm-execution` is the seam producer, confirmed. It carries **both** a `create-prd`
  **skill** (`pm-execution/skills/create-prd/SKILL.md`) and a `/write-prd` **command**
  (`pm-execution/commands/write-prd.md`), plus `red-team-prd` and `pre-mortem` (commands) — matching
  the ROADMAP. It also ships sprint/OKR/user-story/roadmap commands that ACD should ignore (the
  ROADMAP already flags this).
- **Constraint:** The ROADMAP's plugin names, version (2.0.0), MIT, and "pm-execution = PRD producer"
  are all **verified**, not just asserted. The recommended-set names are safe to hard-reference. The
  marketplace name to use in `plugin@marketplace` syntax is **`pm-skills`** (the manifest `name`), not
  the repo path `phuryn/pm-skills`.
- **Source:** `git ls-remote`; sparse-cloned `LICENSE`, `.claude-plugin/marketplace.json`,
  `pm-execution/` listing; README.

## 7. PRD output location — confirmed format, but a producer discrepancy

- **Finding (the seam-critical one):** The `create-prd` **skill** instructs, verbatim: *"save it as a
  markdown document in the format: `PRD-[product-name].md`"* — confirming the ROADMAP's
  `PRD-<name>.md` filename. **BUT** there is **no directory specified** and **no path configuration**
  exposed; the skill leaves the directory to the agent ("save it as a markdown document"). The
  ROADMAP's stronger claim — "lands as `PRD-<name>.md` in the workspace root (not a configurable
  path)" — is only *partly* supported: the **filename pattern is real and fixed**, but "workspace
  root" and "not configurable" are **not guaranteed by the skill** (it is agent-discretion, not a
  hard contract).
- **Finding (discrepancy to flag):** The `/write-prd` **command** uses a *different* 8-section
  template than the skill and says only *"Save the PRD as a markdown file to the user's workspace"* —
  it does **not** state the `PRD-[name].md` filename at all. So the two PRD producers in the same
  plugin disagree on output naming: the **skill** yields `PRD-<name>.md`; the **command** yields an
  unspecified filename "in the workspace." Which one runs depends on how the planner is invoked
  (skill auto-invocation vs `/write-prd`).
- **Constraint:** `aof:shatter` discovers `PRD-*.md`. That glob is reliable **only when the
  `create-prd` skill's filename convention is followed**; a PRD produced via the `/write-prd` command
  may not match `PRD-*.md` and may not sit at the workspace root. The seam therefore rests on an
  **agent-honored naming convention, not a tool-enforced path** — discovery must tolerate (a) PRDs
  not at root and (b) PRD files that lack the `PRD-` prefix, or the planner step must normalize the
  output name. The architect should decide whether aof pins the producer to the *skill* convention,
  post-processes the filename, or makes `shatter`'s discovery looser. This is the milestone's main
  hidden risk.
- **Correction (2026-06-19, F3):** the original §7 above confirmed the create-prd skill's output
  **filename** but said nothing about its **section structure** — and the milestone's two story-01
  fixtures (`PRD-acme-notify.md`, `write-prd-output.md`) were hand-shaped with `## Scope` + `## Milestones`
  headings to match `readSeam`'s parser (`extractScope`/`extractMilestones` title-match `/scope/` and
  `/milestone/`). A live `@uat` create-prd → shatter round-trip (VERIFICATION.md Finding F3) proved that
  fixture shape does NOT occur in practice. The **`create-prd` skill actually emits an 8-section template**
  (genuine output captured verbatim at
  `stories/01_story_shatter-consumes-prd/fixtures/PRD-oncall-compass.real-create-prd.md`):
  1. `## 1. Summary` — what the product is / the problem it replaces.
  2. `## 2. Contacts` — a roles table.
  3. `## 3. Background` — `**Context.**` / `**Why now?**` / `**What changed.**` prose.
  4. `## 4. Objective` — `**Objective.**` + `**Why it matters.**` + `**Key Results (SMART).**` (a bullet
     list). *(`readSeam`'s objective extraction keys off this — already works.)*
  5. `## 5. Market Segment(s)` — bulleted segments + a `**Constraints.**` line.
  6. `## 6. Value Proposition(s)` — bulleted value props.
  7. `## 7. Solution` — `### 7.1 UX / Prototypes`, **`### 7.2 Key Features`** (a numbered feature list —
     the canonical milestone-chunk source), `### 7.3 Technology (optional)`, `### 7.4 Assumptions`.
  8. `## 8. Release` — bulleted `**First version (MVP).**` / `**Fast follow.**` / `**Later.**` (the
     in-vs-deferred scope partition, by bold-lead label).
  There is **NO `## Scope` heading and NO `## Milestones` heading** anywhere in the real template. So a
  read-out helper that requires those literal headings (the milestone's original `readSeam`) extracts only
  the objective and returns empty scope + empty milestones on genuine create-prd output — the F3 defect.
  The deterministic derivation that reads this real structure (milestone-chunks ← `### 7.2 Key Features`;
  in/out scope ← `## 8. Release` first-version/fast-follow = in, later/deferred = out; both with a fallback
  precedence that keeps the existing `## Scope`/`## Milestones` and `/write-prd` inline `In:`/`Out:` shapes
  green) is pinned by **ADR-010**. The `/write-prd` **command**'s own 8-section template (a *different*
  layout, already noted above) is a separate producer; ADR-010's contract covers both via the fallback
  precedence.
- **Source:** `pm-execution/skills/create-prd/SKILL.md` (step 6, "Save the Output");
  `pm-execution/commands/write-prd.md` (Step 3 template + "Save the PRD as a markdown file to the
  user's workspace"); live `create-prd` skill output (pm-skills v2.0.0, commit `5042ff61…`) captured at
  `stories/01_story_shatter-consumes-prd/fixtures/PRD-oncall-compass.real-create-prd.md` (VERIFICATION.md
  Finding F3, 2026-06-19).

## 8. Reuse precedent in aof (`src/cli.mjs`)

- **Finding:** aof already has the exact shape `planning init` should mirror: a plan of commands,
  a `--dry-run` that prints commands and runs nothing, then a per-item **network boundary** print +
  warning before execution (`src/cli.mjs:1176-1206`, the GSD `frameworkInstallCommand`; warning text
  `"this command may access the network and execute npm package code"`). Attempts are recorded to a
  lock file (`writeLock` / `mergeFrameworkInstallAttempts`).
- **Constraint:** `aof planning init` should follow this dry-run-then-boundary pattern rather than
  invent a new one; the boundary warning should say *plugin/marketplace code execution* (not "npm
  package code"). The provenance manifest is the planning-layer analogue of the GSD lock file.
- **Source:** `C:\Source\umair\aof\src\cli.mjs:1176-1206`, `:1186-1194`.

---

## Assumptions to confirm

<!-- CI-testable vs live-only (the latter become @manual / @uat checks). -->

**CI-testable (`@executable`)**

- **A1 — pm-skills is an MIT Claude Code marketplace named `pm-skills` v2.0.0 with the 9 expected
  plugins.** Confirm by fetching `.claude-plugin/marketplace.json` (or a vendored snapshot) and
  asserting `name`, `version`, `owner`, and the plugin-name set. Testable in CI: **yes** (parse the
  JSON; offline if vendored).
- **A2 — `aof planning init --dry-run` emits the correct command verbs.** Assert the printed plan
  uses `claude plugin marketplace add https://github.com/phuryn/pm-skills.git#v2.0.0` (HTTPS git URL
  pinned to the **release tag** — not the SSH-cloning `owner/repo@<sha>` shorthand (Correction F1) and
  not a `#<sha>` fragment, which is not a clonable ref (Correction F2)) and `claude plugin install
  <plugin>@pm-skills` (verb `install`, marketplace name `pm-skills`), for the recommended plugin set,
  with no network call. Testable in CI: **yes** (string assertions on dry-run output).
- **A3 — the provenance manifest records `{ source, marketplaceVersion, ref, sha, plugins }`: the
  `ref` is the tag actually passed to `marketplace add` (`v2.0.0`) and the `sha` is the resolved
  40-char commit that tag points at, not a branch name.** Testable in CI: **yes** (manifest-shape +
  sha-regex assertion; sha may be injected/fixtured to keep CI offline).
- **A4 — `shatter`'s PRD discovery glob.** Pin the exact discovery pattern as a unit test against
  fixture files: a `PRD-foo.md` at root (skill convention) MUST be found; decide and assert behavior
  for a non-prefixed / non-root PRD (the `/write-prd` command case). Testable in CI: **yes**.
- **A5 — vendored snapshot (if adopted) passes `claude plugin validate`.** Testable in CI: **yes** if
  `claude` is available on the runner; otherwise a JSON-schema check is the offline fallback.

**Live-only / developer-run (`@manual`) and human (`@uat`)**

- **A6 — `claude plugin marketplace add https://github.com/phuryn/pm-skills.git#v2.0.0` succeeds
  non-interactively and registers the marketplace at the tagged commit.** Requires a live `claude` +
  network. `@manual` (agent/dev-run). **Corrections:** F1 (2026-06-18) moved this from the
  `owner/repo@<sha>` shorthand (SSH-clones, fails HTTPS-only auth) to the HTTPS git URL `#ref` form;
  F2 (2026-06-19) moved the fragment from `#<40-hex-sha>` (a bare sha is not a clonable ref — the live
  run failed with `Could not find remote branch …`) to the **release tag** `#v2.0.0`. Verify the
  registered ref via `claude plugin marketplace list --json` and cross-check that `v2.0.0` resolves
  to the recorded commit via `git ls-remote … refs/tags/v2.0.0 'refs/tags/v2.0.0^{}'`.
- **A7 — `claude plugin install pm-execution@pm-skills` (etc.) succeeds headlessly and the plugin
  appears enabled** (cache under `~/.claude/plugins/cache/...`, `enabledPlugins` entry). `@manual`.
- **A8 — Codex path.** Confirm whether the chosen Codex story (register-marketplace-only vs nothing)
  actually works on the target Codex version; the per-plugin install verb is **absent** on
  codex-cli 0.130.0, so this is version-sensitive. Also confirm Codex's `@ref`/`--ref` rejects a bare
  sha the same way Claude does (the §4/§5 F2 cross-reference is inferred for Codex, not yet
  live-tested). `@manual`, re-verify per Codex release.
- **A9 — End-to-end PRD lands as `PRD-*.md` discoverable by `shatter`.** Run the `create-prd` skill in
  a live session and confirm the output filename/location actually satisfies `shatter`'s glob. This is
  the seam's real proof and is agent/judgment-dependent → **`@uat`** (human confirms the produced PRD
  is well-formed and discovered).
