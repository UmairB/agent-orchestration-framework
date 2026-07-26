// Traceability wiring for milestone 37 / story 01
// tasks/01_chore-template-and-command.feature — "the bundled CHORE.md template
// instantiates to a folder that validates clean".
//
// Every @executable scenario (and every Scenario Outline Examples row) below is
// asserted against the REAL shipped template (src/bundle/templates/chore/CHORE.md)
// — no fixture text is hand-authored here for the instantiated doc's shape.
// Placeholders are filled by simple string substitution (the same substitution an
// agent running /aof:add-chore performs), then the folder is validated with the
// LOCKED engine `validateWork` (../src/work.mjs), mirroring test/work-spike-chore-validate.test.mjs.
//
// The @manual scenario (/aof:add-chore scaffolds a chore folder that validates
// clean) is agent-work the executable suite can't do — its procedure is recorded
// in the milestone UAT record (verifies →), NOT asserted here.
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateWork, WORK_ITEM_SCHEMA_VERSION } from "../src/work.mjs";
import { packageVersionString } from "../src/asset-base.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = path.join(repoRoot, "src", "bundle", "templates", "chore", "CHORE.md");

function instantiate(raw, overrides = {}) {
  const fields = {
    NN: "00",
    slug: "tidy-config",
    title: "Tidy config",
    owner: "developer",
    created: "2026-07-09",
    updated: "2026-07-09",
    ...overrides,
  };
  let text = raw;
  text = text.replaceAll("NN", fields.NN);
  text = text.replace("<kebab-slug>", fields.slug);
  text = text.replace('"<Chore Title>"', `"${fields.title}"`);
  text = text.replaceAll("<Chore Title>", fields.title); // fill the body H1 too (QA m37/01 minor-1: faithful scaffold)
  text = text.replace("<role>", fields.owner);
  text = text.replaceAll("YYYY-MM-DD", fields.created);
  // milestone 40 born-stamp (ADR-002): fill <schema-version>/<aof-version> the
  // same way insert-shared.mjs's stampVersion does, so the instantiated folder
  // is never stale-by-construction.
  text = text.replace("<schema-version>", String(WORK_ITEM_SCHEMA_VERSION));
  text = text.replace("<aof-version>", packageVersionString());
  return text;
}

async function loadRawTemplate() {
  return readFile(TEMPLATE_PATH, "utf8");
}

function stripStamp(text) {
  return text.replace(/^<!-- aof-generated: bundle -->\n\n/, "");
}

async function withChoreStream(instantiatedContent, { includeTasksAndFeature = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-chore-template-"));
  const work = path.join(root, "work");
  const dir = path.join(work, "00_chore_tidy-config");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "CHORE.md"), instantiatedContent, "utf8");
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

// Extract a heading section's body: everything between the heading line and the
// next `##`-level heading (or end of doc).
function extractSectionBody(text, heading) {
  const lines = text.split(/\r?\n/);
  const headingIdx = lines.findIndex((line) => line.trim() === heading);
  if (headingIdx === -1) return null;
  const body = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

const REQUIRED_FRONTMATTER_KEYS = ["type", "number", "slug", "title", "status", "owner", "created", "updated", "depends"];
const REQUIRED_SECTIONS = ["## Intent", "## Definition of Done", "## Notes"];

export const workChoreTemplateTests = [
  // Scenario: an instantiated chore folder validates clean
  {
    name: "work/chore-template: an instantiated CHORE.md folder validates clean, exit success",
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      const { work, dir, root } = await withChoreStream(instantiated);
      try {
        const findings = await validateWork(work, {}, null);
        const aboutChore = findings.filter((f) => f.path && f.path.startsWith(dir));
        assert.deepEqual(aboutChore, [], `no findings for the instantiated chore folder; got ${JSON.stringify(aboutChore)}`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: an instantiated chore folder with no tasks/ and no .feature validates clean
  {
    name: "work/chore-template: an instantiated CHORE.md folder with no tasks/ and no .feature validates clean",
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      const { work, dir, root } = await withChoreStream(instantiated, { includeTasksAndFeature: false });
      try {
        assert.ok(!(await pathExists(path.join(dir, "tasks"))), "fixture carries no tasks/ dir");
        const findings = await validateWork(work, {}, null);
        const aboutChore = findings.filter((f) => f.path && f.path.startsWith(dir));
        assert.deepEqual(aboutChore, [], `no findings for the instantiated chore folder (no tasks/, no .feature); got ${JSON.stringify(aboutChore)}`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario Outline: the instantiated CHORE.md carries required frontmatter key "<key>"
  ...REQUIRED_FRONTMATTER_KEYS.map((key) => ({
    name: `work/chore-template: the instantiated CHORE.md declares frontmatter key "${key}"`,
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      const meta = extractFrontmatter(instantiated);
      assert.ok(Object.prototype.hasOwnProperty.call(meta, key), `instantiated CHORE.md declares a "${key}" key; got keys ${JSON.stringify(Object.keys(meta))}`);
    },
  })),

  // Scenario: the chore type is pinned
  {
    name: 'work/chore-template: the instantiated CHORE.md pins frontmatter "type" to "chore"',
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      const meta = extractFrontmatter(instantiated);
      assert.equal(meta.type, "chore", `frontmatter type is "chore"; got "${meta.type}"`);
    },
  },

  // Scenario Outline: the instantiated CHORE.md contains required section "<section>"
  ...REQUIRED_SECTIONS.map((section) => ({
    name: `work/chore-template: the instantiated CHORE.md contains a "${section}" section`,
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      assert.ok(extractSectionBody(instantiated, section) !== null, `instantiated CHORE.md contains a "${section}" section`);
    },
  })),

  // Scenario: the instantiated CHORE.md's Definition of Done is a checkbox list
  {
    name: 'work/chore-template: the "## Definition of Done" section body is a markdown checkbox list (every non-empty line begins with "- [ ]" or "- [x]")',
    run: async () => {
      const raw = await loadRawTemplate();
      const instantiated = instantiate(stripStamp(raw));
      const body = extractSectionBody(instantiated, "## Definition of Done");
      assert.ok(body !== null, 'the "## Definition of Done" section is present');
      const withoutComments = body.replace(/<!--[\s\S]*?-->/g, "");
      const nonCommentLines = withoutComments
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      assert.ok(nonCommentLines.length > 0, "the Definition of Done section carries at least one checklist item");
      for (const line of nonCommentLines) {
        assert.match(line, /^-\s\[[ xX]\]\s/, `Definition of Done line "${line}" begins with "- [ ]" or "- [x]"`);
      }
    },
  },
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
