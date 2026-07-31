// `aof work` — deterministic mechanics over an ACD work stream.
//
// The work stream is a tree of `NN_type_slug` folders. The folder NAME is the
// index: identity (number/type/slug) is parseable without opening a file, so
// resolution and listing never need to read content — that is the whole point
// of this module (it replaces the agent improvising `**/*.md` globs).
//
// Structure handled (the let-shield convention):
//   work/NN_milestone_slug/SPEC.md
//   work/NN_milestone_slug/stories/SS_story_slug/STORY.md
//   work/NN_milestone_slug/stories/SS_story_slug/tasks/*.feature
//   work/NN_uat_slug/SESSION.md          (an acceptance session over a span of delivery)
import path from "node:path";
import os from "node:os";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { findProjectConfig, globalMeshPaths, globalWorkspacePaths } from "./workspace.mjs";
import { readJson, writeText } from "./fs.mjs";
// milestone 33 / story 00 (ADR-004, F-3203) — the per-install identity hydration
// seam. sidecarPathFor is the ONE sidecar-path builder (never re-derived here);
// readSidecar is the ONE tolerant sidecar read (22/R2, shared with every other
// sidecar reader/writer in node-identity.mjs); sanitizeHostname + deriveNodeId are
// reused so the self-heal re-derive is the IDENTICAL precedence chain deriveNodeId
// itself uses, not a private re-derivation.
import { sidecarPathFor, readSidecar, sanitizeHostname, deriveNodeId, isDerivationOf } from "./node-identity.mjs";

// Work errors carry `.code`/`.status` (the command error contract) so a face maps
// them uniformly — matching src/command-error.mjs.
function workError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

// `uat` is a top-level acceptance session: like a milestone it sits in the
// stream, carries `depends`, and gates downstream work — but it groups no
// stories (it references existing scenarios, it delivers no new behaviour).
// `spike` and `chore` (milestone 37 / ADR-001) are two more top-level DRIVERS,
// admitted the SAME way: they sit at the stream root, carry `depends`, group
// no stories, and are themselves the actionable unit — see `isDriver` and the
// `nextWork` item-is-the-work branch below.
// Exported (milestone 41 / ADR-001) — the ONE minimal touch of this god-node
// the whole 41 milestone requires: src/work-reindex.mjs consumes this SAME
// identity regex (never a re-derived copy) so a renamed folder it produces is
// guaranteed parseable by every one of work.mjs's 36 dependents. The value is
// unchanged; only the export keyword is added.
export const ITEM_RE = /^(\d+)_(milestone|story|task|uat|spike|chore)_([a-z0-9-]+)$/;
const VALID_STATUS = new Set(["not-started", "in-progress", "blocked", "in-review", "done"]);
const UNIVERSAL_TAGS = new Set(["@executable", "@manual", "@uat", "@bug", "@wip"]);
const VERIFICATION_TAGS = new Set(["@executable", "@manual", "@uat"]);
const FINDING_TAG_RE = /^@finding-[A-Za-z0-9-]+$/;
const MILESTONE_TAG_RE = /^@milestone-\d+$/i;

const sameNum = (a, b) => Number.parseInt(a, 10) === Number.parseInt(b, 10);

// ---------------------------------------------------------------- config ----


