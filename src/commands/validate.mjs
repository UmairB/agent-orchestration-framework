// work:validate — the deterministic stream validator (ADR-002).
//
// `run` returns the `{ findings }` envelope SHAPE (the board's milestone-03
// envelope), each finding's `path` left a RAW ABSOLUTE in its on-disk OS form —
// NO displayPath, NO path.relative, NO slashing inside run (the ADR-002
// keystone). Path display is a FACE adapter: the board projects to projectRoot +
// forward-slash; the CLI `--json` projects to cwd (path.relative) AND unwraps to
// the bare `[{path,problem}]` array it has always emitted (the CLI's historical
// quirk, preserved by the adapter — the command result stays the richer envelope).
// An unresolved scope is a filter that matches nothing → empty findings, no error
// (validateWork's scope-as-filter semantics are preserved through the re-home).
import path from "node:path";
import { validateWork } from "../work.mjs";

export const validateCommand = {
  id: "work:validate",
  input: {
    type: "object",
    properties: { scope: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const scope = scopeOf(input);
    const findings = await validateWork(ctx.workspace.workDir, ctx.workspace.config, scope);
    // Raw absolute paths, OS-native, NO projection — the face relativises.
    return { findings: findings.map((finding) => ({ path: finding.path, problem: finding.problem })) };
  },

  cli: {
    // `aof work validate [scope]` — an optional positional maps onto the input.
    argv: (positionals) => (positionals[0] ? { scope: positionals[0] } : {}),

    // Reproduces today's `aof work validate` human output byte-for-byte: the PASS
    // line (scope-aware via faceCtx) on a clean stream; otherwise the numbered
    // issue list with cwd-relative paths and the trailing test-traceability note.
    render(result, faceCtx = {}) {
      if (result.findings.length === 0) {
        return `PASS — ${faceCtx.scope ? `${faceCtx.scope} is` : "work stream is"} well-formed.`;
      }
      const lines = result.findings.map(
        (finding) => `  ${path.relative(process.cwd(), finding.path)} — ${finding.problem}`
      );
      return [
        `${result.findings.length} issue(s):`,
        ...lines,
        "\nNote: test-traceability (@executable → green test; @manual/@uat → VERIFICATION rows) is not yet checked here.",
      ].join("\n");
    },

    // The CLI's historical `--json` is the BARE array (cli.mjs:586), not the
    // envelope: unwrap `{findings}` and relativise each path to cwd (OS separators).
    json: (result) =>
      result.findings.map((finding) => ({
        path: path.relative(process.cwd(), finding.path),
        problem: finding.problem,
      })),
  },
};

function scopeOf(input) {
  const scope = typeof input?.scope === "string" ? input.scope.trim() : "";
  return scope === "" ? undefined : scope;
}
