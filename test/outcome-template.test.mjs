// Traceability wiring for milestone 39 / story 01
// tasks/00_outcome-template.feature — "The OUTCOME.md bundle template ships with
// the pinned Delivered/Assumptions/Gaps grammar" (@executable).
//
// Every scenario (and every Scenario Outline Examples row) below is asserted
// against the REAL shipped templates:
//   - src/bundle/templates/milestone/OUTCOME.md (source, NO marker, NO frontmatter
//     — ADR-004: OUTCOME.md carries no identity)
//   - .aof/templates/work/milestone/OUTCOME.md (bundled, WITH the leading
//     `<!-- aof-generated: bundle -->` marker, LF-pinned by .gitattributes)
// The @manual authoring scenarios (01_verify-authors-outcome.feature) are
// agent-run at aof:verify — not asserted here.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripBundleMarker } from "../src/commands/insert-shared.mjs";
import { TEMPLATE_STAMP } from "../src/work-bundle.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = path.join(repoRoot, "src", "bundle", "templates", "milestone", "OUTCOME.md");
const BUNDLED_PATH = path.join(repoRoot, ".aof", "templates", "work", "milestone", "OUTCOME.md");

// The pinned grammar (SPEC.md `## Stories`): "# NN · <Item Title> — Outcome" —
// literal (unfilled) placeholder text, since this asserts the TEMPLATE, not an
// instantiated doc.
const TITLE_RE = /^# NN · <Item Title> — Outcome$/;

function firstLine(text) {
  return text.split(/\r?\n/)[0];
}

function loadSource() {
  return readFile(SOURCE_PATH, "utf8");
}

function loadBundled() {
  return readFile(BUNDLED_PATH, "utf8");
}

// Everything between a `## Heading` line and the next `##`-level heading (a
// `### ` sub-heading does NOT match `/^##\s+/` — its third char is `#`, not
// whitespace — so it stays INSIDE the parent section). Mirrors
// test/work-chore-template.test.mjs's own extractor.
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

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

export const outcomeTemplateTests = [
  // Scenario: the milestone OUTCOME.md template ships at both the source and
  // bundled locations
  {
    name: "outcome-template: the milestone OUTCOME.md template ships at both the source and bundled locations",
    run: async () => {
      const source = await loadSource().catch(() => null);
      assert.ok(source != null, `a template file exists at the source location ${SOURCE_PATH}`);
      const bundled = await loadBundled().catch(() => null);
      assert.ok(bundled != null, `a bundled template file exists at ${BUNDLED_PATH}`);
    },
  },

  // Scenario: the template opens on the pinned title heading a completed item's
  // OUTCOME carries
  {
    name: "outcome-template: the template opens on the pinned title heading (below the bundle marker, for the bundled copy)",
    run: async () => {
      const source = await loadSource();
      assert.match(
        firstLine(source),
        TITLE_RE,
        `the source template's first content line is the pinned title heading; got ${JSON.stringify(firstLine(source))}`,
      );

      const bundled = await loadBundled();
      const stripped = stripBundleMarker(bundled);
      assert.match(
        firstLine(stripped),
        TITLE_RE,
        `the bundled template's first content line below the marker is the pinned title heading; got ${JSON.stringify(firstLine(stripped))}`,
      );
    },
  },

  // Scenario Outline: the template carries each pinned section in its section
  // grammar — Examples: the three pinned sections (SPEC `## Stories` grammar)
  {
    name: 'outcome-template: the "## Delivered" section carries a `### ` capability heading followed by a one-line delivered statement',
    run: async () => {
      const source = await loadSource();
      const body = stripComments(extractSectionBody(source, "## Delivered") ?? "");
      const lines = body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const headingIdx = lines.findIndex((line) => line.startsWith("### "));
      assert.ok(headingIdx !== -1, `"## Delivered" carries a "### " capability heading; got ${JSON.stringify(lines)}`);
      const statement = lines[headingIdx + 1];
      assert.ok(
        statement && !statement.startsWith("#"),
        `a one-line delivered statement follows the capability heading; got ${JSON.stringify(statement)}`,
      );
    },
  },
  {
    name: 'outcome-template: the "## Assumptions" section carries a `- **<assumption>** — <condition>` bullet that qualifies the preceding capability',
    run: async () => {
      const source = await loadSource();
      const body = stripComments(extractSectionBody(source, "## Assumptions") ?? "");
      assert.match(
        body,
        /^-\s+\*\*.+\*\*\s+—\s+.+$/m,
        `"## Assumptions" carries a "- **<assumption>** — <condition>" bullet; got ${JSON.stringify(body)}`,
      );
    },
  },
  {
    name: 'outcome-template: the "## Gaps" section carries a `### ` surface heading with `**Status:**` (open | discharged) and `**Discharge condition:**`',
    run: async () => {
      const source = await loadSource();
      const body = stripComments(extractSectionBody(source, "## Gaps") ?? "");
      assert.match(body, /^###\s+.+$/m, `"## Gaps" carries a "### " surface heading; got ${JSON.stringify(body)}`);
      assert.match(
        body,
        /\*\*Status:\*\*\s*(open|discharged)/,
        `"## Gaps" carries a "**Status:**" of open|discharged; got ${JSON.stringify(body)}`,
      );
      assert.match(
        body,
        /\*\*Discharge condition:\*\*/,
        `"## Gaps" carries a "**Discharge condition:**" label; got ${JSON.stringify(body)}`,
      );
    },
  },

  // Scenario: the bundled template declares itself bundle-generated with the
  // leading marker
  {
    name: "outcome-template: the bundled template declares itself bundle-generated with the leading marker",
    run: async () => {
      const bundled = await loadBundled();
      assert.equal(
        firstLine(bundled),
        TEMPLATE_STAMP,
        `the bundled template's first line is the bundle marker; got ${JSON.stringify(firstLine(bundled))}`,
      );
    },
  },

  // Scenario: stripping the bundle marker leaves the OUTCOME opening on its
  // title heading — the deliberately-RED-until-generalised scenario (feasibility
  // flag 1): stripBundleMarker's `(?=---)` frontmatter-fence lookahead did NOT
  // tolerate a frontmatter-less OUTCOME.md; relaxed to `(?=\S)`.
  {
    name: "outcome-template: stripping the bundle marker leaves the OUTCOME opening on its title heading, not the marker",
    run: async () => {
      const bundled = await loadBundled();
      assert.ok(bundled.startsWith(TEMPLATE_STAMP), "sanity: the bundled milestone OUTCOME.md carries the leading bundle marker");
      const stripped = stripBundleMarker(bundled);
      assert.match(
        firstLine(stripped),
        TITLE_RE,
        `the resulting document's first line is the title heading, not the marker; got ${JSON.stringify(firstLine(stripped))}`,
      );
    },
  },

  // Scenario: the bundled OUTCOME.md template is byte-stable across platforms
  // (LF line endings)
  {
    name: "outcome-template: the bundled OUTCOME.md template is byte-stable across platforms (LF line endings, no CRLF)",
    run: () => {
      const raw = readFileSync(BUNDLED_PATH);
      const crlfIndex = raw.indexOf(0x0d);
      assert.ok(crlfIndex === -1, `the bundled OUTCOME.md carries no CRLF (\\r) bytes; found one at byte index ${crlfIndex}`);
    },
  },
];