function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergePlainObjects(base, overlay) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergePlainObjects(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

async function readGlobalMeshConfig(env) {
  const paths = globalWorkspacePaths({ env });
  try {
    const globalConfig = await readJson(paths.configPath);
    return isPlainObject(globalConfig?.mesh) ? globalConfig.mesh : {};
  } catch {
    return {};
  }
}

// milestone 33 / story 00 (ADR-004.5, F-3203) — the self-heal STEP, factored out of
// loadWorkspace so it is directly unit-testable over an injected sidecar object +
// current hostname (+ an optional takenIds roster for the collision-preserving
// scenario) without needing a full fixture project. Returns the (possibly healed)
// sidecar object; loadWorkspace calls this THEN persists+overlays. Fires when the
// sidecar is hostname-DERIVED (sidecar.derivedFrom is a string, sidecar.pinned is not
// true — an old pre-schema sidecar with NEITHER key is "unknown origin, never churned")
// AND EITHER (1) the CURRENT machine's sanitized hostname no longer matches the RECORDED
// DERIVATION hostname, sidecar.derivedFrom (the copied-.aof symptom) — compared against
// derivedFrom, NEVER the resolved nodeId: a collision-suffixed id (e.g.
// nodeId:"shared-host-c4f8", derivedFrom:"shared-host") would never equal its own bare
// sanitized stem, so comparing against nodeId would churn a stable, collision-resolved
// id on EVERY load (craft/architect review finding) — OR (2) the stored id is no longer
// a valid derivation of its own recorded host under CURRENT rules (F-3302: a
// derivation-rule change like the `.local` strip self-migrates), detected via
// isDerivationOf, which recognises the collision-suffixed form so a legitimate collision
// id is never churned. Re-derives via
// deriveNodeId itself — the SAME precedence/collision chain, the sidecar's OWN salt
// (so the install hash never churns) — and returns the sidecar merged with the healed
// { nodeId, derivedFrom }; every other case returns the sidecar UNCHANGED (byte-
// identical object reference is not guaranteed, but the persisted bytes are, because
// persistNodeId's own idempotence check short-circuits the write).
export async function healIdentitySidecar({ sidecar = {}, hostname, sidecarPath, takenIds = [] } = {}) {
  const isHostnameDerived = sidecar.pinned !== true && typeof sidecar.derivedFrom === "string";
  if (!isHostnameDerived) return sidecar; // pinned or unknown-origin — never churned.
  // Trigger 1 (the copied-.aof symptom): the CURRENT machine's sanitized hostname no
  // longer matches the RECORDED derivation host (compared derivedFrom-vs-hostname, never
  // the resolved nodeId — a collision-suffixed id never equals its own bare stem).
  const hostnameChanged = sanitizeHostname(hostname) !== sanitizeHostname(sidecar.derivedFrom);
  // Trigger 2 (F-3302 — a derivation-RULE change self-migrates): the stored id is no
  // longer a valid derivation of its OWN recorded host under current rules (e.g. a
  // pre-`.local`-strip `umairs-mac-mini-local`). isDerivationOf recognises the
  // collision-suffixed / empty-stem forms, so a legitimate collision id is NOT churned
  // (the craft/architect regression). Self-terminating: after the heal the id IS a valid
  // derivation, so a second load is a keep.
  const staleFormat = !isDerivationOf(sidecar.nodeId, sidecar.derivedFrom, sidecar.salt);
  if (!hostnameChanged && !staleFormat) {
    return sidecar; // still on the recorded derivation host with a valid-format id.
  }
  const healedId = await deriveNodeId({
    config: {}, // never a pinned config — a derived sidecar is re-derived fresh
    hostname,
    salt: sidecar.salt,
    takenIds,
    sidecarPath,
  });
  return { ...sidecar, nodeId: healedId, derivedFrom: hostname };
}

// milestone 33 / story 00 (ADR-004.3/.4/.5, F-3203) — loadWorkspace HYDRATES
// config.mesh.nodeId/salt from the git-ignored PER-INSTALL SIDECAR
// (.aof/mesh/identity.json) before returning, so every downstream config.mesh reader
// (mesh-relay.mjs, mesh-presence.mjs, issuance, lease, the mesh-gate) sees the
// per-install id with ZERO code change. PRECEDENCE: sidecar > committed-fallback >
// hostname-derive (hydration OVERLAYS; it never derives — a workspace with neither
// leaves config.mesh.nodeId absent, for a later deriveNodeId call to mint).
//
// THE ONE SANCTIONED LOAD-TIME WRITE (ADR-004.5 self-heal, task 03's carve-out): a
// sidecar whose id was HOSTNAME-DERIVED (sidecar.derivedFrom is a string, sidecar.pinned
// is not true) but whose CURRENT hostname no longer sanitizes to the same value as the
// sidecar's RECORDED derivation hostname (sidecar.derivedFrom — never the resolved
// nodeId, which may carry a collision suffix) — the copied-.aof symptom — re-derives
// from THIS machine's CURRENT hostname (via deriveNodeId itself, so the heal reuses
// the identical precedence/collision chain) and REWRITES the sidecar. Every OTHER load
// (no sidecar, a sidecar still on its recorded derivation host — collision suffix and
// all, an operator-PINNED sidecar, or an old pre-schema sidecar with neither
// derivedFrom nor pinned — "unknown origin, never churned") is a PURE READ: this is
// the ONLY exception to "loadWorkspace writes no file" (ADR-004.3), narrowly
// discriminated by the sidecar schema, never the common overlay path.
//
// `hostname` is the injectable current-hostname override (mirrors deriveNodeId's own
// injected-hostname seam) — production supplies os.hostname() when absent; tests drive
// the mismatch deterministically with two fixture strings.
export async function loadWorkspace(cwd = process.cwd(), explicitConfig, { hostname, env } = {}) {
  const configPath = await findProjectConfig(cwd, explicitConfig);
  let config = {};
  try {
    config = await readJson(configPath);
  } catch {
    config = {};
  }
  const configDir = path.dirname(configPath);
  const projectRoot = path.basename(configDir) === ".aof" ? path.dirname(configDir) : configDir;
  const workDir = path.resolve(projectRoot, config.work?.dir ?? "./wiki/work");
  // The .aof config-home dir. The mesh substrate anchors HERE (not under workDir):
  // mesh is aof config/runtime state — a cross-cutting, extensible concept (planning,
  // not only work) — so it lives beside aof's config/lock, git-tracked (28/verify
  // decision superseding 22/ADR-002+003's work-stream-co-location).
  const aofDir = path.basename(configDir) === ".aof" ? configDir : path.join(projectRoot, ".aof");

  const globalMeshConfig = await readGlobalMeshConfig(env);
  if (Object.keys(globalMeshConfig).length > 0) {
    const localMeshConfig = isPlainObject(config.mesh) ? config.mesh : {};
    config = { ...config, mesh: mergePlainObjects(globalMeshConfig, localMeshConfig) };
  }
  // The per-install identity (34/story 00) — read from the MACHINE-WIDE GLOBAL home
  // (globalMeshPaths().identityPath, honoring AOF_GLOBAL_HOME) so one identity is shared
  // by every workspace on this machine and the global work store keyed on nodeId is
  // coherent. Read via the ONE tolerant sidecar read (readSidecar, 22/R2) — an absent/
  // torn/malformed file degrades to {} and never crashes loadWorkspace. Back-compat: a
  // machine that has not migrated still carries a LEGACY per-workspace sidecar
  // (.aof/mesh/identity.json under aofDir); when the global identity is absent we read
  // that as a fallback (read-only — the migrate up to global is a `work doctor` action,
  // never a silent load-time write into the global home). Precedence: global > legacy
  // per-workspace sidecar > committed config.mesh > absent (a later deriveNodeId mints
  // to the global home).
  const globalMesh = globalMeshPaths({ env });
  const globalIdentityPath = globalMesh.identityPath;
  let sidecarPath = globalIdentityPath;
  let sidecar = await readSidecar(globalIdentityPath);
  if (!(typeof sidecar.nodeId === "string" && sidecar.nodeId.length > 0)) {
    const legacyPath = sidecarPathFor(aofDir);
    const legacy = await readSidecar(legacyPath);
    if (typeof legacy.nodeId === "string" && legacy.nodeId.length > 0) {
      sidecar = legacy;
      sidecarPath = legacyPath;
    }
  }

  // Self-heal (ADR-004.5) — see healIdentitySidecar's own header for the predicate;
  // this is the ONE sanctioned load-time identity write (task 03's carve-out from
  // "loadWorkspace writes no file"), narrowly discriminated by the sidecar schema, and
  // it rewrites WHICHEVER identity we read (the global home, or a legacy sidecar still
  // in place). On the common path — same machine, same hostname — it is a pure read.
  const currentHostname = typeof hostname === "string" ? hostname : os.hostname();
  sidecar = await healIdentitySidecar({ sidecar, hostname: currentHostname, sidecarPath });

  // Overlay the sidecar's identity onto config.mesh in the RETURNED object ONLY — a
  // pure in-memory merge, no further disk write here. Precedence: sidecar > committed
  // (already read into config above) > absent (a later deriveNodeId call mints it).
  // nodeId and salt are overlaid INDEPENDENTLY (craft/architect review finding): a
  // nodeId-only sidecar must NOT clobber a present committed config.mesh.salt with
  // undefined — each key's own precedence (sidecar > committed-fallback > absent)
  // holds regardless of whether the OTHER key is present in the sidecar.
  if (typeof sidecar.nodeId === "string" && sidecar.nodeId.length > 0) {
    const meshOverlay = { ...config.mesh, nodeId: sidecar.nodeId };
    if (typeof sidecar.salt === "string" && sidecar.salt.length > 0) {
      meshOverlay.salt = sidecar.salt;
    }
    config = { ...config, mesh: meshOverlay };
  }
  // The ADVERTISED ADDRESS override (2026-07-27, the `direct` fabric's identity leg) —
  // overlaid on its OWN precedence, deliberately NOT nested under the nodeId branch
  // above: `mesh.address` is machine reachability, not identity derivation, so a node
  // that pinned only an address must still get it. It is the ONE home for the override
  // (mesh-fabric's selfAddress reads config.mesh.address; mesh:identity publishes the
  // SAME value as the descriptor's `host`), so the two never drift.
  //
  // WHY it exists: on `direct` a peer is found by resolving its advertised host, and a
  // guest can INHERIT its host machine's name (a WSL2 distro defaults to the Windows
  // hostname — measured: both answer `Umairs-MSI`). Resolving that name from either
  // side returns the HOST, so without an explicit address the guest is unreachable and
  // its nodeId collides. `aof mesh identity --name <id> --address <ip>` breaks both.
  if (typeof sidecar.address === "string" && sidecar.address.length > 0) {
    config = { ...config, mesh: { ...config.mesh, address: sidecar.address } };
  }

  // Expose the MACHINE-WIDE identity write target (34/story 00) so every minting caller
  // (mesh:identity / mesh:heartbeat / the launcher) persists the id+salt to the SAME
  // global home this hydration read from — resolved with the SAME env, so a test that
  // injects AOF_GLOBAL_HOME through loadWorkspace gets a hermetic, machine-shared identity
  // for free. It is ALWAYS the global path (never the legacy sidecar); the legacy sidecar
  // is a read-only fallback here and is migrated up by `work doctor`, not by a mint.
  return { configPath, config, projectRoot, workDir, aofDir, identityPath: globalIdentityPath, globalMeshRoot: globalMesh.meshRoot };
}

async function readDirSafe(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------ discovery ----

// Enumerate items by folder name only — no file reads.
export async function listItems(workDir) {
  const items = [];
  for (const entry of await readDirSafe(workDir)) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(ITEM_RE);
    if (!match) continue;
    const [, number, type, slug] = match;
    const dir = path.join(workDir, entry.name);
    items.push({ number, type, slug, name: entry.name, dir, ref: number, parent: null });

    if (type === "milestone") {
      const storiesDir = path.join(dir, "stories");
      for (const child of await readDirSafe(storiesDir)) {
        if (!child.isDirectory()) continue;
        const sub = child.name.match(ITEM_RE);
        if (!sub) continue;
        const [, sNumber, sType, sSlug] = sub;
        items.push({
          number: sNumber,
          type: sType,
          slug: sSlug,
          name: child.name,
          dir: path.join(storiesDir, child.name),
          ref: `${number}/${sNumber}`,
          parent: number,
        });
      }
    }
  }
  return items;
}

// Resolve an item's record doc — the single file whose frontmatter carries the
// item's identity/status. For a milestone the flow is AOF.md-first: a milestone
// CONVERTED into aof (its pre-aof SPEC.md left untouched) is represented by an
// `AOF.md` digest, and that digest IS its record doc. A native milestone (no
// AOF.md) keeps SPEC.md. Stories/uat are unaffected — only milestones mint a
// digest. The validate schema is then chosen dynamically off the resolved doc
// (digest vs native — see validateWork).
export function recordDoc(item) {
  if (item.type === "milestone") {
    return existsSync(path.join(item.dir, "AOF.md")) ? "AOF.md" : "SPEC.md";
  }
  if (item.type === "story") return "STORY.md";
  if (item.type === "uat") return "SESSION.md";
  // milestone 37 / ADR-002 — spike/chore are single self-contained record docs
  // (no separate STATE.md, unlike milestone/uat). Neither is a milestone, so
  // these branches sit BEFORE the final `return null`.
  if (item.type === "spike") return "SPIKE.md";
  if (item.type === "chore") return "CHORE.md";
  return null;
}

// Top-level "drivers" of the stream — items that sit at the root, carry
// `depends`, and participate in ordering/gating (milestones and uat sessions,
// and — milestone 37 / ADR-001 — spike and chore: same shape, they group no
// stories and are themselves the actionable unit).
const isDriver = (item) =>
  item.type === "milestone" || item.type === "uat" || item.type === "spike" || item.type === "chore";

// Minimal frontmatter reader: `key: value`, inline lists `[a, b]`, quoted
// scalars. Block lists/maps are not needed — the only collection any record doc
// authors is `depends: [a, b]`. Inline FLOW MAPS `{ … }` are deliberately NOT
// parsed (18/ADR-007): routing intent lives in the per-folder `.integrations.json`
// descriptor, never milestone frontmatter, so this shared seam (the 14-importer
// god-node's parser) parses nothing brace-wrapped into an object.
export function parseFrontmatter(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return {};
  const out = {};
  for (const line of block[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    out[kv[1]] = parseScalarOrCollection(kv[2].trim());
  }
  return out;
}

// One frontmatter value: an inline list `[a, b]` or a quoted scalar. Nested
// collections are not parsed — one level of inline list is all the work stream
// authors. Inline FLOW MAPS `{ … }` are NOT parsed into an object (18/ADR-007 —
// the prior milestone-18 `notion: { parent: <key> }` extension was REVERTED): a
// brace-wrapped value is not a list, so it falls straight to the final
// quote-strip return and round-trips as its VERBATIM string (braces retained),
// routing nothing. This keeps the shared 14-importer seam minimal and de-risked.
function parseScalarOrCollection(value) {
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((part) => part.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return value.replace(/^["']|["']$/g, "");
}

async function readMeta(item) {
  const doc = recordDoc(item);
  if (!doc) return {};
  try {
    return parseFrontmatter(await readFile(path.join(item.dir, doc), "utf8"));
  } catch {
    return {};
  }
}

const asList = (value) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]);

// -------------------------------------------------------- version model ----

// The current work-item record-doc schema (ADR-001, milestone 40) — the ONE
// exported integer constant declaring "the current document shape", mirroring
// GLOBAL_WORK_SCHEMA_VERSION's single-constant idiom (global-work-store.mjs:7).
// It lives HERE (not in a later registry module) because the reader/born-stamp
// (story 01) must consume it before the migration registry (story 02) exists.
// Bump this — and add a registered transform reaching it — when a migration
// changes the document shape.
export const WORK_ITEM_SCHEMA_VERSION = 1;

// Coerce a raw frontmatter `schema` scalar to a non-negative integer: a
// missing key or a non-numeric string reads as the pre-versioning baseline 0
// (ADR-003), mirroring readSchemaVersion's null/absent -> 0 treatment
// (global-work-store.mjs:80-87, parseInt + isFinite). Deliberately NOT clamped
// to WORK_ITEM_SCHEMA_VERSION: an item stamped AHEAD (schema: 2) must read 2,
// faithfully — story 03's staleness check depends on comparing the item's OWN
// schema against the current constant, not a clamped value.
function coerceSchemaVersion(raw) {
  if (raw === undefined || raw === null || raw === "") return 0;
  const version = Number.parseInt(String(raw), 10);
  // Non-negative by contract: a NaN or a malformed negative (never produced by
  // the born-stamp or a genuine older aof) both read as the baseline 0.
  return Number.isFinite(version) && version >= 0 ? version : 0;
}

// The version READER (ADR-001/ADR-003) — the public seam over readMeta's
// PRIVATE frontmatter read (`readMeta` itself stays unexported; `aof work list
// --json`'s 7-field shape is frozen and does not surface `schema`). Neither
// function widens `parseFrontmatter` (18/ADR-007 protected) — both keys
// already parse as raw scalars; the int coercion lives here, in the reader,
// not the shared parser.
//
// readItemSchema resolves the item's `schema` key to a non-negative integer
// (missing/non-integer -> the baseline 0).
export async function readItemSchema(item) {
  const meta = await readMeta(item);
  return coerceSchemaVersion(meta.schema);
}

// readItemVersion resolves the item's `aofVersion` key to a plain provenance
// STRING — never coerced to a number, never parsed for logic. Missing ->
// empty string (there is no numeric "baseline" concept for provenance).
export async function readItemVersion(item) {
  const meta = await readMeta(item);
  return typeof meta.aofVersion === "string" ? meta.aofVersion : "";
}

// ------------------------------------------------------- status rollback ----

// The legal rollback TARGETS (20/ADR-005): from in-progress, a transient reclaim
// rolls to not-started (the PRD's `in_progress → todo` map — re-offered by next); a
// genuine blocker rolls to blocked. Rolling FORWARD (→ in-review / → done) is the one
// move a failure/blocker rollback must never make (it would falsely accept un-done work).
const ROLLBACK_TARGETS = new Set(["not-started", "blocked"]);

// The FIRST programmatic item-frontmatter writer in the codebase (20/ADR-005) —
// work.mjs exported only READERS before this. A bounded status rollback the failed-run
// (work:run-complete --outcome failed) and reclaim (run-store:reclaimStaleRuns) paths
// CALL to leave the stream honest. Bounded HARD: it sets status ONLY from `in-progress`
// to not-started|blocked, NEVER to done/in-review; it touches ONLY the frontmatter
// `status` field (the record-doc body and every other frontmatter key — including
// `updated` — stay byte-identical); and it writes via the atomic fs.mjs:writeText
// temp+rename seam. It lives HERE, not in run-store — the 19/ADR-002 write-scope guard
// forbids the store writing any frontmatter; work.mjs is the item-frontmatter authority.
// `now` is accepted for caller-API symmetry but deliberately NOT written (bumping
// `updated` would violate the "only the status field changes" bound).
export async function rollbackItemStatus(item, toStatus, { now } = {}) { // eslint-disable-line no-unused-vars
  if (!ROLLBACK_TARGETS.has(toStatus)) {
    throw workError(`status rollback target must be not-started|blocked (got "${toStatus}")`, "forbidden-rollback", 400);
  }
  const doc = recordDoc(item);
  if (!doc) {
    throw workError(`item ${item.ref} has no record doc to roll back`, "rollback-not-applicable", 409);
  }
  const docPath = path.join(item.dir, doc);
  let text;
  try {
    text = await readFile(docPath, "utf8");
  } catch {
    throw workError(`item ${item.ref} record doc is unreadable`, "rollback-not-applicable", 409);
  }
  const block = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!block) {
    throw workError(`item ${item.ref} record doc has no frontmatter`, "rollback-not-applicable", 409);
  }
  // Rollback fires ONLY from in-progress — the narrow reclaim/failure seam, not a
  // general status mutator. Any other from-state is left byte-unchanged.
  const meta = parseFrontmatter(text);
  if (meta.status !== "in-progress") {
    throw workError(`status rollback applies only from in-progress (item is "${meta.status ?? "none"}")`, "rollback-not-applicable", 409);
  }
  // Replace ONLY the status line WITHIN the frontmatter block — the body and every
  // other key are reassembled byte-for-byte around it.
  const rewrittenFrontmatter = block[2].replace(/^(status:[ \t]*).*$/m, `$1${toStatus}`);
  const updated = block[1] + rewrittenFrontmatter + block[3] + text.slice(block[0].length);
  await writeText(docPath, updated);
  return { ref: item.ref, status: toStatus };
}

// ------------------------------------------------- frontmatter transforms --

// The transform-scoped frontmatter WRITER (ADR-004, milestone 40) — a SEPARATE
// export from rollbackItemStatus above, NOT a widening of it. rollbackItemStatus
// keeps its hard status-only, in-progress-> not-started|blocked bound untouched;
// this writer is the broader primitive a registered migration transform (story
// 02) calls to add/rename/re-value ANY frontmatter key.
//
// `mutate` receives the RAW inner frontmatter block text (the bytes between the
// `---` fences, exclusive) and returns the new raw block text — the SAME
// block-capture + slice idiom rollbackItemStatus uses above (`block[2]`
// in/out), never a parseFrontmatter+reserialize round-trip (that shared
// 14-importer parser drops comments/order/formatting — 18/ADR-007). The body —
// every byte after the closing `---` fence — and everything before the opening
// fence are reassembled byte-for-byte around the mutated block. `mutate` may be
// sync or async. Persists via the atomic fs.mjs:writeText temp+rename seam.
//
// It runs ONLY as the primitive a registered transform calls — it is not a
// public "edit any frontmatter" verb in its own right.
export async function applyItemFrontmatter(item, mutate) {
  const doc = recordDoc(item);
  if (!doc) {
    throw workError(`item ${item.ref} has no record doc to update`, "frontmatter-not-applicable", 409);
  }
  const docPath = path.join(item.dir, doc);
  let text;
  try {
    text = await readFile(docPath, "utf8");
  } catch {
    throw workError(`item ${item.ref} record doc is unreadable`, "frontmatter-not-applicable", 409);
  }
  const block = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!block) {
    throw workError(`item ${item.ref} record doc has no frontmatter`, "frontmatter-not-applicable", 409);
  }
  const rewrittenFrontmatter = await mutate(block[2]);
  // Reassembled byte-for-byte around the mutated block: the opening fence
  // (`block[1]`), the new block, the closing fence (`block[3]`), and every
  // byte of the body (`text.slice(block[0].length)`) are untouched by anything
  // other than the mutate callback itself.
  const updated = block[1] + rewrittenFrontmatter + block[3] + text.slice(block[0].length);
  await writeText(docPath, updated);
  return { ref: item.ref, doc };
}

// ----------------------------------------------------------------- find ----

// `query` is a structured ref (`NN`, `NN/SS`) or a free-text slug match.
// Semantic matching slots in at the lexical branch below.
export async function findWork(workDir, query) {
  const items = await listItems(workDir);
  const ref = (query ?? "").trim();
  let matches;

  if (/^\d+$/.test(ref)) {
    // A bare number is the top-level item at that slot — a milestone, a uat
    // session, or an adhoc story/task (numbers are unique among top-level items).
    matches = items.filter((item) => item.parent == null && sameNum(item.number, ref));
  } else {
    const pair = ref.match(/^(\d+)\/(\d+)$/);
    if (pair) {
      matches = items.filter(
        (item) => item.type === "story" && item.parent && sameNum(item.parent, pair[1]) && sameNum(item.number, pair[2]),
      );
    } else {
      const needle = ref.toLowerCase();
      matches = items.filter(
        (item) => item.slug.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle),
      );
    }
  }

  const rows = [];
  for (const item of matches) {
    const meta = await readMeta(item);
    rows.push({
      ref: item.ref,
      type: item.type,
      slug: item.slug,
      status: meta.status ?? null,
      title: meta.title ?? null,
      parent: item.parent,
      dir: item.dir,
    });
  }
  return rows;
}

