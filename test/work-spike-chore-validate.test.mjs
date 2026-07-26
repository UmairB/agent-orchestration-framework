// Traceability wiring for milestone 37 / story 00
// tasks/02_record-doc-and-structural-validate.feature — "a spike/chore folder
// validates on its native shape with no behavioural contract".
//
// Every @executable scenario (and every Scenario Outline Examples row) below is
// asserted against the LOCKED engine `validateWork(workDir, config, scopeRef)` in
// ../src/work.mjs — the same engine `aof work validate --json` is a thin face
// over. We assert on `finding.problem` VERBATIM strings the feature pins — we
// never change the engine or the contract. Mirrors test/work-validate.test.mjs.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateWork } from "../src/work.mjs";

function frontmatter(fields) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

async function withWork(body) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-spike-chore-validate-"));
  const work = path.join(root, "work");
  await mkdir(work, { recursive: true });
  try {
    return await body(work);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// A complete, valid spike field set — tests override one field to isolate a defect.
function spikeFields(overrides = {}) {
  return {
    type: "spike",
    number: "00",
    slug: "de-risk-thing",
    status: "not-started",
    created: "2026-07-09",
    updated: "2026-07-09",
    depends: [],
    schema: 1,
    ...overrides,
  };
}

// A complete, valid chore field set.
function choreFields(overrides = {}) {
  return {
    type: "chore",
    number: "00",
    slug: "tidy-config",
    status: "not-started",
    created: "2026-07-09",
    updated: "2026-07-09",
    depends: [],
    schema: 1,
    ...overrides,
  };
}

async function writeSpike(work, { folderNumber = "00", folderSlug = "de-risk-thing", fields } = {}) {
  const dir = path.join(work, `${folderNumber}_spike_${folderSlug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SPIKE.md"), frontmatter(fields));
  return dir;
}

async function writeChore(work, { folderNumber = "00", folderSlug = "tidy-config", fields } = {}) {
  const dir = path.join(work, `${folderNumber}_chore_${folderSlug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "CHORE.md"), frontmatter(fields));
  return dir;
}

export const workSpikeChoreValidateTests = [
  // ============================================================================
  // 02_record-doc-and-structural-validate.feature
  // ============================================================================

  // Scenario: a well-formed spike passes validate clean
  {
    name: "work/spike-chore-validate: a well-formed spike (valid frontmatter, no tasks/, no .feature) validates clean, exit-equivalent",
    run: () =>
      withWork(async (work) => {
        const dir = await writeSpike(work, { fields: spikeFields() });
        const findings = await validateWork(work, {}, null);
        assert.ok(!findings.some((f) => f.path.startsWith(dir)), `no finding under the spike folder; got ${JSON.stringify(findings)}`);
        assert.equal(findings.length, 0, "clean stream, exit 0");
      }),
  },

  // Scenario: a well-formed chore passes validate clean
  {
    name: "work/spike-chore-validate: a well-formed chore (valid frontmatter, no tasks/) validates clean, exit-equivalent",
    run: () =>
      withWork(async (work) => {
        const dir = await writeChore(work, { fields: choreFields() });
        const findings = await validateWork(work, {}, null);
        assert.ok(!findings.some((f) => f.path.startsWith(dir)), `no finding under the chore folder; got ${JSON.stringify(findings)}`);
        assert.equal(findings.length, 0, "clean stream, exit 0");
      }),
  },

  // --- Scenario Outline: validate flags a malformed <type> on its native record doc ---

  {
    name: 'work/spike-chore-validate: malformed spike row [frontmatter type "task"] -> problem equals `frontmatter type "task" ≠ folder type "spike"`',
    run: () =>
      withWork(async (work) => {
        const dir = await writeSpike(work, { fields: spikeFields({ type: "task" }) });
        const findings = await validateWork(work, {}, null);
        const finding = findings.find((f) => f.path.startsWith(dir));
        assert.ok(finding, "a finding is raised under the spike folder");
        assert.equal(finding.problem, 'frontmatter type "task" ≠ folder type "spike"');
      }),
  },
  {
    name: 'work/spike-chore-validate: malformed chore row [frontmatter type "spike"] -> problem equals `frontmatter type "spike" ≠ folder type "chore"`',
    run: () =>
      withWork(async (work) => {
        const dir = await writeChore(work, { fields: choreFields({ type: "spike" }) });
        const findings = await validateWork(work, {}, null);
        const finding = findings.find((f) => f.path.startsWith(dir));
        assert.ok(finding, "a finding is raised under the chore folder");
        assert.equal(finding.problem, 'frontmatter type "spike" ≠ folder type "chore"');
      }),
  },
  {
    name: 'work/spike-chore-validate: malformed spike row [status "wip"] -> problem equals `invalid status "wip"`',
    run: () =>
      withWork(async (work) => {
        const dir = await writeSpike(work, { fields: spikeFields({ status: "wip" }) });
        const findings = await validateWork(work, {}, null);
        const finding = findings.find((f) => f.path.startsWith(dir) && f.problem.startsWith("invalid status"));
        assert.ok(finding, "a finding is raised under the spike folder");
        assert.equal(finding.problem, 'invalid status "wip"');
      }),
  },
  {
    name: "work/spike-chore-validate: malformed chore row [missing created date] -> problem equals `missing created date`",
    run: () =>
      withWork(async (work) => {
        const fields = choreFields();
        delete fields.created;
        const dir = await writeChore(work, { fields });
        const findings = await validateWork(work, {}, null);
        const finding = findings.find((f) => f.path.startsWith(dir) && f.problem === "missing created date");
        assert.ok(finding, `a "missing created date" finding is raised under the chore folder; got ${JSON.stringify(findings)}`);
      }),
  },
  {
    name: "work/spike-chore-validate: malformed spike row [missing updated date] -> problem equals `missing updated date`",
    run: () =>
      withWork(async (work) => {
        const fields = spikeFields();
        delete fields.updated;
        const dir = await writeSpike(work, { fields });
        const findings = await validateWork(work, {}, null);
        const finding = findings.find((f) => f.path.startsWith(dir) && f.problem === "missing updated date");
        assert.ok(finding, `a "missing updated date" finding is raised under the spike folder; got ${JSON.stringify(findings)}`);
      }),
  },
  {
    name: 'work/spike-chore-validate: malformed chore row [slug "wrong-slug"] -> problem starts with `frontmatter slug`',
    run: () =>
      withWork(async (work) => {
        const dir = await writeChore(work, { fields: choreFields({ slug: "wrong-slug" }) });
        const findings = await validateWork(work, {}, null);
        const finding = findings.find((f) => f.path.startsWith(dir) && f.problem.startsWith("frontmatter slug"));
        assert.ok(finding, `a "frontmatter slug ..." finding is raised under the chore folder; got ${JSON.stringify(findings)}`);
      }),
  },
  {
    name: 'work/spike-chore-validate: malformed spike row [depends: [88] unresolved] -> problem starts with `depends "88" does not resolve`',
    run: () =>
      withWork(async (work) => {
        const dir = await writeSpike(work, { fields: spikeFields({ depends: ["88"] }) });
        const findings = await validateWork(work, {}, null);
        const finding = findings.find((f) => f.path.startsWith(dir) && f.problem.startsWith('depends "88" does not resolve'));
        assert.ok(finding, `a "depends \\"88\\" does not resolve ..." finding is raised under the spike folder; got ${JSON.stringify(findings)}`);
        // QA-hardening (m37/00 review): the finding is keyed on the type's OWN record doc,
        // not the folder root — a regression that mis-routes it would slip past a bare
        // startsWith(dir). And a non-empty findings array is the "exits non-zero" litmus.
        assert.ok(finding.path.endsWith("SPIKE.md"), `depends finding keyed on SPIKE.md; got ${finding.path}`);
        assert.ok(findings.length > 0, "malformed stream ⇒ non-empty findings ⇒ exit non-zero");
      }),
  },

  // --- Scenario Outline: validate flags a <type> whose record doc is missing or empty ---

  {
    name: "work/spike-chore-validate: a spike folder with no SPIKE.md -> problem equals `missing or empty record doc (SPIKE.md)`",
    run: () =>
      withWork(async (work) => {
        const dir = path.join(work, "00_spike_de-risk-thing");
        await mkdir(dir, { recursive: true }); // folder exists, no SPIKE.md
        const findings = await validateWork(work, {}, null);
        const finding = findings.find((f) => f.path.startsWith(dir));
        assert.ok(finding, "a finding is raised under the spike folder");
        assert.equal(finding.problem, "missing or empty record doc (SPIKE.md)");
      }),
  },
  {
    name: "work/spike-chore-validate: a chore folder with no CHORE.md -> problem equals `missing or empty record doc (CHORE.md)`",
    run: () =>
      withWork(async (work) => {
        const dir = path.join(work, "00_chore_tidy-config");
        await mkdir(dir, { recursive: true }); // folder exists, no CHORE.md
        const findings = await validateWork(work, {}, null);
        const finding = findings.find((f) => f.path.startsWith(dir));
        assert.ok(finding, "a finding is raised under the chore folder");
        assert.equal(finding.problem, "missing or empty record doc (CHORE.md)");
      }),
  },
];
