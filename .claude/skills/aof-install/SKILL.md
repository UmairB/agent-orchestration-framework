---
name: aof-install
description: The commands to install or refresh the ACD bundle in a repo — `aof work init` vs `aof work update`, what --force means on each, and how to get the rendering aof current first. Load when asked how to init, update, refresh, reinstall, or upgrade aof in a repo, why a bundle change didn't land, or what drift-warning / notInitialized / guarded mean.
---

# Installing & updating aof in a repo

Two layers. The bundle a repo receives is only as new as the `aof` that renders it,
so a stale binary makes step 2 a silent no-op.

## Layer 1 — make the rendering aof current

| Node | Command |
|---|---|
| Windows control node (this machine) | `node scripts/install-local.mjs --skip-ui` from the aof source repo |
| WSL worker | `node scripts/install-local.mjs --wsl --skip-ui` |
| Mac worker (`umairs-mac-mini`) | `git pull` in `~/Source/personal/agent-orchestration-framework` (npm symlink) |

Verify at the source — never assume the deploy landed:

```
~/.aof/bin/aof.exe --version        # 0.1.0 (payload <buildId>); "embedded" = fallback, didn't land
```

No daemon restart is needed for this: `work init`/`work update` are plain file renders
(`workspace: false`), not daemon paths. See `.claude/rules/build-deploy-restart.md` for
when `--sea` / `--desktop` / a restart *are* required.

## Layer 2 — render into the target repo

```
cd <repo>
aof work update --dry-run     # classify: create / update / skip / drift-warning / delete
aof work update               # apply; files you edited are PRESERVED
aof work update --force       # apply; files you edited are OVERWRITTEN
```

## Which verb

| Situation | Command |
|---|---|
| Repo has never had the bundle | `aof work init` |
| Deliver a new bundle release, keep local edits | `aof work update` |
| Deliver it and clobber local edits | `aof work update --force` |
| Change runtimes, or repair a broken/mismatched install | `aof work init --runtime claude,codex --force` |

**`aof work update --force` is the "fully current" verb.** It is the only one that prunes.

## `--force` means different things on each

### `update --force`
Overrides the drift guard. Without it, a managed file whose on-disk hash diverges from
`.aof/aof.lock.json` classifies `drift-warning` and is **kept** — so a bugfix to that file
never lands. `src/render-plan.mjs:38-46`.

### `init --force`
Not a stronger update — a different tool. It does two things:

1. Bypasses the first-install guard (`src/work-init.mjs:73`), which otherwise refuses when
   the lock already has a `work` section.
2. Re-renders from scratch: init **always** passes `previousLock = null`
   (`src/work-init.mjs:97`), so nothing is compared against the manifest.

That second point has two consequences worth knowing before reaching for it:

- **The delete pass never runs.** Stale members — files an older bundle release shipped and
  the current one dropped — are found only by iterating prior lock entries
  (`src/render-plan.mjs:51`). init sees none, leaves them on disk, and writes a fresh manifest
  that no longer lists them. They are orphaned and unmanaged from then on.
- **Drift protection is skipped, not overridden.** Both drift branches require a `prior` entry,
  so every existing file falls through to the ungated `update` at `src/render-plan.mjs:48` —
  overwritten with no warning, `--force` or not. That is TECH_DEBT item 9. (`.claude/settings.json`
  is now exempt via the m43 surgical merge in `src/claude-settings.mjs`; the wider class is open.)

Always `--dry-run` an `init --force` first.

## Flags

`aof work init [dir] [--dry-run] [--runtime claude,codex] [--force] [--with-headroom] [--json]`
`aof work update [dir] [--dry-run] [--force] [--json]`

- Both default `dir` to cwd and `--runtime` to `claude`.
- `--with-headroom` is **init-only** — it enables the headroom block in `.aof/aof.config.json`.
  A plain `work init` writes no config at all (it renders the bundle + lock).
- `--json` returns the structured outcome; the exit code gates refusals (1 on `guarded` /
  `notInitialized`).

## Gotchas

- **Runtimes are pinned at install.** `update` re-renders only the runtimes recorded in the
  manifest (`src/work-update.mjs:94`). Adding codex to an existing install is
  `aof work init --runtime claude,codex --force`, not update.
- **`notInitialized`** — no `work` section in `.aof/aof.lock.json`. Run `aof work init` first.
- **`guarded`** — a `work` section already exists. You almost certainly want `update`, not
  `init --force`.
- **Three verticals share one lock.** `work update` touches only the `work` section; the flat
  asset fields and the `planning` section are preserved by read-merge-write. If the repo also
  uses assets, `aof assets apply` is a separate refresh.
- **`aof init` ≠ `aof work init`.** The top-level verb scaffolds the workspace config + install
  lock (`src/commands/project-init.mjs`); it does not render the bundle.
- **A bundle change isn't shipped until it's rendered.** A new/changed `src/bundle/` member
  reaches a repo only through `work update` — and only after layer 1 put it in the payload.

## Verifying it landed

```
aof work update --dry-run     # a clean install reports every member "skip"
```

Anything still classified `update` or `drift-warning` after an apply means it was preserved,
not delivered.
