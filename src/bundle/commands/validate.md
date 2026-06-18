---
description: Validate the work stream — runs `aof work validate` (folder↔frontmatter, closed tag vocabulary, depends graph) then layers the agent-only checks (test-traceability, litmus).
argument-hint: [item ref — omit for the whole stream]
allowed-tools: [Read, Grep, Glob, Bash]
---
<objective>
The ACD lint keystone: prove the stream is well-formed and the contract is enforced. Read-only.
</objective>

<config>
Scope from "$ARGUMENTS" (one item ref, or omit for the whole stream). The deterministic structural
checks are owned by the `aof` CLI; this command runs it, then adds the language-aware layer the CLI
can't do yet.
</config>

<process>
1. **Structural keystone — the CLI.** Run `aof work validate $ARGUMENTS` (omit the arg for the whole
   stream). It checks deterministically and exits non-zero on any finding: **folder ↔ frontmatter**
   (the name `^(\d+)_(milestone|story|task|uat)_([a-z0-9-]+)$` equals `type`/`number`/`slug`; valid
   `status`; `created`/`updated` present; `parent` resolves), the **closed tag vocabulary** (universal
   ∪ `work.tags`; exactly one `@executable`/`@manual`/`@uat` per scenario; no `@milestone-NN`), and
   the **`depends` graph** (every edge resolves; acyclic). Report its findings verbatim; do NOT
   re-derive these by hand.
2. **Traceability — agent layer (not yet in the CLI).** For each in-scope item: every `@executable`
   scenario (and every row of an `@executable` Scenario Outline) maps to a passing test; every
   `@manual` scenario maps to an evidence row and every `@uat` to a sign-off row in some
   `VERIFICATION.md` (or a `uat` session's `SESSION.md`); every `@finding-<id>` resolves to a real
   finding; every `verifies →` resolves to a real scenario.
3. **UAT-gate integrity (not in the CLI — needs to read `## Findings`).** For each in-scope `uat`
   session: a gate marked **`status: done`** must have **every** finding `verified`/`closed` (none left
   `open`/`accepted`/`fixed`) and a recorded **## Sign-off / verdict** — flag a `done` gate with
   unresolved findings (a lying gate). Conversely, every finding's `amend in` must resolve to a real
   item, and each amendment scenario closing it (`@finding-<id>` lineage) should exist — flag findings
   with no scenario routed to them. (Advisory: a milestone that `depends:` on the gate stays blocked
   until the gate is `done`, so an unclosed gate holds up everything behind it.)
4. **Litmus (advisory).** Flag `Then` steps that read like design/implementation assertions.
</process>

<output>
**PASS** only when the CLI exits 0 **and** the traceability layer is clean; otherwise the combined
findings (CLI + agent), grouped by check. Modify nothing.
</output>
