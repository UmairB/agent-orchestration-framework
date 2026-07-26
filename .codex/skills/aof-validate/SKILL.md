---
name: aof-validate
description: Validate the work stream — runs `aof work validate` (folder↔frontmatter, closed tag vocabulary, depends graph) then layers the agent-only checks (test-traceability, litmus).
---

<!-- aof-generated: true; aof-runtime: codex -->

Use this skill when the user asks for `$aof-validate [item ref - omit for the whole stream]`, or asks to run the AOF `aof:validate` procedure in Codex.

Where this procedure mentions `$ARGUMENTS`, use the text the user supplied after the skill name.
Where it mentions Claude slash command `/aof:validate`, treat that as this Codex skill invocation.

<objective>
The ACD lint keystone: prove the stream is well-formed and the contract is enforced. Read-only.
</objective>

<config>
Scope from "$ARGUMENTS" (one item ref, or omit for the whole stream). The deterministic structural
checks are owned by the `aof` CLI; this command runs it, then adds the language-aware layer the CLI
can't do yet.
</config>

<process>
1. **Structural keystone — the CLI (the validity lane).** Run `aof work validate $ARGUMENTS` (omit the
   arg for the whole stream). This is **the structural keystone (aof work validate)** — the hard gate.
   It checks deterministically and exits non-zero on any finding: **folder ↔ frontmatter**
   (the name `^(\d+)_(milestone|story|task|uat)_([a-z0-9-]+)$` equals `type`/`number`/`slug`; valid
   `status`; `created`/`updated` present; `parent` resolves), the **closed tag vocabulary** (universal
   ∪ `work.tags`; exactly one `@executable`/`@manual`/`@uat` per scenario; no `@milestone-NN`), and
   the **`depends` graph** (every edge resolves; acyclic). Report its findings verbatim under the
   **validity lane** (sourced from `aof work validate`); do NOT re-derive these by hand.
2. **Health floor — the CLI (the health lane).** Run `aof work doctor $ARGUMENTS` (the SAME scope as
   step 1 — omit the arg for the whole stream). This is the deterministic *health* lane the validity
   lane cannot see: cross-item coherence, lifecycle completeness, freshness, and structural integrity
   (e.g. a `done` parent over an `in-progress` child, a stale `updated`, an orphan folder). Report its
   findings **verbatim** under the **health lane** (sourced from `aof work doctor`); do NOT re-derive
   them by hand. **Doctor is advisory (ADR-002):** by default a `warn`-only `aof work doctor` result
   exits 0 and **does not fail the skill** — only an `error`-severity finding (or `--strict`, a
   deliberate opt-in) gates. Doctor is **added beneath, never replacing, validate**: it is an
   ADDITIONAL deterministic floor, not a substitute for the structural keystone or the agent-only
   layer below.
3. **Traceability — agent layer (not yet in the CLI).** For each in-scope item: every `@executable`
   scenario (and every row of an `@executable` Scenario Outline) maps to a passing test; every
   `@manual` scenario maps to an evidence row and every `@uat` to a sign-off row in some
   `VERIFICATION.md` (or a `uat` session's `SESSION.md`); every `@finding-<id>` resolves to a real
   finding; every `verifies →` resolves to a real scenario.
4. **UAT-gate integrity (not in the CLI — needs to read `## Findings`).** For each in-scope `uat`
   session: a gate marked **`status: done`** must have **every** finding `verified`/`closed` (none left
   `open`/`accepted`/`fixed`) and a recorded **## Sign-off / verdict** — flag a `done` gate with
   unresolved findings (a lying gate). Conversely, every finding's `amend in` must resolve to a real
   item, and each amendment scenario closing it (`@finding-<id>` lineage) should exist — flag findings
   with no scenario routed to them. (Advisory: a milestone that `depends:` on the gate stays blocked
   until the gate is `done`, so an unclosed gate holds up everything behind it.)
5. **Litmus (advisory).** Flag `Then` steps that read like design/implementation assertions.
</process>

<output>
Report the combined findings **grouped by lane**, in this layered order:

1. **Validity lane** — the findings from `aof work validate` (the structural keystone). This is the
   hard gate.
2. **Agent-only layer** — the traceability, UAT-gate integrity, and litmus findings the agent derives
   above (the language-aware checks the CLI can't do yet).
3. **Health lane** — the findings from `aof work doctor`, reported **beneath the agent-only layer**
   (traceability / UAT-gate integrity / litmus). This is the deterministic advisory floor.

**PASS** requires `aof work validate` to **exit 0** (the hard keystone) **and** the traceability /
agent-only layer to be clean. A **`warn`-only `aof work doctor` result does NOT fail the skill** —
doctor is advisory, so its exit is not a precondition of PASS (only an `error`-severity health
finding, or an explicit `--strict`, would gate). The health lane is **added beneath, never replacing,
validate** — never substituted for the keystone or the agent-only layer. Modify nothing.
</output>
