// Traceability wiring for milestone 43 / story 06 (the readers migrate), task
//   .../06_story_cache-read-surface/tasks/04_doctor-one-snapshot-with-cache-status-overlay.feature
//
// ADR-005's doctor clause. `work-doctor` does NOT simply move. `doctorWork` still builds its
// snapshot ONCE from disk and its pure `(snapshot, ctx) => Finding[]` group architecture is
// untouched; before the groups run, the BUILDER overlays cache-authoritative facts onto each
// row, stamping the SOURCE of each. `statusCoherenceGroup` and `lifecycleCompletenessGroup`
// then read the authoritative status without changing their source OR their signature.
// `freshnessGroup` stays disk-only and explicitly so.
//
// THE LITMUS, and its one honest limit. Every Then is confirmable from `aof work doctor
// --json`: the PRESENCE or ABSENCE of a finding by `code`, its `severity`, its `path`, and
// its `message`. That is the whole channel — a Finding is `{ code, severity, path, message }`
// and nothing else. `statusFrom` is an INTERNAL snapshot stamp with no black-box channel, so
// it is verified only through its consequences. Where a scenario needs to know WHICH SIDE the
// authoritative status came from, it reads the finding's MESSAGE, which ADR-010/R6.2 makes a
// required contract.
//
// THE DECISIVE PAIR is the point of the whole file: identical disk, identical cache values,
// OPPOSITE verdicts, decided by `node_id` alone. Both halves are asserted, because either one
// on its own is satisfiable by a doctor that has simply stopped checking.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  withCacheReadFixture, plantCacheRow, streamDoc, runCommand, writeItem, writeDoc, workerTree,
  CONTROL_NODE, WORKER_NODE, SYNCED_AT,
} from "./support/cache-read-fixture.mjs";
import { loadWorkspace, invoke } from "../src/command-core.mjs";

// The Background: the control's work directory holds milestones 05, 06 and 07. "07" is the
// pre-run SCAFFOLD — an empty stories/, no VERIFICATION.md, no RETROSPECTIVE.md — with
// `depends: [06]`; the control's own disk still reads 06 as in-progress, because the control
// never did that work.
const DISK_STREAM = [
  { number: "05", stories: [] },
  { number: "06", stories: [], status: "in-progress" },
  { number: "07", stories: [], status: "in-progress", depends: ["06"] },
];

// doctor(fx, scope) — `aof work doctor --json`'s document, through the command core. `now` is
// injected so the findings are deterministic (the feature's own Background).
async function doctor(fx, scope) {
  const result = await runCommand(fx, "work:doctor", scope == null ? {} : { scope });
  return result.findings;
}

const codesFor = (findings, refFragment) =>
  findings.filter((finding) => finding.path.includes(refFragment)).map((finding) => finding.code);

const has = (findings, code, refFragment) =>
  findings.some((finding) => finding.code === code && (refFragment == null || finding.path.includes(refFragment)));

