# PRD: Acme Notify

> A representative pm-skills `create-prd`-shaped PRD fixture. Filename follows the skill convention
> `PRD-[product-name].md` (RESEARCH §7) and sits at the workspace root of the fixture tree. It exists
> only as the **Given** of the story-01 scenarios — it is never installed, never run, and is not a
> real product. Edit it only to change what the discovery / seam-readout scenarios assert.

## 1. Overview

Acme Notify is a transactional notification service that lets product teams send templated email and
SMS messages from a single API, with delivery tracking and per-tenant rate limits.

## 2. Problem & Objective

**Objective.** Give product teams one reliable way to send and track transactional notifications, so
they stop hand-rolling per-channel integrations and can prove a message was delivered.

Teams today wire each provider (email, SMS) separately, with no shared delivery record and no common
template store, which makes auditing a "did the user get it?" question slow and unreliable.

## 3. Scope

**In scope**
- A send API that accepts a template id + recipient + variables and dispatches over the right channel.
- A delivery-tracking record per message (queued → sent → delivered/failed) queryable by id.
- Per-tenant rate limiting so one tenant cannot exhaust shared provider quota.

**Out of scope**
- Marketing / bulk-campaign sending (this is transactional only).
- In-app / push channels (email + SMS only for the first cut).
- A template-authoring UI (templates are supplied via the API initially).

## 4. Milestones

The initiative breaks into independently-deliverable milestones:

1. **Channel send core** — the send API, channel routing (email + SMS), and provider adapters.
2. **Delivery tracking** — the per-message delivery record and the status-query endpoint.
3. **Tenant rate limiting** — per-tenant quotas and back-pressure on the send path.

## 5. Success Metrics

- 99.5% of accepted messages reach a terminal delivery state within 5 minutes.
- A delivery record is queryable by id for 100% of accepted messages.

## 6. Risks & Open Questions

- Provider quota ceilings may force earlier rate-limiting than milestone 3 assumes.
- SMS sender-id regulations vary by region — may narrow the initial SMS launch geographies.
