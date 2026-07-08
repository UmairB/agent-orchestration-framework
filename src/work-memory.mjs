// `aof work memory <verb>` — the memory SEAM (milestone 05, story 00).
//
// This module owns the agent-facing verb surface (recall / brief / ingest /
// reindex / status), argv + scope-flag parsing, backend SELECTION from config,
// and the --json-vs-text rendering of a RecallResult. It calls a backend ONLY
// through the frozen interface { name, recall, reindex, status } (ADR-003);
// the backend owns the data.
//
// Frozen contracts honoured here:
//   ADR-002  selection lives at config.memory?.backend (read in ONE place below),
//            absent memory ≡ "none".
//   ADR-003  three interface methods {recall, reindex, status}; `brief` is
//            COMPOSED over backend.recall, `ingest` is an ALIAS of reindex —
//            neither is an interface method.
//   ADR-004  recall returns { query, scope, records[], text }; the CLI prints
//            `text` by default and the structured `records` array under --json.

import noneBackend from "./memory/none-backend.mjs";

// The verb spine the seam exposes (ADR-003). `brief`/`ingest` are conveniences
// composed over the spine, not interface methods.
export const MEMORY_VERBS = ["recall", "brief", "ingest", "reindex", "status"];

// Scope flags are first-class filters (ADR-006) that parse into the `scope`
// object handed to the backend. `--limit` is an OPTION (parses into `opts`,
// never `scope`). `--json` selects the output projection.
const SCOPE_FLAGS = ["area", "stage", "kind", "owner", "item"];

// The backend registry: name -> a loader returning the backend module's default
// export (the frozen-interface object). `none` is the real no-op backend this
// seam owns; `local` is loaded LAZILY so the seam never imports the local module
// unless a project actually selects it (the glue module is wired at integration).
// ADR-002's "read in one place" invariant: config.memory?.backend is read ONLY in
// `selectBackendName` below — the registry maps the already-resolved name.
export const BACKEND_REGISTRY = {
  none: () => noneBackend,
  local: () => import("./memory/local-backend.mjs").then((m) => m.default),
  // `graphify` (milestone 10) is loaded LAZILY too — the seam never imports the
  // graphify backend (nor, transitively, the command core it reaches graphify
  // through) unless a project actually selects it. Same one-line registration as
  // `local`; selection still happens only in `selectBackendName` above (ADR-002).
  graphify: () => import("./memory/graphify-backend.mjs").then((m) => m.default)
};

// The ONE place config.memory?.backend is read (ADR-002 invariant). Absent memory
// (or absent backend) is equivalent to "none".
export function selectBackendName(config) {
  return config?.memory?.backend ?? "none";
}

// Resolve the configured backend through a registry. Async because `local` is a
// lazy dynamic import. Tests inject a `registry` override so they can register an
// in-memory stub under any name (e.g. "local") WITHOUT the real module existing.
export async function resolveConfiguredBackend(config, registry = BACKEND_REGISTRY) {
  const name = selectBackendName(config);
  const loader = registry[name];
  if (!loader) {
    throw new Error(`Unknown memory backend "${name}". Registered: ${Object.keys(registry).join(", ")}.`);
  }
  return loader();
}

// ----------------------------------------------------------------- argv ----

