<!-- aof-generated: bundle -->

---
doc: compliance
---
<!--
  Milestone COMPLIANCE.md — answers ONE question: which obligations (GDPR, ISO 27001, …) bind this
  work, and where is each one evidenced?
  Owner: compliance (a domain specialist the architect fans out at Decide). Conditional — present
  only when the work touches regulated or personal data.
  Does NOT restate controls. It MAPS each obligation to the evidence that satisfies it — a SECURITY.md
  control, a fitness function, an ADR, or a @manual/UAT procedure. Where a security control IS the
  evidence, reference it; never copy it. Obligation in → evidence out.
-->
# NN · <Milestone Title> — Compliance Map

## Scope

<!-- What personal/regulated data this milestone introduces or touches, and which frameworks apply.
     If none apply, this file should not exist. -->

- Data: <e.g. account email, IP address>
- Frameworks in scope: <GDPR | ISO 27001 | …>

## GDPR obligations

| Article | Obligation | Evidenced by | Surface | Status |
|---|---|---|---|---|
| Art. 32 | Security of processing (encryption) | `SECURITY.md` T-enc / fitness fn `test/arch/pii-encrypted.test.ts` | fitness | green |
| Art. 17 | Right to erasure | `account-delete.feature:purges-pii` | @executable | green |
| Art. 30 | Records of processing | ADR-012 (data inventory) | ADR | n/a |
| Art. 35 | DPIA (where high-risk) | UAT: DPIA-01 sign-off | @manual | pending |

## ISO 27001 controls (Annex A)

<!-- Rows that re-use a control already mapped above POINT at it — never restate the control. -->

| Control | Requirement | Evidenced by | Surface | Status |
|---|---|---|---|---|
| A.8.24 | Use of cryptography | → GDPR Art. 32 (same control) | fitness | green |
| A.5.18 | Access rights | `authz.feature:least-privilege` | @executable | green |
| A.8.15 | Logging | fitness fn `test/arch/audit-log-on-data-access.test.ts` | fitness | green |

## Open items

<!-- Obligations not yet evidenced. Each is a @manual/UAT procedure or an ADR still to write. -->

- <obligation> — <owner / next step> — UAT: <ref, or "none yet">
