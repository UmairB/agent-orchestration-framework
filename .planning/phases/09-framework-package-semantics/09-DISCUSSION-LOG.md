# Phase 9: Framework Package Semantics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 9-Framework Package Semantics
**Areas discussed:** Package Descriptor Shape, Namespace Enforcement, Dependency And Lock Semantics, Conflict Policy

---

## Package Descriptor Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Both forms | Accept current string `source` values and structured descriptors, then normalize internally. | yes |
| Structured only | Cleaner long-term schema but forces migration for current configs. | |
| Strings only | Smallest change, but git/local/dependency metadata stays harder to validate. | |

**User's choice:** Accepted recommended default.
**Notes:** Preserve current config compatibility while adding a descriptor shape that can represent npm, git, and local file sources.

---

## Namespace Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit required | Every package declares `namespace`, making ownership and emitted paths predictable. | yes |
| Derived default | Namespace can default from package id, reducing config noise but hiding ownership choices. | |
| Path prefix only | Avoids a separate namespace field, but makes ownership metadata weaker. | |

**User's choice:** Accepted recommended default.
**Notes:** Namespace should be explicit and applied before write planning so conflict checks operate on final generated paths.

---

## Dependency And Lock Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Direct resolved metadata | Record each package source, resolved version/ref/path, namespace, and direct dependencies. | yes |
| Intent only | Fastest implementation but does not fully satisfy resolved-version expectations. | |
| Full graph | Most complete, but expands scope into package-manager-level resolution. | |

**User's choice:** Accepted recommended default.
**Notes:** Direct resolved package metadata is in scope. Full transitive dependency graph resolution is deferred.

---

## Conflict Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Fail before writes with safe merge exceptions | Duplicate output claims fail before side effects, except known safe merges like current Codex `AGENTS.md` rule merging. | yes |
| Local primitives win | Local config silently overrides package output claims. | |
| Explicit priority/override rules | Users can configure package precedence for conflicting claims. | |

**User's choice:** Accepted recommended default.
**Notes:** Diagnostics must identify the packages or local primitives involved. No implicit package priority or override behavior in Phase 9.

---

## the agent's Discretion

- Exact schema field names and implementation module boundaries can be chosen during planning, provided current compatibility and the captured decisions are preserved.

## Deferred Ideas

- None.
