// Fitness function for milestone 17 / ADR-003 + ADR-004 + SPEC §scope (inv. 7):
//   "Fail-honestly / never-half-write. A status with no `statusMap` entry (or an
//    unreachable Notion) is a STRUCTURED per-item failure — `skip` with a `reason`,
//    computed BEFORE the write — never a page written with a fabricated/absent value,
//    never a silent success."
//
// Two legs, CI-able offline:
//   (a) PROJECTION HONESTY: the PURE projectMilestone over a fixture milestone whose
//       config statusMap is MISSING the item's status → that item's op is `skip` with a
//       non-empty `reason`, carries NO statusOption (no fabricated value), and emits NO
//       `create`/`patch` op for it (the skip is decided BEFORE any write).
//   (b) APPLY HONESTY (source-grep src/notion/sync.mjs): an op flagged `skip`/`noop`
//       takes NO Notion spawn and NO write — the apply layer `continue`s on it before
//       reaching the spawn seam. Self-checked non-vacuous: the guard sees the skip/noop
//       short-circuit and the matcher fires on a planted spawn-on-skip form.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectMilestone } from "../../src/notion/projection.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SYNC = path.join(repoRoot, "src", "notion", "sync.mjs");

const DATA_SOURCE_ID = "ds-fixture";

// A statusMap MISSING the `in-review` entry (RESEARCH §A4 — `in-review` has no Notion
// default; an operator who omits it must get an honest skip, never a half-write).
const PARTIAL_STATUS_MAP = {
  "not-started": "Not started",
  "in-progress": "In progress",
  done: "Done",
};

const CONFIG = {
  dataSourceId: DATA_SOURCE_ID,
  tokenEnv: "NOTION_API_TOKEN",
  statusProperty: "Status",
  statusMap: PARTIAL_STATUS_MAP,
  relationProperty: "Sub-tasks",
};

// A fixture milestone "17" + a story "17/01" whose status (`in-review`) has NO map
// entry — the honest-skip case.
function fixtureItems() {
  return [
    { ref: "17", type: "milestone", slug: "notion-work-sync", meta: { title: "Notion Work-Board Sync", status: "in-progress" } },
    { ref: "17/01", type: "story", slug: "review-story", meta: { title: "A story in review", status: "in-review" } },
  ];
}

function mapping(entries = {}) {
  return { version: 1, dataSourceId: DATA_SOURCE_ID, entries };
}

function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export const archTests = [
  {
    name: "arch/notion-fail-honestly: an unmapped status projects a `skip` op with a reason — no statusOption, no create/patch op for it (honest, never a half-write)",
    async run() {
      const plan = projectMilestone({ items: fixtureItems(), config: CONFIG, mapping: mapping() });
      const reviewOp = plan.ops.find((o) => o.ref === "17/01");
      assert.ok(reviewOp, "the unmapped-status item appears in the plan");
      assert.equal(reviewOp.op, "skip", "an unmapped status is a `skip` op (honest per-item failure)");
      assert.ok(
        typeof reviewOp.reason === "string" && reviewOp.reason.length > 0,
        "the skip carries a non-empty `reason` naming the missing mapping"
      );
      // NEVER-HALF-WRITE: the skip carries NO statusOption (no fabricated board value)
      // and is NOT a create/patch op.
      assert.ok(
        reviewOp.properties == null || reviewOp.properties.statusOption == null,
        "the skip carries no statusOption (no fabricated board value)"
      );
      assert.notEqual(reviewOp.op, "create", "no `create` op is emitted for the unmapped-status item");
      assert.notEqual(reviewOp.op, "patch", "no `patch` op is emitted for the unmapped-status item");

      // The MAPPED milestone item is unaffected (its status IS mapped → a real op).
      const milestoneOp = plan.ops.find((o) => o.ref === "17");
      assert.notEqual(milestoneOp.op, "skip", "a mapped status is NOT skipped (the skip is per-item, not whole-sync)");
    },
  },
  {
    name: "arch/notion-fail-honestly: the apply layer issues NO Notion spawn and NO write for a `skip`/`noop` op (it short-circuits before the spawn seam)",
    async run() {
      const code = stripCommentsOnly(await readFile(SYNC, "utf8"));
      // The apply loop short-circuits skip/noop BEFORE the spawn seam — a guard that
      // tests `op.op === "noop" || op.op === "skip"` and `continue`s with no spawn.
      const SKIP_SHORTCIRCUIT = /op\.op\s*===\s*["']noop["']\s*\|\|\s*op\.op\s*===\s*["']skip["']/;
      assert.ok(
        SKIP_SHORTCIRCUIT.test(code),
        `${path.relative(repoRoot, SYNC)} short-circuits a skip/noop op (no spawn, no write) before the spawn seam`
      );
      // The spawn seam is reached ONLY on a create/patch op — a `notionSpawn(` call
      // sits under a `op.op === "create"` branch / the patch tail, never above the
      // skip/noop short-circuit. Structurally: the noop/skip branch carries no spawn.
      // We assert the skip/noop branch body (up to its `continue`) contains no spawn.
      const branchMatch = code.match(/op\.op\s*===\s*["']noop["']\s*\|\|\s*op\.op\s*===\s*["']skip["']\s*\)\s*\{([\s\S]*?)continue;/);
      assert.ok(branchMatch, "the skip/noop branch is present");
      assert.ok(
        !/notionSpawn\s*\(/.test(branchMatch[1]),
        "the skip/noop branch issues no notionSpawn (no Notion call for a skip/noop op)"
      );

      // Self-check (non-vacuous): the short-circuit matcher fires on the real form and
      // a spawn-on-skip would be visible inside the branch body if present.
      assert.ok(
        SKIP_SHORTCIRCUIT.test('if (op.op === "noop" || op.op === "skip") { continue; }'),
        "the skip/noop short-circuit matcher fires on the canonical form"
      );
      assert.ok(
        /notionSpawn\s*\(/.test('if (op.op === "skip") { await notionSpawn(argv); continue; }'),
        "a spawn-on-skip would be caught inside the branch body (the guard is non-vacuous)"
      );
    },
  },
];
