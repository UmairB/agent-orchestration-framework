---
name: aof-board-milestone-bridge
description: Bind and sync AOF GSD boards after a GSD milestone roadmap is created. Use when a GSD roadmapper or milestone workflow has just written .planning/ROADMAP.md and .planning/STATE.md for an AOF project that may have pending .aof/boards GSD milestone attachments.
---

# AOF Board Milestone Bridge

Version: 1.0.0

This is an internal project skill for GSD `agent_skills` injection only. Do not
register it as an AOF renderable resource or install it into `.codex/skills` or
`.claude/skills`.

After creating or updating a GSD milestone roadmap for AOF:

1. Confirm `.planning/ROADMAP.md` and `.planning/STATE.md` have been written.
2. Run the bridge helper from the repository root:

```bash
node .aof/skills/aof-board-milestone-bridge/scripts/attach-and-sync.mjs
```

The helper reads the current milestone from `.planning/STATE.md`, finds a pending
GSD-backed board in `.aof/boards`, then runs:

```bash
node bin/aof.mjs boards milestone attach <board-id> --milestone <milestone-id> --roadmap .planning/ROADMAP.md
node bin/aof.mjs boards sync <board-id> --milestone <milestone-id>
```

Selection rules:

- If exactly one pending GSD board exists, bind and sync it.
- If multiple pending GSD boards exist, do not guess. Report the helper output and the manual command it prints.
- If no pending GSD board exists, treat the bridge as a no-op and continue.
- If the helper fails, surface its stderr/stdout exactly enough for the user to act; do not edit board JSON by hand.

For explicit routing, run:

```bash
node .aof/skills/aof-board-milestone-bridge/scripts/attach-and-sync.mjs --board <board-id>
```

