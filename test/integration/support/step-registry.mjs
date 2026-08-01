// test/integration/support/step-registry.mjs — the declarative step grammar
// (m42 wave (d): the integration/BDD-first restructure). New step modules
// register PATTERNS against handlers instead of growing an if/else chain; the
// runner hands a bare step line (keyword already stripped) to `run`, the first
// matching pattern's handler receives (context, ...captures).
//
// Kept dependency-free on purpose (no cucumber): the harness is ~40 lines and
// the repo owns it — the same reason feature-runner.mjs exists.
export function createStepRegistry() {
  const definitions = [];

  // define(pattern, handler) — pattern is a RegExp (captures become handler
  // args) or an exact string. Definitions are matched in registration order.
  function define(pattern, handler) {
    definitions.push({ pattern, handler });
  }

  async function run(context, step) {
    for (const { pattern, handler } of definitions) {
      if (typeof pattern === "string") {
        if (pattern === step) return await handler(context);
        continue;
      }
      const match = step.match(pattern);
      if (match) return await handler(context, ...match.slice(1));
    }
    throw new Error(`No step definition matches: "${step}"`);
  }

  return { define, run };
}
