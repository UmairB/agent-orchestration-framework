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
import { recordPageId } from "./mapping.mjs";

// Map an applied Op to the ItemResult `action` (ADR-002 envelope vocabulary).
const ACTION_BY_OP = {
  create: "created",
  patch: "updated",
  noop: "no-op",
  skip: "skipped",
};

// Build the page-create spawn argv: a PAGE create against the data-source, with the
// title, the statusMap'd status option, and (for a story) the §A3 self-relation set
// by the milestone page id. This is a create of a PAGE only — never a schema object.
function createPageArgv(op, config, dataSourceId) {
  return [
    "api",
    "pages",
    "create",
    "--data-source-id",
    dataSourceId,
    "--title",
    op.properties.title,
    "--status-property",
    config.statusProperty,
    "--status-option",
    op.properties.statusOption,
    ...(op.relation && op.relation.parentPageId
      ? ["--relation-property", op.relation.property, "--relation-parent", op.relation.parentPageId]
      : []),
  ];
}

// Build the page-patch spawn argv: a PATCH of an EXISTING page (by id) — sets the
// title + the statusMap'd status option (disk overwrites Notion, one-way). A patch
// of a PAGE only — never a schema object.
function patchPageArgv(op, config) {
  return [
    "api",
    "pages",
    "update",
    "--page-id",
    op.pageId,
    "--title",
    op.properties.title,
    "--status-property",
    config.statusProperty,
    "--status-option",
    op.properties.statusOption,
  ];
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

  for (const op of ops) {
    const action = ACTION_BY_OP[op.op] ?? "no-op";

    // noop / skip — NO Notion call, NO write. Carry the projection's reason through.
    if (op.op === "noop" || op.op === "skip") {
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
      });
      continue;
    }

    if (op.op === "create") {
      // POST a new page (disk → Notion), then record the new id into the sidecar so
      // the NEXT sync resolves it to a patch (idempotent update-in-place, ADR-001).
      const spawnResult = await notionSpawn(createPageArgv(op, config, dataSourceId));
      const newPageId = pageIdFromSpawn(spawnResult);
      if (newPageId && projectRoot) {
        await recordPageId(projectRoot, dataSourceId, op.ref, newPageId, {
          lastStatus: op.properties.statusOption,
          lastSyncedAt: new Date().toISOString(),
        });
      }
      items.push({
        ref: op.ref,
        type: op.type,
        status: op.status,
        action,
        pageId: newPageId,
      });
      continue;
    }

    // patch — PATCH the known page in place (disk overwrites Notion), then re-record
    // the lastStatus so a re-sync over the same disk is a noop.
    await notionSpawn(patchPageArgv(op, config));
    if (projectRoot) {
      await recordPageId(projectRoot, dataSourceId, op.ref, op.pageId, {
        lastStatus: op.properties.statusOption,
        lastSyncedAt: new Date().toISOString(),
      });
    }
    items.push({
      ref: op.ref,
      type: op.type,
      status: op.status,
      action,
      pageId: op.pageId,
    });
  }

  return { items };
}
