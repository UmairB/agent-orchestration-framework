// src/claude-trust.mjs — the ONE writer of claude's folder-TRUST fact.
//
// Extracted from mesh-worker-execution.mjs (2026-07-26) so BOTH spawn paths can share
// it: the mesh worker's per-assignment worktree AND the board's own local terminal.
// mesh-worker-execution.mjs already imports terminal-ws.mjs (for the node-pty spawn
// factory), so terminal-ws.mjs importing it back would be a cycle — this leaf module
// is the seam neither side has to reach through the other for. mesh-worker-execution
// re-exports it, so every existing importer is unchanged.
import os from "node:os";
import path from "node:path";
import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// ensureWorktreeTrusted(cwd, options) — milestone 38 / story 05 fix (live two-machine
// soak 2026-07-25, VERIFICATION F24). claude shows a one-time "Do you trust the files
// in this folder?" dialog the FIRST time it runs in a directory, and that dialog fires
// BEFORE it reads the system prompt — so a fresh per-assignment worktree HANGS the
// autonomous run forever with no human at the worker to accept it (measured: the run
// sat in `running`, no session, no transcript, nothing for the story-06 terminal view
// to bind to). Pre-write the SAME fact the dialog would set —
// projects[<absolute path>].hasTrustDialogAccepted — into the user's ~/.claude.json
// BEFORE the spawn, so the dialog never appears. This is the TRUST gate only; the
// session still runs in `--permission-mode auto`, so a genuine tool pause still
// surfaces as NEEDS_INPUT for a human. Trust is a per-machine, per-ABSOLUTE-PATH LOCAL
// fact (never repo-committable — a repo cannot declare itself trusted), keyed by the
// exact cwd, so EACH distinct cwd must be trusted individually. BEST-EFFORT: a missing
// / locked / malformed ~/.claude.json is swallowed and claude falls back to its own
// (blocking) dialog exactly as before — this never throws.
export async function ensureWorktreeTrusted(worktreeCwd, options = {}) {
  if (typeof worktreeCwd !== "string" || worktreeCwd.length === 0) return;
  const home = options.homedir ?? os.homedir();
  const cfgPath = path.join(home, ".claude.json");
  try {
    const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
    cfg.projects = cfg.projects ?? {};
    if (cfg.projects[worktreeCwd]?.hasTrustDialogAccepted === true) return; // already trusted — no rewrite
    cfg.projects[worktreeCwd] = { ...(cfg.projects[worktreeCwd] ?? {}), hasTrustDialogAccepted: true };
    // temp-then-rename so a crash mid-write can never truncate the user's real config.
    const tmp = `${cfgPath}.aof-trust-${randomUUID()}`;
    await writeFile(tmp, JSON.stringify(cfg, null, 2));
    await rename(tmp, cfgPath);
  } catch {
    // best-effort — leave claude's own dialog in place (the pre-fix behavior).
  }
}
