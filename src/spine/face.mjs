// src/spine/face.mjs — the ONE generic CLI face (m42 wave (d) leg d1;
// PRD-command-spine-effects-ledger). The end state this file exists for:
// cli.mjs shrinks to argv → route table → THIS face — no more per-verb face
// copies, no more hand-maintained *_FLAGS sets, no global boolean allow-list.
//
// A migrated command declares its whole CLI surface on itself:
//   cli: {
//     route: ["work", "doc"],          // its argv words — the route table key
//     spec: {
//       usage: "aof work doc <ref> <DOC> [--json]",
//       flags: { … per-command flag vocabulary … },   // see parseSpecArgv
//       workspace: false,              // opt OUT of loadWorkspace (default in)
//     },
//     argv, render, json,              // the existing adapter contract
//   }
//
// One error envelope + exit-code policy (the runVerbCli discipline, now THE
// policy): under --json a command failure is EXACTLY ONE structured
// { ok:false, error, code } document on stdout + exit 1; without --json the
// error propagates to bin/aof.mjs (stderr + exit 1). console.log lives HERE —
// commands return data, faces print.
//
// The face is also the CLI half of the d2 drain contract: after every routed
// invoke it sweeps the effects journal for locally-reachable steps any process
// (this one or a crashed predecessor) left pending — a crashed process leaves
// pending events, not lost cascades.
import { existsSync } from "node:fs";
import { invoke, listCommands, loadWorkspace } from "../command-core.mjs";
import { commandError } from "../command-error.mjs";
import { effectsJournalPath, openEffectsJournal } from "../effects/journal.mjs";
import { drainEffects } from "../effects/dispatch.mjs";
import { reportDegrade } from "../degrade.mjs";

// Every command's face vocabulary includes these without redeclaring them:
// --json (the machine face) and --config <path> (explicit config resolution).
export const BASE_FLAGS = Object.freeze({
  json: Object.freeze({ type: "boolean", description: "emit the command result as JSON" }),
  config: Object.freeze({ type: "string", description: "explicit aof config path" }),
});

// parseSpecArgv — per-command flag parsing driven by the command's OWN spec
// (retires parseOptions' global boolean allow-list for migrated verbs). Flags
// are declared camelCased ({ dryRun: { type: "boolean" } } ⇒ --dry-run);
// `--flag=value` and `--flag value` both bind string flags. An undeclared flag
// is a LOUD coded refusal — a typo'd flag can no longer silently become a
// stringly option.
export function parseSpecArgv(args, spec = {}, commandId = "") {
  const flags = { ...BASE_FLAGS, ...(spec.flags ?? {}) };
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== "string" || !arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const flag = flags[key];
    if (!flag) {
      throw commandError(
        `Unknown flag "--${rawKey}"${commandId ? ` for ${commandId}` : ""}.${usageSuffix(spec)}`,
        "unknown-flag",
        400,
      );
    }
    if (flag.type === "boolean") {
      options[key] = true;
      continue;
    }
    const value = inlineValue ?? args[++index];
    if (value === undefined) {
      throw commandError(`Flag "--${rawKey}" requires a value.${usageSuffix(spec)}`, "missing-flag-value", 400);
    }
    options[key] = value;
  }
  return options;
}

function usageSuffix(spec) {
  return spec?.usage ? `\n\nUsage: ${spec.usage}` : "";
}

// deriveRouteTable — the route table IS the registry (never a hand-kept ladder):
// every command carrying cli.route contributes its words as a key. A collision
// is a programmer error and throws at derivation, so two commands can never
// silently shadow one another.
export function deriveRouteTable(commands = listCommands()) {
  const table = new Map();
  for (const command of commands) {
    const route = command.cli?.route;
    if (!Array.isArray(route) || route.length === 0) continue;
    const key = route.join(" ");
    if (table.has(key)) {
      throw new Error(`Route collision: "${key}" is claimed by both "${table.get(key).id}" and "${command.id}".`);
    }
    table.set(key, command);
  }
  return table;
}

