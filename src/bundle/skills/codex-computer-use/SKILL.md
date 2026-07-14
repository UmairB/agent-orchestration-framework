---
name: codex-computer-use
description: Ask Codex CLI (gpt-5.6) to run local app verification that needs computer use, browser automation, simulators, screenshots, app launching, or independent runtime inspection. This is how gpt-5.6 is invoked for computer-use work. Use when the user asks Claude to test a flow, verify UI behavior, inspect a running app, capture screenshots, or report confirmation and feedback about implemented behavior that benefits from computer use functionality.
---

# Codex Computer Use

> Optional accelerator. This skill only applies if you have the Codex CLI (gpt-5.6) installed and a gpt/Codex subscription. If Codex is not available, ignore this skill and verify the flow directly (or ask the user to) — nothing here is a hard dependency.

Use Codex as a separate local verification agent when the task needs real UI interaction, screenshots, simulator/browser/device state, or an independent runtime check outside Claude's current context.

This project's configured delegation model is `gpt-5.6-sol` (set via `aof work delegation-model <id>`) — target it explicitly with `-m gpt-5.6-sol` so the verification run uses the configured model.

**Be explicit about the model.** Before the run, state `Delegating verification to gpt-5.6-sol via Codex…`; in the final report, name `gpt-5.6-sol` again so it's always clear which model performed the verification.

Do not use this for ordinary code reading, typechecking, linting, or tests Claude can run directly. Launching apps, simulators, or browsers to verify the requested work is fine without asking; ask first only if the run could disrupt the user's environment beyond that (closing their apps, changing system settings, acting on real accounts or data).

## Workflow

1. Define the verification target: what to launch, how to reach the state under test, the exact behavior to check, and the pass/fail criteria.
2. Note the current runtime state (what's already running, which simulator/device/browser, which build) so Codex doesn't disrupt it.
3. Create a temporary artifact directory for Codex's report and any screenshots.
4. Run `codex exec` with the access the check requires. Computer use usually needs machine-level access (app launch, simulator/browser control, screenshots), so this skill defaults to `-s danger-full-access`.
5. After Codex exits, read its report and inspect the captured screenshots/artifacts.
6. Confirm the observed behavior against the pass/fail criteria; re-run with a tighter prompt if the result is inconclusive.
7. Report what Codex verified, what it observed (referencing screenshots), and anything blocked or uncertain.

Use this command shape:

```bash
ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-computer-use.XXXXXX")"
REPORT="$ARTIFACT_DIR/report.md"
PROMPT="$ARTIFACT_DIR/prompt.md"

# Write a self-contained prompt to $PROMPT, then run:
codex exec \
  -m gpt-5.6-sol \
  -C "$PWD" \
  --add-dir "$ARTIFACT_DIR" \
  -s danger-full-access \
  -o "$REPORT" \
  "$(cat "$PROMPT")"
```

Use `-s danger-full-access` for this skill because launching apps, driving simulators or browsers, taking screenshots, and touching package-manager or global state all need access beyond the repo sandbox. Drop to `-s workspace-write` only if the verification genuinely stays inside the repo (e.g. inspecting build output). Never widen access beyond what the check needs.

## Prompt Requirements

Tell Codex:

- What to launch and the exact command or steps to reach the state under test (build/run command, dev server URL, simulator or device target).
- The precise flow or behavior to verify, step by step.
- The explicit pass/fail (acceptance) criteria.
- What to capture and when: screenshots at named checkpoints, console output, network activity, device/simulator state.
- Where to write the report and screenshots (the artifact directory).
- What must not be touched: real accounts, production data, system settings, and other running apps or simulators.
- To report exactly what it observed versus what it inferred, and to stop and report if it cannot reach the state under test.

Keep the target bounded. If several flows need verifying, split them into separate runs or ask the user which flow to check first.

## Example Prompt

```text
You are verifying implemented behavior for Claude on a local machine.

Repository: /absolute/path/to/repo
Artifact directory: /tmp/codex-computer-use.xxxxxx

Setup:
- The Expo dev server is already running. Do not start a second one.
- Boot the iOS Simulator (iPhone 15) and open the app if it isn't already open.

Verify this flow:
- From the app's launch screen, complete the onboarding: tap "Get started",
  enter a display name, and tap "Continue".
- Confirm the app lands on the Home tab after onboarding.

Acceptance criteria:
- "Continue" is disabled until a display name is entered.
- After onboarding, the Home tab is selected and shows the greeting with the entered name.
- No red-box error or console crash appears during the flow.

Capture:
- Screenshot at the launch screen, at the filled onboarding form, and at the Home tab.
- Any console errors or warnings emitted during the flow.
- Save screenshots and a report.md to the artifact directory.

Constraints:
- Do not close other running apps or simulators.
- Do not change system settings or act on real accounts or data.

Report:
- Which criteria passed and which failed, with the screenshot filename for each.
- What you directly observed versus inferred.
- Anything blocked or uncertain.
```

## Reporting Back

Before relaying a result, look at the screenshots and report Codex produced and confirm they actually show the behavior claimed. In the user-facing response, separate what Codex directly observed from what it inferred, and reference the specific screenshots or artifacts.

Do not present a screenshot as proof of a behavior Codex did not actually exercise. If Codex could not reach the state under test, say so plainly and name what blocked it.

If `codex` is not installed or the command fails, report the error and offer to walk the user through verifying the flow manually instead.