// ----------------------------------------------------------------- list ----

// The board's read model: the WHOLE stream serialised as a flat array, one
// element per `listItems` item, each carrying exactly the seven frozen contract
// fields `{ ref, type, slug, status, title, parent, dir }` (ARCHITECTURE
// ADR-002). Flat-with-`parent` — `parent` is the only tree edge (null at
// depth 0); the consumer (the board) derives the hierarchy from it.
//
// Order is deterministic depth-first preorder: top-level items sorted by number
// ascending, each milestone immediately followed by its stories sorted by
// number. `dir` is the absolute item directory, forward-slashed (the
// lock-manifest path convention) so the JSON is byte-stable across OSes.
//
// This is the single source of the `aof work list --json` contract; the board
// API (story 01) reuses it. Keep it a thin pass over `listItems` — no new
// traversal, no convenience fields.
export async function listStream(workDir) {
  const items = await listItems(workDir);

  const byNum = (a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10);
  const topLevel = items.filter((item) => item.parent == null).sort(byNum);

  const ordered = [];
  for (const item of topLevel) {
    ordered.push(item);
    if (item.type === "milestone") {
      ordered.push(
        ...items
          .filter((child) => child.parent === item.number)
          .sort(byNum),
      );
    }
  }

  const rows = [];
  for (const item of ordered) {
    const meta = await readMeta(item);
    rows.push({
      ref: item.ref,
      type: item.type,
      slug: item.slug,
      status: meta.status ?? null,
      title: meta.title ?? null,
      parent: item.parent,
      dir: item.dir.replaceAll("\\", "/"),
    });
  }
  return rows;
}

