---
doc: security
---
<!--
  Milestone SECURITY.md — answers ONE question: what could an attacker do, and how do we stop them?
  Owner: security (a domain specialist the architect fans out at Decide). Conditional — present only
  when the work has a meaningful attack surface.
  Does NOT restate controls. A control lives ONCE — as a fitness function, an @executable scenario,
  or an ADR — and this file REFERENCES it. This is the threat model + the map from each threat to the
  control that defends it. It is NOT a fourth verification surface; it routes into the existing three.
-->
# NN · <Milestone Title> — Threat Model

## Assets & trust boundaries

<!-- What's worth attacking, and where trust changes hands. The boundaries, not a diagram essay. -->

- <asset / data of value>
- <trust boundary — e.g. unauthenticated edge → authenticated app>

## Threats & mitigations (STRIDE)

<!-- One row per threat. The "defended by" column REFERENCES where the control lives (scenario id /
     fitness-function path / ADR) — it does not describe the implementation. Status tracks the
     control, not this prose. -->

| # | Threat (STRIDE) | Attack | Defended by | Surface | Status |
|---|---|---|---|---|---|
| T1 | Spoofing | <forged session token> | `auth-session.feature:valid-token` | @executable | green |
| T2 | Tampering | <mass-assignment> | fitness fn `test/arch/no-mass-assign.test.ts` | fitness | green |
| T3 | Info disclosure | <secret in logs> | fitness fn `test/arch/no-secret-in-logs.test.ts` | fitness | green |
| T4 | Elevation of privilege | <missing authz on admin route> | ADR-007 + `authz.feature:admin-only` | @executable | wip |

## Residual risk

<!-- Threats consciously NOT fully mitigated, and why. The honest list. Each links to a @manual/UAT
     item (a pen-test, a manual review) where a human confirms it. -->

- <residual risk> — <why accepted> — UAT: <ref, or "none yet">
