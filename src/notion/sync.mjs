// src/notion/sync.mjs — the APPLY layer over the projection plan (17/ADR-003).
//
// applyPlan({ plan, config, projectRoot, notionSpawn, dryRun }) walks a SyncPlan's
// ops and pushes them to Notion through the INJECTABLE spawn seam (the provisioned
// Notion CLI; ADR-004). It is the SOLE caller of that seam — the command body
// resolves the seam and hands it here.
//
// Per-op egress (the ONLY Notion calls this layer ever issues):
//   create → spawn a PAGE create (parent = the data-source, the §A3 relation set,
//            the statusMap'd option set); record the new page id back into the
//            sidecar (ADR-001 recordPageId). action: "created".
//   patch  → spawn a PAGE patch (status/title) BY page id; re-record lastStatus.
//            action: "updated".
//   noop   → NO spawn, NO write. action: "no-op".
//   skip   → NO spawn, NO write. action: "skipped" (+ the projection's reason).
//
// ONE-WAY (ADR-003 inv. 2): the only Notion egress is a page create / page patch
// (disk → Notion). There is NO path that reads a Notion page's status/title and
// writes it back to disk; on divergence disk overwrites Notion (the patch). The
// only disk WRITE this layer makes is recordPageId — the aof-owned sidecar id store
// (ADR-001) — never a Notion-derived value onto a STORY.md/SPEC.md/frontmatter.
//
// NEVER-TOUCH-SCHEMA (ADR-003 inv. 5): the spawn argv only ever names a PAGE create
// / PAGE patch — never a database / data-source / property / view create.
//
// DRY-RUN (ADR-003): applyPlan with dryRun:true issues ZERO spawns and makes ZERO
// writes — the plan IS the preview. The command body computes the plan in both
// modes; only a non-dry-run reaches the spawn seam.
import { recordPageId, hashContent } from "./mapping.mjs";

// Map an applied Op to the ItemResult `action` (ADR-002 envelope vocabulary).
const ACTION_BY_OP = {
  create: "created",
  patch: "updated",
  noop: "no-op",
  skip: "skipped",
};

// The Notion property-value body for a page, keyed by the board's REAL property NAMES
// (config-driven, not hardcoded): the title property, the status property, and — when
// the op carries a relation — the relation property. This is the `properties` object
// of a Notion create/patch request body (RESEARCH §A3/§A4). The title property NAME is
// `config.titleProperty` (Notion's default title prop is "Name", but a board may name
// it anything, e.g. "Objective"); the status property carries `{ <statusType>: { name }}`
// where `statusType` is "status" (default) or "select"; a relation is `[{ id }]`.
function pageProperties(op, config, { includeTitle = true } = {}) {
  const props = {};
  if (includeTitle && op.properties.title != null) {
    const titleProperty = config.titleProperty || "Name";
    props[titleProperty] = { title: [{ text: { content: String(op.properties.title) } }] };
  }
  if (op.properties.statusOption != null && config.statusProperty) {
    const statusType = config.statusType === "select" ? "select" : "status";
    props[config.statusProperty] = { [statusType]: { name: op.properties.statusOption } };
  }
  if (op.relation && op.relation.property && op.relation.parentPageId) {
    props[op.relation.property] = { relation: [{ id: op.relation.parentPageId }] };
  }
  return props;
}

// Build the page-create spawn argv: a real Notion API POST to `v1/pages` whose body
// names the data-source PARENT + the title/status/relation property values. The
// payload is one `-d <json>` argv element (spawned with an argv array — NO shell, so
// the JSON needs no quoting). This is a create of a PAGE only — the path is `v1/pages`,
// never a `v1/databases`/`v1/data_sources` schema object (ADR-003 inv. 5).
function createPageArgv(op, config, dataSourceId) {
  const body = {
    parent: { data_source_id: dataSourceId },
    properties: pageProperties(op, config),
  };
  return ["api", "-X", "POST", "v1/pages", "-d", JSON.stringify(body)];
}

// Build the page-patch spawn argv: a real Notion API PATCH of an EXISTING page by id
// (`v1/pages/<id>`), whose body sets the title + the statusMap'd status option (disk
// overwrites Notion, one-way). A patch of a PAGE only — never a schema object.
function patchPageArgv(op, config) {
  const body = { properties: pageProperties(op, config) };
  return ["api", "-X", "PATCH", `v1/pages/${op.pageId}`, "-d", JSON.stringify(body)];
}

// Build the page-BODY edit spawn argv: `ntn pages edit <id> --content <markdown>` sets
// the page's CONTENT from markdown (ntn does the markdown→blocks conversion). A
// CONTENT write of a PAGE (disk → Notion, one-way) — never a schema object, never a
// read. Default (no `--allow-deleting-content`) so it never deletes child pages/dbs.
function editPageBodyArgv(pageId, content) {
  return ["pages", "edit", pageId, "--content", content];
}