// ------------------------------------------------------------- validate ----

function checkFeatureTags(text, relPath, projectTags, add) {
  const lines = text.split(/\r?\n/);
  let pending = [];
  let featureTags = [];

  const allowed = (tag) => UNIVERSAL_TAGS.has(tag) || projectTags.has(tag) || FINDING_TAG_RE.test(tag);

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("@")) {
      const tags = line.split(/\s+/).filter((token) => token.startsWith("@"));
      for (const tag of tags) {
        if (MILESTONE_TAG_RE.test(tag)) {
          add(relPath, `tag "${tag}" — milestone membership is structural, not a tag`);
        } else if (!allowed(tag)) {
          add(relPath, `unknown tag "${tag}" (outside the closed vocabulary)`);
        }
      }
      pending.push(...tags);
      continue;
    }
    if (/^Feature:/.test(line)) {
      featureTags = pending;
      pending = [];
      continue;
    }
    if (/^Scenario( Outline)?:/.test(line)) {
      const effective = [...featureTags, ...pending];
      const verification = effective.filter((tag) => VERIFICATION_TAGS.has(tag));
      if (verification.length !== 1) {
        const name = line.replace(/^Scenario( Outline)?:\s*/, "");
        add(relPath, `scenario "${name}" carries ${verification.length} verification tags (need exactly 1): [${verification.join(", ")}]`);
      }
      pending = [];
    }
  }
}

