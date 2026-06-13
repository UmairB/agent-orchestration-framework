# Milestone Templates

Copy-paste skeletons for an ACD milestone. Start a milestone by copying this folder to
`<milestones-root>/NNN-name/` and deleting the documents you don't need
([conditional activation](../agents.md#conditional-activation--the-anti-ceremony-guardrail) — only
the **spine** is mandatory).

```
NNN-name/
  SPEC.md              ← spine        why + scope
  STATE.md             ← spine        progress + history
  tasks/*.feature      ← spine        observable outcomes (the contract)
  RESEARCH.md          ← conditional  what we learned          (only if there was an unknown)
  ARCHITECTURE.md      ← conditional  ADRs + invariants        (only if a decision was made)
  DESIGN.md            ← conditional  UI/UX intent             (only if there is UI)
  UAT.md               ← conditional  human/live verification  (only if CI can't prove it)
```

Each template carries inline guidance in HTML comments (`<!-- ... -->`) and Gherkin comments
(`# ...`). Delete the guidance as you fill the document in. The rules each template enforces are in:

- [documents.md](../documents.md) — what each document owns
- [acceptance-criteria.md](../acceptance-criteria.md) — the feature-file rules
- [workflow.md](../workflow.md) — the order to produce them in
