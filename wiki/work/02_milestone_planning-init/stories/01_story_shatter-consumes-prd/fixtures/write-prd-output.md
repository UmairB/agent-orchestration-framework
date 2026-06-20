# Acme Notify — Product Requirements

> A `/write-prd`-command-shaped PRD that breaks the skill convention: it is a real, well-formed PRD
> but its filename carries **no `PRD-` prefix** (RESEARCH §7 — the `/write-prd` command "saves the PRD
> as a markdown file to the user's workspace" without stating the `PRD-[name].md` filename). It exists
> so the discovery scenarios can assert the explicit-path escape hatch: passed by path, this PRD is
> used even though `PRD-*.md` would never auto-find it.

## Objective

Give product teams one reliable way to send and track transactional notifications.

## Scope

In: a send API, delivery tracking, per-tenant rate limiting.
Out: marketing/bulk sending, push channels, a template-authoring UI.

## Milestones

1. Channel send core.
2. Delivery tracking.
3. Tenant rate limiting.