// resolveRoute — longest-prefix match of argv words (flags never participate).
// Returns { command, rest } or null (null ⇒ the caller falls through to the
// legacy ladder while the migration is in flight).
export function resolveRoute(argv, commands = listCommands()) {
  const table = deriveRouteTable(commands);
  if (table.size === 0) return null;
  let maxWords = 0;
  for (const key of table.keys()) maxWords = Math.max(maxWords, key.split(" ").length);
  const words = [];
  for (const token of argv) {
    if (typeof token !== "string" || token.startsWith("--")) break;
    words.push(token);
    if (words.length >= maxWords) break;
  }
  for (let length = words.length; length > 0; length -= 1) {
    const command = table.get(words.slice(0, length).join(" "));
    if (command) return { command, rest: argv.slice(length) };
  }
  return null;
}

// runCommandFace — the one door's one face: spec-parse → (loadWorkspace) →
// invoke → render/--json, then the effects sweep. Faces are transport; every
// decision lives in the command.
export async function runCommandFace(command, args) {
  const cli = command.cli ?? {};
  const spec = cli.spec ?? {};

  // Honour --json from the RAW argv before spec-parsing (m42 wave (d) leg d1,
  // wave 3 — the meshVerbCli precedent, now THE policy): a refused flag must
  // not swallow the operator's --json, so even a spec-parse refusal is ONE
  // structured envelope on stdout when --json was asked for.
  const wantsJson = args.some((arg) => arg === "--json" || (typeof arg === "string" && arg.startsWith("--json=")));
  let options;
  try {
    options = parseSpecArgv(args, spec, command.id);
  } catch (error) {
    if (!wantsJson) throw error;
    emitJsonErrorEnvelope(error);
    return;
  }
  const faceCtx = { positionals: options._, options };

  // m42 wave (d) leg d1 (wave-3 tail) — THE LAUNCHER SEAM. A command whose real
  // body is a long-lived foreground process declares cli.launch(options): null ⇒
  // not launcher mode (fall through to the probe/invoke path below); a function ⇒
  // the launcher body, awaited until the process ends. The probe rule is FACE
  // POLICY, checked before the seam is even consulted: --json NEVER launches —
  // every launcher verb's machine face is its non-blocking registered run, so no
  // bijection spawn-probe can hang on a serve. cli.argv still runs first (the
  // positional discipline + input shaping govern BOTH doors); the body owns its
  // workspace posture, announce lines, friendly coded refusals and shutdown, and
  // the face never sweeps effects behind it (a daemon owns its own drain).
  if (options.json !== true && typeof cli.launch === "function") {
    const body = cli.launch(options);
    if (body != null) {
      const input = await cli.argv(options._, options);
      await body(input, faceCtx);
      return;
    }
  }

  if (options.json === true) {
    try {
      const result = await performInvoke(command, options);
      console.log(JSON.stringify(cli.json(result, faceCtx), null, 2));
      applyExitAdapter(cli, result, faceCtx);
    } catch (error) {
      emitJsonErrorEnvelope(error);
    }
    await sweepPendingEffects();
    return;
  }

  // Non-json: render the result; a command error propagates to bin/aof.mjs
  // (stderr + non-zero exit) — today's contract, unchanged.
  const result = await performInvoke(command, options);
  console.log(cli.render(result, faceCtx));
  applyExitAdapter(cli, result, faceCtx);
  await sweepPendingEffects();
}

// EXACTLY ONE structured document on stdout — success or failure — so every
// `aof … --json` is parseable without sniffing stderr. A coded refusal that carries
// STRUCTURE keeps it in the envelope, through ONE channel: `error.detail`.
function emitJsonErrorEnvelope(error) {
  console.log(JSON.stringify({
    ok: false,
    error: error.message,
    code: error.code ?? "error",
    ...structuredDetail(error),
  }, null, 2));
  process.exitCode = 1;
}

