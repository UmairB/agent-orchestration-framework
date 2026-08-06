// milestone 43 / story 03 — task 02: the ARTIFACT SET
// (`tasks/02_artifact-manifest-widening-and-content-hash.feature`, AC6–AC8, ADR-007).
//
// The set becomes a bounded TWO-KIND manifest — `{name,file}` × 8 exact filenames and
// `{name,dir,ext}` × `tasks/` + `.feature` — with no glob language; `WORK_ITEM_DOC_FILES`
// is DERIVED from it; and every artifact travels with a content hash so an unchanged one
// is never re-sent.
//
// Everything below is observed from the OUTSIDE: the control node's answers to the real
// `work:doc` / `work:tasks` commands after a real worker tick, the artifact rows'
// `updatedAt` stamps (an artifact NOT re-sent is a stamp that did not move), and the
// artifact list a tick's frame carries. This suite never asserts that the manifest is
// "one constant in one module" — that sameness property belongs to
// `test/arch/acd-work-artifact-set-single-home.test.mjs`.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { withArtifactSyncFixture, writeArtifact, enqueueLine, WORKER_ID, ITEM_REF, RECORD_DOCS } from "./support/artifact-sync-fixture.mjs";
import { WORK_ITEM_DOC_FILES } from "../src/global-work-store.mjs";
import { WORK_ITEM_ARTIFACTS } from "../src/work-artifacts.mjs";

// The fourteen artifacts task 02's Givens describe: the eight record docs plus six
// `tasks/*.feature` members.
async function seedFourteen(fx) {
  for (const file of RECORD_DOCS) {
    await writeArtifact(fx.itemDir, file, `${file} v1\n`);
  }
  for (let i = 0; i < 6; i += 1) {
    await writeArtifact(fx.itemDir, `tasks/0${i}_t.feature`, `@executable\nFeature: t${i}\n  Scenario: s${i}\n`);
  }
}

function carriedDocs(fx, from) {
  return fx.contentFrames().slice(from).flatMap((frame) => frame.docs.map((doc) => doc.doc));
}