function findCycle(graph) {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map([...graph.keys()].map((node) => [node, WHITE]));
  const stack = [];
  let cycle = null;

  const visit = (node) => {
    color.set(node, GREY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      if (color.get(next) === GREY) {
        cycle = [...stack.slice(stack.indexOf(next)), next];
        return true;
      }
      if (color.get(next) === WHITE && visit(next)) return true;
    }
    stack.pop();
    color.set(node, BLACK);
    return false;
  };

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE && visit(node)) break;
  }
  return cycle;
}

// Deterministic checks only — folder↔frontmatter, the closed tag vocabulary,
// and the `depends` graph (resolves + acyclic). Test-traceability
// (@executable→green test) is the language-aware layer still to come.
export async function validateWork(workDir, config, scopeRef) {
  const items = await listItems(workDir);
  const findings = [];
  const add = (target, problem) => findings.push({ path: target, problem });

  const inScope = (item) => {
    if (!scopeRef) return true;
    const ref = scopeRef.trim();
    if (/^\d+$/.test(ref)) return sameNum(item.parent ?? item.number, ref);
    const pair = ref.match(/^(\d+)\/(\d+)$/);
    if (pair) return item.ref === `${pair[1]}/${pair[2]}` || item.ref === ref;
    return item.slug.includes(ref);
  };

  const tagConfig = config?.work?.tags ?? {};
  const projectTags = new Set([
    ...(tagConfig.layers ?? []),
    ...(tagConfig.refinements ?? []),
    ...(tagConfig.domains ?? []),
  ]);

  const milestoneNumbers = new Set(
    items.filter((item) => item.type === "milestone").map((item) => Number.parseInt(item.number, 10)),
  );
  // `depends` may point at any top-level driver (a milestone or a uat gate).
  const driverNumbers = new Set(
    items.filter(isDriver).map((item) => Number.parseInt(item.number, 10)),
  );
  const graph = new Map();

  for (const item of items) {
    const meta = recordDoc(item) ? await readMeta(item) : {};

    if (isDriver(item)) {
      const deps = asList(meta.depends).map((value) => Number.parseInt(value, 10));
      graph.set(Number.parseInt(item.number, 10), deps);
    }

    if (!inScope(item)) continue;

    // 1. folder ↔ frontmatter — the schema is chosen DYNAMICALLY off the doc
    //    type. A `doc: digest` record doc (an AOF.md for a converted milestone)
    //    carries digest-shaped frontmatter (`milestone`/`slug`/`status`, the
    //    legacy SPEC left untouched), NOT the native record shape — so it is
    //    held to the digest schema, not the SPEC/STORY/SESSION one.
    const doc = recordDoc(item);
    if (doc) {
      const docPath = path.join(item.dir, doc);
      if (Object.keys(meta).length === 0) {
        add(docPath, `missing or empty record doc (${doc})`);
      } else if (meta.doc === "digest") {
        // Imported/converted milestone digest (AOF.md). Identity comes from
        // `milestone` (the number) + `slug`; status from the closed vocabulary.
        // No `type`/`created`/`updated`/`parent` — those are native-only.
        if (item.type !== "milestone") add(docPath, `digest record doc (doc: digest) is only valid for a milestone, not a "${item.type}"`);
        if (!sameNum(meta.milestone ?? "", item.number)) add(docPath, `digest milestone "${meta.milestone ?? ""}" ≠ folder "${item.number}"`);
        if (meta.slug !== item.slug) add(docPath, `digest slug "${meta.slug ?? ""}" ≠ folder "${item.slug}"`);
        if (!VALID_STATUS.has(meta.status)) add(docPath, `invalid status "${meta.status ?? ""}"`);
      } else {
        if (meta.type !== item.type) add(docPath, `frontmatter type "${meta.type ?? ""}" ≠ folder type "${item.type}"`);
        if (!sameNum(meta.number ?? "", item.number)) add(docPath, `frontmatter number "${meta.number ?? ""}" ≠ folder "${item.number}"`);
        if (meta.slug !== item.slug) add(docPath, `frontmatter slug "${meta.slug ?? ""}" ≠ folder "${item.slug}"`);
        if (!VALID_STATUS.has(meta.status)) add(docPath, `invalid status "${meta.status ?? ""}"`);
        if (!meta.created) add(docPath, "missing created date");
        if (!meta.updated) add(docPath, "missing updated date");
        if (meta.parent != null && meta.parent !== "" && !milestoneNumbers.has(Number.parseInt(meta.parent, 10))) {
          add(docPath, `parent "${meta.parent}" does not resolve to a milestone`);
        }
      }

      // 1b. staleness (milestone 40 / story 03, ADR-005/ADR-006) — independent
      // of the digest/native branch above: an item's own `schema` (missing/
      // non-integer coerces to the baseline 0, ADR-003) compared against the
      // current WORK_ITEM_SCHEMA_VERSION. Only checked once the doc actually
      // parsed (a missing/empty record doc is already reported above; flagging
      // it stale too would be a misleading second finding for the same root
      // cause). Deliberately dep-01 only (work.mjs constants alone) — names
      // the remedy `aof upgrade` as a STRING LITERAL, never imports
      // work-upgrade.mjs, and never enumerates which transforms are pending
      // (that is `aof upgrade --dry-run`, story 02) so the message stays
      // deterministic and stable run-to-run.
      if (Object.keys(meta).length > 0) {
        const itemSchema = coerceSchemaVersion(meta.schema);
        if (itemSchema < WORK_ITEM_SCHEMA_VERSION) {
          add(
            docPath,
            `schema ${itemSchema} is behind the current schema ${WORK_ITEM_SCHEMA_VERSION} — run \`aof upgrade\` to update it`,
          );
        }
      }
    }

    // 3a. depends references resolve (to any top-level driver)
    if (isDriver(item)) {
      for (const dep of asList(meta.depends)) {
        if (!driverNumbers.has(Number.parseInt(dep, 10))) {
          add(path.join(item.dir, recordDoc(item)), `depends "${dep}" does not resolve to a milestone/uat item`);
        }
      }
    }

    // 2. tag vocabulary (per task feature)
    if (item.type === "story") {
      const tasksDir = path.join(item.dir, "tasks");
      for (const file of await readDirSafe(tasksDir)) {
        if (!file.isFile() || !file.name.endsWith(".feature")) continue;
        const featurePath = path.join(tasksDir, file.name);
        checkFeatureTags(await readFile(featurePath, "utf8"), featurePath, projectTags, add);
      }
    }
  }

  // 3b. depends graph acyclic
  const cycle = findCycle(graph);
  if (cycle) add(workDir, `depends cycle: ${cycle.join(" → ")}`);

  // collapse identical (path, problem) duplicates — the same tag can recur
  // across scenarios in one file, but one report per issue is enough.
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.path}${finding.problem}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------------------- next ----

