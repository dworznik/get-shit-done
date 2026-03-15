---
name: gsd:supervisor
description: Run the Codex supervisor against a generated quick/focus bundle
argument-hint: "--bundle <path> --stage pre|post"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Task
---
<objective>
Run the Codex supervisor as a separate artifact-driven analysis pass for quick/focus tasks.

This command is Codex-only. It does not execute Claude Code inside Codex.
It reads a generated supervisor bundle, spawns the read-only `gsd-supervisor` agent,
then writes:
- `SUPERVISOR-FINDINGS.json`
- `SUPERVISOR-REPORT.md`
</objective>

<context>
Parse `$ARGUMENTS` for:
- `--bundle <path>` — required, path to `SUPERVISOR-PRE.json` or `SUPERVISOR-POST.json`
- `--stage pre|post` — required

If either is missing, stop with a clear usage error.
</context>

<process>
1. Verify the bundle file exists.
2. Derive `QUICK_DIR=$(dirname "$BUNDLE_PATH")`.
3. Spawn `gsd-supervisor` with:
   - the bundle path in `<files_to_read>`
   - instruction to return one JSON object in a fenced `json` block
   - schema:
     - `stage`
     - `status` (`passed` | `warnings` | `blocked`)
     - `findings[]`
       - `severity`
       - `category`
       - `title`
       - `evidence`
       - `recommended_action`
4. Write the normalized JSON object to `${QUICK_DIR}/SUPERVISOR-FINDINGS.json`.
5. Write `${QUICK_DIR}/SUPERVISOR-REPORT.md` with:
   - title line
   - stage
   - overall status
   - one section per finding with severity, category, evidence, and recommended action
6. Return:

```text
## SUPERVISION COMPLETE
Stage: {pre|post}
Status: {passed|warnings|blocked}
Findings: {count}
Findings file: {path}
Report file: {path}
```

If the supervisor returns no findings, write an empty `findings: []` payload with `status: passed`.
</process>
