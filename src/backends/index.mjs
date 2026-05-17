import { gsdBackend, gsdBackendSdkVersion } from "./gsd-backend.mjs";
import { nullBackend } from "./null-backend.mjs";

const BACKENDS = new Map([
  [gsdBackend.kind, gsdBackend],
  [nullBackend.kind, nullBackend]
]);
const USER_VISIBLE_BACKENDS = new Set(["gsd"]);

// Internal v1.7 seam; this shape is not a public stability promise.
export class BackendUnsupportedError extends Error {
  constructor(actual, details = {}) {
    const expected = details.expected ?? supportedBackends();
    super(`Unsupported board backend "${actual}". Supported backends: ${expected.join(", ")}.`);
    this.name = "BackendUnsupportedError";
    this.code = "BACKEND_UNSUPPORTED";
    this.expected = expected;
    this.actual = actual;
    this.next = details.next ?? "Use executionProvider \"gsd\" or remove executionProvider for a manual board.";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      expected: this.expected,
      actual: this.actual,
      next: this.next
    };
  }
}

export class BackendCapabilityError extends Error {
  constructor(backend, capability) {
    super(`Board backend "${backend.kind}" does not support capability "${capability}".`);
    this.name = "BackendCapabilityError";
    this.code = "BACKEND_CAPABILITY_UNSUPPORTED";
    this.expected = capability;
    this.actual = backend.kind;
    this.next = "Use executionProvider \"gsd\" for agent assignment.";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      expected: this.expected,
      actual: this.actual,
      next: this.next
    };
  }
}

export function resolveBackend(name = "gsd") {
  if (name && typeof name === "object" && typeof name.kind === "string") return name;
  const normalized = normalizeBackendName(name);
  const backend = BACKENDS.get(normalized);
  if (!backend) throw new BackendUnsupportedError(normalized);
  return backend;
}

export function supportedBackends(options = {}) {
  const kinds = [...BACKENDS.keys()]
    .filter((kind) => options.includeTest || USER_VISIBLE_BACKENDS.has(kind))
    .sort();
  return kinds;
}

export function backendSdkVersion(backendOrName = "gsd") {
  const backend = resolveBackend(backendOrName);
  if (backend.kind === "gsd") return gsdBackendSdkVersion();
  return {
    installed: null,
    cliBundled: null,
    drift: false,
    driftReason: null
  };
}

function normalizeBackendName(name) {
  if (name === undefined || name === null || name === "") return "gsd";
  return String(name).trim().toLowerCase();
}
