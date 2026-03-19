# Phase 5 Tooling Metadata Issues

Documented from supervisor execute-stage findings (`PHASE-SUPERVISOR-EXECUTE-FINDINGS.json`).
These are GSD tooling/orchestration issues, not implementation gaps. Phase 5 code is fully verified (11/11 must-haves passed).

## Issue 1: Verification status not propagated to execute bundle

**Severity:** high
**Category:** status-mismatch
**Supervisor finding:** "Phase execution bundle contradicts the verifier result"

### What happened

The execute bundle (`PHASE-SUPERVISOR-EXECUTE.json`) was generated **before** the manifest was updated to reflect the verification result. The bundle snapshot captured stale state:

| Field | Bundle value | Actual value |
|-------|-------------|--------------|
| `phase.verification_status` | `"pending"` | `"passed"` |
| `phase.final_status` | `"executed"` | `"verified"` |
| `execution.completion_ready.verification_passed` | `false` | `true` |
| `execution.completion_ready.ready_for_phase_complete` | `false` | `true` |

Meanwhile the actual verification artifact (`05-VERIFICATION.md`) correctly reports `status: passed` with `score: 11/11`.

### Root cause

The execute-phase workflow runs these steps in order:

1. Execute plans (waves 1-2)
2. Run verifier (`gsd-verifier`) -- produces `05-VERIFICATION.md`
3. Update manifest with verification result
4. Build supervisor execute bundle (`supervisor-bundle`)
5. Launch supervisor

In this Phase 5 run, the orchestrator updated the manifest **after** building the bundle (step 3 happened after step 4). The `supervisor-bundle` CLI reads the manifest at generation time, so it captured the pre-verification state.

### Fix

The execute-phase workflow (`execute-phase.md`) should ensure the manifest is updated with verification results **before** calling `supervisor-bundle`. The relevant sequence in `codex_supervisor_execute_gate`:

```
# Current (broken) order:
1. Build execute bundle  <-- reads stale manifest
2. Update manifest       <-- too late

# Correct order:
1. Update manifest verification_status = "passed", final_status = "verified"
2. Build execute bundle  <-- now reads correct state
```

Alternatively, `supervisor-bundle` could read `05-VERIFICATION.md` directly instead of relying solely on manifest fields.

---

## Issue 2: Summary data not ingested into execute bundle

**Severity:** medium
**Category:** artifact-ingestion
**Supervisor finding:** "Execution summary data was not captured into the bundle"

### What happened

Both summary entries in the execute bundle have empty/null fields despite the actual SUMMARY.md files containing concrete data:

```json
// Bundle shows:
{
  "plan_id": "05-01",
  "one_liner": null,
  "requirements_completed": [],
  "key_files": { "created": [], "modified": [], "all": [] },
  "decisions": [],
  "commit_hashes": []
}
```

Actual `05-01-SUMMARY.md` contains:
- Commit hashes: `8a43f3e`, `4b54176`
- Detailed build descriptions
- 4 decisions documented
- Files created: `src/composite/schemas.ts`, `src/composite/derive.ts`, `src/composite/index.ts`

Same pattern for `05-02-SUMMARY.md`.

### Root cause

The `supervisor-bundle` CLI parses SUMMARY.md files looking for specific structured sections. The summaries written by the orchestrator (not a `gsd-executor` subagent) used a freeform format that doesn't match the expected parsing patterns:

- **`one_liner`**: Parser likely looks for a `## One-liner` heading or similar — the summaries use `## What was built` instead
- **`requirements_completed`**: Parser expects explicit requirement ID references in a specific section — summaries reference them implicitly
- **`key_files`**: Parser expects `### Key Files` with `- created:` / `- modified:` prefixes — summaries list files inline in prose
- **`commit_hashes`**: Parser expects a specific frontmatter key or `### Commits` section — summaries put hashes in YAML frontmatter under `commits[].hash`

### Fix

Two possible approaches:

**Option A: Fix summary format** — Use the `gsd-tools summary` template format so the parser can extract structured data. This means summaries should include:
- `## One-liner` section
- `### Key Files` with `- created:` / `- modified:` prefixed lines
- `### Requirements` listing requirement IDs explicitly
- `### Commits` with hash references

**Option B: Fix summary parser** — Update `supervisor-bundle`'s summary ingestion to handle:
- YAML frontmatter `commits:` array for commit hashes
- Freeform prose sections (extract file paths from `src/` and `test/` patterns)
- Implicit requirement coverage (cross-reference plan frontmatter `requirements:` field)

Option A is simpler and ensures consistency. The `gsd-executor` subagent normally writes summaries using the template, but when the orchestrator writes summaries directly (as happened here due to an API error recovery), it should follow the same template.

---

## Impact Assessment

Neither issue affected Phase 5's implementation quality:
- All 111 composite templates correctly derived
- Matcher works across all structural categories
- 338 tests pass, typecheck clean
- Verifier independently confirmed 11/11 must-haves

The issues only affect the supervisor's ability to validate execution evidence through the bundle metadata layer. Downstream phases are unaffected.
