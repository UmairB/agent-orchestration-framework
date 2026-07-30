---
description: Ship + review a branch — commit & push in logical (per-story) batches, open a PR, run architect review with conditional security/compliance lenses, comment issues, fix them via the developer, and (with --auto-complete) squash-merge once checks are green.
argument-hint: "[item ref] [--auto-complete]"
allowed-tools: [Read, Grep, Glob, Bash, Edit, Write, Task, SlashCommand]
---
<objective>
Take built work from branch to merged: commit & push what's outstanding, open a PR, review it
(structural + conditional security/compliance + craft), drive the issues to resolution through the
developer, and — only when explicitly opted in — complete the PR once CI is green.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`, `work.codeReview.autoComplete` (default
`false`). Parse "$ARGUMENTS": an optional **item ref** (scope the PR/review to a milestone or story;
default = the whole branch) and the **`--auto-complete`** flag.

- **auto-complete is ON** if the flag is present **OR** `work.codeReview.autoComplete` is `true`.
- Pre-flight: `gh auth status` must be authenticated and the branch must have a remote. **Never run
  on the default branch** — if `HEAD` is `main`, stop and tell the user to branch first.
</config>

<process>
1. **Commit & push.** Inspect `git status` + `git diff` (and unpushed commits). Stage and commit
   anything outstanding in **logical batches** — prefer **one commit per story**: its `work.dir`
   docs plus the code that implements it. A change set that spans stories or maps to none (shared
   config, infra, tooling) becomes its own logical commit (`chore(config): …`). **Never `git add -A`**
   — stage each batch's paths explicitly; use conventional-commit messages. Then `git push` (set
   upstream on first push). If nothing is outstanding and the branch is pushed, skip.

2. **Open the PR.** If a PR already exists for the branch, reuse it; else `gh pr create` against the
   repo's default base, with a title and a body that summarises the stories shipped, links the
   milestone, and lists `@executable` coverage (write the body via a heredoc/`--body-file`, never a
   fragile inline string). Capture the PR number/URL; `gh pr view --web` to open it.

3. **Review.** Spawn `aof-architect` (Task) on the PR diff (`gh pr diff` / changed files) for
   structural conformance to the ADRs/fitness functions.

   **Surface the PR-impact blast-radius as ranking context (advisory).** Run unconditionally (a silent
   no-op when graphify is absent): when handing the diff to `aof-architect`, first build the codebase graph
   fresh — `aof graph build .` (the project root; read back the `builtAt`/`egress`/counts so
   freshness is visible) — then run **`aof graph impact <the files changed in the diff>`**. It returns,
   deterministically, each changed file's **dependents** (`imported/called by ←` — the blast-radius: who
   breaks if this changes) and **dependencies**. Rank the review by that blast-radius — review the changed
   files with the most dependents first. (You MAY also run `aof graph triage` for graphify's own
   PR-impact queue as a secondary, fuzzier signal; `graph impact` on the actual diff is the exact one.)
   Graphify extraction replaces the single project graph; never target a package or `src` subtree,
   because doing so evicts every file outside that subtree.
   The agent **READS** the structured impact as advisory context. **Advisory only:** the impact is ranking context for the
   reviewer; it is **never** an auto-block input to the merge — the merge gate (step 6: CI-green +
   no-blocking-finding) is **unchanged**, and any concern the rank raises flows through the normal
   human/agent-judged finding path, never a separate graph-gate (no wiring into
   `work.codeReview.autoComplete`). If `aof graph build`/`triage` returns the structured `graphify-missing`
   miss, note the graph is unavailable and review unranked exactly as before — no block, no crash, no noise.

   Its verdict also flags surfaces:
   - **attack surface** (auth, secrets, tenant isolation, untrusted input, crypto) → spawn
     `aof-security` → it reviews against / authors `SECURITY.md`.
   - **regulated or personal data** (PII, payments, tenant data crossing a boundary) → spawn
     `aof-compliance` → it reviews against / authors `COMPLIANCE.md`.
   Both are **conditional** — skip the one whose surface is absent. Also run a **craft pass**
   (`@executable` suite + fitness functions + lint/typecheck as a local pre-flight, plus an
   adversarial read for untested-path bugs). Behavioural sign-off is `aof:verify`'s job — don't
   duplicate QA here. Collect findings typed + severity'd with `file:line`.

4. **Comment.** Post each finding to the PR with `gh pr comment` (group by lens: structural /
   security / compliance / craft; line-level via `gh api …/pulls/{n}/comments` where a `file:line` is
   exact). A clean lens posts a one-line "✓ no issues".

5. **Fix loop.** For each **blocking** finding, spawn `aof-developer` (the executor) to fix **within
   the locked contract** — code + `@executable` step defs only; if a scenario itself is wrong, stop
   and flag it, don't edit it. Commit the fixes (`fix: …`, referencing `@finding-<id>`), push,
   re-run only the affected lens, and resolve the PR comment. Repeat until **no blocking finding is
   open**. Non-blockers are noted on the PR and deferred to the backlog.

6. **Complete (gated).** **Only if auto-complete is ON:** wait for CI (`gh pr checks --watch`) and
   require **all green** AND no blocking finding open, then `gh pr merge --squash --delete-branch`.
   **If auto-complete is OFF** (default): stop with the PR open, report the URL + the review summary,
   and leave the merge to the human.
</process>

<progress_tracking>
- Record the PR URL in the milestone `STATE.md` (the PO is its single writer — note it there).
- This command does not set item `status` — build/review status is `aof:continue`'s and acceptance is
  `aof:verify`'s. A merge here is shipping the branch, not accepting the milestone.
- `SECURITY.md` / `COMPLIANCE.md` are created **only** when their surface is present (conditional;
  absence is information). Bump `updated:` on any record you touch.
</progress_tracking>

<output>
Report: the commit batches pushed, the PR URL, each review lens's verdict + findings (with routing),
the fixes applied, the CI status, and whether the PR was completed or left open for the human.
Next: `aof:verify <ref>` to accept the milestone.
</output>