export const artifactSyncManifestTests = [
  {
    // HEADLINE (AC6, and the story's payoff) — this is the scenario that closes
    // `commands/tasks.mjs:15`'s "the features live in the worker's worktree and are not
    // streamed yet". The last assertion is what makes it a real proof: the control's own
    // disk cannot possibly be the source of the answer.
    name: "artifact-sync/02 a story's task features ride the wire and are readable on the control node during the run",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await writeArtifact(fx.itemDir, "tasks/00_a.feature", "@cli\nFeature: alpha\n  @executable\n  Scenario: one\n  @manual\n  Scenario: two\n");
      await writeArtifact(fx.itemDir, "tasks/01_b.feature", "@executable\nFeature: beta\n  Scenario: three\n");
      assert.equal(existsSync(path.join(fx.controlWorkDir, "43_milestone_mesh-artifact-authority")), false, "the control node's checkout has no tasks/ directory for the item (non-vacuous)");

      await fx.tick();
      await fx.deliver();

      const tasks = await fx.tasks(ITEM_REF);
      assert.deepEqual(tasks.tasks.map((task) => task.file), ["00_a.feature", "01_b.feature"], "both feature files are listed");
      const alpha = tasks.tasks[0];
      assert.equal(alpha.feature, "alpha", "…with its parsed feature name");
      assert.equal(alpha.scenarios.length, 2, "…and its scenarios, as a local read would give");
      assert.deepEqual(alpha.counts, { executable: 1, manual: 1, uat: 0 }, "…with per-lane counts");
      assert.equal(tasks.reportedBy, WORKER_ID, "the answer is stamped with the worker that reported it");
      assert.equal(tasks.fromWorker, true);
      assert.equal(existsSync(path.join(fx.controlWorkDir, "43_milestone_mesh-artifact-authority")), false, "the control node's own checkout STILL has no tasks/ directory — the answer came off the wire");
    }),
  },
  {
    // THE `file`-KIND ENTRIES (AC6). Each is requestable BY NAME — `work:doc`'s input
    // contract — and each rides the wire. The first four are today's whitelist; the last
    // four are the widening. (An ADR log needs no separate entry: in this repo an ADR log
    // IS ARCHITECTURE.md.)
    name: "artifact-sync/02 every exact-filename entry is both streamed and requestable by name",
    run: async () => withArtifactSyncFixture(async (fx) => {
      const rows = [
        { name: "SPEC", file: "SPEC.md" },
        { name: "STORY", file: "STORY.md" },
        { name: "VERIFICATION", file: "VERIFICATION.md" },
        { name: "RETROSPECTIVE", file: "RETROSPECTIVE.md" },
        { name: "ARCHITECTURE", file: "ARCHITECTURE.md" },
        { name: "DESIGN", file: "DESIGN.md" },
        { name: "RESEARCH", file: "RESEARCH.md" },
        { name: "STATE", file: "STATE.md" },
      ];
      for (const row of rows) await writeArtifact(fx.itemDir, row.file, `body of ${row.file}\n`);
      await fx.tick();
      await fx.deliver();

      for (const row of rows) {
        const answer = await fx.doc(ITEM_REF, row.name);
        assert.equal(answer.body, `body of ${row.file}\n`, `${row.name} returns that file's current body`);
        assert.equal(answer.present, true, `${row.name} was accepted — no invalid-doc refusal`);
        assert.equal(answer.reportedBy, WORKER_ID, `${row.name} is stamped with the worker that reported it`);
      }
    }),
  },
  {
    // THE `dir`-KIND ENTRY (AC6): requested by name + MEMBER, never by pattern. The
    // traversal row matters most — a member is a bounded directory entry, so a separator
    // or a `..` in it is a REFUSAL, never a read.
    name: "artifact-sync/02 the directory entry is requested by name plus member, and an out-of-contract request is refused, coded",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await writeArtifact(fx.itemDir, "tasks/00_a.feature", "@executable\nFeature: a\n  Scenario: one\n");
      await fx.tick();
      await fx.deliver();

      const body = await fx.doc(ITEM_REF, "TASKS", "00_a.feature");
      assert.equal(body.body, "@executable\nFeature: a\n  Scenario: one\n", "the TASKS entry + member returns that feature's current body");
      assert.equal(body.member, "00_a.feature", "the answer echoes its member");

      const absent = await fx.doc(ITEM_REF, "TASKS", "99_absent.feature");
      assert.equal(absent.present, false, "an absent member is absent-not-error");
      assert.equal(absent.body, "", "…with an empty body");

      const refusals = [
        { name: "TASKS", member: "../../STORY.md", why: "a member is a bounded directory entry" },
        { name: "TASKS", member: "sub/deep.feature", why: "the entry is one directory, not a walk" },
        { name: "TASKS", member: undefined, why: "a directory entry is not requestable whole" },
        { name: "ARCHITECTURE", member: "anything.md", why: "an exact-filename entry takes no member" },
      ];
      for (const row of refusals) {
        await assert.rejects(
          () => fx.doc(ITEM_REF, row.name, row.member),
          (error) => {
            assert.equal(error.code, "invalid-doc-member", `${row.name}/${row.member}: coded refusal (${row.why})`);
            assert.equal(error.status, 400);
            return true;
          },
          `${row.name} + ${row.member} must be refused`,
        );
      }
      await assert.rejects(
        () => fx.doc(ITEM_REF, "NOTES"),
        (error) => {
          assert.equal(error.code, "invalid-doc", "a name in no manifest entry is a coded invalid-doc refusal — the set stays answerable");
          return true;
        },
      );
    }),
  },
  {
    // THE `dir`-KIND ENTRY IS BOUNDED BY EXTENSION (AC6): only `.feature` members are in
    // the set. This is what keeps the widening's payload bounded and the requestable set
    // enumerable — six genuinely different non-membership classes.
    name: "artifact-sync/02 only .feature members of the tasks directory are streamed",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await writeArtifact(fx.itemDir, "tasks/00_a.feature", "@executable\nFeature: a\n  Scenario: one\n");
      await writeArtifact(fx.itemDir, "tasks/notes.md", "notes\n");
      await writeArtifact(fx.itemDir, "tasks/00_a.feature.bak", "a backup\n");
      await writeArtifact(fx.itemDir, "tasks/.keep", "");
      await writeArtifact(fx.itemDir, "tasks/nested/deep.feature", "@executable\nFeature: deep\n  Scenario: x\n");
      await writeArtifact(fx.itemDir, "tasks/00_A.FEATURE", "@executable\nFeature: shouty\n  Scenario: y\n");

      const before = fx.contentFrames().length;
      await fx.tick();
      await fx.deliver();

      const carried = carriedDocs(fx, before).filter((doc) => doc.startsWith("TASKS/"));
      assert.deepEqual(carried, ["TASKS/00_a.feature"], "only the .feature member is carried in the frame");
      const listed = (await fx.tasks(ITEM_REF)).tasks.map((task) => task.file);
      assert.deepEqual(listed, ["00_a.feature"], "…and only it is listed on the control node");
      for (const entry of ["notes.md", "00_a.feature.bak", ".keep", "nested/deep.feature", "00_A.FEATURE"]) {
        assert.ok(!listed.includes(entry), `${entry} is not listed`);
      }
    }),
  },
  {
    // THE DERIVATION GUARD (AC7) — a REGRESSION scenario, not a new capability. The
    // widening must be purely additive: the four names existing importers already use
    // keep resolving to the same files with the same answers.
    name: "artifact-sync/02 the four pre-existing doc names keep answering exactly as they did before the widening",
    run: async () => withArtifactSyncFixture(async (fx) => {
      for (const file of RECORD_DOCS) await writeArtifact(fx.itemDir, file, `${file} body\n`);
      await fx.tick();
      await fx.deliver();

      // THE DERIVATION ITSELF, asserted on the VALUE (ADR-013/C9). The structural guard
      // was blind for a while — its detector matched `= (Object.freeze()? [{` while the
      // real derived form is `= Object.freeze(Object.fromEntries(`, so a stale literal
      // beside the manifest would have satisfied every proof. This assertion cannot be
      // fooled by a spelling: the compatibility view must EQUAL the manifest's file-kind
      // entries, in manifest order.
      assert.deepEqual(
        WORK_ITEM_DOC_FILES,
        Object.fromEntries(WORK_ITEM_ARTIFACTS.filter((entry) => entry.file != null).map((entry) => [entry.name, entry.file])),
        "WORK_ITEM_DOC_FILES is the manifest's file-kind entries — one definition, one derived view, never two literal lists",
      );
      assert.equal(Object.keys(WORK_ITEM_DOC_FILES).length, 8, "…and the view really carries the widened set (non-vacuous)");

      for (const name of ["SPEC", "STORY", "VERIFICATION", "RETROSPECTIVE"]) {
        // The pre-widening mapping, restated literally here so a change to the manifest
        // that re-pointed a name would red this test rather than agree with itself.
        const expectedFile = { SPEC: "SPEC.md", STORY: "STORY.md", VERIFICATION: "VERIFICATION.md", RETROSPECTIVE: "RETROSPECTIVE.md" }[name];
        assert.equal(WORK_ITEM_DOC_FILES[name], expectedFile, `${name} still resolves to ${expectedFile} (the derived compatibility view)`);
        const answer = await fx.doc(ITEM_REF, name);
        assert.equal(answer.body, `${expectedFile} body\n`, `${name} returns the same file's body it returned before the widening`);
        assert.equal(answer.present, true, `${name} is still a valid doc name`);
      }
      await assert.rejects(
        () => fx.doc(ITEM_REF, "NOTES"),
        (error) => {
          assert.equal(error.code, "invalid-doc", "a name outside the manifest is still a coded refusal, not a silent empty answer");
          return true;
        },
      );
    }),
  },
  {
    // THE CONTENT HASH (AC8) — what makes the widening affordable. The mtime row is the
    // sharp one: the hash is over CONTENT, so a touched-but-unchanged file must not be
    // re-sent; a tick keyed on mtime would re-send the whole set after any checkout.
    name: "artifact-sync/02 an unchanged artifact is never re-sent, and only a real content change moves its stamp",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await seedFourteen(fx);
      await fx.tick();
      await fx.deliver();
      assert.equal(Object.keys(fx.stamps(ITEM_REF)).length, 14, "the control already holds all fourteen artifacts");

      const rows = [
        {
          name: "nothing changed in the worktree",
          change: async () => {},
          bodies: 0,
          moved: [],
        },
        {
          name: "one artifact's bytes changed",
          change: async () => { await writeArtifact(fx.itemDir, "DESIGN.md", "DESIGN.md v2\n"); },
          bodies: 1,
          moved: ["DESIGN"],
        },
        {
          name: "one artifact was touched, its bytes unchanged",
          change: async () => {
            const when = new Date(Date.now() + 60_000);
            await utimes(path.join(fx.itemDir, "SPEC.md"), when, when);
          },
          bodies: 0,
          moved: [],
        },
        {
          name: "one artifact was edited and then reverted exactly",
          change: async () => {
            await writeArtifact(fx.itemDir, "RESEARCH.md", "a temporary edit\n");
            await writeArtifact(fx.itemDir, "RESEARCH.md", "RESEARCH.md v1\n");
          },
          bodies: 0,
          moved: [],
        },
        {
          name: "a new tasks/*.feature file was added",
          change: async () => { await writeArtifact(fx.itemDir, "tasks/06_new.feature", "@executable\nFeature: new\n  Scenario: s\n"); },
          bodies: 1,
          moved: [],
          gains: "TASKS/06_new.feature",
        },
        {
          name: "one artifact was deleted from the worktree",
          change: async () => { await rm(path.join(fx.itemDir, "STATE.md"), { force: true }); },
          bodies: 0,
          moved: [],
          keeps: "STATE",
        },
      ];

      for (const row of rows) {
        const before = fx.stamps(ITEM_REF);
        const framesBefore = fx.contentFrames().length;
        await row.change();
        await fx.tick();
        await fx.deliver();
        const carried = carriedDocs(fx, framesBefore);
        assert.equal(carried.length, row.bodies, `${row.name}: the frame carries ${row.bodies} artifact body/bodies`);
        const after = fx.stamps(ITEM_REF);
        for (const key of Object.keys(before)) {
          if (row.moved.includes(key)) {
            assert.notEqual(after[key].updatedAt, before[key].updatedAt, `${row.name}: ${key}'s updatedAt moves`);
          } else {
            assert.equal(after[key].updatedAt, before[key].updatedAt, `${row.name}: ${key} keeps the updatedAt it already had`);
          }
        }
        if (row.gains != null) {
          assert.ok(after[row.gains] != null, `${row.name}: the new artifact gains a row`);
          assert.equal(before[row.gains], undefined, "…and it is genuinely new");
        }
        if (row.keeps != null) {
          assert.equal(after[row.keeps].body, before[row.keeps].body, `${row.name}: its last streamed body still answers`);
          assert.equal(after[row.keeps].updatedAt, before[row.keeps].updatedAt, `${row.name}: …and its stamp stops moving`);
          const answer = await fx.doc(ITEM_REF, row.keeps);
          assert.equal(answer.present, true, `${row.name}: the deleted artifact still reads on the control node (never-evict, ADR-006 / R3.B)`);
        }
      }
    }),
  },
  {
    // THE WIDENING'S COST IS BOUNDED (AC8), stated as the operator-visible number.
    // Without the hash, widening from four files to eight-plus-every-feature-file
    // multiplies the per-tick payload by the size of the set.
    name: "artifact-sync/02 after the widening a steady-state tick carries no artifact bodies at all",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await seedFourteen(fx);
      // A RUN RECORD in the same subtree — the fact that used to cost a frame per tick
      // forever (ADR-013/C10: three steady-state ticks sent three frames of `docs: []`,
      // `runs: [1,1,1]`, for a record that stopped changing when the run ended).
      await writeArtifact(fx.itemDir, "runs/run-9.json", `${JSON.stringify({ runId: "run-9", itemRef: ITEM_REF, state: "done", attempt: 1, createdAt: "2026-08-02T09:00:00.000Z", updatedAt: "2026-08-02T09:05:00.000Z" })}\n`);
      await fx.tick();
      await fx.deliver();
      const before = fx.stamps(ITEM_REF);
      assert.equal(Object.keys(before).length, 14, "all fourteen are held");
      assert.ok(fx.contentFrames().at(-1).runs.length > 0, "…and the run record was streamed once (non-vacuous)");

      const framesBefore = fx.contentFrames().length;
      await fx.tick();
      await fx.tick();
      await fx.tick();
      await fx.deliver();
      assert.equal(carriedDocs(fx, framesBefore).length, 0, "no artifact body is carried in any of the three frames");
      // …and with docs AND runs both gated, a genuinely idle tick sends NO CONTENT FRAME
      // AT ALL, which is the end state AC8 describes.
      assert.equal(fx.contentFrames().length, framesBefore, "an idle tick sends no content frame at all");

      const after = fx.stamps(ITEM_REF);
      for (const key of Object.keys(before)) {
        assert.equal(after[key].updatedAt, before[key].updatedAt, `${key} keeps the updatedAt it had before the three ticks`);
      }
      for (const name of ["SPEC", "STORY", "VERIFICATION", "RETROSPECTIVE", "ARCHITECTURE", "DESIGN", "RESEARCH", "STATE"]) {
        assert.equal((await fx.doc(ITEM_REF, name)).present, true, `${name} is still readable on the control node`);
      }
      assert.equal((await fx.tasks(ITEM_REF)).tasks.length, 6, "…and all six features are still readable");
    }),
  },
  {
    // THE TWO SETS CANNOT DRIFT (AC6/AC7's real point, as an OUTCOME): whatever the
    // manifest holds, the same names answer on both sides — what a worker streams is
    // exactly what a face may ask for, with no name answerable on one side only.
    name: "artifact-sync/02 every name the worker streams is a name the control node can request, and no other",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await seedFourteen(fx);
      const before = fx.contentFrames().length;
      await fx.tick();
      await fx.deliver();

      const streamed = carriedDocs(fx, before);
      assert.ok(streamed.length >= 14, "the frame carried the manifest's artifacts (non-vacuous)");
      for (const docKey of streamed) {
        const [name, member] = docKey.includes("/") ? [docKey.slice(0, docKey.indexOf("/")), docKey.slice(docKey.indexOf("/") + 1)] : [docKey, undefined];
        const ref = streamed.length > 0 ? ITEM_REF : ITEM_REF;
        const answer = await fx.doc(ref, name, member).catch((error) => error);
        assert.ok(!(answer instanceof Error), `${docKey} the frame carried is requestable by its manifest name`);
      }
      // …and every manifest name the control requests is answered from what the frame
      // carried, including the dir-kind entry through its member.
      for (const name of Object.keys(WORK_ITEM_DOC_FILES)) {
        assert.equal((await fx.doc(ITEM_REF, name)).present, true, `${name} is answered from the frame`);
      }
      assert.equal((await fx.doc(ITEM_REF, "TASKS", "00_t.feature")).present, true, "the dir entry is answered through its member");

      // A name absent from the manifest is refused on the request side AND absent from
      // the frame.
      await writeFile(path.join(fx.itemDir, "NOTES.md"), "not in the manifest\n", "utf8");
      const framesBefore = fx.contentFrames().length;
      await fx.tick();
      await fx.deliver();
      assert.equal(carriedDocs(fx, framesBefore).includes("NOTES"), false, "an unmanifested file is absent from the frame");
      await assert.rejects(() => fx.doc(ITEM_REF, "NOTES"), (error) => error.code === "invalid-doc");
    }),
  },
];
