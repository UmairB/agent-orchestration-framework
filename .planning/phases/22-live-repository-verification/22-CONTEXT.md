# Phase 22: Live Repository Verification - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 22 proves the final v1.4 namespaced CLI contract against real repository workflows. It should use live new-repo and existing-repo scenarios to find rough edges that BDD did not expose, then either fix concrete issues with regression coverage or document future product work.

This phase is verification and hardening, not another command taxonomy redesign.

</domain>

<decisions>
## Implementation Decisions

### Live Test Scope
- **D-01:** Test against two repo shapes: a new empty repo with no `.aof`, and an existing/live repo through a disposable copy or worktree.
- **D-02:** Keep live writes contained with temporary `AOF_GLOBAL_HOME`, temporary `AOF_DATA_DIR`, and disposable repository directories.
- **D-03:** Run dry-runs before writes where the command supports it.
- **D-04:** Do not run real networked package install during live verification; use `aof packages install gsd --dry-run`.

### Command Coverage
- **D-05:** Cover the final accepted command surface: `init`, `assets`, `packages`, and `project`.
- **D-06:** Cover rejected legacy commands: `add`, `apply`, `sync`, `clean`, `global`, `install`, `validate`, `doctor`, `migrate`, `config`, and `catalog`.
- **D-07:** Verify README examples and CLI help match the final command surface.

### UI Verification
- **D-08:** Start `aof assets ui` and verify the local URL loads.
- **D-09:** Verify setup UI APIs can read/write project/global config in the disposable test environment.
- **D-10:** Keep UI apply/install execution out of scope.
- **D-10a:** UI runtime targeting and runtime override editing must be visually distinct concepts.

### Findings Policy
- **D-11:** Fix concrete live-test bugs in Phase 22 and add regression BDD.
- **D-12:** If live testing finds only docs/help wording gaps, update README/help.
- **D-13:** If a finding is future product work, record it as deferred rather than expanding v1.4.

### Live Finding: Interactive Body Prompt
- **D-14:** Interactive `aof assets add skill` must not ask users to type markdown or long-form asset bodies in the console.
- **D-15:** Interactive asset creation should collect only terminal-appropriate metadata: asset id, description, and runtimes.
- **D-16:** Interactive asset creation should scaffold a draft/template body and direct users to edit the asset in `aof assets ui` or their editor.
- **D-17:** Future body input should be explicit, non-interactive, and better suited to files, for example a later `--from-file` option; do not add that unless deliberately planned.

### Live Finding: UI Runtime Override Selector
- **D-17a:** The setup UI must not show runtime body overrides as peer checkboxes in the Runtimes target selector.
- **D-17b:** Runtime target rows should represent only target runtimes such as Claude Code and Codex.
- **D-17c:** Runtime overrides should appear as explicit edit controls or sections, likely disabled or hidden unless the corresponding runtime is targeted.
- **D-17d:** Remove `native` badges from runtime checkbox rows unless there is a real mixed capability state to communicate.

### Milestone Closeout
- **D-18:** Run full verification: unit, Node BDD, PowerShell BDD, smoke, UI build, `npm test`, and `npm run check`.
- **D-19:** Mark HARD-01 through HARD-04 complete only after live verification and final docs/help alignment.
- **D-20:** Produce v1.4 milestone audit/archive artifacts.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Completed Namespace Phases
- `.planning/phases/18-command-contract-audit/18-CLI-CONTRACT.md`
- `.planning/phases/18-command-contract-audit/18-BDD-CONTRACT.md`
- `.planning/phases/19-assets-namespace-rewrite/19-VERIFICATION.md`
- `.planning/phases/20-packages-namespace-rewrite/20-VERIFICATION.md`
- `.planning/phases/21-project-and-diagnostics-commands/21-VERIFICATION.md`