// Pull the created page id out of the spawn result. The provisioned CLI returns the
// created page's JSON; accept the common shapes ({ id } / { pageId } / a string)
// without coupling to one CLI's exact envelope (the @manual live row pins the real
// shape; the @executable rows inject a spy returning a known id).
function pageIdFromSpawn(result) {
  if (result == null) return null;
  if (typeof result === "string") return result;
  if (typeof result.id === "string") return result.id;
  if (typeof result.pageId === "string") return result.pageId;
  if (result.page && typeof result.page.id === "string") return result.page.id;
  return null;
}

// Apply a SyncPlan, returning one ItemResult per op (in plan order). On dryRun the
// spawn seam is NEVER called and NO sidecar write is made — the plan is the preview.
export async function applyPlan({ plan, config, projectRoot, notionSpawn, dryRun = false } = {}) {
  const dataSourceId = plan?.dataSourceId ?? null;
  const ops = Array.isArray(plan?.ops) ? plan.ops : [];
  const items = [];

  // The milestone's page id within THIS run — created/resolved as the FIRST op
  // (traversal order). Threaded into each story's §A3 self-relation, so a FRESH sync
  // nests stories under the milestone in ONE run even though the milestone's id is not
  // in the sidecar at projection time (the milestone is created before its stories).
  let runMilestonePageId = null;

  for (const op of ops) {
    const action = ACTION_BY_OP[op.op] ?? "no-op";

    // §A3: resolve a story's unresolved self-relation parent to the milestone page id
    // created/resolved earlier in this run (the projection left it null on a fresh sync).
    if (op.type === "story" && op.relation && !op.relation.parentPageId && runMilestonePageId) {
      op.relation = { ...op.relation, parentPageId: runMilestonePageId };
    }

    // noop / skip — NO Notion call, NO write. Carry the projection's reason through.
    if (op.op === "noop" || op.op === "skip") {
      if (op.type === "milestone" && op.pageId) runMilestonePageId = op.pageId;
      items.push({
        ref: op.ref,
        type: op.type,
        status: op.status,
        action,
        pageId: op.pageId ?? null,
        ...(op.reason ? { reason: op.reason } : {}),
      });
      continue;
    }

    // DRY-RUN — compute the decision but apply NOTHING (zero spawns, zero writes).
    // The create-plan's pageId stays null (no POST happened); the patch keeps its
    // sidecar page id (ADR-002: pageId null on a dry-run create-plan).
    if (dryRun) {
      items.push({
        ref: op.ref,
        type: op.type,
        status: op.status,
        action,
        pageId: op.op === "patch" ? op.pageId ?? null : null,
        ...(op.reason ? { reason: op.reason } : {}),
      });
      continue;
    }

    if (op.op === "create") {
      // POST a new page (disk → Notion), then record the new id into the sidecar so
      // the NEXT sync resolves it to a patch (idempotent update-in-place, ADR-001).
      const spawnResult = await notionSpawn(createPageArgv(op, config, dataSourceId));
      const newPageId = pageIdFromSpawn(spawnResult);
      // The milestone is created first — capture its id for its stories' §A3 relation.
      if (op.type === "milestone" && newPageId) runMilestonePageId = newPageId;
      // Set the page BODY from the record-doc content (disk → Notion), once the page
      // exists and we have its id. A content-less op skips this (no second call).
      if (newPageId && op.content) {
        await notionSpawn(editPageBodyArgv(newPageId, op.content));
      }
      if (newPageId && projectRoot) {
        await recordPageId(projectRoot, dataSourceId, op.ref, newPageId, {
          lastStatus: op.properties.statusOption,
          lastSyncedAt: new Date().toISOString(),
          lastContentHash: hashContent(op.content),
        });
      }
      items.push({
        ref: op.ref,
        type: op.type,
        status: op.status,
        action,
        pageId: newPageId,
        ...(op.reason ? { reason: op.reason } : {}),
      });
      continue;
    }

    // patch — PATCH the known page in place (disk overwrites Notion), then re-record
    // the lastStatus so a re-sync over the same disk is a noop.
    if (op.type === "milestone" && op.pageId) runMilestonePageId = op.pageId;
    await notionSpawn(patchPageArgv(op, config));
    // Re-set the page BODY from the record-doc content (disk wins, one-way). A
    // content-less op skips this.
    if (op.content) {
      await notionSpawn(editPageBodyArgv(op.pageId, op.content));
    }
    if (projectRoot) {
      await recordPageId(projectRoot, dataSourceId, op.ref, op.pageId, {
        lastStatus: op.properties.statusOption,
        lastSyncedAt: new Date().toISOString(),
        lastContentHash: hashContent(op.content),
      });
    }
    items.push({
      ref: op.ref,
      type: op.type,
      status: op.status,
      action,
      pageId: op.pageId,
      ...(op.reason ? { reason: op.reason } : {}),
    });
  }

  return { items };
}
