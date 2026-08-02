// Fitness function for milestone 01 / ADR-005:
// "Every file rendered by init/update carries the aof-generated stamp in its
//  correct form (frontmatter key for resources, comment marker for templates);
//  managed-file detection recognises exactly stamped files."
//
// Render every bundle member with the REAL renderer; assert each output is
// recognised by the frozen detection contract AND carries the form-correct
// marker; assert an unstamped fixture is detected as not-managed.
import assert from "node:assert/strict";
import { loadBundle, renderBundleOutputs, TEMPLATE_STAMP } from "../../src/work-bundle.mjs";

// The frozen detection contract (ADR-005): a file is aof-managed iff it carries
// the `aof-generated` marker in EITHER canonical form —
//   - frontmatter key: a literal `aof-generated: <truthy>` line inside a leading
//     `---` … `---` block; OR
//   - comment form: the file head contains an `aof-generated:` comment marker,
//     either the markdown/HTML `<!-- aof-generated: … -->` or (m43, the ASSET kind —
//     a verbatim script, which cannot carry YAML frontmatter or an HTML comment and
//     stay executable) the line-comment `// aof-generated: …`.
function isManaged(content) {
  const text = String(content).replace(/^﻿/, "");
  // Comment form: head contains the aof-generated comment marker.
  const head = text.slice(0, 512);
  if (/<!--\s*aof-generated:/.test(head)) return true;
  if (/^\s*\/\/\s*aof-generated:/m.test(head)) return true;
  // Frontmatter form: aof-generated truthy key inside the leading --- block.
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      const block = text.slice(0, end);
      const match = /^aof-generated:\s*(.+)$/m.exec(block);
      if (match) {
        const value = match[1].trim();
        return value !== "" && value !== "false" && value !== "0";
      }
    }
  }
  return false;
}

function hasFrontmatterStamp(content) {
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return false;
  return /^aof-generated:\s*true\s*$/m.test(content.slice(0, end));
}

export const archTests = [
  {
    name: "arch/ADR-005: every rendered bundle member is recognised as aof-managed by the detection contract",
    run: async () => {
      const bundle = loadBundle();
      const outputs = renderBundleOutputs(bundle, { runtimes: ["claude"] });
      assert.ok(outputs.length > 0, "bundle renders outputs");
      for (const output of outputs) {
        assert.ok(isManaged(output.content), `${output.path} (${output.resource.kind}) is recognised as managed`);
      }
    }
  },
  {
    name: "arch/ADR-005: resources carry the frontmatter-key form; templates carry the comment-marker form",
    run: async () => {
      const bundle = loadBundle();
      const outputs = renderBundleOutputs(bundle, { runtimes: ["claude"] });
      for (const output of outputs) {
        if (output.resource.kind === "template") {
          assert.ok(output.content.startsWith(TEMPLATE_STAMP), `${output.path} begins with the comment-form stamp`);
          // A template carries the comment form, NOT a YAML frontmatter key.
          assert.ok(!hasFrontmatterStamp(output.content), `${output.path} does not use the frontmatter form`);
        } else if (output.resource.kind === "asset") {
          // m43 — an ASSET ships VERBATIM (the artifact-sync enqueue script is the
          // first): frontmatter would not parse and an HTML comment would not execute,
          // so its stamp is the language's own line comment. The invariant is unchanged
          // — every rendered file still declares itself aof-managed in-band.
          assert.ok(/^\s*\/\/\s*aof-generated:/m.test(output.content.slice(0, 512)), `${output.path} carries the line-comment stamp`);
          assert.ok(!hasFrontmatterStamp(output.content), `${output.path} does not use the frontmatter form`);
        } else {
          assert.ok(hasFrontmatterStamp(output.content), `${output.path} (${output.resource.kind}) carries aof-generated: true frontmatter`);
        }
      }
    }
  },
  {
    name: "arch/ADR-005: exactly one stamp form per file (resources never carry the comment marker; templates never the frontmatter key)",
    run: async () => {
      const bundle = loadBundle();
      const outputs = renderBundleOutputs(bundle, { runtimes: ["claude"] });
      for (const output of outputs) {
        const isTemplate = output.resource.kind === "template";
        const hasComment = output.content.slice(0, 512).includes("<!-- aof-generated:");
        const hasFrontmatter = hasFrontmatterStamp(output.content);
        if (output.resource.kind === "asset") {
          assert.ok(!hasComment && !hasFrontmatter, `${output.path} uses neither of the document forms`);
          assert.ok(/^\s*\/\/\s*aof-generated:/m.test(output.content.slice(0, 512)), `${output.path} has only the line-comment form`);
        } else if (isTemplate) {
          assert.ok(hasComment && !hasFrontmatter, `${output.path} has only the comment form`);
        } else {
          assert.ok(hasFrontmatter && !hasComment, `${output.path} has only the frontmatter form`);
        }
      }
    }
  },
  {
    name: "arch/ADR-005: an unstamped fixture is detected as NOT aof-managed",
    run: async () => {
      // A plausible user-authored file with no aof-generated marker in either form.
      const userFrontmatter = "---\nname: my-agent\ndescription: hand written\n---\n\nBody.";
      const userMarkdown = "# My notes\n\nNothing generated here.\n";
      const userFalse = "---\naof-generated: false\nname: x\n---\n\nopted out";
      assert.equal(isManaged(userFrontmatter), false, "user frontmatter without aof-generated is not managed");
      assert.equal(isManaged(userMarkdown), false, "plain markdown is not managed");
      assert.equal(isManaged(userFalse), false, "aof-generated: false is an explicit opt-out, not managed");
    }
  }
];
