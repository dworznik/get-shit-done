---
name: gsd:review-feedback
description: Collect and triage bot review feedback from GitHub PRs
argument-hint: "[phase|stack-id] [--pr <number>] [--bots <names>] [--timeout <seconds>]"
agent: gsd-feedback-collector
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Task
---

$gsd-review-feedback $ARGUMENTS
