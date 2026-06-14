# Acceptance-Criteria Development (ACD)

> A declarative, outcome-first methodology for delivering software with LLM agents.
> Executable acceptance criteria are the contract; a flat, chronological stream of
> work items is the record.

Also called **acceptance-criteria prompting** when the emphasis is on the agent loop:
you hand an agent the goal, the context, and the outcomes — and let it plan the steps.

## The one-paragraph pitch

You should be able to see *what work has been delivered, and when*, by scanning a single
ordered list — and to see *what each piece will deliver* by reading its **Gherkin acceptance
criteria**. ACD organises work as a flat, sequential **stream** of items — `milestone`,
`story`, `task` — each a numbered folder. A **task** is the atomic unit: a `.feature` file
whose scenarios are its acceptance criteria. A **story** groups tasks toward one user-facing
outcome. A **milestone** groups stories and holds their shared context. Every other concern
(why, how-decided, how-it-looks, what-we-learned, where-we-are, how-a-human-confirms-it) lives
in its own single-purpose document, stated **once**. Specialist agents each own one document and
hand off through the files. The whole thing rests on one enforced link: every `@executable`
scenario maps to a green test.

## The three ideas

1. **Declarative outcomes.** Acceptance criteria (Gherkin, at the **task** level) state what's
   observably true when done — not how to build it. → [acceptance-criteria.md](acceptance-criteria.md)
2. **One question per document.** Each artifact answers exactly one question. → [documents.md](documents.md)
3. **Specialist agents, document handoffs.** Six roles, each owning one artifact. → [agents.md](agents.md)

## The work stream

Work lives in one flat directory (`wiki/work/` by convention), as a **chronological stream** of
numbered items. The number is the timeline; the folder name carries the type, so an `ls` *is* the
delivery log:

```
work/
  00_milestone_console-shell/        groups the stories below
  01_story_shell-layout/             parent: 00   STORY.md + tasks/*.feature
  02_story_theming/                  parent: 00
  03_milestone_platform-foundation/
  04_story_database-package/         parent: 03
  ...
  47_task_snapshot-perf-fix/         adhoc — no parent, just a .feature
```

- **Folder name** = `NN_type_slug` — underscores between segments, dashes within the slug.
- **Number** = creation order = the timeline. Scan the last *N* to catch up on recent delivery.
- **Grouping is by reference** (`parent:` in frontmatter), not by physical nesting — that's what
  keeps the stream flat and chronological.
- Create at **any level**: a planned `milestone`, a standalone `story` (a group of adhoc work),
  or a lone `task` (an adhoc fix). Depth scales with planning; adhoc stays flat.

See [documents.md](documents.md) for the hierarchy, folder convention, and frontmatter.

## Navigate

| Doc | The question it answers |
|---|---|
| [philosophy.md](philosophy.md) | *Why* does ACD exist and what does it believe? |
| [documents.md](documents.md) | *What documents and items* make up the work stream? |
| [acceptance-criteria.md](acceptance-criteria.md) | *What goes in a task's feature file* and how is it verified? |
| [agents.md](agents.md) | *Who owns what* and how do the agents collaborate? |
| [workflow.md](workflow.md) | *What is the sequence* from idea to accepted delivery? |
| [glossary.md](glossary.md) | What do the *terms* mean? |
| [templates/](templates/) | Copy-paste item skeletons. |

## The hierarchy in one line

**Milestone** (groups stories, holds shared docs) **> Story** (groups tasks, owns the user story)
**> Task** (the atomic unit; its `.feature` is the acceptance criteria). Stories are the unit of
**parallelism** — independent stories run concurrently, one per agent.

## Status

This wiki is the canonical reference for ACD. The agent definitions, slash commands, and CLI that
operationalise it are derived directly from [agents.md](agents.md) and [workflow.md](workflow.md).
