// Regression test for review fix 2 (milestone 41 as-built review, 2026-07-16):
// "CRLF templates defeat the bundle-marker strip -> validate-broken scaffold on
// Windows." `stripBundleMarker` (src/commands/insert-shared.mjs) used
// `/^<!--[^\n]*-->\r?\n+(?=---)/`, which on a CRLF template (`-->\r\n\r\n---`,
// i.e. TWO separate \r\n units) consumed only the FIRST \r\n, leaving a
// leftover `\r\n---` that the `(?=---)` lookahead never satisfied — nothing
// stripped, and the scaffolded doc's first line stayed the
// `<!-- aof-generated: bundle -->` comment, which `parseFrontmatter` (anchors
// `^---`, no /m) then reads as `{}` — VALIDATE-BROKEN. This is a
// Windows-primary target: `.gitattributes` did not pin
// `.aof/templates/**/*.md` to LF, so a `core.autocrlf=true` checkout hands the
// scaffold CRLF template bytes for real.
//
// Wired against the REAL registered command `work:insert-milestone`, invoked
// in-process through the command core, over a template whose bytes are
// rewritten to CRLF (mirroring what a `core.autocrlf=true` checkout would
// hand the command) — confirmed via a fresh read of the scaffolded doc's
// bytes, `parseFrontmatter`, and `aof work validate`.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { invoke } from "../src/command-core.mjs";
import { findWork, validateWork, parseFrontmatter } from "../src/work.mjs";
import { withInsertFixture, buildTopLevelMilestones } from "./support/work-insert-fixture.mjs";

// Convert EVERY line ending to CRLF (first normalizing to LF, defensively) —
// mirroring a `core.autocrlf=true` Windows checkout of a template authored
// (and committed) with LF endings.
function toCRLF(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

export const workInsertCrlfTemplateStripTests = [
  {
    name: "work-insert/crlf-template-strip: insert-milestone scaffolds validate-green from a CRLF-templated SPEC.md (the bundle marker still strips)",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 3); // 00-02 (alpha..charlie)

        const templatePath = path.join(workspace.aofDir, "templates", "work", "milestone", "SPEC.md");
        const original = await readFile(templatePath, "utf8");
        assert.ok(original.startsWith("<!--"), "sanity: the real template starts with the bundle marker");
        const crlf = toCRLF(original);
        assert.ok(
          crlf.includes("-->\r\n\r\n---"),
          `sanity: the rewritten template bytes carry TWO separate \\r\\n units between the marker and the fence: ${JSON.stringify(crlf.slice(0, 40))}`,
        );
        await writeFile(templatePath, crlf, "utf8");

        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 1 }, { workspace });
        assert.equal(Number(result.created.ref), 1, `reports the new item's ref as 1 (got ${result.created.ref})`);

        const widget = (await findWork(workDir, "1")).find((row) => row.slug === "widget-support");
        assert.ok(widget, "a fresh find 1 resolves the new milestone");

        const scaffolded = await readFile(path.join(widget.dir, "SPEC.md"), "utf8");
        assert.ok(
          scaffolded.startsWith("---"),
          `the scaffolded doc's FIRST line is "---" — the bundle-marker comment was stripped even from CRLF template bytes: ${JSON.stringify(scaffolded.slice(0, 60))}`,
        );

        const meta = parseFrontmatter(scaffolded);
        assert.equal(meta.type, "milestone", `parseFrontmatter reads REAL frontmatter, not {} (got ${JSON.stringify(meta)})`);
        assert.equal(String(meta.number), "01", `parseFrontmatter reads the real number (got ${meta.number})`);
        assert.equal(meta.slug, "widget-support", `parseFrontmatter reads the real slug (got ${meta.slug})`);

        const findings = await validateWork(workDir, workspace.config);
        const own = findings.filter((f) => f.path.startsWith(widget.dir));
        assert.deepEqual(own, [], `the CRLF-templated scaffold is validate-green: ${JSON.stringify(own)}`);
      }),
  },
];
