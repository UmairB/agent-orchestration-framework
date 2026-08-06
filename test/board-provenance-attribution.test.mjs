// Traceability wiring for milestone 43 / story 04 / task 04 —
// tasks/04_provenance-line-and-node-attribution.feature (@executable).
//
// THE RULE BEING ENCODED, in one sentence: the cache is now the read surface, so
// every fact on the board is a copy of something a machine said at some instant —
// and the reader must always be able to see WHOSE and WHEN, without asking.
// Attribution used to be an EXECUTION detail (the provenance box rendered only
// when `item.execution` existed); this milestone makes it a first-class fact of
// the item, which is why the SETTLED and NEVER-EXECUTED cases are the ones that
// prove the change — a settled item is exactly the item most likely to be old.
//
// DRIVEN THE WAY THE TASK'S LITMUS REQUIRES: every Then below is read off the
// RENDERED ELEMENT TREE of the REAL, UNMODIFIED production <Board/> (and the real
// <Fleet/>), mounted headlessly against the REAL faces over an isolated global
// store, on a controllable clock. The presence, ORDER and TEXT of the provenance
// lines, and the ABSENCE of the retired copy, are all element facts. No source
// read anywhere in this file.
//
// PRODUCER-FED THROUGHOUT. A lane says "umairs-mac-mini reported this workspace
// twelve minutes ago" by making the REAL publisher write exactly that into the
// REAL store; "the mesh dispatched this item" by minting a REAL assignment record
// through the production assembler + writer; and "the cache holds this doc" by
// writing it through the REAL content upsert. The face then reads all of it back
// through the production mappers. A green lane therefore means the store recorded
// it, the mapper mapped it and the route served it.
//
// ── BOTH SIDES OF THE "IS THIS ROW MINE" FORK ARE COVERED (43/ADR-015 F5) ────
//
// Every provenance and resync lane in this story states a REMOTE reporter
// (`umairs-mac-mini`), which left the whole suite blind to the case where the
// reporter is THIS node — the COMMON deployment, not the exotic one, and the case
// in which the panel had silently retired its m03 empty states. The last lane in
// this file is the fork read from both sides in one place. The reusable half of
// the lesson: a surface whose behaviour forks on "is this row mine" needs at least
// one lane on each side of that fork.
//
// ── TWO THINGS THIS FILE FLAGS RATHER THAN PAPERS OVER ──────────────────────
//
// (DEV-3 was here and is CLOSED, 2026-08-03. It flagged the two `(this node)`
// Examples cells as a contract with no producer: the clause needs the board to
// know WHICH NODE IT IS RUNNING ON, and `/api/work/list`'s envelope carried only
// `{ items, stalenessSeconds }`. The face now states `nodeId` on that envelope —
// the one-key change of exactly the shape ADR-010 R4.1 made for the window — so
// both cells are asserted END TO END below, through the real face and the real
// mappers, like every other Then in this file.)
//
// DEV-6 (RAISED — the DEV-1 defect class, at a second address). The headline
// outline's `running on a worker` row states `synced 4s ago`. The product has ONE
// relative-time formatter (`relativeTime`, runs.mjs) and it renders any span
// under five seconds as `just now`, so `4s ago` is a string this ramp cannot
// produce without growing a second time vocabulary — which is the very thing
// DESIGN forbids. This is the SAME cell defect the PO already corrected in task
// 03 (`4 seconds` → `10 seconds`). The lane honours the RULE and states the row's
// actual subject — a fresh, seconds-grain age on an EXECUTING item, beside an
// unchanged line 1 — at `10s`. The cell, not the code, is what needs the edit.
//
// DEV-5 (DEVIATION, stated). The per-doc lanes use the milestone's VERIFICATION
// and RETROSPECTIVE tabs where the scenarios name SPEC. The reason is structural
// and the task file already names it: `work:doc` prefers LOCAL DISK and only
// falls through to the cached artifact on ENOENT, and "serving the doc body out
// of the cache is story 06's job". A milestone's own `SPEC.md` must exist on disk
// for the milestone to be LISTED at all, so its SPEC tab can never reach the
// cache today — whereas VERIFICATION is the doc most likely to be authored on a
// WORKER (that is where `aof:verify` runs) and absent from the control checkout,
// which makes it the truest subject this milestone has. Every clause of both
// scenarios — the line's TEXT, its position as the region's FIRST child, the
// markdown following it, no second badge, no second Resync, the row and the doc
// judged SEPARATELY, and the reworded placeholder's exact sentence shape and
// dashed treatment — is asserted verbatim; only the doc's NAME differs.
import assert from "node:assert/strict";
import { freshness } from "../ui/src/board/freshness.mjs";
import { withBoardFace } from "./support/board-face-fixture.mjs";
import { withBoardApp, BOARD_EPOCH, findAll, visibleTextOf } from "./support/board-app-harness.mjs";
import { withPublishedAssignFixture } from "./support/mesh-ui-assign-fixture.mjs";
import { withFleetApp } from "./support/fleet-app-harness.mjs";

