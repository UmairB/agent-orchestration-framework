---
type: story
number: 01
slug: binary-provisioning
title: "Binary provisioning — assets-only + an aof project doctor graphify-binary check (the npx installer untouched)"
parent: 09
status: in-review
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
---
# 01 · Binary provisioning — the Python-binary install path made real

## User story

As an operator adopting graphify in an aof project,
I want `aof project doctor` to tell me clearly whether graphify's binary is present — and, when it is not, exactly how to install it (`uv tool install graphifyy` then `graphify install`) — without aof trying to install a Python tool through its npx-only installer,
so that the Python-binary provisioning is an honest, deliberate check (the milestone's load-bearing carry-forward decision) rather than a silent failure deep inside a `graph:*` command.

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 09/01`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [binary-resolution](tasks/00_binary-resolution.feature)** — `resolveGraphifyBinary()` returns a structured present/absent result (binary `graphify`, spec `graphifyy` — the name asymmetry) with an install hint when absent; never an opaque ENOENT. _@executable green; live present-binary row @manual (verify)._
- [x] **01 · [doctor-graphify-check](tasks/01_doctor-graphify-check.feature)** — `aof project doctor` carries a `graphify-binary` check: `ok` when present (version, or "present, version unknown" when the probe is unavailable), `warning` + install guidance when absent — never an error, never a crash. Plus a version-pin drift warning. _@executable green._

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-004** the assets-only + doctor-check
decision, Option B; **ADR-002** the `resolveGraphifyBinary` seam it implements against). This story
**owns**: the `resolveGraphifyBinary()` implementation wired against story 00's driver seam, and the new
**`graphify-binary`** check added to `doctorConfig`'s `checks[]` in
[config-inspect.mjs](../../../../../src/config-inspect.mjs) (surfaced by `aof project doctor`). It does
**not** touch [frameworks.mjs](../../../../../src/frameworks.mjs) — the npx installer is provably unchanged
(ADR-004 invariant, enforced by story 03's `acd-graphify-no-npx-install`). It does **not** author the
`graph:*` commands (story 00) or the rendered faces (story 02).

**Independent because** it consumes only story 00's already-frozen driver seam (`resolveGraphifyBinary`'s
contract) and the existing `doctorConfig` `checks[]` surface — and produces a project-health check that no
sibling consumes. Its target surface (the doctor check) is disjoint from the commands (00), the faces (02),
and the arch-tests (03). The absent-binary path is CI-assertable with PATH stubbed empty; the present-binary
/ version-probe behaviour against a real install is `@manual`/doctor-confirmed (the version command is a
live-only assumption, RESEARCH §A4).

**Feasibility (developer amigo seat — confirmed at Contract):** **Buildable as written.**
`resolveGraphifyBinary()` is a small PATH-resolution + structured-result function (locate the `graphify`
single-y executable; on miss return `{found:false, hint}` rather than throwing ENOENT; on hit attempt a
version probe and degrade to "present, version unknown" when it is unavailable) — confirmed bounded, and
its absent-binary path is CI-assertable with PATH stubbed empty exactly as the feature and ADR-006 inv. 3
require. **The doctor seam genuinely supports the `graphify-binary` check** — confirmed by reading
`config-inspect.mjs`: `doctorConfig()` (line 229) builds a plain `checks` array and `push`es entries of the
shape `{ id, severity, message, details? }` — e.g. `checks.push({ id: "legacy-config", severity:
"warning", message: … })` (lines 242-246) and `checks.push({ id: "generated-output-drift", severity:
driftCount > 0 ? "warning" : "ok", message: …, details: … })` (lines 270-275). Severity is a free string
the consumer reads (`"ok"`/`"warning"`/`"error"`/`"info"` are all in live use); there is no enum gate and
no schema to extend — adding a `{ id: "graphify-binary", severity: "warning"|"ok", message, details? }`
entry is purely additive and matches the established idiom byte-for-byte. The check calls the driver's
`resolveGraphifyBinary()`; `doctorConfig` is already `async`, so awaiting the resolver is free.
**`src/frameworks.mjs` needs NO change** — confirmed: `planFrameworkInstall` hardcodes argv[0] as `"npx"`
(line 66), `FRAMEWORKS` holds only GSD, and there is no `uv`/`pipx`/`pip`/`graphify` reference anywhere in
the file; ADR-004 Option B leaves it untouched and story 03's `acd-graphify-no-npx-install` is GREEN now.
**Hard part (bounded, honestly gated):** the *present-binary + version* branch is a live-only assumption
(`graphify --version` is unconfirmed, RESEARCH §A4), so its real-install behaviour is `@manual`/doctor-
confirmed; the *degrade-clearly structure* (warning + guidance + version-unknown) is fully CI-assertable
with the binary stubbed absent. No blockers.
