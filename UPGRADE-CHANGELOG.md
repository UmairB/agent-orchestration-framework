<!-- aof-generated: true -->

# Upgrade changelog

This changelog is generated from `WORK_ITEM_MIGRATIONS` (`src/work-upgrade.mjs`) — a pure
projection of the migration registry, never hand-authored (ADR-006, milestone 40). It
describes each registered transform; the act of upgrading a work stream to the current
schema is always the command:

```
aof upgrade
```

(`aof upgrade --dry-run` previews the pending transforms without writing; add `--json` for
a machine-readable plan.) Regenerating this file from the registry reproduces it
byte-for-byte — a hand edit cannot survive the drift guard.

## Transforms

### `stamp-0-to-1` — schema 0 -> 1

Backstamp an unstamped (schema-0) item to schema 1, writing an aofVersion provenance string. This is the transform that backstamps the aof repository's own pre-versioning stream (items 00-39) — those items ARE the current shape, so stamping them schema 1 is a true version record, never a reconstruction (ADR-003 / ADR-008).
