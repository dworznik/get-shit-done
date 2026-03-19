<purpose>
Collect and triage bot review feedback from GitHub PRs. Auto-detects PRs from stack state files, polls each PR for bot comments, creates per-slice feedback sessions, and bridges actionable findings into gap format for plan-phase --gaps consumption.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="initialize">
Parse arguments and load review feedback context:

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init review-feedback "${PHASE_OR_STACK_ARG}" ${PR_FLAG})
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse from init JSON: `delivery_mode`, `pr_list`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `stack_id`, `gh_available`, `feedback_dir`, `feedback_dir_exists`, `existing_sessions`, `collector_model`, `commit_docs`.

Where `${PHASE_OR_STACK_ARG}` is the first positional argument and `${PR_FLAG}` is `--pr <number>` if provided.

**If `gh_available` is false:** Error — `gh` CLI required. Run `gh auth login`.

**If `pr_list` is empty:** Error — "No PRs found. Pass `--pr <number>` or ensure stack state exists (STACK_STATE.json or focus-stack state.json)."

Parse optional flags from $ARGUMENTS:
- `--bots <names>` — comma-separated bot names to filter (default: all bots)
- `--timeout <seconds>` — polling timeout per PR (default: 120)
</step>

<step name="resolve_prs">
Display discovered PRs:

```
Found {pr_list.length} PR(s) to collect feedback for ({delivery_mode} mode)

| # | Slice | PR | Branch |
|---|-------|----|--------|
| 1 | {slice_id} | #{pr_number} | {branch} |
| 2 | ... | ... | ... |
```

If `feedback_dir_exists` and `existing_sessions` is non-empty, note:
```
Existing feedback sessions found: {existing_sessions.length} file(s)
Sessions with prior triage (status != collecting) will be preserved — only new findings are appended.
```
</step>

<step name="collect_per_slice">
Create feedback directory if needed:
```bash
mkdir -p .planning/feedback
```

For each entry in `pr_list`:

**a. Poll for reviews:**
```bash
POLL=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" feedback-poll {pr_number} ${BOTS_FLAG} ${TIMEOUT_FLAG} --raw)
```

Display: `Polling PR #{pr_number} ({title})...`

**b. If comments found (timed_out=false, comments non-empty):**

Determine feedback session filename:
- Phase stack: `{padded_phase}-{slice_id}-pr{pr_number}.md`
- Focus-stack: `{stack_id}-{slice_id}-pr{pr_number}.md`
- Single PR: `pr{pr_number}.md`

Check if a session file already exists at the output path. If it exists and its frontmatter `status` is not `collecting`, skip this slice (preserve prior triage). Otherwise spawn `gsd-feedback-collector` agent with:

```
<files_to_read>
- $HOME/.claude/get-shit-done/templates/FEEDBACK.md
</files_to_read>

Parse these bot review comments for PR #{pr_number} and create a feedback session file.

**Output path:** .planning/feedback/{filename}
**PR number:** {pr_number}
**PR URL:** {pr_url}
**Phase:** {phase_number or "N/A"}
**Slice ID:** {slice_id}
**Slice title:** {title}

**Raw comments JSON:**
{POLL.comments as JSON}

Create the feedback session file following the FEEDBACK.md template.
Auto-triage each finding by severity using bot-specific parsing rules.
Generate Gaps entries for blocker and major findings.
```

Track each created/updated session path in a `CREATED_SESSIONS` list for the aggregate step.

**c. If no bot reviews found (timed_out=true or comments empty):**
Note: `PR #{pr_number} ({title}): No bot reviews found within timeout.`
Continue to next PR.
</step>

<step name="aggregate_and_triage">
After all PRs are processed, read only the feedback session files created or updated in this run (from the `CREATED_SESSIONS` list built during collect_per_slice). Do **not** glob all `.planning/feedback/*.md` — that would include unrelated historical sessions.

Display combined findings table:

```
## Review Feedback Summary

| Slice | PR | Bot | Sev | File:Line | Title | Status |
|-------|----|-----|-----|-----------|-------|--------|
| {slice_id} | #{pr} | {bot} | {severity} | {file}:{line} | {title} | {status} |
```

Show totals:
```
Total: {N} findings ({blockers} blocker, {majors} major, {minors} minor, {cosmetics} cosmetic)
Actionable: {count} (blocker + major with status=actionable)
```

If actionable findings exist, offer interactive triage:
```
Accept auto-triage? Or review individually?
- "yes" / "accept" → keep current triage, proceed to gap generation
- "review" → walk each finding, allow dismiss/defer/accept
```

If user chooses "review": for each finding, display details and ask:
- **accept** — keep as actionable (default for blocker/major)
- **dismiss** — mark as dismissed (won't generate gap)
- **defer** — mark as deferred (won't generate gap now)

Update finding `status` in session files accordingly.
</step>

<step name="generate_gaps">
For each feedback session file with actionable findings:

1. Verify the `## Gaps` section contains entries for all `actionable` findings with severity `blocker` or `major`
2. If the agent already generated gaps during collection, verify format matches UAT.md gap schema
3. If gaps are missing, generate them now following the template

Commit all feedback session files:
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" commit "docs: add review feedback sessions" --files .planning/feedback/*.md
```
(Only if `commit_docs` is true)
</step>

<step name="offer_next">
Based on results:

**If actionable gaps exist:**
```
## Next Steps

Actionable findings require attention:
- /gsd:plan-phase {phase} --gaps — create plans to address feedback
- /gsd:debug — investigate specific findings manually
```

**If no actionable findings:**
```
## Next Steps

All clear — no actionable bot feedback.
- /gsd:verify-work {phase} — proceed with verification
- /gsd:progress — check overall project status
```
</step>

</process>
