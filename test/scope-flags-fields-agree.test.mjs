// Review fix (milestone 39): `aof work memory recall`'s scope dimensions are a
// deliberately duplicated two-file seam — `work-memory.mjs`'s SCOPE_FLAGS (which
// argv flags PARSE into `scope`) and `local-retrieval.mjs`'s SCOPE_FIELDS (which
// fields `applyScope` actually FILTERS on). The duplication itself is a noted
// boundary (not refactored here); this test guards it: a future scope dimension
// added to only ONE of the two lists must fail LOUDLY (a flag that parses but
// never filters, or a filterable field with no flag to set it) rather than
// half-working silently.
import assert from "node:assert/strict";
import { SCOPE_FLAGS } from "../src/work-memory.mjs";
import { SCOPE_FIELDS } from "../src/memory/local-retrieval.mjs";

export const scopeFlagsFieldsAgreeTests = [
  {
    name: "scope-flags-fields-agree: work-memory.mjs's SCOPE_FLAGS and local-retrieval.mjs's SCOPE_FIELDS are the SAME set",
    run: () => {
      const flags = new Set(SCOPE_FLAGS);
      const fields = new Set(SCOPE_FIELDS);
      assert.deepEqual(
        [...flags].sort(),
        [...fields].sort(),
        `SCOPE_FLAGS ${JSON.stringify([...flags].sort())} must equal SCOPE_FIELDS ${JSON.stringify([...fields].sort())}`,
      );
    },
  },
];
