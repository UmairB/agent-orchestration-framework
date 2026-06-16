# Planning

> **The question this document answers:** *Where does a milestone come from — how does a product idea
> become the milestones the work stream delivers?*

[workflow.md](workflow.md) describes the sequence from a framed milestone to accepted delivery — it
starts at the milestone `SPEC.md`. This document covers the altitude *above* that: **planning**, the
pre-milestone work that decides *what milestones to build and why*, often spanning several at once.
ACD deliberately owns very little here — it owns the **seam**, not the planning method.

## Two surfaces: `/planning` and `/work`

ACD separates the *product* altitude from the *delivery* altitude into two surfaces, with one
contract between them:

| Surface | Altitude | Owns | Produces |
|---|---|---|---|
| **`/planning`** | product — discovery, strategy, prioritisation; may span many milestones | nothing methodological — it's where bought tools run | a **PRD** |
| **`/work`** | delivery — one milestone at a time | the ACD methodology (the [work stream](documents.md) + the [contract](acceptance-criteria.md)) | milestones, stories, tasks |

`/planning` is where the mature plugin ecosystem lives ([planning is bought](#planning-is-bought-delivery-is-owned)).
`/work` is the methodology this wiki describes. The PRD is the only thing that crosses between them.

## The PRD is the seam

Planning produces a **PRD** (product requirements document): the product framing for an initiative
that may break into several milestones. The PRD is the **boundary artifact** — the one document that
hands off from planning to delivery. Two properties make the seam clean:

- **It lives upstream of the work stream, not inside it.** `work/` holds only milestones, stories,
  and tasks ([documents.md](documents.md)); the PRD sits *before* the first milestone. The work
  stream stays milestone-topped and flat — planning adds no new tier to it.
- **It sits outside the methodology boundary.** ACD does **not** define the PRD's format — the
  planning tool does. A PRD can be as opinionated as the plugin that wrote it; its shape is not
  ACD's concern, because nothing downstream depends on its internals — only on what the seam
  requires.

### What the seam requires

ACD owns the *contract* of the seam, not the document. For the product-owner to frame milestones from
any PRD, it must be able to read out:

- the **objective(s)** of the initiative — the *why*;
- the **scope** — what's in, what's out;
- enough structure to identify **milestone-sized chunks** of delivery.

A PRD carrying those can be shattered into milestones; its other sections are the planning tool's
business, ignored by delivery.

## The product-owner is the adapter

The handoff is an agent action, not a copy-paste. The **product-owner** ([agents.md](agents.md)) reads
the PRD and **shatters it into milestones**: one PRD → N milestone `SPEC.md`s, each a framed delivery
container, each **linking back** to the PRD as its origin (reference, never restate —
[philosophy.md → principle 4](philosophy.md)). This is a natural extension of the PO's Frame role: the
PRD is simply where Frame gets its input when the work was *planned* rather than adhoc.

## One-directional flow — the guardrail

The single rule that keeps planning from reintroducing drift:

> **PRD → SPECs, never back.**

Once the PO derives the milestone SPECs, **the SPECs are the delivery source of truth.** The PRD
becomes a historical, upstream artifact — referenced for origin, *not* maintained in lockstep with the
SPECs. The moment you are editing both to keep them agreeing, you have recreated the drift ACD exists
to defend against ([philosophy.md → principle 4](philosophy.md)). The seam is crossed once, in one
direction.

## Planning is bought, delivery is owned

Planning is exactly where the build-vs-buy balance tips to **buy**. The product ecosystem (discovery,
strategy, market research, prioritisation) is mature and community-maintained; recreating it would be
wasted effort. So:

- **Own the methodology** — the work stream, the contract, and the seam's input contract. Small, and
  the moat.
- **Buy the planning implementation** — let plugins run the discovery→strategy→PRD work.

This is *why* the boundary matters: a planning plugin can encode any method it likes, because the PO
adapts its one output — the PRD — into ACD's model. Nothing else of the plugin crosses the seam, so
its opinions never leak into the delivery methodology.

## Conditional — planning only when the work spans milestones

Planning obeys the same conditional ceremony as everything else ([philosophy.md → principle 5](philosophy.md)).
The **item you start sets whether planning runs at all**:

- An **adhoc task** or **standalone story** — no planning; write the `.feature` / `STORY.md` directly.
- A **single milestone** — frame it directly with a `SPEC.md`; no PRD needed.
- An **initiative spanning several milestones** — *this* is when `/planning` earns its place: a PRD
  frames the set, and the PO shatters it.

No multi-milestone initiative, no PRD. Absence of a PRD is information: this work didn't need product
planning.

## Next

- The sequence once a milestone is framed → [workflow.md](workflow.md)
- The work-stream items the PO creates from a PRD → [documents.md](documents.md)
- Who does the shattering → [agents.md](agents.md)
- Why one-directional flow matters → [philosophy.md](philosophy.md)
