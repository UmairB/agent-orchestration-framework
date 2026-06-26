// src/notion/projection.mjs — the PURE aof→Notion projection (17/ADR-003).
//
// projectMilestone({ items, config, mapping }) → SyncPlan computes, with ZERO
// Notion calls, exactly what the sync would push: one Op per aof item in traversal
// order (the milestone first, then its stories). The create/patch/noop/skip
// decision is taken ENTIRELY from local facts — the sidecar lookup (ADR-001) + the
// status-map resolution + the recorded lastStatus — never a Notion read, so the
// plan is EXACT (the basis of the --dry-run zero-call preview, ADR-003).
//
//   SyncPlan { dataSourceId, ops: [ Op, … ] }   // ops in traversal order
//   Op {
//     ref, type, status,
//     op: "create" | "patch" | "noop" | "skip",
//     pageId: string | null,                       // null on a create
//     properties: { title, statusOption?, relation? },  // statusOption absent on a skip
//     relation?: { property, parentPageId },       // story → milestone page id (§A3)
//     reason?: string,                             // skip explanation
//   }
//
// The decision precedence (local facts only, ADR-003):
//   1. no statusMap entry for the aof status            → skip   (reason names the missing mapping)
//   2. else no sidecar pageId for the ref               → create (pageId null)
//   3. else the mapped option equals the sidecar lastStatus → noop
//   4. else                                             → patch  (pageId = the sidecar hit)
//
// A skip emits NO create/patch op for that item AND carries no statusOption value —
// never-half-write at the projection level (the skip is decided BEFORE any write).
import { resolvePageId } from "./mapping.mjs";

// The aof item's on-disk title, with sensible fallbacks so a thin fixture (no
// `title` frontmatter) still projects a stable, non-empty page title.
function itemTitle(item) {
  const meta = item.meta ?? {};
  return meta.title ?? meta.name ?? item.slug ?? item.ref;
}

// The aof on-disk status read via readMeta (the frontmatter `status`).
function itemStatus(item) {
  return item.meta?.status ?? null;
}

// Project ONE aof item into its Op. `mapping` is the already-read sidecar for the
// configured data-source; `milestonePageId` is the milestone's sidecar page id (the
// §A3 self-relation parent), present iff the milestone has been synced.
function projectItem(item, config, mapping, milestonePageId) {
  const status = itemStatus(item);
  const statusMap = config?.statusMap ?? {};
  const title = itemTitle(item);

  // A story carries the §A3 self-relation to the milestone page id in the SAME
  // data-source (the relation cannot cross databases). The parent page id comes
  // from the milestone's sidecar entry; if the milestone is not yet recorded it is
  // null (the apply layer creates the milestone first, so on a real run it is set).
  const relation =
    item.type === "story"
      ? { property: config?.relationProperty, parentPageId: milestonePageId ?? null }
      : undefined;

  // (1) No statusMap entry for this aof status ⇒ an honest skip. NO statusOption is
  // written, NO create/patch op is emitted — never-half-write (ADR-003 §A4).
  const mappedOption = Object.prototype.hasOwnProperty.call(statusMap, status)
    ? statusMap[status]
    : undefined;
  if (mappedOption === undefined || mappedOption === null) {
    return {
      ref: item.ref,
      type: item.type,
      status,
      op: "skip",
      pageId: null,
      properties: relation ? { title, relation } : { title },
      ...(relation ? { relation } : {}),
      reason: `no statusMap entry for ${status}`,
    };
  }

  const properties = { title, statusOption: mappedOption };
  if (relation) properties.relation = relation;

  const pageId = resolvePageId(mapping, item.ref);
  const entry = mapping?.entries?.[item.ref];

  // (2) No sidecar page id ⇒ create (the apply layer POSTs, then records the id).
  if (pageId == null) {
    return {
      ref: item.ref,
      type: item.type,
      status,
      op: "create",
      pageId: null,
      properties,
      ...(relation ? { relation } : {}),
    };
  }

  // (3) The mapped option already equals the sidecar's recorded lastStatus ⇒ noop
  // (the board option already matches what disk would write — no Notion call).
  if (entry?.lastStatus != null && entry.lastStatus === mappedOption) {
    return {
      ref: item.ref,
      type: item.type,
      status,
      op: "noop",
      pageId,
      properties,
      ...(relation ? { relation } : {}),
    };
  }

  // (4) Else patch the known page in place (disk overwrites Notion, one-way).
  return {
    ref: item.ref,
    type: item.type,
    status,
    op: "patch",
    pageId,
    properties,
    ...(relation ? { relation } : {}),
  };
}

// The pure projection: turn the on-disk traversal + config + sidecar into a
// per-item SyncPlan. NO Notion call. `items` is the milestone + its stories in
// traversal order (milestone FIRST), each `{ ref, type, slug, meta }` where `meta`
// is the readMeta frontmatter ({ title, status, … }). `config` is the resolved
// `work.integrations.notion` block; `mapping` is readMapping(projectRoot, dsId).
export function projectMilestone({ items, config, mapping } = {}) {
  const dataSourceId = config?.dataSourceId ?? mapping?.dataSourceId ?? null;
  const list = Array.isArray(items) ? items : [];

  // The milestone's sidecar page id is the §A3 self-relation parent for every story
  // op — resolve it once, in traversal order the milestone is first.
  const milestoneItem = list.find((item) => item.type === "milestone");
  const milestonePageId = milestoneItem ? resolvePageId(mapping, milestoneItem.ref) : null;

  const ops = list.map((item) => projectItem(item, config, mapping, milestonePageId));

  return { dataSourceId, ops };
}
