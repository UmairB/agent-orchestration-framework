# Phase 22 UAT Log: Live Repository Verification

**Started:** 2026-05-11
**Status:** Active

## Scope

UAT is validating the v1.4 namespaced CLI and setup UI against live repository usage, especially places where the workflow feels wrong despite automated BDD passing.

## Findings

### UAT-01: CLI asks for markdown/body content during interactive asset creation

**Status:** Fixed
**Severity:** High UX friction
**Source:** Live repo test of `aof assets add skill`

**Observed:**

```text
Starter skill instructions (optional; press Enter to create a template and edit it later)
```

**Why this is wrong:**

The interactive CLI should not ask users to type markdown or long-form skill instructions in a terminal.

**Expected:**

The interactive CLI should ask only for:

- asset id
- description
- target runtimes

Then it should scaffold a draft asset file and tell the user to edit it in `aof assets ui` or their editor.

**Planned fix:**

Suppress interactive body prompts for `aof assets add ...`. Keep draft/template file creation. Add BDD regression coverage that interactive asset creation does not print body/instructions prompts.

**Resolution:**

Interactive asset creation now suppresses body prompts and scaffolds template content. BDD covers the absence of starter body prompts.

---

### UAT-02: UI Runtimes section shows override rows as runtime checkboxes with `native` badges

**Status:** Fixed
**Severity:** Medium UX confusion
**Source:** Setup UI live review

**Observed:**

The setup UI Runtimes section shows:

- `Claude Code` with `native`
- `Codex` with `native`
- `Claude Code override` with `native`
- `Codex override` with `native`

**Why this is wrong:**

Runtime targets and runtime-specific overrides are different concepts. Overrides are not runtimes and should not appear as peer checkboxes. The repeated `native` badges add noise because they do not communicate a useful distinction in this view.

**Expected:**

The Runtimes selector should show only target runtimes:

- Claude Code
- Codex

Runtime-specific overrides should appear as separate edit controls or sections, likely tied to the selected runtime. Remove `native` badges from runtime checkbox rows unless there is a real mixed capability state.

**Planned fix:**

Split target runtime selection from runtime override editing in the setup UI. Add regression coverage that override controls are not rendered as runtime target checkboxes.

**Resolution:**

The setup UI now shows target runtimes separately from runtime overrides, and override rows no longer display capability badges as peer runtime selector content.

---

### UAT-03: Asset card layout is visually noisy and wraps ids badly

**Status:** Fixed
**Severity:** Medium UX polish
**Source:** Setup UI live review

**Observed:**

An asset card renders the id as:

```text
clear-
cosmos
```

with multiple prominent badges such as `project`, `native`, and `native`.

**Why this is wrong:**

The card is hard to scan. The asset id wraps awkwardly, badges dominate the layout, and repeated `native` badges do not communicate useful information.

**Expected:**

Asset cards should use a cleaner operational layout:

- keep the asset id on one line where possible, with sensible truncation or wrapping
- show description below the title with calmer styling
- keep scope/runtime metadata compact and secondary
- remove repeated `native` badges unless they communicate a real exception
- prefer dense list-row/card behavior over decorative card emphasis

**Planned fix:**

Redesign setup UI asset cards for clearer scanning and less noisy metadata. Add UI regression coverage or screenshot/UAT verification for long-ish ids and metadata display.

**Resolution:**

Asset cards now keep ids in a single-line truncated title, show runtime targets as secondary text, and remove repeated runtime capability badges from the card chrome.

---

### UAT-04: `aof assets apply` output is too technical for normal use

**Status:** Fixed
**Severity:** High UX friction
**Source:** Live repo test of `aof assets apply`

**Observed:**

```text
create: .claude\skills\clear-cosmos\SKILL.md runtime=claude source=skill:clear-cosmos reason=file does not exist
create: .codex\skills\clear-cosmos\SKILL.md runtime=codex source=skill:clear-cosmos reason=file does not exist
lock: C:\Source\voice-vox\voice-vox-company-portal\.aof\aof.lock.json
```

**Why this is wrong:**

Normal CLI output exposes implementation details and noisy reasons such as `file does not exist`. The action succeeded, but the output reads like debug logging.

**Expected:**

Normal output should be friendly and action-oriented, for example:

```text
Applied assets

✓ Created .claude/skills/clear-cosmos/SKILL.md
✓ Created .codex/skills/clear-cosmos/SKILL.md
✓ Updated .aof/aof.lock.json
```

Dry-run output should use future-tense wording such as `Would create ...`.

