---
name: gsd:import-plan
description: Convert an agent-written plan into GSD roadmap phases and import notes
argument-hint: "[--milestone <name>] [@file|pasted plan]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Task
---

<objective>
Convert an external agent-written markdown plan into GSD planning artifacts that can flow into `/gsd:discuss-phase` and `/gsd:plan-phase`.

Default behavior:
- Fresh repo: bootstrap `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`
- Existing GSD project: append the imported plan as the next milestone and continue phase numbering
- Preserve phase detail in dedicated `IMPORT.md` files instead of treating it as confirmed user context
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/import-plan.md
</execution_context>

<context>
$ARGUMENTS

Inputs:
- Optional `--milestone <name>` override for milestone naming
- Either a single `@file.md` reference or pasted markdown plan text

Context files and import paths are resolved in-workflow via `init import-plan`.
</context>

<process>
Execute the import-plan workflow from @~/.claude/get-shit-done/workflows/import-plan.md end-to-end.
Preserve all validation gates: input validation, active-work confirmation, raw source preservation, importer delegation, artifact checks, and next-step routing.
</process>
