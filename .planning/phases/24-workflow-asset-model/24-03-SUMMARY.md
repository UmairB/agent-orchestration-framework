# Phase 24 Wave 3 Summary: Workflow API Compatibility, BDD, And Docs

## Status

Completed on 2026-05-14.

## Delivered

- Exposed `workflows` through editable config load payloads.
- Preserved workflows when saving editable sections or regular resources.
- Allowed workflow global references through the existing global-ref API path.
- Added Node BDD coverage for workflow-backed Claude command and Codex skill wrappers sharing one workflow.
- Added Node BDD coverage for missing workflow references and invalid argument overrides.
- Mirrored workflow BDD fixture support in the PowerShell runner.
- Updated README with the shipped Phase 24 workflow model, generated paths, wrapper binding, and placeholder deferral.

## Deferred

- Full setup UI Simple vs Workflow-backed authoring controls remain Phase 26.
- `{{skills.*}}` and `{{workflows.*}}` runtime path placeholders remain Phase 25.

## Verification

- `npm run test:unit`
- `npm test`
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/cli.ps1`

