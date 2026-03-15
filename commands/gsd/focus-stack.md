---
name: gsd:focus-stack
description: Deliver a list of bounded focus-mode changes as managed stacked PRs
argument-hint: "[--base <branch>] [--resume <stack-id>] [--restack-only <stack-id>] [--full] [--discuss] [@file|pasted list]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - AskUserQuestion
---
<objective>
Deliver a list of small focus-mode slices as one managed stacked PR chain.

This flow is for multiple narrow changes that should each land as their own PR,
while sharing the same focus-mode execution contract:
- `spec -> implement -> self-review -> verify`
- one bounded slice per PR
- automatic restacking after lower-slice fixes
- explicit stop on conflicts or verification failures
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/focus-stack.md
</execution_context>

<context>
$ARGUMENTS

Context files are resolved inside the workflow (`init focus-stack`) and delegated via `<files_to_read>` blocks.
</context>

<process>
Execute the stacked focus workflow from @~/.claude/get-shit-done/workflows/focus-stack.md.
Preserve all workflow gates: stack validation, manifest creation, per-slice focus execution,
PR creation/update, restacking, state updates, and documentation updates.
</process>
