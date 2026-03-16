---
name: gsd:supervisor
description: Run the Codex supervisor against a generated quick/focus bundle
argument-hint: "--bundle <path> --stage pre|post [--status <path>] [--findings <path>] [--report <path>]"
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
- stage-specific findings, report, and status files
- compatibility copies at `SUPERVISOR-FINDINGS.json` and `SUPERVISOR-REPORT.md`
</objective>

<context>
Parse `$ARGUMENTS` for:
- `--bundle <path>` — required, path to `SUPERVISOR-PRE.json` or `SUPERVISOR-POST.json`
- `--stage pre|post` — required
- `--status <path>` — optional explicit status output path
- `--findings <path>` — optional explicit findings output path
- `--report <path>` — optional explicit report output path

If either is missing, stop with a clear usage error.
</context>

<process>
1. Verify the bundle file exists.
2. Derive `QUICK_DIR=$(dirname "$BUNDLE_PATH")`.
3. Resolve output paths:
   - default findings: `${QUICK_DIR}/SUPERVISOR-${STAGE^^}-FINDINGS.json`
   - default report: `${QUICK_DIR}/SUPERVISOR-${STAGE^^}-REPORT.md`
   - default status: `${QUICK_DIR}/SUPERVISOR-${STAGE^^}-STATUS.json`
4. Immediately write a JSON status payload with:
   - `stage`
   - `state: "running"`
   - bundle/findings/report paths
   - `started_at`
5. Spawn `gsd-supervisor` with:
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
6. Write the normalized JSON object to the resolved findings path.
7. Write the resolved report path with:
   - title line
   - stage
   - overall status
   - one section per finding with severity, category, evidence, and recommended action
8. Copy the resolved findings/report to `${QUICK_DIR}/SUPERVISOR-FINDINGS.json` and `${QUICK_DIR}/SUPERVISOR-REPORT.md`.
9. Write a terminal status payload with:
   - `state` set to `passed`, `warnings`, or `blocked`
   - `completed_at`
   - `error: null`
10. Return:

```text
## SUPERVISION COMPLETE
Stage: {pre|post}
Status: {passed|warnings|blocked}
Findings: {count}
Findings file: {path}
Report file: {path}
```

If the supervisor returns no findings, write an empty `findings: []` payload with `status: passed`.
If bundle parsing or analysis fails, still write a terminal status file with `state: failed` and include the error text.
</process>
