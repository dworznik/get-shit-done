---
name: gsd:supervisor
description: Run the Codex supervisor against a generated quick/focus or phase bundle
argument-hint: "--bundle <path> --stage pre|post|plan|execute [--kind quick|phase] [--status <path>] [--findings <path>] [--report <path>]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Task
---
<objective>
Run the Codex supervisor as a separate artifact-driven analysis pass for quick/focus tasks or roadmap phases.

This command is Codex-only. It does not execute Claude Code inside Codex.
It reads a generated supervisor bundle, spawns the read-only `gsd-supervisor` agent,
then writes:
- stage-specific findings, report, and status files
- compatibility copies at `SUPERVISOR-FINDINGS.json` / `SUPERVISOR-REPORT.md` for quick bundles
- compatibility copies at `PHASE-SUPERVISOR-FINDINGS.json` / `PHASE-SUPERVISOR-REPORT.md` for phase bundles
</objective>

<context>
Parse `$ARGUMENTS` for:
- `--bundle <path>` — required, path to a generated supervisor bundle
- `--stage pre|post|plan|execute` — required
- `--kind quick|phase` — optional; if omitted, infer from the bundle content/path
- `--status <path>` — optional explicit status output path
- `--findings <path>` — optional explicit findings output path
- `--report <path>` — optional explicit report output path

If either is missing, stop with a clear usage error.
</context>

<process>
1. Verify the bundle file exists.
2. Derive `ARTIFACT_DIR=$(dirname "$BUNDLE_PATH")`.
3. Resolve output paths:
   - quick/focus stages use `SUPERVISOR-${STAGE^^}-*`
   - phase stages use `PHASE-SUPERVISOR-${STAGE^^}-*`
   - compatibility copies:
     - quick/focus: `SUPERVISOR-FINDINGS.json`, `SUPERVISOR-REPORT.md`
     - phase: `PHASE-SUPERVISOR-FINDINGS.json`, `PHASE-SUPERVISOR-REPORT.md`
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
8. Copy the resolved findings/report to compatibility paths:
   - quick/focus: `${ARTIFACT_DIR}/SUPERVISOR-FINDINGS.json` and `${ARTIFACT_DIR}/SUPERVISOR-REPORT.md`
   - phase: `${ARTIFACT_DIR}/PHASE-SUPERVISOR-FINDINGS.json` and `${ARTIFACT_DIR}/PHASE-SUPERVISOR-REPORT.md`
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

For phase bundles, `Stage` is `plan` or `execute`.

If the supervisor returns no findings, write an empty `findings: []` payload with `status: passed`.
If bundle parsing or analysis fails, still write a terminal status file with `state: failed` and include the error text.
</process>
