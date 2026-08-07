#!/usr/bin/env node
// aof-generated: bundle — this file is installed by `aof work init` / `aof work update`
// as a content-hashed, drift-protected bundle ASSET. Edit it in aof's own bundle, not
// here; a local edit is reported as drift exactly like any other bundled file.
//
// aof artifact-sync ENQUEUE — the PostToolUse hook body (milestone 43 / ADR-001).
//
// It DERIVES NOTHING ABOUT THE WORKSPACE. Read stdin, look the path field up in an
// explicit per-tool map, append ONE NDJSON line to the queue beside this script, exit
// 0. It opens no store, imports nothing from src/, boots no CLI, loads no workspace and
// computes NO WORKSPACE IDENTITY — the last is not incidental: a cwd-derived identity
// (TECH_DEBT item 4) is what silently discarded 100% of the worker->control frames for
// days.
//
// THE QUEUE IS DERIVED FROM THIS SCRIPT'S OWN INSTALLED LOCATION (ADR-013/C2, which
// SUPERSEDES ADR-001's "a queue file whose absolute path was stamped into its argv at
// hook-install time"). `.claude/settings.json` is a TRACKED file and a `git worktree`
// inherits it verbatim, so an install-time absolute path in the entry names ANOTHER
// checkout's queue — and, worse, another checkout's SCRIPT, which makes `node` itself
// exit non-zero before this file's "exit 0, always" can apply. The entry therefore
// carries `${CLAUDE_PROJECT_DIR}/.claude/hooks/aof/<this>` — a token the HARNESS
// substitutes into the argv at spawn time, so `process.argv[1]` is THIS checkout's
// script (correct in a worktree too), and the queue is a fixed walk from it:
// `<root>/.claude/hooks/aof/<this>` -> `<root>/.aof/`. No cwd derivation, and no
// absolute path written into a tracked file.
//
// A bare checkout-relative path was tried FIRST and is wrong: the harness spawns hooks
// with the session's persisted shell cwd, NOT the project directory, so after any `cd`
// the path missed and node exited MODULE_NOT_FOUND — a NON-blocking hook error, i.e. a
// silent no-op (measured 2026-08-06: 37 misses across real installs). This script still
// reads nothing but `process.argv[1]`; the token is resolved before it ever runs, so the
// derivation-free property (ADR-001) is untouched.
// ADR-001's "the queue destination is an ARGUMENT, never a derivation" survives intact:
// its subject was workspace IDENTITY, not path composition (ADR-013/C2 says so).
//
// EXIT 0, ALWAYS. `PostToolUse` cannot block — the tool already ran — so a non-zero
// exit would only ever show the model an error about a sync it never asked for. A queue
// that cannot be written degrades to the reconciliation tick, which is the pre-existing
// behaviour: never worse than today.
//
// THE PATH FIELD IS PER-TOOL, MEASURED (RESEARCH §1.2): `Write`/`Edit` carry
// `tool_input.file_path`; `NotebookEdit` carries `tool_input.notebook_path`. A hook
// keyed only on `file_path` silently misses every notebook edit, and silence here is
// the exact failure mode being engineered out — so a MATCHED tool whose mapped field is
// absent enqueues a coded `unresolved-path` line rather than dropping the event, and
// the drain reports it as a degrade.
//
// The path is carried VERBATIM as the payload delivered it. Resolving a relative path
// to an absolute one would itself be a cwd derivation; canonicalisation is the drain's
// job, deliberately.
import { closeSync, fstatSync, openSync, readFileSync, readSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

const TOOL_PATH_FIELDS = { Write: "file_path", Edit: "file_path", NotebookEdit: "notebook_path" };

// `<root>/.claude/hooks/aof/artifact-sync-enqueue.mjs` -> `<root>/.aof/artifact-sync-queue.ndjson`.
// The relative walk is the ONE thing this script knows about a layout, and it is the
// layout of its own installed home.
function queuePathFromScript(scriptPath) {
  if (typeof scriptPath !== "string" || scriptPath.length === 0) return null;
  const root = dirname(dirname(dirname(dirname(scriptPath))));
  return join(root, ".aof", "artifact-sync-queue.ndjson");
}

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    // An absent or malformed payload names no tool, so there is nothing to enqueue.
    // The harness's contract is not aof's to police (the in-repo precedent,
    // .claude/hooks/aof/guard-test-isolation.mjs, exits 0 on both).
    return null;
  }
}

function lineFor(payload) {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const tool = payload.tool_name;
  if (typeof tool !== "string") return null;
  const field = Object.prototype.hasOwnProperty.call(TOOL_PATH_FIELDS, tool) ? TOOL_PATH_FIELDS[tool] : null;
  if (field == null) return null; // an unmatched tool: the map has no entry, nothing is appended
  const input = payload.tool_input;
  const value = input == null || typeof input !== "object" ? undefined : input[field];
  if (typeof value !== "string" || value.length === 0) {
    return JSON.stringify({ tool, code: "unresolved-path" });
  }
  return JSON.stringify({ tool, path: value });
}

const queuePath = queuePathFromScript(process.argv[1]);
const line = lineFor(readPayload());
if (queuePath != null && line != null) {
  try {
    // ONE append-mode write per event, and the record is separated from whatever the
    // file already ends with. The separator is not decoration: a run killed mid-write
    // leaves a TORN final line with no newline, and appending straight onto it would
    // splice the new record into the wreckage — losing the artifact it names AND making
    // the torn line unrecoverable. Reading one byte of the queue is not a derivation.
    // The check-then-write window is harmless under concurrency: O_APPEND still puts
    // the write at the end, so the worst case is a blank line, never a spliced record.
    //
    // The descriptor is closed on the SUCCESS path only (ADR-013/C5): a `finally` with
    // its own catch would be a SECOND runtime silence in the one file forbidden from
    // reporting — one the detector cannot see — so the pinned count of 1 would be a
    // number that understates its subject. On the failure path this process exits
    // within milliseconds and the OS closes the descriptor.
    const fd = openSync(queuePath, "a+");
    const size = fstatSync(fd).size;
    let prefix = "";
    if (size > 0) {
      const tail = Buffer.alloc(1);
      readSync(fd, tail, 0, 1, size - 1);
      if (tail[0] !== 0x0a) prefix = "\n";
    }
    writeSync(fd, `${prefix}${line}\n`);
    closeSync(fd);
  } catch {
    // THE ONE SANCTIONED SILENCE IN THIS REPO'S HOOK LAYER, and it is a decision, not an
    // oversight (m42 item 3 / `acd-no-new-silent-catch` carries it as a pinned,
    // shrink-only baseline entry of exactly 1, and ADR-013/C5 ruled that the count must
    // be TRUE). The queue destination is unwritable — an absent parent, a directory
    // where a file belongs, a full disk, a read-only ACL. Every channel this process
    // could report on is closed to it by contract: it may not import aof's degrade sink
    // (it must derive NOTHING, `acd-artifact-sync-hook-derivation-free`), it must write
    // nothing on stdout, and it must exit 0 because `PostToolUse` cannot block. The
    // COMPENSATING CONTROL is architectural: the daemon's reconciliation tick still
    // converges every artifact, so a run with an unwritable queue is never worse than
    // today.
  }
}
