// Traceability wiring for milestone 37 / story 01
// tasks/00_spike-template-and-command.feature — "the bundled SPIKE.md template
// instantiates to a folder that validates clean".
//
// Every @executable scenario (and every Scenario Outline Examples row) below is
// asserted against the REAL shipped template (src/bundle/templates/spike/SPIKE.md)
// — no fixture text is hand-authored here for the instantiated doc's shape.
// Placeholders are filled by simple string substitution (the same substitution an
// agent running /aof:add-spike performs), then the folder is validated with the
// LOCKED engine `validateWork` (../src/work.mjs), mirroring test/work-spike-chore-validate.test.mjs.
//
// The @manual scenario (/aof:add-spike scaffolds a spike folder that validates
// clean) is agent-work the executable suite can't do — its procedure is recorded
// in the milestone UAT record (verifies →), NOT asserted here.
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateWork } from "../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = path.join(repoRoot, "src", "bundle", "templates", "spike", "SPIKE.md");

// Fill the template's placeholders exactly the way /aof:add-spike would: a real
// number/slug/title/owner/dates/timebox, an empty depends list.
function instantiate(raw, overrides = {}) {
  const fields = {
    NN: "00",
    slug: "de-risk-mesh-routing",
    title: "De-risk mesh routing",
    owner: "architect",
    created: "2026-07-09",
    updated: "2026-07-09",
    timebox: "1d",
    ...overrides,
  };
  let text = raw;
  text = text.replaceAll("NN", fields.NN);
  text = text.replace("<kebab-slug>", fields.slug);
  text = text.replace('"<Spike Title>"', `"${fields.title}"`);
  text = text.replaceAll("<Spike Title>", fields.title); // fill the body H1 too (QA m37/01 minor-1: faithful scaffold)
  text = text.replace("<role>", fields.owner);
  text = text.replaceAll("YYYY-MM-DD", fields.created); // created + updated (both occurrences)
  text = text.replace("depends: []", "depends: []");
  text = text.replace("<e.g. 1d / 2d>", fields.timebox);
  return text;
}

async function loadRawTemplate() {
  return readFile(TEMPLATE_PATH, "utf8");
}

function stripStamp(text) {
  // Mirrors the bundle's TEMPLATE_STAMP prefix a rendered install carries; the
  // raw src/bundle file carries no stamp, so this is a defensive no-op today,
  // kept so the helper is safe if ever pointed at a rendered copy instead.
  return text.replace(/^<!-- aof-generated: bundle -->\n\n/, "");
}

async function withSpikeStream(instantiatedContent, { includeTasksAndFeature = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-spike-template-"));
  const work = path.join(root, "work");
  const dir = path.join(work, "00_spike_de-risk-mesh-routing");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SPIKE.md"), instantiatedContent, "utf8");
  if (includeTasksAndFeature) {
    const tasksDir = path.join(dir, "tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(path.join(tasksDir, "00_probe.feature"), "@executable\nFeature: probe\n  Scenario: x\n    Given a\n    When b\n    Then c\n", "utf8");
  }
  return { root, work, dir };
}

function extractFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function extractSection(text, heading) {
  const re = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const match = re.exec(text);
  return match ? match.index : -1;
}

const REQUIRED_FRONTMATTER_KEYS = ["type", "number", "slug", "title", "status", "owner", "created", "updated", "depends", "timebox"];
const REQUIRED_SECTIONS = ["## Question", "## Timebox", "## Investigation", "## Finding", "## Outcome / Next"];

export const workSpikeTemplateTests = [
  // Scenario: an instantiated spike folder validates clean
  {
    name: "work/spike-template: an instantiated SPIKE.md folder validates clean, exit success",
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      const { work, dir, root } = await withSpikeStream(instantiated);
      try {
        const findings = await validateWork(work, {}, null);
        const aboutSpike = findings.filter((f) => f.path && f.path.startsWith(dir));
        assert.deepEqual(aboutSpike, [], `no findings for the instantiated spike folder; got ${JSON.stringify(aboutSpike)}`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: an instantiated spike folder with no tasks/ and no .feature validates clean
  {
    name: "work/spike-template: an instantiated SPIKE.md folder with no tasks/ and no .feature validates clean",
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      const { work, dir, root } = await withSpikeStream(instantiated, { includeTasksAndFeature: false });
      try {
        // Non-vacuity: the folder genuinely carries no tasks/ or .feature.
        assert.ok(!(await pathExists(path.join(dir, "tasks"))), "fixture carries no tasks/ dir");
        const findings = await validateWork(work, {}, null);
        const aboutSpike = findings.filter((f) => f.path && f.path.startsWith(dir));
        assert.deepEqual(aboutSpike, [], `no findings for the instantiated spike folder (no tasks/, no .feature); got ${JSON.stringify(aboutSpike)}`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario Outline: the instantiated SPIKE.md carries required frontmatter key "<key>"
  ...REQUIRED_FRONTMATTER_KEYS.map((key) => ({
    name: `work/spike-template: the instantiated SPIKE.md declares frontmatter key "${key}"`,
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      const meta = extractFrontmatter(instantiated);
      assert.ok(Object.prototype.hasOwnProperty.call(meta, key), `instantiated SPIKE.md declares a "${key}" key; got keys ${JSON.stringify(Object.keys(meta))}`);
    },
  })),

  // Scenario: the instantiated SPIKE.md pins the spike type and carries every required section
  {
    name: 'work/spike-template: the instantiated SPIKE.md pins frontmatter "type" to "spike"',
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      const meta = extractFrontmatter(instantiated);
      assert.equal(meta.type, "spike", `frontmatter type is "spike"; got "${meta.type}"`);
    },
  },
  ...REQUIRED_SECTIONS.map((section) => ({
    name: `work/spike-template: the instantiated SPIKE.md contains a "${section}" section`,
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      assert.ok(extractSection(instantiated, section) !== -1, `instantiated SPIKE.md contains a "${section}" section`);
    },
  })),
];

async function pathExists(p) {
  try {
    await readFile(p);
    return true;
  } catch (err) {
    if (err && err.code === "EISDIR") return true;
    return false;
  }
}
