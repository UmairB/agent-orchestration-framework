// THE CONFIG LOAD RULE — when is a response from `/api/config/<scope>` actually a config?
// (milestone 45, finding F-45-M-1 at `aof:verify 45`.)
//
// A framework-free leaf, in `.mjs` for the house reason: a rule that lives inside a component
// is a rule nothing can check without a bundler and a DOM. This one earned its own home the
// hard way.
//
// WHAT WENT WRONG. `App.tsx`'s loader was the one `fetch` in that file that did not test
// `response.ok` before believing the body — every other call site already did. On an origin
// that does not serve `/api/config` (the FLEET origin, which milestone 45 gave a `/config`
// path AND a nav item advertising it as available), the 404's coded `{ ok:false, error, code }`
// envelope was parsed and stored AS the config payload. `payload` was then truthy while
// `payload.resources` was `undefined`, so the editor's `.filter` threw during render — and with
// no boundary above the surface, React unmounted the WHOLE tree: the shell, the top bar, the
// nav and the operator's way back went with it. A blank page: no shell, no navigation, no way
// back but the browser's Back button, one click from the fleet.
//
// THE RULE IS POSITIVE, NOT DEFENSIVE. It does not list the shapes that are known to be bad;
// it states the one shape that is good and rejects everything else. A 200 carrying the SPA
// shell's HTML, a coded refusal, a truncated body and a 404 all fail the same way and for the
// same stated reason, which is what stops the next unanticipated shape reaching the editor.

// The coded failure a caller can present. `code` is the server's own when it sent one, so a
// refusal keeps its identity instead of collapsing into "something went wrong".
export class ConfigLoadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ConfigLoadError";
    this.code = code;
  }
}

// isConfigPayload(body) — the ONE definition of "this is a config". `resources` being an array
// is the load-bearing half: it is the field the editor reads first and the field whose absence
// produced F-45-M-1.
export function isConfigPayload(body) {
  return Boolean(body) && typeof body === "object" && body.ok !== false && Array.isArray(body.resources);
}

// loadScope(fetchImpl, scope) — fetch one scope and return its payload, or throw a
// `ConfigLoadError` naming why. Never returns a non-payload.
export async function loadScope(fetchImpl, scope) {
  const response = await fetchImpl(`/api/config/${scope}`);
  // A non-JSON body is itself a failed load — an origin answering HTML here (the SPA shell,
  // say) must not reach the editor as an object with no `resources`.
  const body = await response.json().catch(() => null);
  if (!response.ok || !isConfigPayload(body)) {
    throw new ConfigLoadError(
      body?.error ?? `The configuration API answered ${response.status} for ${scope}.`,
      body?.code ?? `http-${response.status}`,
    );
  }
  return body;
}