// The ONE structured-refusal channel. Two riders today: the insert family's
// confirm-required `{ shifted }` (ADR-004's never-deadlock guard — callers read the
// shift size without re-deriving it) and m43/ADR-003's item lock, whose five keys
// `{ itemRef, scopeRef, assignmentId, holderNode, state }` let a face render "42 is
// held by aof-wsl — refused" without parsing prose. One concept, one mechanism: a
// per-key special case here is how a face grows a second vocabulary. It is a plain
// object on `error.detail`, and it can never shadow the envelope's three contract keys.
function structuredDetail(error) {
  const detail = error?.detail;
  if (detail == null || typeof detail !== "object" || Array.isArray(detail)) return {};
  return Object.fromEntries(Object.entries(detail).filter(([key]) => key !== "ok" && key !== "error" && key !== "code"));
}

async function performInvoke(command, options) {
  const ctx = {};
  if (command.cli?.spec?.workspace !== false) {
    ctx.workspace = await loadWorkspace(await resolveWorkspaceRoot(options), options.config);
  }
  // argv adapters may be ASYNC: interactive verbs complete their missing
  // positionals by prompting (a face-side concern — prompting never lives in a
  // command's run, which other faces invoke headlessly).
  const input = await command.cli.argv(options._, options);
  return await invoke(command.id, input, ctx);
}

// m42 wave (b) item 4, re-homed with wave (d) wave 3 — CWD-INDEPENDENT workspace
// resolution for verbs that DECLARE a `workspace` flag (the mesh family): a path
// loads that workspace; a bare id resolves its registered projectRoot through
// the global descriptor store (the fleet's own registry) and refuses loudly when
// unknown — never a silent fall-through to the cwd. Commands that do not declare
// the flag are untouched (an undeclared --workspace is refused at spec-parse).
async function resolveWorkspaceRoot(options) {
  const requested = typeof options.workspace === "string" ? options.workspace.trim() : "";
  if (requested === "") return process.cwd();
  if (existsSync(requested)) return requested;
  const { openGlobalWorkProjectionStore } = await import("../global-work-store.mjs");
  let resolvedRoot = null;
  try {
    const store = await openGlobalWorkProjectionStore({});
    try {
      const row = store.db.prepare("SELECT project_root FROM global_workspace_descriptors WHERE workspace_id = ?").get(requested);
      resolvedRoot = row?.project_root ?? null;
    } finally {
      store.close?.();
    }
  } catch (error) {
    throw commandError(`Could not resolve --workspace "${requested}": ${error.message}`, "workspace-unresolvable");
  }
  if (resolvedRoot == null) {
    throw commandError(`Unknown workspace "${requested}" — not a path, and no registered workspace descriptor carries that id.`, "workspace-unknown");
  }
  return resolvedRoot;
}

// cli.exit(result, faceCtx) — the OPTIONAL exit-code adapter for verbs whose
// CLEAN run still gates (validate/doctor: findings → exit 1). faceCtx rides
// along for gates that read a FACE flag (work:doctor's --strict promotes warns
// to failures without changing the findings the run returns). The one
// exit-code policy stays here in the face: commands return data, the adapter
// maps data to a code, only the face touches process.exitCode.
function applyExitAdapter(cli, result, faceCtx) {
  if (typeof cli.exit !== "function") return;
  const code = cli.exit(result, faceCtx);
  if (Number.isInteger(code) && code !== 0) process.exitCode = code;
}

// The crash-recovery half of the CLI sync-drain: pay out anything the journal
// still owes for loci this process can reach. Read-only when nothing is owed
// (the journal file is only ever CREATED by a transition), bounded, and never
// allowed to fail the command it rides behind. Drained work is announced on
// stderr — stdout stays the command's single document.
async function sweepPendingEffects() {
  try {
    const databasePath = effectsJournalPath({ env: process.env });
    if (!existsSync(databasePath)) return;
    const journal = await openEffectsJournal({ env: process.env });
    try {
      const outcomes = await drainEffects({ journal, limit: 25 });
      const paid = outcomes.filter((outcome) => outcome.status === "done" || outcome.status === "failed");
      if (paid.length > 0) {
        console.error(`effects: drained ${paid.length} pending step(s) from the journal`);
      }
    } finally {
      journal.close();
    }
  } catch (error) {
    reportDegrade("effects-sweep", error);
  }
}
