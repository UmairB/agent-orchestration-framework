---
doc: verification
updated: 2026-06-26
---
<!--
  Milestone VERIFICATION.md — the record of the verify pass: evidence, findings, accept decision.
  Owner: aof:verify. Write only sections that have content (absence of a section is information).
-->
# 17 · Notion Work-Board Sync — Verification

Verify run `2026-06-26` (`aof:verify 17`). Lanes in scope: `@executable` (56) + `@manual` (18); **no
`@uat`** (no human-acceptance step) and **no UI** (no design-conformance / designer pass). Outcome:
the automated + agent-runnable lanes are green; the live-Notion `@manual` lanes are **deferred** (no
workspace/token on this host) → milestone **held `in-review`** (operator decision).

## Verification evidence

Agent-run, no token required — each procedure executed inline against the as-built CLI.

- **`@executable` suite + fitness — green.** `node scripts/test.mjs` → **1310 ok / 0 not ok** (63 notion
  tests). The seven `acd-notion-*` arch-tests all pass (mutation-verified non-vacuous at the build-review
  gate). *verifies →* story-03 fitness table (mapping-sidecar, one-way, opt-in-no-op, auth-env-ref,
  no-schema-write, cli-not-mcp, fail-honestly) + every `@executable` scenario across stories 00/01/02.
- **Opt-in no-op, live.** `node src/cli.mjs work integrations notion sync-work 17 --json` against this
  unconfigured project returned `{ "configured": false, "items": [], "hint": "Notion sync is not
  configured. Add a \"work.integrations.notion\" block …" }`, exit 0, zero CLI spawn / zero Notion calls.
  *verifies →* `00/01_opt-in-no-op-when-unconfigured.feature` + arch-test `acd-notion-opt-in-noop`
  (ADR-004 / ADR-005 inv.3).
- **`aof project doctor` surfaces Notion, advisory-only.** `node src/cli.mjs project doctor` reported
  `warning: managed-tool — Run \`aof project provision notion\`…` (CLI absent → honest warning with
  provision guidance) and `ok: tool-platform — notion is supported on win32 (x64 only (no win32-arm64))`.
  Doctor exit 0 — no Notion check errored or threw. *verifies →* `02/03_doctor-surfaces-notion.feature`
  managed-tool absent-warning row + tool-platform win32-ok row + the never-error scenario.
- **Pinned `ntn` CLI installs and runs on win32 (binary availability).** `npx -y ntn@0.17.0 --version` →
  `ntn 0.17.0`, exit 0 — the descriptor's pinned version is provisionable via the npx lane and the binary
  executes on this win32 x64 host. *verifies →* `02/01_descriptor-registered.feature` (the live binary-run
  half) + the STATE §Open "win32 binary running" build-time `@manual` confirmation.

## Findings

| id | observed | type | severity | triage | routed-to | status |
|----|----------|------|----------|--------|-----------|--------|
| NTN-V1 | The four live-Notion `@manual` lanes — `01` live first-run create / resync-no-duplicate / patch-in-place, `02` live `ntn api` auth round-trip, `03` live doctor present-and-versioned + auth-reachable, `04` one-way disk-wins / no-read-back — could not be executed: this host has no Notion workspace and no `NOTION_API_TOKEN` (a known, documented constraint, RESEARCH §A2). Each lane has a **green `@executable` MECHANIC twin** proving the offline behaviour through the injected `ctx.notionSpawn` seam, and the structural invariants (one-way, fail-honestly, opt-in) are arch-test-enforced; the only unconfirmed surface is the real `ntn api` HTTP round-trip against a live board (auth landing, create/patch/relation actually written, 429/`Retry-After` pacing). | environmental (live-token deferral) | non-blocker | **defer** — run the live lanes against a real Notion board + token; sign off then. Not routed to a `@bug`: no defect observed, the behaviour is built and offline-proven. | live-token verify run (deferred) | open (deferred) |

## Accept decision

**Held `in-review` — NOT accepted** (operator decision, `2026-06-26`). The automated + agent-runnable
lanes are green and the validate gate passes (below), but the four live-Notion `@manual` lanes (NTN-V1)
remain unverified for want of a real workspace/token. The milestone's own STATE scopes these as "signed
off at verify with a real token"; absent the token, acceptance is deferred rather than asserted on the
offline twins alone. Stories 00–03 stay `in-review`; SPEC status stays `in-progress`.

**To accept later:** run the four NTN-V1 lanes against a live Notion board with `NOTION_API_TOKEN`
exported, record their results + sign-off here, then re-run `aof:verify 17` to flip the stories →
`done` and the milestone → `done` (and run the retrospective + `aof work memory ingest` at that close).

## Gate

`aof work validate 17` → **PASS — 17 is well-formed** (folder↔frontmatter, closed-vocab tags, depends
graph). Test-traceability + litmus carried by the green `@executable` suite and the build-review QA pass.