const WINDOW = 300;
const NODE = "umairs-mac-mini";
const CONTROL = "aof-control";

const at = (secondsFromNow) => new Date(BOARD_EPOCH + secondsFromNow * 1000).toISOString();

// The badge's PINNED class signature, re-derived here so the fleet lane (whose
// harness this story may not extend) can find one off the same tokens the board
// harness uses.
const BADGE_TOKENS = ["border-dashed", "border-muted-foreground/45", "rounded-full", "px-2", "text-[11px]", "font-semibold"];
const isBadgeSpan = (node) => node?.type === "span"
  && typeof node.props?.className === "string"
  && BADGE_TOKENS.every((token) => node.props.className.includes(token));

export const boardProvenanceAttributionTests = [
  // ══ Scenario Outline: the provenance line renders for EVERY cache-published
  //    item, executing or not ══
  {
    name: "board-provenance/04 the provenance line renders for EVERY cache-published item, executing or not — running, settled after a run, and never dispatched at all",
    run: async () => {
      // ── running on a worker: line 1 present exactly as today, line 2 new ──
      // DEV-6: the cell's `4s` is unrenderable by the product's one formatter;
      // the row's SUBJECT (a fresh seconds-grain age on an executing item) is
      // asserted at the nearest age that formatter can express.
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-10));
        await face.dispatched("43/04", { node: NODE, state: "running", at: at(-60) });
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const detail = app.detail();
          assert.ok(detail.provenanceBox, "running on a worker: the provenance box is present");
          assert.equal(detail.provenanceLine, `synced 10s ago · from ${NODE}`, "…and its line 2 states who reported the copy and when");
          // Line 1 keeps its EXISTING rule verbatim, links and all (a live run
          // with no captured session says where to watch it) — the scenario's
          // "present, exactly as today" is a claim about it being UNCHANGED, not
          // about it being reduced.
          assert.ok(
            detail.executionLine.startsWith(`running on ${NODE}`),
            `…while line 1 — the execution facts — is present, exactly as today (${JSON.stringify(detail.executionLine)})`,
          );
          assert.ok(detail.executionLine.includes("watch on the fleet →"), "…including its existing fleet link");
        });
      });

      // ── settled after a run: the worker stopped reporting, so the row is the
      //    one most likely to be old — and it is the case "only while executing"
      //    used to leave unattributed.
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await face.dispatched("43/04", { node: NODE, state: "done", at: at(-600) });
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const detail = app.detail();
          assert.equal(detail.provenanceLine, `stale · synced 12m ago · from ${NODE}`, "settled after a run: line 2 states the stale copy's age and reporter");
          assert.equal(detail.executionLine, `last run done on ${NODE}`, "…and line 1 still names the finished run and its node");
        });
      });

      // ── never executed, remote: NO execution record at all, so line 1 is
      //    absent — and line 2 is exactly what this milestone adds.
      await withBoardFace(async (face) => {
        await face.reportedBy("aof-wsl", at(-30));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const detail = app.detail();
          assert.ok(detail.provenanceBox, "never executed, remote: the box renders even though nothing was ever dispatched");
          assert.equal(detail.provenanceLine, "synced 30s ago · from aof-wsl");
          assert.equal(detail.executionLine, null, "…and line 1 is absent, its existing rule unchanged");
        });
      });

      // ── never executed, LOCAL: the control node is simply one more writer into
      //    the cache, so its own rows are attributed like anyone else's — by name,
      //    plus the clause that says which machine "here" is. The board is running
      //    ON `aof-control` (the face's own configured identity, which it states on
      //    the list envelope), and `aof-control` is who published this row.
      await withBoardFace(async (face) => {
        await face.reportedBy(CONTROL, at(-30));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const detail = app.detail();
          assert.equal(detail.executionLine, null, "never executed, local: line 1 is absent");
          assert.equal(
            detail.provenanceLine,
            `synced 30s ago · from ${CONTROL} (this node)`,
            "…and line 2 reads the full cell — attributed by name, and marked as this node's own",
          );
        });
      }, { nodeId: CONTROL });
    },
  },

  // ══ Scenario Outline: a row this node published reads `(this node)`; a row
  //    another node published names it plainly ══
  {
    name: "board-provenance/04 a row names its reporting node plainly whoever wrote it — and never omits the reporter on the grounds that it is the local one",
    run: async () => {
      // The Examples table, verbatim: this board is RUNNING ON "aof-control" (its
      // own configured identity, which the face states once on the list envelope),
      // and each row is REPORTED BY a different node. Only the row this node
      // published earns the clause; the other two are named plainly.
      const rows = [
        ["control-authored", CONTROL, `synced 30s ago · from ${CONTROL} (this node)`],
        ["worker-authored", NODE, `synced 30s ago · from ${NODE}`],
        ["the WSL test node", "aof-wsl", "synced 30s ago · from aof-wsl"],
      ];
      for (const [label, reporter, line] of rows) {
        await withBoardFace(async (face) => {
          await face.reportedBy(reporter, at(-30));
          await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
            const rendered = app.detail().provenanceLine;
            assert.equal(rendered, line, `${label}: the line reads the cell`);
            // "…and it never omits the reporting node on the grounds that it is
            // the local one": the clause is ADDITIVE to the name, never a
            // substitute for it, which is only observable on the local row.
            assert.ok(rendered.includes(`from ${reporter}`), `${label}: …naming the reporting node, local or not`);
          });
        }, { nodeId: CONTROL });
      }

      // THE HONEST DEGRADE, end to end and CONFIGURATION-FED: a machine with no
      // mesh identity configured at all. The face states `nodeId: null` — it does
      // not invent one — so NO row is marked local, not even the one this very
      // machine published, and every row still names its reporter plainly. A board
      // that does not know which machine it is must not guess.
      await withBoardFace(async (face) => {
        await face.reportedBy(CONTROL, at(-30));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(
            app.detail().provenanceLine,
            `synced 30s ago · from ${CONTROL}`,
            "with no node identity configured, NO row is marked local — the honest degrade, never a guess",
          );
        });
      }, { nodeId: null });

      // …and the composition itself, on the ramp, so the clause's exact copy is
      // pinned at its source as well as through the surfaces that render it.
      assert.equal(
        freshness({ syncedAt: at(-30), reportedBy: CONTROL }, { now: BOARD_EPOCH, windowSeconds: WINDOW, thisNode: CONTROL }).label,
        `synced 30s ago · from ${CONTROL} (this node)`,
        "the ` (this node)` clause is the ramp's, appended to the reporter's name rather than replacing it",
      );
    },
  },

  // ══ Scenario Outline: an unknown instant or reporter degrades to explicit
  //    words, never to an omitted line and never to a guess ══
  {
    name: "board-provenance/04 an unknown instant or an unknown reporter degrades to EXPLICIT WORDS — never to an omitted line, never to a badge, and never to a guess",
    run: async () => {
      const rows = [
        ["instant unknown", ["syncedAt"], "synced time unknown · from aof-wsl"],
        ["both unknown", ["syncedAt", "reportedBy"], "synced time unknown · reporting node unknown"],
        ["reporter unknown, age known", ["reportedBy"], "synced 30s ago · reporting node unknown"],
      ];
      for (const [label, forgotten, line] of rows) {
        await withBoardFace(async (face) => {
          await face.reportedBy("aof-wsl", at(-30));
          await face.forget("43/04", forgotten);
          await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
            const detail = app.detail();
            assert.equal(detail.provenanceLine, line, `${label}: the unknown is STATED`);
            assert.ok(detail.provenanceLabel, `${label}: …and the line is present in the DOM — the unknown is stated, not dropped`);
            assert.equal(detail.badge, null, `${label}: no badge is rendered for that row`);
          });
        });
      }
    },
  },

  // ══ Scenario: a workspace that is not mesh-enabled shows no provenance region
  //    at all ══
  {
    name: "board-provenance/04 a workspace that is not mesh-enabled shows NO provenance region at all — no box, no line, no badge, no Resync anywhere on the panel",
    run: async () => {
      await withBoardFace(async (face) => {
        // Nothing is ever published, so the cache holds no rows for this
        // workspace and the face leaves every row BYTE-IDENTICAL — no provenance
        // keys at all, which is the wire's non-mesh shape.
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const detail = app.detail();
          assert.ok(detail.panel, "the detail panel renders (non-vacuous)");
          assert.equal(detail.provenanceBox, null, "there is no provenance box");
          assert.equal(detail.provenanceLine, null, "…no provenance line");
          assert.equal(detail.badge, null, "…no badge");
          assert.equal(app.resyncControls().length, 0, "…and no Resync anywhere on the panel");
          // The panel is otherwise the plain local board it is today.
          assert.ok(detail.title.length > 0, "the title still renders");
          assert.deepEqual(app.tabs(), ["STORY", "TASKS", "RUNS"], "…and the tab set is unchanged");
        });
      });
    },
  },

  // ══ Scenario: a doc body carries its own provenance line at the top, above
  //    the rendered markdown ══
  {
    name: "board-provenance/04 a doc body carries its OWN provenance line as the region's FIRST child, above the rendered markdown — and the row and the doc are judged SEPARATELY",
    run: async () => {
      await withBoardFace(async (face) => {
        // The ROW was reported 30 seconds ago; the cached DOC two hours ago. A
        // doc can be older than the row that names it, and each carries its own
        // `node_id` + `updated_at`, so the two verdicts are independent.
        await face.reportedBy(NODE, at(-30));
        await face.reportedDoc("43", "VERIFICATION", "# Verification\n\nRun on the worker.\n", { node: NODE, at: at(-7200) });
        await withBoardApp({ url: face.url, hash: "43" }, async (app) => {
          await app.openTab("VERIFICATION");
          const region = app.docRegion();
          assert.ok(region, "the doc region renders");
          assert.equal(
            region.firstChildText,
            `stale · synced 2h ago · from ${NODE}`,
            "the doc region's FIRST child is a single provenance line — before the reader reads the body, not after",
          );
          assert.equal(region.provenanceLine, `stale · synced 2h ago · from ${NODE}`);
          assert.ok(region.markdown, "…and the rendered markdown FOLLOWS it");
          assert.ok(region.markdownHtml.includes("<h1>Verification</h1>"), "…as real rendered markup, not raw text");
          assert.equal(region.badges.length, 0, "the doc region carries no badge of its own");
          assert.equal(region.resyncControls.length, 0, "…and no Resync of its own — the header's ONE door serves the item and its artifacts");

          // The HEADER's own line is unchanged and unprefixed: the row is fresh
          // while its doc is stale, which is the whole point of two subjects.
          assert.equal(
            app.detail().provenanceLine,
            `synced 30s ago · from ${NODE}`,
            "the header's own line still states the ROW's age, with no `stale ·` prefix",
          );
          assert.equal(app.detail().badge, null, "…and the row earns no badge, because the ROW is fresh");
        });
      });
    },
  },

  // ══ Scenario: whenever the badge is showing, the provenance line carries the
  //    `stale ·` prefix too ══
  {
    name: "board-provenance/04 whenever the badge is showing the provenance line carries the `stale ·` prefix too — and when the badge clears, the prefix clears in the SAME tick",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const detail = app.detail();
          assert.equal(detail.badge.text, "◌ stale · 12m ago", "the header badge reads the full form");
          assert.equal(
            detail.provenanceLine,
            `stale · synced 12m ago · from ${NODE}`,
            "…and the provenance line INDEPENDENTLY states the same fact in prose",
          );

          // A fresher copy lands through the app's OWN door (a settled board
          // schedules no list poll of its own). Badge and prefix are read in the
          // same tick, off the same descriptor, so they cannot disagree.
          await face.reportedBy(NODE, at(0));
          await app.sync();
          const after = app.detail();
          assert.equal(after.badge, null, "when the badge clears…");
          assert.equal(after.provenanceLine, `synced just now · from ${NODE}`, "…the prefix clears in the same tick");
          assert.equal(app.badges().length, 0, "…on every surface that showed it");
        });
      });
    },
  },

  // ══ Scenario: the fleet milestone card carries the badge and its `title`
  //    only — no provenance line, no Resync ══
  {
    name: "board-provenance/04 the FLEET milestone card carries the badge and its `title` ONLY — row 1's `ml-auto shrink-0` cluster holds badge then chip, no provenance line was added, and there is no Resync anywhere on the fleet",
    run: async () => {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url, search: "?mode=fleet&scope=global" }, async (app) => {
          const tree = app.tree();
          // The milestone card's badge — the one inside the row-1 cluster (the
          // legend's swatch is the other badge on the page and is not a card's).
          const clusters = findAll(tree, (node) => typeof node.props?.className === "string"
            && node.props.className.includes("ml-auto")
            && node.props.className.includes("shrink-0")
            && findAll(node, isBadgeSpan).length > 0);
          assert.equal(clusters.length, 1, "row 1 carries exactly one badge cluster (non-vacuous: the fleet's wire really does feed a stale row)");

          const children = (clusters[0].children ?? []).filter(Boolean);
          assert.equal(children.length, 2, "…and the cluster holds exactly two elements");
          assert.ok(isBadgeSpan(children[0]), "the stale badge is FIRST");
          assert.ok(visibleTextOf(children[1]).includes("in-progress"), "…and the status chip follows it, keeping its right-edge anchor");

          const badge = children[0];
          const title = badge.props?.title ?? "";
          assert.ok(title.includes("control-a"), "the badge's `title` names the reporting node");
          assert.ok(/\d+[smhd] ago|just now|yesterday/.test(title), "…the age");
          assert.ok(/ at .*\d/.test(title), "…the last-synced local time");
          assert.ok(title.includes("5 minutes"), "…and the configured window, which the fleet's own wire now carries");
          assert.ok(!visibleTextOf(badge).includes("control-a"), "…while the visible text never spends its width on the node id");

          // Attribution here is ON DEMAND: no new line was added to the card,
          // because that region's geometry is fitness-locked.
          const card = findAll(tree, (node) => node.type === "div"
            && typeof node.props?.className === "string"
            && node.props.className.includes("rounded-[10px]")
            && findAll(node, (inner) => inner === badge).length > 0)[0];
          assert.ok(card, "the badge is inside the milestone card");
          // The claim is that no provenance SENTENCE was added to the card —
          // asserted on the ramp's own line shape rather than on a class set the
          // card already uses for its workspace name and its chips.
          assert.ok(
            !/synced .* · from /.test(visibleTextOf(card)),
            `no new provenance LINE was added to the card — the answer is the badge's \`title\` (${JSON.stringify(visibleTextOf(card))})`,
          );
          assert.ok(
            !visibleTextOf(card).includes("control-a"),
            "…and the reporting node appears nowhere in the card's visible text",
          );

          // No Resync on the fleet at all: one door per item, on the surface that
          // also shows WHAT is stale.
          const resync = findAll(tree, (node) => (node.type === "button" || node.type === "a")
            && (/resync|requested/i.test(visibleTextOf(node)) || String(node.props?.["aria-label"] ?? "").startsWith("Resync ")));
          assert.equal(resync.length, 0, "there is no Resync control anywhere on the fleet surface");

          // …and the fitness-locked assign row is untouched.
          const affordance = app.affordanceIn(app.cards()[0]);
          assert.ok(affordance, "the assign row renders (non-vacuous)");
          assert.deepEqual(affordance.rowChildTypes, ["select", "button"], "the assign row's element order is unchanged");
          assert.equal(affordance.actionSizerStyle?.width, "10ch", "…and its reserved action width is unchanged (the freshness badge above it took none of the row's geometry)");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: `RemoteContentNotice`'s "documents aren't bridged" copy is
  //    retired — it survives only as the reworded cache-miss placeholder ══
  {
    name: "board-provenance/04 the retired \"documents aren't bridged\" copy is GONE — no surface claims the board bridges the list but not its documents, none sends the reader to the fleet to read one, and the miss is the reworded dashed placeholder",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-30));
        // One doc the cache HAS, one it does NOT.
        await face.reportedDoc("43", "VERIFICATION", "# Verification\n\nRun on the worker.\n", { node: NODE, at: at(-7200) });
        await withBoardApp({ url: face.url, hash: "43" }, async (app) => {
          // The doc the cache HAS: its body renders, preceded by its line.
          await app.openTab("VERIFICATION");
          const has = app.docRegion();
          assert.ok(has.markdownHtml.includes("<h1>Verification</h1>"), "the doc the cache HAS renders its body");
          assert.equal(has.provenanceLine, `stale · synced 2h ago · from ${NODE}`, "…preceded by its provenance line");

          // The doc the cache does NOT have: the reworded absent placeholder.
          await app.openTab("RETROSPECTIVE");
          const miss = app.docRegion();
          assert.equal(
            miss.placeholder,
            `No cached RETROSPECTIVE yet — ${NODE} has not reported one.`,
            "the doc the cache does NOT have renders the reworded absent placeholder",
          );
          assert.ok(miss.placeholderClassName.includes("border-dashed"), "…in the DASHED absent treatment");
          assert.ok(!miss.placeholderClassName.includes("accent"), "…never the error token — absent is not an error");
          assert.ok(!miss.placeholderClassName.includes("destructive"), "…and never destructive either");

          // THE RETIREMENT, asserted across the WHOLE rendered tree in every tab
          // the panel offers — the copy is gone from the product, not merely from
          // the branch that used to show it.
          for (const tab of ["SPEC", "VERIFICATION", "RETROSPECTIVE", "RUNS"]) {
            await app.openTab(tab);
            const page = visibleTextOf(app.tree());
            assert.ok(
              !/bridges the item list/i.test(page),
              `${tab}: no surface states that this board bridges the item list but not its documents or runs`,
            );
            assert.ok(
              !/not its documents or runs/i.test(page),
              `${tab}: …in any wording`,
            );
            assert.ok(
              !/open the fleet to watch/i.test(page),
              `${tab}: no surface directs the reader to "open the fleet to watch that node" in order to read a document`,
            );
          }
        });
      });
    },
  },

  // ══ The SAME scenario read from its own Given — "an item whose truth lives on
  //    `umairs-mac-mini`". The cache-miss copy is for an item whose truth lives
  //    ELSEWHERE; an item whose truth lives HERE keeps the m03 empty states.
  //    (43/ADR-015 F5 — a REGRESSION this suite was structurally blind to.) ══
  {
    name: "board-provenance/04 the cache-miss copy is for an item whose truth lives on ANOTHER machine — a row THIS node authored keeps every m03 empty state, including its call to action",
    run: async () => {
      // ── the fork's LOCAL side. This is the COMMON deployment, not the exotic
      //    one: a mesh-enabled workspace on the operator's own control node,
      //    where the control published its own rows. Before ADR-015/F5 the panel
      //    told them `aof-control has not reported one` about their own machine's
      //    item and deleted `run aof:verify (Run agent)` with it.
      await withBoardFace(async (face) => {
        await face.reportedBy(CONTROL, at(-30));
        await withBoardApp({ url: face.url, hash: "43" }, async (app) => {
          // Non-vacuity: the row really IS cache-published and really IS this
          // node's — the very condition the broken presence test fired on.
          assert.equal(
            app.detail().provenanceLine,
            `synced 30s ago · from ${CONTROL} (this node)`,
            "the row is cache-published AND authored here (non-vacuous: this is the state the defect fired in)",
          );

          await app.openTab("VERIFICATION");
          assert.equal(
            app.docRegion().placeholder,
            "Not verified yet — run aof:verify (Run agent)",
            "an absent VERIFICATION on THIS node's own item keeps the m03 copy — and its call to action",
          );

          await app.openTab("RETROSPECTIVE");
          assert.equal(
            app.docRegion().placeholder,
            "No retrospective yet — written when the milestone is accepted",
            "…and so does an absent RETROSPECTIVE",
          );

          await app.openTab("RUNS");
          assert.equal(
            app.docRegion().placeholder,
            "No runs yet This item hasn't been run.",
            "…and an empty run log reads as empty, because for this item it IS empty",
          );

          // The claim that would be FALSE here is absent in every tab — stated as
          // its own assertion so a partial fix cannot pass.
          for (const tab of ["VERIFICATION", "RETROSPECTIVE", "RUNS"]) {
            await app.openTab(tab);
            assert.ok(
              !/has not reported one/.test(visibleTextOf(app.tree())),
              `${tab}: no surface accuses THIS node of having failed to report an artifact it simply has not written yet`,
            );
          }
        });
      }, { nodeId: CONTROL });

      // ── the fork's REMOTE side, in the SAME shape, so the pair is one lane: the
      //    identical workspace, the identical tabs, only the REPORTER differs.
      //    "A surface whose behaviour forks on 'is this row mine' needs at least
      //    one lane on each side of that fork."
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-30));
        await withBoardApp({ url: face.url, hash: "43" }, async (app) => {
          assert.equal(
            app.detail().provenanceLine,
            `synced 30s ago · from ${NODE}`,
            "the same workspace, reported by another machine (and NOT marked as this node's)",
          );

          await app.openTab("VERIFICATION");
          assert.equal(
            app.docRegion().placeholder,
            `No cached VERIFICATION yet — ${NODE} has not reported one.`,
            "an absent VERIFICATION on a row ANOTHER machine reported names that machine — the cache-miss copy is retained exactly where it is true",
          );

          await app.openTab("RUNS");
          assert.equal(
            app.docRegion().placeholder,
            `No cached run history yet — ${NODE} has not reported one.`,
            "…and an empty LOCAL run log says where the records actually are, rather than the false \"this item hasn't been run\"",
          );
        });
      }, { nodeId: CONTROL });

      // ── and the DEGRADE, which must fork the same way the line does: a board
      //    that does not know which machine it is marks NO row as local, so it
      //    cannot claim the row is its own — and both readings degrade together,
      //    because both come from the ONE `local` fact on the ramp's descriptor.
      await withBoardFace(async (face) => {
        await face.reportedBy(CONTROL, at(-30));
        await withBoardApp({ url: face.url, hash: "43" }, async (app) => {
          assert.equal(
            app.detail().provenanceLine,
            `synced 30s ago · from ${CONTROL}`,
            "with no node identity configured, the line does not claim the row as this node's…",
          );
          await app.openTab("VERIFICATION");
          assert.equal(
            app.docRegion().placeholder,
            `No cached VERIFICATION yet — ${CONTROL} has not reported one.`,
            "…and the empty state does not either — one fact, two readings, degrading together",
          );
        });
      }, { nodeId: null });

      // …and the fact itself, on the ramp, so the two readings are pinned to ONE
      // source rather than to two expressions that agree today.
      const local = freshness({ syncedAt: at(-30), reportedBy: CONTROL }, { now: BOARD_EPOCH, windowSeconds: WINDOW, thisNode: CONTROL });
      const remote = freshness({ syncedAt: at(-30), reportedBy: NODE }, { now: BOARD_EPOCH, windowSeconds: WINDOW, thisNode: CONTROL });
      const blind = freshness({ syncedAt: at(-30), reportedBy: CONTROL }, { now: BOARD_EPOCH, windowSeconds: WINDOW });
      assert.equal(local.local, true, "the ramp states `local` for a copy this node authored — the same fact its ` (this node)` clause renders");
      assert.equal(remote.local, false, "…false for a copy another node authored");
      assert.equal(blind.local, false, "…and false when the surface does not know which node it is (never a guess)");
      assert.equal(local.label.includes("(this node)"), local.local, "the clause and the flag are the same fact, by construction");
      assert.equal(remote.label.includes("(this node)"), remote.local, "…on either side of the fork");
    },
  },
];