Technical metadata such as runtime, source, and reason should move to `--verbose` or JSON output. Warnings and errors should remain explicit and prominent.

**Planned fix:**

Revise normal `assets apply` and dry-run output. Suppress routine create reasons, use friendly verbs, preserve paths, keep warnings/errors visible, and add regression BDD for non-technical normal output.

**Resolution:**

`aof assets apply` now prints concise Created/Updated/Removed output by default, keeps technical action metadata behind `--verbose`, and dry-run uses `Would create/update` wording.

---

### UAT-05: Generated runtime outputs should be ignored by default

**Status:** Fixed
**Severity:** Medium repository hygiene
**Source:** Live repo test after `aof assets apply`

**Observed:**

`aof assets apply` generates runtime-specific files under folders such as:

- `.claude/`
- `.codex/`

These files duplicate source-of-truth assets already stored in `.aof/`.

**Why this is wrong:**

Generated runtime outputs create git noise and can encourage users to edit generated files instead of editing `.aof` source assets. The source of truth should remain `.aof/`; `.claude/` and `.codex/` are render targets.

**Expected:**

AOF should help projects ignore generated runtime output by default while still allowing users to intentionally track specific hand-owned runtime files.

One likely approach is to generate runtime-folder `.gitignore` files, for example:

```gitignore
*
!.gitignore
```

inside AOF-managed runtime output folders. Users can still intentionally track a file with `git add -f`, and already tracked files remain tracked by Git.

**Open design detail:**

Decide whether to ignore the whole runtime folders or only AOF-owned generated subpaths. Whole-folder ignores are simpler and match the “generated output” model, but they may hide manually created runtime files unless users know to force-add them. Scoped ignores are friendlier to mixed ownership but harder to keep complete as render targets expand.

**Planned fix:**

Design and implement a generated-output ignore strategy during Phase 22. Add live/BDD coverage that apply creates or preserves the expected ignore rules without clobbering user-owned tracked files.

**Resolution:**

AOF now generates `.gitignore` files in runtime output folders when those folders receive generated files. The generated rule ignores folder contents by default while preserving `.gitignore`.

---

### UAT-06: Commands need additional files without path-heavy UI

**Status:** Fixed
**Severity:** Medium asset authoring gap
**Source:** Setup UI live review of command authoring

**Observed:**

Command assets could edit only the primary command prompt. Additional/helper files were available only for global skills, and the UI asked for path-like values.

**Why this is wrong:**

Commands can need companion scripts, templates, examples, or other support files. Users should not have to think in internal storage paths while creating those files through the UI.

**Expected:**

Command assets should support additional files. In the setup UI, users should provide a filename and body; AOF should store the file under the asset's own `files/` folder.

**Resolution:**

Skills and commands now support associated files as a flat filename list. Filename-only UI/API input is stored under `.aof/assets/<kind>/<id>/files/<name>` and recorded in config as `files: ["<name>"]`. Nested associated-file paths are rejected for now. Command files render into runtime script folders such as `.claude/scripts/<id>/run.ps1` and `.codex/scripts/<id>/run.ps1`.

Skill/command markdown can use `{{files.<name>}}` placeholders. AOF replaces those placeholders with runtime-specific generated paths during render. Placeholders are intentionally flat: `{{files.run.py}}` is valid, while `{{files.scripts/run.py}}` is rejected. Validation also scans explicit generated support-file references such as `.claude/scripts/convert-files/run.ps1` or `.codex/skills/research/files/search.py` and reports `invalid-associated-file-reference` when they do not match declared files.

---

### UAT-07: Command frontmatter needs first-class runtime metadata

**Status:** Open
**Severity:** High command fidelity
**Source:** Live review of a real Claude command with `argument-hint` and `allowed-tools`

**Observed:**

Real Claude commands can include frontmatter fields such as:

- `name`
- `description`
- `argument-hint`
- `allowed-tools`

The current command renderer owns the generated frontmatter and does not provide first-class fields for all command metadata.

**Why this is wrong:**

Command source must be able to express runtime-native command metadata without forcing users to paste full runtime-specific frontmatter into the body or rely on lossy rendering.

**Expected:**

AOF command assets should model command metadata explicitly and render it correctly per runtime. Runtime-only metadata should either be adapter-aware or live in runtime overrides.

**Planned fix:**

Design and implement a command metadata model before declaring command authoring complete. Include BDD/unit coverage for Claude command metadata such as `argument-hint` and `allowed-tools`.

## Notes

- These findings are concrete Phase 22 hardening items, not future product ideas.
- Implementation should happen during `$gsd-execute-phase 22` after planning.
