---
doc: architecture
---
# Spike Fixture · Architecture

A minimal ARCHITECTURE with one ADR block, shaped like the real work-stream ADRs.

## ADR-001 · Memory is a derived index, never an authoritative store

- **Status:** accepted
- **Decision:** The work-memory backend reconstructs every record from the `.md`
  source on each reindex. It holds no fact that is absent from its source files,
  and every record carries a `source: path:line` back-reference that must resolve
  to live text.
- **Invariant:** A fresh reindex over the same corpus yields byte-identical
  records; deleting the index and rebuilding loses nothing. Memory is cache, not
  truth.
- **Consequence:** A graphify-backed memory cannot let records originate from the
  LLM extraction — records must come from the local markdown parse so the
  `source:line` guarantee survives.
