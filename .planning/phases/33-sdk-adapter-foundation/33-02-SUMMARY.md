# Summary 33-02: Error Wrapping And Dispatch Logging

## Completed

- Normalized SDK/tool failures into `GsdSdkError` with stable error codes and user-safe messages.
- Added best-effort append logging to `.aof/cache/boards/dispatch.log.jsonl`.
- Ensured dispatch log failures warn without failing the adapter call.

## Verification

- Adapter unit test covers failure wrapping and failed dispatch logging.
- `node scripts/test-unit.mjs`
- `node scripts/test.mjs`

