// Type declarations for the config load rule (milestone 45, finding F-45-M-1). `config-load.mjs`
// is framework-free JavaScript so node:test can drive it with no bundler; `App.tsx` gets its
// types from here — the same split `ui/src/app/routes.d.mts` uses for the route table.

export declare class ConfigLoadError extends Error {
  constructor(message: string, code: string);
  name: "ConfigLoadError";
  code: string;
}

// The ONE definition of "this response is a config". `resources` being an array is the
// load-bearing half — its absence is what produced F-45-M-1.
export declare function isConfigPayload(body: unknown): boolean;

// Fetch one scope and return its payload, or throw a `ConfigLoadError` naming why. Never
// returns a non-payload. The caller supplies `fetch` so a lane can drive it without a network.
export declare function loadScope(
  fetchImpl: typeof fetch,
  scope: "project" | "global",
): Promise<Record<string, unknown>>;