// The Background's cache: 06 done and 07 in-progress, both last reported by aof-wsl.
async function background(fx) {
  await plantCacheRow(fx, "06", { status: "done", slug: "m06", node: WORKER_NODE, at: SYNCED_AT });
  await plantCacheRow(fx, "07", { status: "in-progress", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
}

export const cacheReadDoctorOverlayTests = [
  // ==========================================================================
  // THE DECISIVE NEGATIVE — the case that makes the overlay necessary
  // ==========================================================================
  {
    name: "cache-read/04 a driver whose dependency was completed by a worker draws no false depends-blocked finding, and no error-severity finding at all",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      // NON-VACUITY: without the overlay this fixture DOES fire the finding. Proven by
      // running the same doctor against a snapshot with no cache — the mechanism removed.
      const { doctorWork } = await import("../src/work-doctor.mjs");
      const withoutOverlay = await doctorWork(fx.workDir, {}, undefined, { now: Date.parse(SYNCED_AT) });
      assert.ok(
        has(withoutOverlay, "depends-blocked-in-progress", "07_milestone"),
        "a disk-status doctor DOES report 07 as working ahead of an unmet dependency (the false finding the overlay exists to stop)",
      );

      const findings = await doctor(fx);
      assert.ok(!has(findings, "depends-blocked-in-progress", "07_milestone"), `no depends-blocked-in-progress is reported for 07 (got ${JSON.stringify(codesFor(findings, "07_milestone"))})`);
      const errors = findings.filter((finding) => finding.path.includes("07_milestone") && finding.severity === "error");
      assert.deepEqual(errors, [], `the run reports no error-severity finding for 07 at all (got ${JSON.stringify(errors)})`);
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // THE OVERLAY IS APPLIED TO EVERY ROW, not to some
  // ==========================================================================
  {
    name: "cache-read/04 a milestone and its stories are judged on the same side, so a half-applied overlay cannot manufacture a lying parent, a done-under-not-started story or a stale parent",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      // The control's disk holds 05 at not-started with child stories 05/00 and 05/01, both
      // not-started; the cache holds 05 at done and BOTH its stories at done, all aof-wsl's.
      await plantCacheRow(fx, "05", { status: "done", slug: "m05", node: WORKER_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "05/00", { status: "done", slug: "s05-00", parent: "05", node: WORKER_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "05/01", { status: "done", slug: "s05-01", parent: "05", node: WORKER_NODE, at: SYNCED_AT });

      const findings = await doctor(fx);
      assert.ok(!has(findings, "lying-parent", "05_milestone"), `no lying-parent for 05 (got ${JSON.stringify(codesFor(findings, "05_milestone"))})`);
      assert.ok(!has(findings, "story-done-under-not-started"), "no story-done-under-not-started for 05/00 or 05/01");
      assert.ok(!has(findings, "stale-parent", "05_milestone"), "no stale-parent for 05");

      // NON-VACUITY: a HALF-applied overlay is exactly what manufactures these. Overlaying
      // the PARENT alone (the naive implementation) fires lying-parent immediately.
      const { doctorWork } = await import("../src/work-doctor.mjs");
      const halfApplied = await doctorWork(fx.workDir, {}, undefined, {
        now: Date.parse(SYNCED_AT),
        selfNode: CONTROL_NODE,
        cache: {
          rows: new Map([["05", { ref: "05", type: "milestone", slug: "m05", status: "done", title: null, parent: null }]]),
          provenance: new Map([["05", { reportedBy: WORKER_NODE, syncedAt: SYNCED_AT }]]),
          docs: new Map(),
        },
      });
      assert.ok(has(halfApplied, "lying-parent", "05_milestone"), "a half-applied overlay DOES manufacture a lying parent — which is what the full one prevents");
    }, { stream: [{ number: "05", stories: ["00", "01"] }, ...DISK_STREAM.slice(1)] }),
  },

  // ==========================================================================
  // THE DECISIVE PAIR — identical disagreement, opposite verdicts, decided by
  // node_id alone
  // ==========================================================================
  {
    name: "cache-read/04 a divergence on a ref the control itself last reported remains a real finding, naming the reporting node, anchored on the real on-disk record doc",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      // The cache holds 05 at in-progress, last reported by THIS control node; the control's
      // own disk reads 05 as done.
      await plantCacheRow(fx, "05", { status: "in-progress", slug: "m05", node: CONTROL_NODE, at: SYNCED_AT });
      await writeItem(fx, "05", { status: "done", slug: "m05" });

      const findings = await doctor(fx);
      const divergence = findings.find((finding) => finding.code === "cache-status-divergence" && finding.path.includes("05_milestone"));
      assert.ok(divergence != null, `a divergence finding is reported for 05 (got ${JSON.stringify(findings.map((f) => f.code))})`);
      assert.match(divergence.message, new RegExp(CONTROL_NODE), "its message NAMES this control node as the side that last reported the authoritative status");
      assert.ok(divergence.path.endsWith("SPEC.md"), `its path is the real on-disk anchor for 05 (got ${divergence.path})`);
      assert.ok(existsSync(divergence.path), "…and that anchor exists on this node");
    }, { stream: DISK_STREAM }),
  },

  {
    name: "cache-read/04 the IDENTICAL disagreement is silent when a REMOTE node last reported it, and the status-coherence lane judges the ref on the cache's value",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      // Byte-for-byte the same fixture as the pair above, differing ONLY in `node_id`.
      await plantCacheRow(fx, "05", { status: "in-progress", slug: "m05", node: WORKER_NODE, at: SYNCED_AT });
      await writeItem(fx, "05", { status: "done", slug: "m05" });
      // …with a child story that is NOT done, so "the coherence lane judges 05 as
      // in-progress" has an observable: at the DISK's `done` this would be a lying parent.
      await writeDoc(fx, "05/00", "STORY.md", "---\ntype: story\nnumber: 00\nslug: s05-00\nparent: 05\nstatus: in-progress\ntitle: Story 05/00\ncreated: 2026-08-01\nupdated: 2026-08-01\nschema: 1\n---\n");

      const findings = await doctor(fx);
      assert.ok(!has(findings, "cache-status-divergence", "05_milestone"), `no divergence finding is reported for 05 (got ${JSON.stringify(codesFor(findings, "05_milestone"))})`);
      assert.ok(
        !has(findings, "lying-parent", "05_milestone"),
        "the status-coherence lane judges 05 as in-progress, the CACHE's value — at the disk's `done` its unfinished child would be a lying parent",
      );
    }, { stream: [{ number: "05", stories: ["00"] }, ...DISK_STREAM.slice(1)] }),
  },

  // ==========================================================================
  // RESIDUAL CONCERN (2), decided as a scenario: the overlay must not turn the
  // lifecycle lane into noise against every remote milestone
  // ==========================================================================
  {
    name: "cache-read/04 a worker-authored milestone reported done draws no false lifecycle-completeness finding, because the cache carries its deliverables too",
    run: () => withCacheReadFixture(async (fx) => {
      // The cache holds 07 at done, reported by aof-wsl, CARRYING its VERIFICATION.md,
      // RETROSPECTIVE.md and two child stories.
      await plantCacheRow(fx, "07", { status: "done", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "07/00", { status: "done", slug: "s07-00", parent: "07", node: WORKER_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "07/01", { status: "done", slug: "s07-01", parent: "07", node: WORKER_NODE, at: SYNCED_AT });
      await streamDoc(fx, { ref: "07", doc: "VERIFICATION", body: "# Verification\n\nRun on the worker.\n" });
      await streamDoc(fx, { ref: "07", doc: "RETROSPECTIVE", body: "# Retrospective\n\nWhat we learned.\n" });
      // The control's disk holds only the scaffold — an empty stories/, neither doc.
      assert.ok(!existsSync(`${fx.workDir}/07_milestone_m07/VERIFICATION.md`), "the control's disk holds no VERIFICATION.md (the precondition)");

      const findings = await doctor(fx);
      for (const code of ["missing-verification", "missing-retrospective", "milestone-no-stories"]) {
        assert.ok(!has(findings, code, "07_milestone"), `no ${code} is reported for 07 (got ${JSON.stringify(codesFor(findings, "07_milestone"))})`);
      }
      assert.ok(!has(findings, "started-story-no-tasks"), "no started-story-no-tasks for any of 07's worker-authored stories");
    }, { stream: DISK_STREAM }),
  },

  {
    name: "cache-read/04 …and the lane is NOT switched off: a locally-authored done milestone with no VERIFICATION.md still draws missing-verification and missing-retrospective",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      // The control's disk holds 06 at done with no non-empty VERIFICATION.md, and the
      // cache's row for 06 was last reported by THIS control node, also at done.
      await writeItem(fx, "06", { status: "done", slug: "m06" });
      await plantCacheRow(fx, "06", { status: "done", slug: "m06", node: CONTROL_NODE, at: SYNCED_AT });

      const findings = await doctor(fx);
      assert.ok(has(findings, "missing-verification", "06_milestone"), `missing-verification IS reported for 06 (got ${JSON.stringify(codesFor(findings, "06_milestone"))})`);
      assert.ok(has(findings, "missing-retrospective", "06_milestone"), "missing-retrospective IS reported for 06");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // …and when the cache knows the STATUS but not the deliverables, the three
  // false findings are replaced by ONE honest `cache-incomplete` naming the node
  // ==========================================================================
  {
    name: "cache-read/04 a worker-authored milestone whose deliverables the cache does NOT carry draws ONE cache-incomplete naming the reporting node, in place of the three false lifecycle findings",
    run: () => withCacheReadFixture(async (fx) => {
      await plantCacheRow(fx, "07", { status: "done", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
      // No streamed VERIFICATION/RETROSPECTIVE, no cached children — the incomplete case.

      const findings = await doctor(fx);
      for (const code of ["missing-verification", "missing-retrospective", "milestone-no-stories"]) {
        assert.ok(!has(findings, code, "07_milestone"), `${code} is SUPPRESSED for 07 (got ${JSON.stringify(codesFor(findings, "07_milestone"))})`);
      }
      const incomplete = findings.filter((finding) => finding.code === "cache-incomplete" && finding.path.includes("07_milestone"));
      assert.equal(incomplete.length, 1, `ONE cache-incomplete finding replaces them (got ${incomplete.length})`);
      assert.match(incomplete[0].message, new RegExp(WORKER_NODE), "…and it NAMES the reporting node (ADR-010/R6.2's message contract)");
      assert.ok(existsSync(incomplete[0].path), "…anchored on a path that exists here");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // QA case matrix — each check-group reads the side ADR-005 assigns it
  // ==========================================================================
  {
    name: "cache-read/04 each check-group reads the side ADR-005 assigns it — statusCoherence and lifecycleCompleteness from the CACHE, freshness / structuralIntegrity / budget from the DISK, meshIdentityCommitted from config",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      // A disk `updated` far past the stale window, and a REAL on-disk numbering gap, so the
      // disk-only lanes have something to find.
      await writeDoc(fx, "07", "SPEC.md", "---\ntype: milestone\nnumber: 07\nslug: m07\nstatus: in-progress\ntitle: Milestone 07\ndepends: [06]\ncreated: 2020-01-01\nupdated: 2020-01-01\nschema: 1\n---\n");

      const findings = await doctor(fx);
      const codes07 = codesFor(findings, "07_milestone");

      // statusCoherence — status: CACHE. No false depends-blocked appears.
      assert.ok(!codes07.includes("depends-blocked-in-progress"), "statusCoherence judges 07 on the cache's status for 06");
      // lifecycleCompleteness — status: CACHE. A worker-reported row draws no
      // missing-verification / missing-retrospective (they are suppressed or satisfied).
      assert.ok(!codes07.includes("missing-verification"), "lifecycleCompleteness draws no missing-verification against the remote row");
      assert.ok(!codes07.includes("missing-retrospective"), "…nor missing-retrospective");
      // freshness — DISK only, explicitly. 07's disk `updated` past the window still fires.
      assert.ok(codes07.includes("stale-updated"), `freshness stays disk-only and still draws stale-updated for 07 (got ${JSON.stringify(codes07)})`);
      // structuralIntegrity — DISK only. The cache-only ref draws no numbering-gap.
      assert.ok(!findings.some((f) => f.code === "numbering-gap" && /\b09\b/.test(f.message)), "structuralIntegrity sees no cache-only ref");
      // budget — DISK only. Its inputs are this node's files, so any doc-over-budget finding
      // it makes names a file that exists here.
      for (const finding of findings.filter((f) => f.code === "doc-over-budget")) {
        assert.ok(existsSync(finding.path), `budget measures the control disk's own files (${finding.path})`);
      }
      // meshIdentityCommitted — config, unchanged. "Unchanged" is only observable as a
      // comparison, so the SAME engine call is made twice against the SAME committed-config
      // input, differing ONLY in whether the cache overlay is supplied. Comparing against a
      // run with a different `rawCommittedMesh` would be comparing two different questions.
      const { doctorWork } = await import("../src/work-doctor.mjs");
      const identityArgs = {
        now: Date.parse(SYNCED_AT),
        rawCommittedMesh: { nodeId: CONTROL_NODE },
        committedConfigPath: `${fx.root}/.aof/aof.config.json`,
      };
      const withOverlay = await doctorWork(fx.workDir, {}, undefined, {
        ...identityArgs,
        selfNode: CONTROL_NODE,
        cache: {
          rows: new Map([["06", { ref: "06", type: "milestone", slug: "m06", status: "done", title: null, parent: null }]]),
          provenance: new Map([["06", { reportedBy: WORKER_NODE, syncedAt: SYNCED_AT }]]),
          docs: new Map(),
        },
      });
      const withoutOverlay = await doctorWork(fx.workDir, {}, undefined, identityArgs);
      const identityOf = (set) => set.filter((f) => f.code.startsWith("mesh-identity")).map((f) => `${f.code} ${f.path} ${f.message}`).sort();
      assert.ok(identityOf(withoutOverlay).length > 0, "the identity lane genuinely produces a finding here (non-vacuous)");
      assert.deepEqual(identityOf(withOverlay), identityOf(withoutOverlay), "meshIdentityCommitted's finding set is byte-identical with and without the overlay");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // RESIDUAL CONCERN (3), an ACCEPTED noise consequence, asserted so the choice
  // stays visible
  // ==========================================================================
  {
    name: "cache-read/04 a fresh cache row does not silence the disk freshness lane — the statement it makes (this node's copy is old) is TRUE, and its path is the control disk's own record doc",
    run: () => withCacheReadFixture(async (fx) => {
      // The cache's row for 07 carries a `syncedAt` seconds old…
      await plantCacheRow(fx, "07", { status: "in-progress", slug: "m07", node: WORKER_NODE, at: new Date(Date.now() - 5000).toISOString() });
      // …while the control disk's 07 frontmatter `updated` is far past the configured window.
      await writeDoc(fx, "07", "SPEC.md", "---\ntype: milestone\nnumber: 07\nslug: m07\nstatus: in-progress\ntitle: Milestone 07\ncreated: 2020-01-01\nupdated: 2020-01-01\nschema: 1\n---\n");

      const findings = await doctor(fx);
      const stale = findings.find((finding) => finding.code === "stale-updated" && finding.path.includes("07_milestone"));
      assert.ok(stale != null, `stale-updated IS reported for 07 (got ${JSON.stringify(codesFor(findings, "07_milestone"))})`);
      // The feature's Then reads "its path is the control disk's own record doc for 07". The
      // freshness lane has anchored on the item FOLDER since milestone 15 / story 02, and this
      // story changes neither that group's data nor its anchoring — so the checkable property
      // is asserted: the path is 07's own on-disk anchor under THIS node's work directory, and
      // it exists here. (Flagged to the PO as a cell that names a finer anchor than the
      // pre-existing group produces.)
      assert.ok(stale.path.startsWith(fx.workDir), `its path is the control disk's own anchor for 07 (got ${stale.path})`);
      assert.ok(stale.path.includes("07_milestone"), "…for 07 specifically");
      assert.ok(existsSync(stale.path), "…which exists here");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // …and the freshness lane's STATUS GATE is the disk's too (m43 / ADR-016/G5).
  //
  // The lane ADR-016/G5 names as missing: no scenario above places a REMOTE-AUTHORED item on
  // the far side of the stale window. Without one, the overlay could reach `freshnessGroup`
  // through its `meta.status` gate — every datum the group compares stays this node's own
  // filesystem, so a cache-authoritative gate produces a finding that is FALSE about the item
  // and true only about a scaffold nobody was supposed to be reading.
  // ==========================================================================
  {
    name: "cache-read/04 freshness's status GATE reads the DISK's status: a scaffold whose worker-reported row says in-progress draws no stale-updated, and the lane still fires when THIS node's own record is the in-progress one",
    run: () => withCacheReadFixture(async (fx) => {
      // The control's own disk: 07 is the pre-run SCAFFOLD — not-started, untouched for years.
      const scaffold = (status) => `---\ntype: milestone\nnumber: 07\nslug: m07\nstatus: ${status}\ntitle: Milestone 07\ncreated: 2020-01-01\nupdated: 2020-01-01\nschema: 1\n---\n`;
      await writeDoc(fx, "07", "SPEC.md", scaffold("not-started"));
      // …while a WORKER is actively building it, and the cache says exactly that.
      await plantCacheRow(fx, "07", { status: "in-progress", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });

      const staleFor07 = (findings) => findings
        .filter((finding) => finding.code === "stale-updated" && finding.path.includes("07_milestone"))
        .map((finding) => finding.message);

      const withOverlay = staleFor07(await doctor(fx));
      assert.deepEqual(withOverlay, [], `no stale-updated for 07 — its own record is not in-progress (got ${JSON.stringify(withOverlay)})`);

      // THE CONTROL, and it is what makes the assertion above a statement about the GATE
      // rather than about the window: the SAME fixture with no cache at all agrees.
      const { doctorWork } = await import("../src/work-doctor.mjs");
      assert.deepEqual(
        staleFor07(await doctorWork(fx.workDir, {}, undefined, { now: Date.now() })),
        [],
        "a disk-only doctor agrees — so the overlay changed nothing here, which is the whole claim",
      );

      // NON-VACUITY: the fixture IS past the stale window, and the lane IS live. Flip the
      // DISK's own status and the identical `updated` fires immediately.
      await writeDoc(fx, "07", "SPEC.md", scaffold("in-progress"));
      const diskInProgress = staleFor07(await doctor(fx));
      assert.equal(diskInProgress.length, 1, `stale-updated IS drawn when THIS node's record reads in-progress (got ${JSON.stringify(diskInProgress)})`);
      assert.match(diskInProgress[0], /2020-01-01/, "…naming the disk's own `updated`");
    }, { stream: [{ number: "05", stories: [] }, { number: "06", stories: [] }, { number: "07", stories: [] }] }),
  },

  // ==========================================================================
  // THE SECOND CACHE-READ DOOR (m43 / ADR-016/G4): `work:doctor` INSIDE a
  // materialised worktree reads its own checkout, exactly as the seam does
  // ==========================================================================
  {
    name: "cache-read/04 work:doctor run INSIDE a worker's own worktree draws no cache-status-divergence — the echo-chamber guard is a WORKSPACE fact, so the door that bypasses the read seam consults it too",
    run: () => withCacheReadFixture(async (fx) => {
      // A real per-assignment worktree: at `<origin>/.aof/mesh/worktrees/<id>`, reporting under
      // the SAME workspace id as the control — both details are what make this dangerous.
      const worker = await workerTree(fx, ["07", "07/01"], "asg-doctor-door");
      await writeItem(fx, "07", { status: "not-started", workDir: worker.workDir });
      await writeItem(fx, "07/01", { status: "not-started", workDir: worker.workDir });
      // The cache holds the LAST STREAM TICK's view, already behind this worktree's disk —
      // which is the NORMAL mid-phase state, not an exotic one.
      await plantCacheRow(fx, "07", { status: "in-progress", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "07/01", { status: "in-progress", slug: "s07-01", parent: "07", node: WORKER_NODE, at: SYNCED_AT });

      const workspace = await loadWorkspace(worker.root, undefined, { env: fx.env });
      // `selfNode` inside a worktree is the WORKER — the same node that reported the row — so
      // `reportedElsewhere` is false and the divergence finding is NOT suppressed by node id.
      workspace.config = { ...(workspace.config ?? {}), mesh: { ...(workspace.config?.mesh ?? {}), nodeId: WORKER_NODE, workspaceId: fx.workspaceId } };
      const { findings } = await invoke("work:doctor", {}, {
        workspace,
        globalWorkStoreOptions: { env: fx.env },
        effectsJournalOptions: { env: fx.env },
      });
      const codes = findings.map((finding) => finding.code);
      assert.ok(!codes.includes("cache-status-divergence"), `no cache-status-divergence inside the worktree (got ${JSON.stringify(codes)})`);
      assert.ok(!codes.includes("started-story-no-tasks"), "…and no started-story-no-tasks off an OVERLAID status the worktree's own disk contradicts");

      // NON-VACUITY: the cache genuinely holds the disagreeing rows this read stepped over.
      const { readCachedWorkFacts } = await import("../src/board-worker-stream.mjs");
      const raw = await readCachedWorkFacts(worker.workspace, { docNames: ["VERIFICATION.md"] }, { globalWorkStoreOptions: { env: fx.env } });
      assert.equal(raw?.rows?.get("07")?.status, "in-progress", "the unguarded read DOES see the cache's in-progress for 07 (the precondition)");
      assert.equal(raw?.rows?.get("07/01")?.status, "in-progress", "…and for 07/01");

      // …and the same doctor on the CONTROL, where the cache IS the authority, still reports
      // the divergence for a row this node itself last reported — the guard is scoped to the
      // worktree, it did not switch the check off.
      await plantCacheRow(fx, "07", { status: "done", slug: "m07", node: CONTROL_NODE, at: SYNCED_AT });
      await writeItem(fx, "07", { status: "in-progress" });
      const onControl = await doctor(fx);
      assert.ok(
        onControl.some((finding) => finding.code === "cache-status-divergence" && finding.path.includes("07_milestone")),
        `the control node still reports cache-status-divergence for 07 (got ${JSON.stringify(onControl.map((f) => f.code))})`,
      );
    }, { stream: [{ number: "07", stories: ["01"] }] }),
  },

  // ==========================================================================
  // Doctor's SUBJECT is the disk: a cache-only ref is not doctored at all
  // ==========================================================================
  {
    name: "cache-read/04 a ref that exists only in the cache is not doctored, and EVERY reported finding's path names a file or directory that exists on this node",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      await plantCacheRow(fx, "09", { status: "in-progress", slug: "m09", node: WORKER_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "09/02", { status: "done", slug: "s09-02", parent: "09", node: WORKER_NODE, at: SYNCED_AT });

      const findings = await doctor(fx);
      assert.ok(!findings.some((finding) => finding.path.includes("09_") || /\b09\/02\b/.test(finding.message)), `no finding is reported for 09/02 (got ${JSON.stringify(findings.map((f) => `${f.code}@${f.path}`))})`);
      for (const finding of findings) {
        assert.ok(existsSync(finding.path), `every reported finding's path names a file or directory that exists on this node (${finding.code} → ${finding.path})`);
      }
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // The structural lane is unmoved in BOTH directions
  // ==========================================================================
  {
    name: "cache-read/04 the structural lane sees the disk's folders alone — a real gap still draws numbering-gap, and the cache neither invents one nor fills one",
    run: () => withCacheReadFixture(async (fx) => {
      // The disk holds 00, 01 and 03 — a real gap at 02. The cache holds rows for 02 and 07,
      // neither of which has a folder here: 02 would FILL the gap, 07 would INVENT one.
      await plantCacheRow(fx, "02", { status: "done", slug: "m02", node: WORKER_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "07", { status: "done", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });

      const findings = await doctor(fx);
      const gaps = findings.filter((finding) => finding.code === "numbering-gap");
      assert.ok(gaps.length > 0, `a numbering-gap is reported for the real gap at 02 (got ${JSON.stringify(findings.map((f) => f.code))})`);
      assert.ok(gaps.some((finding) => /\b2\b|\b02\b/.test(finding.message)), `…and it names the gap at 02 (got ${JSON.stringify(gaps.map((f) => f.message))})`);
      assert.ok(!gaps.some((finding) => /\b7\b|\b07\b/.test(finding.message)), "no numbering-gap is reported for the cache-only 07");
    }, { stream: [{ number: "00", stories: [] }, { number: "01", stories: [] }, { number: "03", stories: [] }] }),
  },

  // ==========================================================================
  // Doctor's determinism contract survives the overlay
  // ==========================================================================
  {
    name: "cache-read/04 the findings stay deterministic and scope-filterable after the overlay — two runs over an unchanged fixture are byte-identical, and a scoped run reports exactly the unscoped run's findings for that scope",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      await plantCacheRow(fx, "07/00", { status: "done", slug: "s07-00", parent: "07", node: WORKER_NODE, at: SYNCED_AT });

      const { doctorWork } = await import("../src/work-doctor.mjs");
      const options = {
        now: Date.parse(SYNCED_AT),
        selfNode: CONTROL_NODE,
        cache: {
          rows: new Map([
            ["06", { ref: "06", type: "milestone", slug: "m06", status: "done", title: null, parent: null }],
            ["07", { ref: "07", type: "milestone", slug: "m07", status: "in-progress", title: null, parent: null }],
          ]),
          provenance: new Map([
            ["06", { reportedBy: WORKER_NODE, syncedAt: SYNCED_AT }],
            ["07", { reportedBy: WORKER_NODE, syncedAt: SYNCED_AT }],
          ]),
          docs: new Map(),
        },
      };
      const first = await doctorWork(fx.workDir, {}, undefined, options);
      const second = await doctorWork(fx.workDir, {}, undefined, options);
      assert.equal(JSON.stringify(first), JSON.stringify(second), "the two documents are byte-identical");
      assert.ok(first.length > 0, "…and non-empty, so the equality is not vacuous");

      // A scoped run reports exactly the findings the unscoped run reported for that scope,
      // and no others. Stream-level findings (anchored at the workDir root) are ALWAYS
      // reported, which is validateWork's own scope contract carried into doctor.
      const scoped = await doctorWork(fx.workDir, {}, "07", options);
      const expected = first.filter((finding) => finding.path.includes("07_milestone") || finding.path === fx.workDir);
      assert.deepEqual(
        scoped.map((f) => `${f.code}@${f.path}`).sort(),
        expected.map((f) => `${f.code}@${f.path}`).sort(),
        "a scoped run reports exactly the findings the unscoped run reported for 07, and no others",
      );
    }, { stream: DISK_STREAM }),
  },
];