### Project Planning
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md` - HARD-01 through HARD-04 requirements.
- `.planning/ROADMAP.md` - Phase 22 goal and success criteria.
- `.planning/STATE.md`

### Codebase Maps
- `.planning/codebase/STRUCTURE.md`
- `.planning/codebase/CONVENTIONS.md`
- `.planning/codebase/INTEGRATIONS.md`

</canonical_refs>

<code_context>
## Existing Code Insights

- `src/cli.mjs` owns command routing and interactive asset creation.
- `src/prompt.mjs` owns prompt wording and body collection for asset creation.
- `src/scaffold.mjs` can already create template/draft asset files.
- `test/integration/features/lifecycle.feature` covers interactive asset creation and should receive regression coverage for no console body prompt.
- `test/integration/cli.ps1` must preserve PowerShell parity for user-visible BDD behavior.
- `ui/src/main.tsx` owns the setup UI asset form and runtime/override controls.
- `src/setup-ui.mjs` exposes setup UI capabilities and config payloads used by the frontend.

</code_context>

<live_findings>
## Findings Captured During Discussion

### LF-01: Interactive asset creation asks for markdown/body content in the console

**Observed:** In a live repo, `aof assets add skill` prompts:

```text
Starter skill instructions (optional; press Enter to create a template and edit it later)
```

**Problem:** Even with the "press Enter" escape hatch, this invites users to type long-form markdown in a terminal. That is the wrong UX for AOF asset bodies.

**Expected:** Interactive CLI should only collect metadata that fits terminal entry: id, description, and runtimes. It should then scaffold the asset file and tell the user to edit it in `aof assets ui` or their editor.

**Likely fix:** Ensure interactive `assets add` paths pass `skipBody: true` or otherwise suppress body prompts. Keep generated template content. Add BDD coverage proving the body prompt is absent in interactive creation output.

### LF-02: Setup UI conflates runtime targets and runtime overrides

**Observed:** In the setup UI Runtimes section, four checkbox rows appear:

```text
Claude Code              native
Codex                    native
Claude Code override     native
Codex override           native
```

**Problem:** The first two are runtime targets. The override rows are not runtimes; they are optional per-runtime asset body/editing concepts. Showing them as peer checkboxes is confusing, and the repeated `native` badges add noise without communicating a meaningful state.

**Expected:** The Runtimes selector should only show target runtimes. Runtime-specific overrides should be separate edit controls or sections, tied to the selected runtime. The `native` badge should be removed from these checkbox rows unless it represents a real capability distinction.

**Likely fix:** Split target runtime selection from runtime override editing in the setup UI. Add UI/API or component tests proving override controls are not rendered as runtime target checkboxes.

### LF-03: Setup UI asset cards are visually noisy

**Observed:** Asset cards can wrap ids awkwardly, such as `clear-` on one line and `cosmos` on the next, while prominent `project` and repeated `native` badges dominate the card.

**Problem:** The card layout is harder to scan than it needs to be. Scope/runtime metadata should not compete with the asset title and description.

**Expected:** Asset cards should keep the id readable, use calmer description styling, keep metadata compact, and remove repeated `native` badges unless they communicate a real exception.

**Likely fix:** Redesign the asset list/card layout in the setup UI and add regression coverage or UAT screenshot checks for long-ish ids and metadata.

### LF-04: `aof assets apply` normal output is too technical

**Observed:** Live apply output prints lines such as:

```text
create: .codex\skills\clear-cosmos\SKILL.md runtime=codex source=skill:clear-cosmos reason=file does not exist
```

**Problem:** Normal successful output reads like debug logging. Routine reasons such as `file does not exist` add no value to users.

**Expected:** Normal output should use friendly action-oriented wording, such as `Created ...` and `Updated .aof/aof.lock.json`. Dry-run output should say `Would create ...`. Technical runtime/source/reason details should move to verbose or JSON output.

**Likely fix:** Revise apply action formatting for normal and dry-run output, keep warnings/errors explicit, and add BDD coverage for non-technical normal output.

### LF-05: Generated `.claude` and `.codex` outputs should be ignored by default

**Observed:** `aof assets apply` generates runtime-specific outputs under `.claude/` and `.codex/`, which duplicate source-of-truth assets in `.aof/`.

**Problem:** Generated outputs create git noise and may encourage editing generated runtime files instead of `.aof` source assets.

**Expected:** AOF should help projects ignore generated runtime output by default while preserving an escape hatch for intentionally tracked runtime files.

**Likely fix:** Design a generated-output ignore strategy. The proposed approach is a `.gitignore` inside generated runtime folders, such as `*` plus `!.gitignore`, so generated contents are ignored by default and users can still force-add intentional files. The phase should decide whether whole-folder ignores or AOF-owned subpath ignores are the right v1.4 behavior.

</live_findings>

<deferred>
## Deferred Ideas

- UI-driven apply/install execution.
- Hosted catalog or registry-backed discovery.
- `--from-file` or equivalent explicit file import for asset bodies.

</deferred>

---

*Phase: 22-Live Repository Verification*
*Context gathered: 2026-05-11*
