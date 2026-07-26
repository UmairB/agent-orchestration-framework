// Traceability wiring for milestone 37 / story 00
// tasks/01_drivers-ordering-and-next.feature — "spike and chore participate in the
// depends ordering graph as top-level drivers".
//
// Every @executable scenario (and every Scenario Outline Examples row) below is
// asserted against the LOCKED engine `nextWork` in ../src/work.mjs — the same
// surface `aof work next --json` is a thin face over (src/commands/next.mjs
// passes the raw result through, relativising only `path`). Mirrors the fixture
// style of test/work-next.test.mjs.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nextWork } from "../src/work.mjs";

function frontmatter(fields) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

const RECORD_DOC = { milestone: "SPEC.md", uat: "SESSION.md", spike: "SPIKE.md", chore: "CHORE.md" };

// A driver spec: { number, type?, slug?, status, depends? }. Mirrors
// test/work-next.test.mjs's buildStream but adds spike/chore record docs.
async function buildStream(drivers) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-spike-chore-next-"));
  const work = path.join(root, "work");

  for (const d of drivers) {
    const type = d.type ?? "milestone";
    const slug = d.slug ?? `${type}-${d.number}`;
    const dir = path.join(work, `${d.number}_${type}_${slug}`);
    await mkdir(dir, { recursive: true });

    const doc = RECORD_DOC[type] ?? "SPEC.md";
    await writeFile(
      path.join(dir, doc),
      frontmatter({
        type,
        number: d.number,
        slug,
        status: d.status,
        created: "2026-01-01",
        updated: "2026-01-02",
        ...(d.depends ? { depends: d.depends } : {}),
      }),
    );
  }

  return { root, work };
}

async function withStream(drivers, body) {
  const { root, work } = await buildStream(drivers);
  try {
    return await body(work);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export const workSpikeChoreNextTests = [
  // ============================================================================
  // 01_drivers-ordering-and-next.feature
  // ============================================================================

  // Scenario: aof work next reports a milestone blocked on a not-done spike
  {
    name: "work/spike-chore-next: a milestone depending on a not-done spike is blocked, waitingOn names the spike",
    run: () =>
      withStream(
        [
          { number: "00", type: "spike", slug: "de-risk-thing", status: "in-progress" },
          { number: "01", status: "not-started", depends: ["00"] },
        ],
        async (work) => {
          const next = await nextWork(work, "01");
          assert.equal(next.state, "blocked");
          assert.equal(next.ref, "01");
          assert.ok(next.waitingOn.includes("00"));
        },
      ),
  },

  // --- Scenario Outline: a ready <type> is surfaced as the actionable item ITSELF ---

  {
    name: "work/spike-chore-next: a ready spike is surfaced as the item itself — ready, type spike, own ref, path ends with folder name, no waitingOn",
    run: () =>
      withStream([{ number: "00", type: "spike", slug: "de-risk-thing", status: "not-started" }], async (work) => {
        const next = await nextWork(work, "00");
        assert.equal(next.state, "ready");
        assert.equal(next.type, "spike");
        assert.equal(next.ref, "00");
        assert.ok(next.path.endsWith("00_spike_de-risk-thing"), `path ends with the spike folder name; got ${next.path}`);
        assert.ok(!("waitingOn" in next), "no waitingOn field on a ready result");
      }),
  },
  {
    name: "work/spike-chore-next: a ready chore is surfaced as the item itself — ready, type chore, own ref, path ends with folder name, no waitingOn",
    run: () =>
      withStream([{ number: "00", type: "chore", slug: "tidy-config", status: "not-started" }], async (work) => {
        const next = await nextWork(work, "00");
        assert.equal(next.state, "ready");
        assert.equal(next.type, "chore");
        assert.equal(next.ref, "00");
        assert.ok(next.path.endsWith("00_chore_tidy-config"), `path ends with the chore folder name; got ${next.path}`);
        assert.ok(!("waitingOn" in next), "no waitingOn field on a ready result");
      }),
  },

  // Scenario: a chore is an honoured depends target that gates and then unblocks a dependent driver
  {
    name: "work/spike-chore-next: a chore gates a dependent milestone (blocked while not-done) then unblocks it once done",
    run: () =>
      withStream(
        [
          { number: "00", type: "chore", slug: "tidy-config", status: "not-started" },
          { number: "01", status: "not-started", depends: ["00"] },
        ],
        async (work) => {
          const blocked = await nextWork(work, "01");
          assert.equal(blocked.state, "blocked");
          assert.ok(blocked.waitingOn.includes("00"));
        },
      ),
  },
  {
    name: "work/spike-chore-next: once the gating chore is done, the dependent milestone becomes ready",
    run: () =>
      withStream(
        [
          { number: "00", type: "chore", slug: "tidy-config", status: "done" },
          { number: "01", status: "not-started", depends: ["00"] },
        ],
        async (work) => {
          const ready = await nextWork(work, "01");
          assert.equal(ready.state, "ready");
          assert.equal(ready.ref, "01");
        },
      ),
  },

  // --- Scenario Outline: walk order respects the numeric slot among drivers, across types ---

  {
    name: "work/spike-chore-next: walk order outline row [spike 00 < milestone 01] -> ready 00 spike",
    run: () =>
      withStream(
        [
          { number: "00", type: "spike", slug: "de-risk-thing", status: "not-started" },
          { number: "01", status: "not-started" },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.ref, "00");
          assert.equal(next.type, "spike");
        },
      ),
  },
  {
    name: "work/spike-chore-next: walk order outline row [milestone 00 < chore 01] -> ready 00 milestone",
    run: () =>
      withStream(
        [
          { number: "00", status: "not-started" },
          { number: "01", type: "chore", slug: "tidy-config", status: "not-started" },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.ref, "00");
          assert.equal(next.type, "milestone");
        },
      ),
  },
  {
    name: "work/spike-chore-next: walk order outline row [chore 00 < spike 01] -> ready 00 chore",
    run: () =>
      withStream(
        [
          { number: "00", type: "chore", slug: "tidy-config", status: "not-started" },
          { number: "01", type: "spike", slug: "de-risk-thing", status: "not-started" },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.ref, "00");
          assert.equal(next.type, "chore");
        },
      ),
  },
];