// Parse `aof work memory <verb> [query] [<ref>] [--scope-flags] [--limit N] [--json]`.
//   recall/brief : a free-text query string (first positional).
//   ingest/reindex : an optional milestone ref (e.g. "01"); `--all` / `--item NN`
//                    also name the scope of the rebuild (mapped to `only`).
// Returns { verb, query, only, scope, opts, json }.
export function parseMemoryArgv(argv) {
  const positionals = [];
  const scope = {};
  const opts = {};
  let json = false;
  let block = false;
  let all = false;
  let itemFlag;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey;

    if (key === "json") {
      json = true;
      continue;
    }
    if (key === "block") {
      // The read-hook injection projection (recall): render the compact block the
      // command pastes into agent context. A flag, like --json; mirrors its handling.
      block = true;
      continue;
    }
    if (key === "all") {
      all = true;
      continue;
    }
    if (key === "limit") {
      const value = inlineValue ?? argv[++i];
      const n = Number.parseInt(value, 10);
      // Only a positive integer is a valid limit. A missing / non-numeric / zero /
      // negative value falls back to the backend default (rankRecords' DEFAULT_LIMIT)
      // rather than silently truncating to 0 (`slice(0, "abc")` → []) or dropping the
      // lowest-ranked record (`slice(0, -1)`).
      if (Number.isFinite(n) && n > 0) opts.limit = n;
      continue;
    }
    if (SCOPE_FLAGS.includes(key)) {
      const value = inlineValue ?? argv[++i];
      if (value === undefined) continue; // a trailing flag with no value sets nothing
      if (key === "item") itemFlag = value;
      else scope[key] = value;
      continue;
    }
    // Unknown flags are ignored by the seam (the verb gate is what rejects bad
    // input); record nothing.
  }

  // `--item` is a first-class scope filter for recall AND the rebuild scope for
  // reindex/ingest; it always lands on scope.item.
  if (itemFlag !== undefined) scope.item = itemFlag;

  const [verb, ...restPositionals] = positionals;
  const query = restPositionals.join(" ");

  // For reindex/ingest the first non-verb positional (or --item / --all) is the
  // milestone ref to scope the rebuild; `--all` (whole stream) maps to null.
  const only = all ? null : (scope.item ?? restPositionals[0] ?? null);

  return { verb, query, only, scope, opts, json, block };
}

// --------------------------------------------------- injection block render ----

// The default cap for an injected recall block (the read-hook limit): how many
// records a command pastes into agent context before it floods. A caller may
// override per-hook via `--limit`.
export const HOOK_LIMIT = 5;

// A PURE render of a RecallResult (ADR-004 { query, scope, records[], text }) into
// the compact injection block a read hook (refine/continue) pastes into agent
// context — the ONE new mechanical surface story 03 adds (the seam owns rendering,
// ADR-004). It consumes the frozen RecallResult; it adds no backend method.
//
// Shape: one line PER record (already scope-filtered + highest-score-first by
// recall), capped at `limit` (default HOOK_LIMIT), each line exactly:
//   `${id} (m${item}) · ${kind || recordType} · ${area} · ${title} · ${source}`
// joined by "\n" with a trailing "\n". `kind || recordType` so an adr (whose
// `kind` is "") shows "adr" while a lesson shows its kind (e.g. "near-miss"). The
// id field carries its milestone (`(m<item>)`) — ids COLLIDE across milestones
// (`R1`, `ADR-002` recur every milestone), so a bare id leaves an agent unable to
// tell which milestone a lesson came from without parsing the source path; the
// `m<item>` qualifier (the same provenance the human text view keeps) makes the
// "we already learned this" signal scannable. `item` is always present (ADR-005).
//
// An EMPTY recall renders an EMPTY block — "" (never a "none" placeholder): the
// caller omits it from context entirely. So `block lines === records` holds
// exactly: no header, no score, the block IS the record lines in recall's order.
export function renderRecallBlock(recallResult, { limit } = {}) {
  const records = (recallResult?.records ?? []).slice(0, limit ?? HOOK_LIMIT);
  if (records.length === 0) return "";
  const lines = records.map((record) => {
    const id = record.item ? `${record.id} (m${record.item})` : record.id;
    return `${id} · ${record.kind || record.recordType} · ${record.area} · ${record.title} · ${record.source}`;
  });
  return lines.join("\n") + "\n";
}

// --------------------------------------------------------------- render ----

