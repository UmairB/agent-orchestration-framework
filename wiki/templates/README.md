# Item Templates

Copy-paste skeletons for the ACD work-item types. Every item is a folder named
`NN_type_slug` in the flat work stream (see [documents.md](../documents.md)).

```
task/                 ← a task: the atomic unit (a .feature = acceptance criteria)
  example.feature
story/                ← a story: a user-facing group of tasks
  STORY.md
milestone/            ← a milestone: a group of stories + shared context
  SPEC.md             spine (the record doc)
  STATE.md            spine (the running log)
  ARCHITECTURE.md     conditional (ADRs + fitness functions)
  DESIGN.md           conditional (UI/UX)
  RESEARCH.md         conditional (findings)
  UAT.md              conditional (human/live verification)
  SECURITY.md         conditional (threat model + technical controls)
  COMPLIANCE.md       conditional (GDPR / ISO 27001 obligation→evidence map)
uat/                  ← a uat session: a cross-milestone acceptance gate (groups no stories)
  SESSION.md          spine (the record doc — scope, plan, checks, findings, verdict)
  STATE.md            spine (the running log + feedback inbox)
```

## How to start an item

- **Adhoc task** → a `NN_task_<slug>/` folder containing one `<slug>.feature` (from `task/`). No
  story, no SPEC. The lightest unit.
- **Standalone story** → a `NN_story_<slug>/` folder with `STORY.md` (omit `parent`) + `tasks/`.
- **Story under a milestone** → same, with `parent: <milestone-number>`.
- **Milestone** → a `NN_milestone_<slug>/` folder with `SPEC.md` + `STATE.md`; add the conditional
  docs as the work needs them (produced by `refine`). Its stories are *separate* numbered items
  pointing back via `parent`.
- **UAT session** → a `NN_uat_<slug>/` folder with `SESSION.md` + `STATE.md` (from `uat/`). It
  `depends:` on the milestones it accepts, groups no stories, and gates downstream work. Created by
  `aof:add-uat`; run/accepted by `aof:verify`.

## The rules each template encodes

- The **record doc** (`SPEC.md` / `STORY.md`) carries the full frontmatter (`type`/`number`/`slug`/
  `title`/`parent`/`status`/dates); supporting docs carry only `doc: <kind>`; tasks carry none
  (folder name + tags). Validator keeps folder name ↔ frontmatter in sync.
- The **user story** lives on `STORY.md`, never on a task.
- **Acceptance criteria** live on task `.feature` files. See [acceptance-criteria.md](../acceptance-criteria.md).
- Conditional docs appear only when they have content — absence is information.
