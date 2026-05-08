# Phase 13: Code-Bearing Asset Files - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 13-Code-Bearing Asset Files
**Areas discussed:** File Declaration, Runtime Shape, Validation, Rendering And Lock Ownership

---

## File Declaration

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit `files` array | Resource manifest lists associated files relative to the asset directory. | yes |
| Implicit directory scan | AOF copies every file under the asset directory except known body/override files. | |
| Hybrid scan with ignore file | AOF scans by default and supports ignore patterns. | |

**Selected outcome:** Use explicit `files`.
**Notes:** This keeps `aof.config.json` canonical and avoids publishing accidental drafts or secrets.

---

## Runtime Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Skills only | Render associated files only for directory-shaped skill outputs. | yes |
| All resource kinds | Try to render files for agents, rules, commands, and skills. | |
| Runtime-specific support matrix | Render associated files wherever an individual runtime supports directories. | |

**Selected outcome:** Start with skills.
**Notes:** Current Claude/Codex skill outputs are directories. Agents, commands, and rules are currently single-file or merged outputs.

---

## Validation Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Reject escapes and missing files | Validate relative paths, existence, regular files, and asset-directory containment. | yes |
| Warn on unsafe files | Let rendering continue with warnings. | |
| Trust manifest paths | Assume listed paths are safe and let filesystem errors surface during apply. | |

**Selected outcome:** Reject unsafe associated files during validation.
**Notes:** Code-bearing files can affect assistant behavior, so unsafe paths should fail before render writes.

---

## Rendering And Lock Ownership

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse render-plan outputs | Associated files become normal desired outputs with content, hash, path, and resource metadata. | yes |
| Separate copier after render | Copy helper files after markdown rendering. | |
| Copy only during apply, not sync dry-run | Simpler, but dry-run and lock previews would be incomplete. | |

**Selected outcome:** Reuse render-plan outputs.
**Notes:** This preserves drift protection, dry-run previews, conflict detection, and lock ownership.

---

## the agent's Discretion

- Exact output metadata field names.
- Whether helper file content is read in the adapter layer or a smaller resolver/helper.
- Whether local skills receive the same associated-file support as global skills if that avoids duplicate code.

## Deferred Ideas

- Implicit helper discovery.
- Binary files.
- Associated files on agents/rules/commands.
- Setup UI file management.
- Project overrides for global associated files.

