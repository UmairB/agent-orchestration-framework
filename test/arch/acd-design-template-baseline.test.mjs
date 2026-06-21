// Fitness function for milestone 07 / ADR-003:
// "The bundled DESIGN milestone template encodes BOTH the committed-`mocks/`-dir convention
//  (a committed, locally-readable artifact referenced as the source of truth) AND a mandatory
//  binding-checklist section (regions-in-order / components / states / ramp) per surface; it no
//  longer presents a remote design-tool link as the SOLE mock reference."
//
// Reads src/bundle/templates/milestone/DESIGN.md and asserts the convention markers are present
// (and the stale remote-link-only-mock shape is gone). Mirrors 02_design-template-baseline.feature.
// Plain node:fs read + node:assert/strict; case-insensitive substring checks for prose markers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEMPLATE_URL = new URL("../../src/bundle/templates/milestone/DESIGN.md", import.meta.url);
const TEMPLATE_PATH = fileURLToPath(TEMPLATE_URL);

function template() {
  return readFileSync(TEMPLATE_PATH, "utf8");
}

// case-insensitive substring presence
function has(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export const archTests = [
  {
    name: "arch/ADR-003: the DESIGN template references a committed mocks/ dir as the conformance source of truth (a locally-readable, committed artifact)",
    run: async () => {
      const body = template();

      assert.ok(
        has(body, "mocks/"),
        "the template references a committed mocks/ directory"
      );
      assert.ok(
        has(body, "source of truth"),
        "the mocks/ dir is named as the conformance source of truth"
      );
      assert.ok(
        has(body, "conformance source of truth"),
        "the committed mock is the conformance source of truth"
      );
      assert.ok(
        has(body, "committed") && has(body, "locally-readable"),
        "the template requires a mock to be a locally-readable, committed artifact"
      );
    }
  },
  {
    name: "arch/ADR-003: the DESIGN template carries a mandatory binding-checklist section per surface (regions in order / components / states empty-loading-error-populated / ramp)",
    run: async () => {
      const body = template();

      assert.ok(
        has(body, "binding checklist") && has(body, "mandatory"),
        "the template carries a mandatory binding-checklist section"
      );
      assert.ok(
        has(body, "layout regions") && has(body, "in order"),
        "the checklist enumerates the layout regions in order"
      );
      assert.ok(
        has(body, "the components each region holds") || (has(body, "component") && has(body, "each region")),
        "the checklist enumerates the components each region holds"
      );
      assert.ok(
        has(body, "empty") && has(body, "loading") && has(body, "error") && has(body, "populated"),
        "the checklist enumerates the states (empty / loading / error / populated)"
      );
      assert.ok(
        has(body, "design ramp") && has(body, "each uses"),
        "the checklist enumerates the design ramp each uses"
      );
    }
  },
  {
    name: "arch/ADR-003: the DESIGN template states that with no committed mock the binding checklist is mandatory and is the source of truth",
    run: async () => {
      const body = template();

      assert.ok(
        has(body, "no committed mock") || has(body, "no mock"),
        "the template addresses the no-mock case"
      );
      // Match the literal phrase against a whitespace-flattened body so a line-wrap inside it does not
      // silently fall through to the looser 3-substring branch (craft nit: keep the literal branch live).
      const flat = body.replace(/\s+/g, " ").toLowerCase();
      assert.ok(
        flat.includes("binding checklist is mandatory and is the source of truth") ||
          (has(body, "binding checklist") && has(body, "mandatory") && has(body, "source of truth")),
        "with no mock, the binding checklist is mandatory and is the source of truth"
      );
    }
  },
  {
    name: "arch/ADR-003: the DESIGN template does NOT present a remote design-tool link as the SOLE mock reference (the stale simple-template shape is gone)",
    run: async () => {
      const body = template();

      // The stale template carried `Mockup: <Figma / image / design-bundle link>` as the sole mock
      // reference. Forbid that exact sole-reference shape regressing in.
      assert.ok(
        !/-\s*\*\*mockup:\*\*\s*<figma\b/i.test(body),
        "the stale 'Mockup: <Figma … link>' sole-reference line must not be present"
      );
      assert.ok(
        !/-\s*\*\*mockup:\*\*\s*<[^>]*\blink\b[^>]*>/i.test(body),
        "no 'Mockup: <… link>' line offering a remote link as the sole mock reference"
      );
    }
  }
];