// The default human renderer (text projection). recall prints the RecallResult's
// pre-rendered `text` view (ADR-004); status/reindex render a short line. When a
// read hook asks for the injection block (`--block`, recall + non-json), recall
// renders `renderRecallBlock` instead — printed ONLY when non-empty (an empty
// recall injects nothing). `--json` still wins (the records-array contract).
function defaultRender(verb, result, { json, block, limit }, log) {
  if (json) {
    // ADR-004: under --json, recall emits the structured `records` array (the
    // contract), never the rendered text blob. brief emits its digest (sans the
    // rendered text projection); reindex/ingest emit the build summary WITHOUT the
    // full records dump (the index was just written to disk — re-emitting it is noise).
    if (verb === "recall") {
      log(JSON.stringify(result.records, null, 2));
    } else if (verb === "brief") {
      const { text, ...digest } = result;
      log(JSON.stringify(digest, null, 2));
    } else if (verb === "reindex" || verb === "ingest") {
      const { records, ...summary } = result;
      log(JSON.stringify(summary, null, 2));
    } else {
      log(JSON.stringify(result, null, 2));
    }
    return;
  }

  if (verb === "recall" && block) {
    // The read-hook injection block (compact, bounded). An EMPTY recall renders an
    // EMPTY block — print NOTHING (no blank line); the command injects nothing.
    const rendered = renderRecallBlock(result, { limit });
    if (rendered) log(rendered);
    return;
  }
  if (verb === "recall" || verb === "brief") {
    // Print the pre-rendered text view (recall: a projection of records; brief: the
    // lesson/adr digest).
    log(result.text ?? "");
    return;
  }
  if (verb === "status") {
    log(`memory: backend=${result.backend} records=${result.recordCount}`);
    return;
  }
  if (verb === "reindex" || verb === "ingest") {
    log(`reindex: ${result.recordCount} record(s)`);
    return;
  }
  log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------- brief ----

// brief's seam-side digest (ADR-003 composition + ADR-007 shape): the lesson/adr
// split plus a lessons-by-area map, derived from the records `recall` returns.
// Backend-agnostic — the seam owns rendering, so every backend gets the same
// digest without reimplementing it (and the frozen interface stays at 4 methods).
export function briefDigest(records = [], scope = {}) {
  const lessons = records.filter((record) => record.recordType === "lesson");
  const adrs = records.filter((record) => record.recordType === "adr");

  const lessonsByArea = {};
  for (const lesson of lessons) {
    const area = lesson.area || "";
    (lessonsByArea[area] ||= []).push({
      id: lesson.id,
      item: lesson.item,
      title: lesson.title,
      summary: lesson.summary ?? ""
    });
  }

  const digest = {
    scope,
    lessonCount: lessons.length,
    adrCount: adrs.length,
    lessonsByArea,
    text: ""
  };
  digest.text = renderBriefDigest(digest);
  return digest;
}

function renderBriefDigest(digest) {
  const where = digest.scope?.item ? ` · milestone ${digest.scope.item}` : " · whole stream";
  const lines = [`memory brief${where}`, `  ${digest.lessonCount} lesson(s), ${digest.adrCount} adr(s)`];
  const areas = Object.keys(digest.lessonsByArea);
  if (areas.length > 0) {
    lines.push("  lessons by area:");
    for (const area of areas) {
      const ids = digest.lessonsByArea[area].map((lesson) => lesson.id).join(", ");
      lines.push(`    ${area || "(unspecified)"}: ${ids}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

// --------------------------------------------------------------- usage ----

export function memoryUsage() {
  return [
    "Usage: aof work memory <verb> [args] [--area --stage --kind --owner --item NN] [--limit N] [--json]",
    "",
    `Verbs: ${MEMORY_VERBS.join(", ")}`,
    "  recall <query>     recall prior lessons/ADRs matching a query (scoped by flags)",
    "  brief              a situational digest (composed over recall)",
    "  ingest [ref]       (re)build the memory index — alias of reindex",
    "  reindex [ref]      rebuild the derived memory index from the work stream",
    "  status             report the active backend and record count"
  ].join("\n");
}

// ------------------------------------------------------------- dispatch ----

// The verb-dispatch CORE. Pure of process/filesystem concerns: it takes an
// already-parsed config (for backend selection), a `resolveBackend(config)`
// function (so tests inject a stub registry), a `render` projection, a `log`
// sink, and the `ctx` the backend receives. Returns { ok, exitCode }.
//
// Routing (ADR-003):
//   recall  -> backend.recall(query, scope, opts, ctx)
//   brief   -> backend.recall(...)  COMPOSED (no `brief` interface method)
//   reindex -> backend.reindex(only, ctx)
//   ingest  -> backend.reindex(only, ctx)  ALIAS (no `ingest` interface method)
//   status  -> backend.status(ctx)
//   unknown / missing verb -> print usage, exit non-zero, invoke NO backend method.
export async function runMemory(argv, { config, resolveBackend, render = defaultRender, log = console.log, ctx = {} } = {}) {
  // --help/-h is a GUARD that prints usage and returns WITHOUT resolving or reaching a
  // backend. Checked FIRST, before parsing/verb-gating: ingest/reindex start the record
  // rebuild AND spawn the graph build the instant they route, so `... memory ingest
  // --help` must never do real work (before this guard it dropped straight into the
  // rebuild — the reason `--help` itself hung).
  if (argv.includes("--help") || argv.includes("-h")) {
    log(memoryUsage());
    return { ok: true, exitCode: 0 };
  }

  const { verb, query, only, scope, opts, json, block } = parseMemoryArgv(argv);

  if (!verb || !MEMORY_VERBS.includes(verb)) {
    // Gate BEFORE resolving/invoking any backend method.
    const errLog = (line) => console.error(line);
    if (verb) errLog(`Unknown memory verb "${verb}".`);
    else errLog("Missing memory verb.");
    errLog("");
    errLog(memoryUsage());
    return { ok: false, exitCode: 1 };
  }

  const backend = await resolveBackend(config);

  let result;
  if (verb === "recall") {
    result = await backend.recall(query, scope, opts, ctx);
  } else if (verb === "brief") {
    // brief is COMPOSED over recall (ADR-003): it reaches backend.recall (no
    // `brief` interface method), pulling the scope-filtered records (item scope
    // only, unlimited), then derives the lesson/adr digest SEAM-SIDE. The digest is
    // backend-agnostic (every backend yields MemoryRecords), so the seam owns this
    // rendering — honouring "brief is a seam composition" without a 4th method.
    const briefScope = scope.item ? { item: scope.item } : {};
    const recalled = await backend.recall("", briefScope, { limit: Infinity }, ctx);
    result = briefDigest(recalled.records ?? [], briefScope);
  } else if (verb === "reindex" || verb === "ingest") {
    // ingest is an ALIAS of reindex (ADR-003, FINDINGS §4): same interface method.
    result = await backend.reindex(only, ctx);
  } else if (verb === "status") {
    result = await backend.status(ctx);
  }

  render(verb, result, { json, block, limit: opts.limit }, log);
  return { ok: true, exitCode: 0, result };
}

// ----------------------------------------------------------- CLI wrapper ----

// The thin CLI entry the `aof work memory ...` command calls. Builds `ctx` from
// loadWorkspace (configMemory = config.memory ?? {}), resolves the configured
// backend through the real registry, and delegates to `runMemory`. Sets
// process.exitCode non-zero on an unknown/missing verb.
export async function workMemoryCommand(argv, { loadWorkspace } = {}) {
  // Lazy-load loadWorkspace so this module stays import-light for tests.
  const load = loadWorkspace ?? (await import("./work.mjs")).loadWorkspace;
  // `--config` may select an explicit config path (same convention as other
  // work subcommands); pull it out without disturbing memory argv parsing.
  const explicitConfig = explicitConfigFrom(argv);
  const { config, workDir, projectRoot } = await load(process.cwd(), explicitConfig);
  const ctx = { workDir, projectRoot, configMemory: config?.memory ?? {} };

  const outcome = await runMemory(stripConfigFlag(argv), {
    config,
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx
  });

  if (!outcome.ok) process.exitCode = outcome.exitCode || 1;
  return outcome;
}

// `--config <path>` / `--config=<path>` extraction (mirrors parseOptions).
function explicitConfigFrom(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") return argv[i + 1];
    if (arg.startsWith("--config=")) return arg.slice("--config=".length);
  }
  return undefined;
}

function stripConfigFlag(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      i += 1; // skip its value
      continue;
    }
    if (arg.startsWith("--config=")) continue;
    out.push(arg);
  }
  return out;
}
