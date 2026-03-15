---
name: gsd:focus
description: Execute a narrow feature or fix through GSD's focus-mode fast path
argument-hint: "[--full] [--discuss] [task description]"
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
Execute a narrow feature, bug fix, or refactor through GSD's focus-mode fast path.

Focus mode keeps the quick-task substrate but adds a stronger default contract:
- `spec -> implement -> self-review -> verify`
- bounded scope and minimal diffs
- risk-based escalation only when the task is risky, unknown-domain, or too large

Use this when you want the recommended small-feature workflow.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/quick.md
</execution_context>

<context>
--mode focus $ARGUMENTS

Context files are resolved inside the workflow (`init quick`) and delegated via `<files_to_read>` blocks.
</context>

<process>
Execute the shared quick workflow from @~/.claude/get-shit-done/workflows/quick.md in `focus` mode.
Preserve all workflow gates (validation, task description, planning, execution, state updates, commits).
</process>