function inRange(scopeRef) {
  if (!scopeRef) return () => true;
  const range = scopeRef.match(/^(\d+)-(\d+)$/);
  if (range) {
    const lo = Number.parseInt(range[1], 10);
    const hi = Number.parseInt(range[2], 10);
    return (num) => num >= lo && num <= hi;
  }
  if (/^\d+$/.test(scopeRef)) {
    const only = Number.parseInt(scopeRef, 10);
    return (num) => num === only;
  }
  return () => true;
}

const ready = (item, status) => ({
  state: "ready",
  ref: item.ref,
  type: item.type,
  slug: item.slug,
  status: status ?? null,
  path: item.dir,
});

// The next actionable item, respecting `depends`: the first not-`done`
// top-level driver (milestone, uat session, spike, or chore) whose
// dependencies are all `done`. A milestone is drilled into its first not-`done`
// story; a uat session, spike, or chore is itself the actionable item (each
// groups no stories — running/resolving/ticking it IS the work; milestone 37 /
// ADR-001 treats spike/chore the uat way). Returns
// { state: "ready" | "blocked" | "done", ... }.
//
// The OPTIONAL third argument (milestone 26 / ADR-005, WIDENED milestone 27 /
// ADR-004 — mesh-aware next, INJECTED): `candidacyView` is a pre-computed,
// PLAIN-DATA view built OUTSIDE this module (the command layer composes it under
// its config gate, unifying the m26 lease view with the m27 routing verdict; this
// module imports NO mesh module) — a Map keyed by item ref, value
// { state?: "leased-live" | "leased-stale", holder?, routed?: "elsewhere" }; a ref
// absent from the map (or an absent map) is unleased/untargeted. ABSENT ⇒
// behaviour is byte-identical to the two-argument call (the mergePresence(disk,
// null) === disk idiom applied to next).
//
// THE PER-REF GUARD (ADR-004.2 — routing runs FIRST, the lease then arbitrates):
//   routed === "elsewhere"  ⇒ skipped (another node's work — never surfaced
//                              reclaimable here, short-circuits before the lease);
//   state === "leased-live" ⇒ skipped exactly as not-actionable (being worked, not
//                              here — the following candidate is offered);
//   state === "leased-stale"⇒ returned ready + { reclaimable: true, leasedBy }
//                              (next is a READ — the claim path reclaims, never next);
//   otherwise                ⇒ offered in its normal walk position (byte-identical
//                              to the pre-fold-in behaviour when no entry exists).
// A milestone whose every not-done story is skipped (routed-elsewhere OR
// lease-live) is NOT offered as ready-for-acceptance — the walk falls through to
// the honest nothing-actionable shape.
//
// milestone 27 / ADR-004.3 (the m26/ADR-007 fold-in) — the SAME guard now applies
// at EVERY ready-return: the uat driver return, the zero-story needs-break-down
// driver return, AND the story-loop returns (already candidacy-aware in m26). The
// milestone-ACCEPT fallthrough (all stories done) stays deliberately
// candidacy-BLIND — a genuinely-done milestone is not a claimable work ref, so a
// lease/directive entry for it is ignored (the carve-out).
export async function nextWork(workDir, scopeRef, { candidacyView } = {}) {
  const items = await listItems(workDir);
  const drivers = items
    .filter(isDriver)
    .sort((a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10));

  const statusCache = new Map();
  const driverStatus = async (num) => {
    if (statusCache.has(num)) return statusCache.get(num);
    const item = drivers.find((d) => Number.parseInt(d.number, 10) === num);
    const status = item ? (await readMeta(item)).status ?? null : null;
    statusCache.set(num, status);
    return status;
  };

  const within = inRange(scopeRef);
  const scoped = drivers.filter((d) => within(Number.parseInt(d.number, 10)));
  let blocked = null;

  for (const driver of scoped) {
    const meta = await readMeta(driver);
    statusCache.set(Number.parseInt(driver.number, 10), meta.status ?? null);
    if (meta.status === "done") continue;

    const unmet = [];
    for (const dep of asList(meta.depends)) {
      if ((await driverStatus(Number.parseInt(dep, 10))) !== "done") unmet.push(String(dep));
    }
    if (unmet.length > 0) {
      blocked ??= { state: "blocked", ref: driver.ref, type: driver.type, slug: driver.slug, status: meta.status ?? null, path: driver.dir, waitingOn: unmet };
      continue;
    }

    if (driver.type === "uat" || driver.type === "spike" || driver.type === "chore") {
      // milestone 27 / ADR-004.3 — the uat driver return is now candidacy-aware
      // (before m27 this return was candidacy-BLIND — a peer's next double-offered
      // a live-leased/targeted-elsewhere uat ref). milestone 37 / ADR-001 (FF-3705,
      // honouring 26/ADR-007) — spike/chore are routed through this SAME
      // candidacy-guarded, item-is-the-work return, NOT a fresh unguarded one: they
      // group no stories, so the milestone drill-down path below would mis-classify
      // them as "needs break-down".
      const uatCandidacy = candidacyView?.get?.(driver.ref);
      if (uatCandidacy?.routed === "elsewhere" || uatCandidacy?.state === "leased-live") {
        continue; // another node's work, or being worked live — pass over, keep walking
      }
      if (uatCandidacy?.state === "leased-stale") {
        return { ...ready(driver, meta.status), reclaimable: true, leasedBy: uatCandidacy.holder };
      }
      return ready(driver, meta.status); // run the session
    }

    const stories = items
      .filter((item) => item.type === "story" && item.parent === driver.number)
      .sort((a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10));

    if (stories.length === 0) {
      // milestone 27 / ADR-004.3 — the zero-story (needs-break-down) driver return
      // is now candidacy-aware (the SAME guard, applied at the SAME driver.ref key).
      const zeroStoryCandidacy = candidacyView?.get?.(driver.ref);
      if (zeroStoryCandidacy?.routed === "elsewhere" || zeroStoryCandidacy?.state === "leased-live") {
        continue;
      }
      if (zeroStoryCandidacy?.state === "leased-stale") {
        return { ...ready(driver, meta.status), reclaimable: true, leasedBy: zeroStoryCandidacy.holder };
      }
      return ready(driver, meta.status); // needs break-down
    }

    let candidacySkipped = false;
    for (const story of stories) {
      const storyMeta = await readMeta(story);
      if (storyMeta.status !== "done") {
        const candidacy = candidacyView?.get?.(story.ref);
        if (candidacy?.routed === "elsewhere") {
          // Targeted at (or claimed to advertise) another node's capability — not
          // this node's work at all; short-circuits BEFORE the lease is even
          // consulted (never surfaced reclaimable here).
          candidacySkipped = true;
          continue;
        }
        if (candidacy?.state === "leased-live") {
          // Leased by a live peer — being worked, just not here: passed over exactly
          // as not-actionable; the flag guards the milestone-accept fallthrough below.
          candidacySkipped = true;
          continue;
        }
        if (candidacy?.state === "leased-stale") {
          // A stale peer's item is OFFERED in its normal walk position, annotated so
          // the caller knows a claim-path reclaim stands between it and the work.
          return { ...ready(story, storyMeta.status), reclaimable: true, leasedBy: candidacy.holder };
        }
        return ready(story, storyMeta.status);
      }
    }
    // The false-accept guard: a candidacy-skipped story is NOT done — a milestone
    // whose remaining stories are all skipped (routed-elsewhere or leased) must not
    // be offered for acceptance.
    if (candidacySkipped) continue;
    // The milestone-ACCEPT fallthrough (ADR-004.3 carve-out) stays candidacy-BLIND —
    // a genuinely-done milestone is not a claimable work ref; no lookup here.
    return ready(driver, meta.status); // all stories done -- milestone needs accepting
  }

  return blocked ?? { state: "done" };
}
