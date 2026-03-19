<purpose>
Create executable phase prompts (PLAN.md files) for a roadmap phase with integrated research and verification. Default flow: Research (if needed) -> Plan -> Verify -> Done. Orchestrates gsd-phase-researcher, gsd-planner, and gsd-plan-checker agents with a revision loop (max 3 iterations).
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.

@~/.claude/get-shit-done/references/ui-brand.md
</required_reading>

<available_agent_types>
Valid GSD subagent types (use exact names — do not fall back to 'general-purpose'):
- gsd-phase-researcher — Researches technical approaches for a phase
- gsd-planner — Creates detailed plans from phase scope
- gsd-plan-checker — Reviews plan quality before execution
</available_agent_types>

<process>

## 1. Initialize

Load all context in one call (paths only to minimize orchestrator context):

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init plan-phase "$PHASE")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for: `researcher_model`, `planner_model`, `checker_model`, `research_enabled`, `plan_checker_enabled`, `nyquist_validation_enabled`, `commit_docs`, `text_mode`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`, `has_research`, `has_context`, `has_reviews`, `has_plans`, `plan_count`, `planning_exists`, `roadmap_exists`, `phase_req_ids`, `import_path`, `validation_path`, `codex_supervisor_phase_enabled`, `runtime_context`, `codex_supervisor_transport`, `codex_supervisor_transport_error`, `codex_launch_command`, `codex_boot_delay_ms`, `codex_supervisor_timeout_seconds`, `codex_supervisor_poll_ms`.

**File paths (for <files_to_read> blocks):** `state_path`, `roadmap_path`, `requirements_path`, `context_path`, `import_path`, `research_path`, `verification_path`, `uat_path`, `reviews_path`. These are null if files don't exist.

**Feedback files (for gap closure):**
```bash
FEEDBACK_FILES=$(ls .planning/feedback/${PADDED_PHASE}-*-pr*.md 2>/dev/null)
```
These contain bot review feedback gaps (if `--gaps` and feedback files exist).

**If `planning_exists` is false:** Error — run `/gsd:new-project` first.

## 2. Parse and Normalize Arguments

Extract from $ARGUMENTS: phase number (integer or decimal like `2.1`), flags (`--research`, `--skip-research`, `--gaps`, `--skip-verify`, `--prd <filepath>`, `--reviews`, `--text`, `--stack`).

Set `TEXT_MODE=true` if `--text` is present in $ARGUMENTS OR `text_mode` from init JSON is `true`. When `TEXT_MODE` is active, replace every `AskUserQuestion` call with a plain-text numbered list and ask the user to type their choice number. This is required for Claude Code remote sessions (`/rc` mode) where TUI menus don't work through the Claude App.

If `--stack` flag present, set `STACK_MODE=true`.

**Config auto-detection:** If `--stack` is NOT in $ARGUMENTS, check `delivery` from init JSON.
If `delivery` is `"stack"`, set `STACK_MODE=true`.

Extract `--prd <filepath>` from $ARGUMENTS. If present, set PRD_FILE to the filepath.

**If no phase number:** Detect next unplanned phase from roadmap.

**If `phase_found` is false:** Validate phase exists in ROADMAP.md. If valid, create the directory using `phase_slug` and `padded_phase` from init:
```bash
mkdir -p ".planning/phases/${padded_phase}-${phase_slug}"
```

**Existing artifacts from init:** `has_research`, `has_plans`, `plan_count`.

## 2.5. Validate `--reviews` Prerequisite

**Skip if:** No `--reviews` flag.

**If `--reviews` AND `--gaps`:** Error — cannot combine `--reviews` with `--gaps`. These are conflicting modes.

**If `--reviews` AND `has_reviews` is false (no REVIEWS.md in phase dir):**

Error:
```
No REVIEWS.md found for Phase {N}. Run reviews first:

/gsd:review --phase {N}

Then re-run /gsd:plan-phase {N} --reviews
```
Exit workflow.

## 3. Validate Phase

```bash
PHASE_INFO=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" roadmap get-phase "${PHASE}")
```

**If `found` is false:** Error with available phases. **If `found` is true:** Extract `phase_number`, `phase_name`, `goal` from JSON.

## 3.5. Handle PRD Express Path

**Skip if:** No `--prd` flag in arguments.

**If `--prd <filepath>` provided:**

1. Read the PRD file:
```bash
PRD_CONTENT=$(cat "$PRD_FILE" 2>/dev/null)
if [ -z "$PRD_CONTENT" ]; then
  echo "Error: PRD file not found: $PRD_FILE"
  exit 1
fi
```

2. Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PRD EXPRESS PATH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Using PRD: {PRD_FILE}
Generating CONTEXT.md from requirements...
```

3. Parse the PRD content and generate CONTEXT.md. The orchestrator should:
   - Extract all requirements, user stories, acceptance criteria, and constraints from the PRD
   - Map each to a locked decision (everything in the PRD is treated as a locked decision)
   - Identify any areas the PRD doesn't cover and mark as "Claude's Discretion"
   - **Extract canonical refs** from ROADMAP.md for this phase, plus any specs/ADRs referenced in the PRD — expand to full file paths (MANDATORY)
   - Create CONTEXT.md in the phase directory

4. Write CONTEXT.md:
```markdown
# Phase [X]: [Name] - Context

**Gathered:** [date]
**Status:** Ready for planning
**Source:** PRD Express Path ({PRD_FILE})

<domain>
## Phase Boundary

[Extracted from PRD — what this phase delivers]

</domain>

<decisions>
## Implementation Decisions

{For each requirement/story/criterion in the PRD:}
### [Category derived from content]
- [Requirement as locked decision]

### Claude's Discretion
[Areas not covered by PRD — implementation details, technical choices]

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

[MANDATORY. Extract from ROADMAP.md and any docs referenced in the PRD.
Use full relative paths. Group by topic area.]

### [Topic area]
- `path/to/spec-or-adr.md` — [What it decides/defines]

[If no external specs: "No external specs — requirements fully captured in decisions above"]

</canonical_refs>

<specifics>
## Specific Ideas

[Any specific references, examples, or concrete requirements from PRD]

</specifics>

<deferred>
## Deferred Ideas

[Items in PRD explicitly marked as future/v2/out-of-scope]
[If none: "None — PRD covers phase scope"]

</deferred>

---

*Phase: XX-name*
*Context gathered: [date] via PRD Express Path*
```

5. Commit:
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" commit "docs(${padded_phase}): generate context from PRD" --files "${phase_dir}/${padded_phase}-CONTEXT.md"
```

6. Set `context_content` to the generated CONTEXT.md content and continue to step 5 (Handle Research).

**Effect:** This completely bypasses step 4 (Load CONTEXT.md) since we just created it. The rest of the workflow (research, planning, verification) proceeds normally with the PRD-derived context.

## 4. Load CONTEXT.md

**Skip if:** PRD express path was used (CONTEXT.md already created in step 3.5).

Check `context_path` from init JSON.

If `context_path` is not null, display: `Using phase context from: ${context_path}`

**If `context_path` is null (no CONTEXT.md exists):**

Read discuss mode for context gate label:
```bash
DISCUSS_MODE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get workflow.discuss_mode 2>/dev/null || echo "discuss")
```

If `import_path` is not null, display: `Using imported phase notes from: ${import_path}`

If `TEXT_MODE` is true, present as a plain-text numbered list:
```
No CONTEXT.md found for Phase {X}. Plans will use research and requirements only — your design preferences won't be included.

1. Continue without context — Plan using research + requirements only
[If DISCUSS_MODE is "assumptions":]
2. Gather context (assumptions mode) — Analyze codebase and surface assumptions before planning
[If DISCUSS_MODE is "discuss" or unset:]
2. Run discuss-phase first — Capture design decisions before planning

Enter number:
```

Otherwise use AskUserQuestion:
- header: "No context"
- question: "No CONTEXT.md found for Phase {X}. Imported phase notes are available and can be used as the planning baseline. Continue or capture context first?"
- options:
  - "Continue without context" — Plan using imported phase notes + research + requirements
  - "Run discuss-phase first" — Capture design decisions before planning

If `import_path` is null, use AskUserQuestion:
- header: "No context"
- question: "No CONTEXT.md found for Phase {X}. Plans will use research and requirements only — your design preferences will not be included. Continue or capture context first?"
- options:
  - "Continue without context" — Plan using research + requirements only
  If `DISCUSS_MODE` is `"assumptions"`:
  - "Gather context (assumptions mode)" — Analyze codebase and surface assumptions before planning
  If `DISCUSS_MODE` is `"discuss"` (or unset):
  - "Run discuss-phase first" — Capture design decisions before planning

If "Continue without context": Proceed to step 5.
If "Run discuss-phase first":
  **IMPORTANT:** Do NOT invoke discuss-phase as a nested Skill/Task call — AskUserQuestion
  does not work correctly in nested subcontexts (#1009). Instead, display the command
  and exit so the user runs it as a top-level command:
  ```
  Run this command first, then re-run /gsd:plan-phase {X} ${GSD_WS}:

  /gsd:discuss-phase {X} ${GSD_WS}
  ```
  **Exit the plan-phase workflow. Do not continue.**

## 5. Handle Research

**Skip if:** `--gaps` flag or `--skip-research` flag or `--reviews` flag.

**If `has_research` is true (from init) AND no `--research` flag:** Use existing, skip to step 6.

**If RESEARCH.md missing OR `--research` flag:**

**If no explicit flag (`--research` or `--skip-research`) and not `--auto`:**
Ask the user whether to research, with a contextual recommendation based on the phase:

If `TEXT_MODE` is true, present as a plain-text numbered list:
```
Research before planning Phase {X}: {phase_name}?

1. Research first (Recommended) — Investigate domain, patterns, and dependencies before planning. Best for new features, unfamiliar integrations, or architectural changes.
2. Skip research — Plan directly from context and requirements. Best for bug fixes, simple refactors, or well-understood tasks.

Enter number:
```

Otherwise use AskUserQuestion:
```
AskUserQuestion([
  {
    question: "Research before planning Phase {X}: {phase_name}?",
    header: "Research",
    multiSelect: false,
    options: [
      { label: "Research first (Recommended)", description: "Investigate domain, patterns, and dependencies before planning. Best for new features, unfamiliar integrations, or architectural changes." },
      { label: "Skip research", description: "Plan directly from context and requirements. Best for bug fixes, simple refactors, or well-understood tasks." }
    ]
  }
])
```

If user selects "Skip research": skip to step 6.

**If `--auto` and `research_enabled` is false:** Skip research silently (preserves automated behavior).

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► RESEARCHING PHASE {X}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning researcher...
```

### Spawn gsd-phase-researcher

```bash
PHASE_DESC=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" roadmap get-phase "${PHASE}" --pick section)
```

Research prompt:

```markdown
<objective>
Research how to implement Phase {phase_number}: {phase_name}
Answer: "What do I need to know to PLAN this phase well?"
</objective>

<files_to_read>
- {context_path} (USER DECISIONS from /gsd:discuss-phase)
- {import_path} (Imported phase baseline)
- {requirements_path} (Project requirements)
- {state_path} (Project decisions and history)
</files_to_read>

<additional_context>
**Phase description:** {phase_description}
**Phase requirement IDs (MUST address):** {phase_req_ids}

**Project instructions:** Read ./CLAUDE.md if exists — follow project-specific guidelines
**Project skills:** Check .claude/skills/ or .agents/skills/ directory (if either exists) — read SKILL.md files, research should account for project skill patterns
</additional_context>

<output>
Write to: {phase_dir}/{phase_num}-RESEARCH.md
</output>
```

```
Task(
  prompt=research_prompt,
  subagent_type="gsd-phase-researcher",
  model="{researcher_model}",
  description="Research Phase {phase}"
)
```

### Handle Researcher Return

- **`## RESEARCH COMPLETE`:** Display confirmation, continue to step 6
- **`## RESEARCH BLOCKED`:** Display blocker, offer: 1) Provide context, 2) Skip research, 3) Abort

## 5.5. Create Validation Strategy

Skip if `nyquist_validation_enabled` is false OR `research_enabled` is false.

If `research_enabled` is false and `nyquist_validation_enabled` is true: warn "Nyquist validation enabled but research disabled — VALIDATION.md cannot be created without RESEARCH.md. Plans will lack validation requirements (Dimension 8)." Continue to step 6.

**But Nyquist is not applicable for this run** when all of the following are true:
- `research_enabled` is false
- `has_research` is false
- no `--research` flag was provided

In that case: **skip validation-strategy creation entirely**. Do **not** expect `RESEARCH.md` or `VALIDATION.md` for this run, and continue to Step 6.

```bash
grep -l "## Validation Architecture" "${PHASE_DIR}"/*-RESEARCH.md 2>/dev/null
```

**If found:**
1. Read template: `~/.claude/get-shit-done/templates/VALIDATION.md`
2. Write to `${PHASE_DIR}/${PADDED_PHASE}-VALIDATION.md` (use Write tool)
3. Fill frontmatter: `{N}` → phase number, `{phase-slug}` → slug, `{date}` → current date
4. Verify:
```bash
test -f "${PHASE_DIR}/${PADDED_PHASE}-VALIDATION.md" && echo "VALIDATION_CREATED=true" || echo "VALIDATION_CREATED=false"
```
5. If `VALIDATION_CREATED=false`: STOP — do not proceed to Step 6
6. If `commit_docs`: `commit "docs(phase-${PHASE}): add validation strategy"`

**If not found:** Warn and continue — plans may fail Dimension 8.

## 5.6. UI Design Contract Gate

> Skip if `workflow.ui_phase` is explicitly `false` AND `workflow.ui_safety_gate` is explicitly `false` in `.planning/config.json`. If keys are absent, treat as enabled.

```bash
UI_PHASE_CFG=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get workflow.ui_phase 2>/dev/null || echo "true")
UI_GATE_CFG=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get workflow.ui_safety_gate 2>/dev/null || echo "true")
```

**If both are `false`:** Skip to step 6.

Check if phase has frontend indicators:

```bash
PHASE_SECTION=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" roadmap get-phase "${PHASE}" 2>/dev/null)
echo "$PHASE_SECTION" | grep -iE "UI|interface|frontend|component|layout|page|screen|view|form|dashboard|widget" > /dev/null 2>&1
HAS_UI=$?
```

**If `HAS_UI` is 0 (frontend indicators found):**

Check for existing UI-SPEC:
```bash
UI_SPEC_FILE=$(ls "${PHASE_DIR}"/*-UI-SPEC.md 2>/dev/null | head -1)
```

**If UI-SPEC.md found:** Set `UI_SPEC_PATH=$UI_SPEC_FILE`. Display: `Using UI design contract: ${UI_SPEC_PATH}`

**If UI-SPEC.md missing AND `UI_GATE_CFG` is `true`:**

If `TEXT_MODE` is true, present as a plain-text numbered list:
```
Phase {N} has frontend indicators but no UI-SPEC.md. Generate a design contract before planning?

1. Generate UI-SPEC first — Run /gsd:ui-phase {N} then re-run /gsd:plan-phase {N}
2. Continue without UI-SPEC
3. Not a frontend phase

Enter number:
```

Otherwise use AskUserQuestion:
- header: "UI Design Contract"
- question: "Phase {N} has frontend indicators but no UI-SPEC.md. Generate a design contract before planning?"
- options:
  - "Generate UI-SPEC first" → Display: "Run `/gsd:ui-phase {N} ${GSD_WS}` then re-run `/gsd:plan-phase {N} ${GSD_WS}`". Exit workflow.
  - "Continue without UI-SPEC" → Continue to step 6.
  - "Not a frontend phase" → Continue to step 6.

**If `HAS_UI` is 1 (no frontend indicators):** Skip silently to step 6.

## 6. Check Existing Plans

```bash
ls "${PHASE_DIR}"/*-PLAN.md 2>/dev/null
```

**If exists AND `--reviews` flag:** Skip prompt — go straight to replanning (the purpose of `--reviews` is to replan with review feedback).

**If exists AND no `--reviews` flag:** Offer: 1) Add more plans, 2) View existing, 3) Replan from scratch.

## 7. Use Context Paths from INIT

Extract from INIT JSON:

```bash
_gsd_field() { node -e "const o=JSON.parse(process.argv[1]); const v=o[process.argv[2]]; process.stdout.write(v==null?'':String(v))" "$1" "$2"; }
STATE_PATH=$(_gsd_field "$INIT" state_path)
ROADMAP_PATH=$(_gsd_field "$INIT" roadmap_path)
REQUIREMENTS_PATH=$(_gsd_field "$INIT" requirements_path)
RESEARCH_PATH=$(_gsd_field "$INIT" research_path)
VERIFICATION_PATH=$(_gsd_field "$INIT" verification_path)
UAT_PATH=$(_gsd_field "$INIT" uat_path)
CONTEXT_PATH=$(_gsd_field "$INIT" context_path)
REVIEWS_PATH=$(_gsd_field "$INIT" reviews_path)
IMPORT_PATH=$(_gsd_field "$INIT" import_path)
VALIDATION_PATH=$(_gsd_field "$INIT" validation_path)
```

## 7.5. Verify Nyquist Artifacts

Skip if `nyquist_validation_enabled` is false OR `research_enabled` is false.

Also skip if all of the following are true:
- `research_enabled` is false
- `has_research` is false
- no `--research` flag was provided

In that no-research path, Nyquist artifacts are **not required** for this run.

```bash
VALIDATION_EXISTS=$(ls "${PHASE_DIR}"/*-VALIDATION.md 2>/dev/null | head -1)
```

If missing and Nyquist is still enabled/applicable — ask user:
1. Re-run: `/gsd:plan-phase {PHASE} --research ${GSD_WS}`
2. Disable Nyquist with the exact command:
   `node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-set workflow.nyquist_validation false`
3. Continue anyway (plans fail Dimension 8)

Proceed to Step 8 only if user selects 2 or 3.

## 8. Spawn gsd-planner Agent

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PLANNING PHASE {X}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning planner...
```

Planner prompt:

```markdown
<planning_context>
**Phase:** {phase_number}
**Mode:** {standard | gap_closure | reviews}

<files_to_read>
- {state_path} (Project State)
- {roadmap_path} (Roadmap)
- {requirements_path} (Requirements)
- {context_path} (USER DECISIONS from /gsd:discuss-phase)
- {import_path} (Imported phase baseline)
- {research_path} (Technical Research)
- {verification_path} (Verification Gaps - if --gaps)
- {uat_path} (UAT Gaps - if --gaps)
- {reviews_path} (Cross-AI Review Feedback - if --reviews)
- {FEEDBACK_FILES} (Review Feedback Gaps - if --gaps and feedback exists)
- {UI_SPEC_PATH} (UI Design Contract — visual/interaction specs, if exists)
</files_to_read>

**Phase requirement IDs (every ID MUST appear in a plan's `requirements` field):** {phase_req_ids}

**Project instructions:** Read ./CLAUDE.md if exists — follow project-specific guidelines
**Project skills:** Check .claude/skills/ or .agents/skills/ directory (if either exists) — read SKILL.md files, plans should account for project skill rules
</planning_context>

<downstream_consumer>
Output consumed by /gsd:execute-phase. Plans need:
- Frontmatter (wave, depends_on, files_modified, autonomous)
- Tasks in XML format with read_first and acceptance_criteria fields (MANDATORY on every task)
- Verification criteria
- must_haves for goal-backward verification
</downstream_consumer>

{If STACK_MODE is true, inject this block into the planner prompt:}

<delivery_mode>
**Delivery:** stack (stacked PRs)

Stack delivery constraints:
- Plans MUST be strictly linear: plan 01 has no deps, plan 02 depends on [01], plan 03 depends on [02], etc.
- Each plan gets its own wave: plan 01 = wave 1, plan 02 = wave 2, plan 03 = wave 3.
- File overlap between plans IS ALLOWED (unlike parallel mode where file ownership must be exclusive).
- Each plan should represent one reviewable PR unit — a coherent, self-contained change.
- Order plans by natural implementation sequence (foundations first, features next, polish last).
</delivery_mode>

<deep_work_rules>
## Anti-Shallow Execution Rules (MANDATORY)

Every task MUST include these fields — they are NOT optional:

1. **`<read_first>`** — Files the executor MUST read before touching anything. Always include:
   - The file being modified (so executor sees current state, not assumptions)
   - Any "source of truth" file referenced in CONTEXT.md (reference implementations, existing patterns, config files, schemas)
   - Any file whose patterns, signatures, types, or conventions must be replicated or respected

2. **`<acceptance_criteria>`** — Verifiable conditions that prove the task was done correctly. Rules:
   - Every criterion must be checkable with grep, file read, test command, or CLI output
   - NEVER use subjective language ("looks correct", "properly configured", "consistent with")
   - ALWAYS include exact strings, patterns, values, or command outputs that must be present
   - Examples:
     - Code: `auth.py contains def verify_token(` / `test_auth.py exits 0`
     - Config: `.env.example contains DATABASE_URL=` / `Dockerfile contains HEALTHCHECK`
     - Docs: `README.md contains '## Installation'` / `API.md lists all endpoints`
     - Infra: `deploy.yml has rollback step` / `docker-compose.yml has healthcheck for db`

3. **`<action>`** — Must include CONCRETE values, not references. Rules:
   - NEVER say "align X with Y", "match X to Y", "update to be consistent" without specifying the exact target state
   - ALWAYS include the actual values: config keys, function signatures, SQL statements, class names, import paths, env vars, etc.
   - If CONTEXT.md has a comparison table or expected values, copy them into the action verbatim
   - The executor should be able to complete the task from the action text alone, without needing to read CONTEXT.md or reference files (read_first is for verification, not discovery)

**Why this matters:** Executor agents work from the plan text. Vague instructions like "update the config to match production" produce shallow one-line changes. Concrete instructions like "add DATABASE_URL=postgresql://... , set POOL_SIZE=20, add REDIS_URL=redis://..." produce complete work. The cost of verbose plans is far less than the cost of re-doing shallow execution.
</deep_work_rules>

<quality_gate>
- [ ] PLAN.md files created in phase directory
- [ ] Each plan has valid frontmatter
- [ ] Tasks are specific and actionable
- [ ] Every task has `<read_first>` with at least the file being modified
- [ ] Every task has `<acceptance_criteria>` with grep-verifiable conditions
- [ ] Every `<action>` contains concrete values (no "align X with Y" without specifying what)
- [ ] Dependencies correctly identified
- [ ] Waves assigned for parallel execution
- [ ] must_haves derived from phase goal
</quality_gate>
```

```
Task(
  prompt=filled_prompt,
  subagent_type="gsd-planner",
  model="{planner_model}",
  description="Plan Phase {phase}"
)
```

## 9. Handle Planner Return

- **`## PLANNING COMPLETE`:** Display plan count. If `--skip-verify` or `plan_checker_enabled` is false (from init): skip to step 13. Otherwise: step 10.
- **`## CHECKPOINT REACHED`:** Present to user, get response, spawn continuation (step 12)
- **`## PLANNING INCONCLUSIVE`:** Show attempts, offer: Add context / Retry / Manual

## 10. Spawn gsd-plan-checker Agent

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► VERIFYING PLANS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning plan checker...
```

Checker prompt:

```markdown
<verification_context>
**Phase:** {phase_number}
**Phase Goal:** {goal from ROADMAP}

<files_to_read>
- {PHASE_DIR}/*-PLAN.md (Plans to verify)
- {roadmap_path} (Roadmap)
- {requirements_path} (Requirements)
- {context_path} (USER DECISIONS from /gsd:discuss-phase)
- {import_path} (Imported phase baseline)
- {research_path} (Technical Research — includes Validation Architecture)
</files_to_read>

**Phase requirement IDs (MUST ALL be covered):** {phase_req_ids}

**Project instructions:** Read ./CLAUDE.md if exists — verify plans honor project guidelines
**Project skills:** Check .claude/skills/ or .agents/skills/ directory (if either exists) — verify plans account for project skill rules
</verification_context>

<expected_output>
- ## VERIFICATION PASSED — all checks pass
- ## ISSUES FOUND — structured issue list
</expected_output>
```

```
Task(
  prompt=checker_prompt,
  subagent_type="gsd-plan-checker",
  model="{checker_model}",
  description="Verify Phase {phase} plans"
)
```

## 11. Handle Checker Return

- **`## VERIFICATION PASSED`:** Display confirmation, proceed to step 12.5 when phase supervisor is enabled, otherwise step 13.
- **`## ISSUES FOUND`:** Display issues, check iteration count, proceed to step 12.

## 12. Revision Loop (Max 3 Iterations)

Track `iteration_count` (starts at 1 after initial plan + check).

**If iteration_count < 3:**

Display: `Sending back to planner for revision... (iteration {N}/3)`

Revision prompt:

```markdown
<revision_context>
**Phase:** {phase_number}
**Mode:** revision

<files_to_read>
- {PHASE_DIR}/*-PLAN.md (Existing plans)
- {context_path} (USER DECISIONS from /gsd:discuss-phase)
- {import_path} (Imported phase baseline)
</files_to_read>

**Checker issues:** {structured_issues_from_checker}
</revision_context>

<instructions>
Make targeted updates to address checker issues.
Do NOT replan from scratch unless issues are fundamental.
Return what changed.
</instructions>
```

```
Task(
  prompt=revision_prompt,
  subagent_type="gsd-planner",
  model="{planner_model}",
  description="Revise Phase {phase} plans"
)
```

After planner returns -> spawn checker again (step 10), increment iteration_count.

**If iteration_count >= 3:**

Display: `Max iterations reached. {N} issues remain:` + issue list

Offer: 1) Force proceed, 2) Provide guidance and retry, 3) Abandon

## 13. Requirements Coverage Gate

After plans pass the checker (or checker is skipped), verify that all phase requirements are covered by at least one plan.

**Skip if:** `phase_req_ids` is null or TBD (no requirements mapped to this phase).

**Step 1: Extract requirement IDs claimed by plans**
```bash
# Collect all requirement IDs from plan frontmatter
PLAN_REQS=$(grep -h "requirements_addressed\|requirements:" ${PHASE_DIR}/*-PLAN.md 2>/dev/null | tr -d '[]' | tr ',' '\n' | sed 's/^[[:space:]]*//' | sort -u)
```

**Step 2: Compare against phase requirements from ROADMAP**

For each REQ-ID in `phase_req_ids`:
- If REQ-ID appears in `PLAN_REQS` → covered ✓
- If REQ-ID does NOT appear in any plan → uncovered ✗

**Step 3: Check CONTEXT.md features against plan objectives**

Read CONTEXT.md `<decisions>` section. Extract feature/capability names. Check each against plan `<objective>` blocks. Features not mentioned in any plan objective → potentially dropped.

**Step 4: Report**

If all requirements covered and no dropped features:
```
✓ Requirements coverage: {N}/{N} REQ-IDs covered by plans
```
→ Proceed to step 14.

If gaps found:
```
## ⚠ Requirements Coverage Gap

{M} of {N} phase requirements are not assigned to any plan:

| REQ-ID | Description | Plans |
|--------|-------------|-------|
| {id} | {from REQUIREMENTS.md} | None |

{K} CONTEXT.md features not found in plan objectives:
- {feature_name} — described in CONTEXT.md but no plan covers it

Options:
1. Re-plan to include missing requirements (recommended)
2. Move uncovered requirements to next phase
3. Proceed anyway — accept coverage gaps
```

If `TEXT_MODE` is true, present as a plain-text numbered list (options already shown in the block above). Otherwise use AskUserQuestion to present the options.

## 13.5. Codex Supervisor Phase Plan Gate

Run this step only when `codex_supervisor_phase_enabled` is true and the plan-check result is effectively passed.

Write or update `${PHASE_DIR}/PHASE_RUN_MANIFEST.json`:
```bash
PHASE_RUN_MANIFEST="${PHASE_DIR}/PHASE_RUN_MANIFEST.json"
PHASE_DIR="$PHASE_DIR" PHASE_RUN_MANIFEST="$PHASE_RUN_MANIFEST" PHASE_NUMBER="$PHASE" PHASE_NAME="$PHASE_NAME" PHASE_SLUG="$PHASE_SLUG" CONTEXT_PATH="$CONTEXT_PATH" RESEARCH_PATH="$RESEARCH_PATH" IMPORT_PATH="$IMPORT_PATH" VALIDATION_PATH="$VALIDATION_PATH" VERIFICATION_PATH="$VERIFICATION_PATH" UAT_PATH="$UAT_PATH" SUPERVISOR_RUNTIME="${runtime_context}" SUPERVISOR_TRANSPORT="${codex_supervisor_transport}" node <<'NODE'
const fs = require('fs');
const manifestPath = process.env.PHASE_RUN_MANIFEST;
const existing = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const manifest = {
  run_id: existing.run_id || `phase-${process.env.PHASE_NUMBER}`,
  kind: 'phase',
  phase_number: process.env.PHASE_NUMBER,
  phase_name: process.env.PHASE_NAME,
  phase_slug: process.env.PHASE_SLUG,
  phase_dir: process.env.PHASE_DIR,
  context_path: process.env.CONTEXT_PATH || null,
  research_path: process.env.RESEARCH_PATH || null,
  import_path: process.env.IMPORT_PATH || null,
  validation_path: process.env.VALIDATION_PATH || null,
  verification_path: process.env.VERIFICATION_PATH || null,
  uat_path: process.env.UAT_PATH || null,
  planner_status: 'planned',
  checker_status: 'passed',
  execution_status: existing.execution_status || 'pending',
  verification_status: existing.verification_status || 'pending',
  supervisor_runtime: process.env.SUPERVISOR_RUNTIME || null,
  supervisor_transport: process.env.SUPERVISOR_TRANSPORT || null,
  supervisor_plan_tmux_target: existing.supervisor_plan_tmux_target || null,
  supervisor_execute_tmux_target: existing.supervisor_execute_tmux_target || null,
  supervisor_plan_status: 'pending',
  supervisor_execute_status: existing.supervisor_execute_status || 'pending',
  final_status: 'planned',
};
fs.writeFileSync(manifestPath, JSON.stringify({ ...existing, ...manifest }, null, 2));
NODE
```

Build the phase plan bundle:
```bash
PHASE_PLAN_BUNDLE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" supervisor-bundle "$PHASE_DIR" --kind phase --stage plan --raw)
```

If `codex_supervisor_transport` is `unavailable`, stop with `codex_supervisor_transport_error`.

If `codex_supervisor_transport` is `direct`, invoke:
```text
Skill(skill="gsd:supervisor", args="--bundle ${PHASE_PLAN_BUNDLE} --stage plan --kind phase")
```

If `codex_supervisor_transport` is `tmux`, launch and wait:
```bash
SUPERVISOR_PLAN_LAUNCH=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" supervisor-launch "$PHASE_DIR" --kind phase --stage plan)
if [[ "$SUPERVISOR_PLAN_LAUNCH" == @file:* ]]; then SUPERVISOR_PLAN_LAUNCH=$(cat "${SUPERVISOR_PLAN_LAUNCH#@file:}"); fi
SUPERVISOR_PLAN_TARGET=$(printf '%s' "$SUPERVISOR_PLAN_LAUNCH" | node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(data.tmux_target || "");')
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" supervisor-wait "$PHASE_DIR" --kind phase --stage plan
```

After the supervisor completes:
- verify `${PHASE_DIR}/PHASE-SUPERVISOR-PLAN-FINDINGS.json` exists
- read findings, report, and state:
```bash
SUPERVISOR_PLAN=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" supervisor-findings "${PHASE_DIR}/PHASE-SUPERVISOR-PLAN-FINDINGS.json")
if [[ "$SUPERVISOR_PLAN" == @file:* ]]; then SUPERVISOR_PLAN=$(cat "${SUPERVISOR_PLAN#@file:}"); fi
SUPERVISOR_PLAN_REPORT=$(cat "${PHASE_DIR}/PHASE-SUPERVISOR-PLAN-REPORT.md" 2>/dev/null || true)
SUPERVISOR_PLAN_STATE=$(node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.state || "failed");' "${PHASE_DIR}/PHASE-SUPERVISOR-PLAN-STATUS.json")
```
- update `PHASE_RUN_MANIFEST.json` `supervisor_plan_status`
- when tmux transport ran, also update `supervisor_plan_tmux_target`

Gate behavior:
- `blocked` → enter the supervisor revision loop (step 12.75)
- `failed` or `timeout` → stop before offering `/gsd:execute-phase`
- `warnings` → continue and keep the warnings recorded in the manifest
- `passed` → continue normally

## 12.75. Supervisor Revision Loop (Max 3 Iterations)

Run this step only when `SUPERVISOR_PLAN_STATE` is `blocked`.

Track `supervisor_iteration_count` separately from the checker loop. It starts at `1` after the first blocked supervisor result.

**If `supervisor_iteration_count < 3`:**

Display: `Codex supervisor found plan gaps. Sending back to planner for targeted revision... (iteration {N}/3)`

Revision prompt:

```markdown
<revision_context>
**Phase:** {phase_number}
**Mode:** supervisor_revision

<files_to_read>
- {PHASE_DIR}/*-PLAN.md (Current plans)
- {roadmap_path} (Roadmap)
- {requirements_path} (Requirements)
- {context_path} (USER DECISIONS from /gsd:discuss-phase)
- {import_path} (Imported phase baseline)
- {research_path} (Technical research)
- {validation_path} (Validation expectations)
- {PHASE_DIR}/PHASE-SUPERVISOR-PLAN-FINDINGS.json (Structured supervisor findings)
- {PHASE_DIR}/PHASE-SUPERVISOR-PLAN-REPORT.md (Human-readable supervisor report)
</files_to_read>

**Supervisor findings JSON:** {SUPERVISOR_PLAN}

**Supervisor report:** {SUPERVISOR_PLAN_REPORT}
</revision_context>

<instructions>
Make targeted updates to close the supervisor gaps.
Preserve the accepted phase shape unless the findings prove the current structure is incompatible.
Do NOT ignore requirement coverage, dependency compatibility, validation expectations, or missing cross-plan wiring.
Return what changed and why the supervisor blockers should now be resolved.
</instructions>
```

```text
Task(
  prompt=revision_prompt,
  subagent_type="gsd-planner",
  model="{planner_model}",
  description="Revise Phase {phase} plans from supervisor findings"
)
```

After planner returns:
- rerun the checker (step 10)
- if checker passes, rerun the supervisor gate (step 12.5)
- increment `supervisor_iteration_count`

**If `supervisor_iteration_count >= 3`:**

Display: `Max supervisor revision iterations reached. Blockers remain:` + findings summary

Offer: 1) Force proceed, 2) Provide guidance and retry, 3) Abandon

## 12.8. Write PHASE_DELIVERY.json (Stack Mode Only)

**Skip if:** `STACK_MODE` is not true.

After plans pass verification (or checker is skipped), write the delivery mode file:

```bash
node -e "
const fs = require('fs');
fs.writeFileSync('${PHASE_DIR}/PHASE_DELIVERY.json', JSON.stringify({
  delivery: 'stack',
  created_at: new Date().toISOString()
}, null, 2));
"
```

Commit:
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" commit "docs(${padded_phase}): set stack delivery mode" --files "${PHASE_DIR}/PHASE_DELIVERY.json"
```

## 13. Requirements Coverage Gate

After plans pass the checker (or checker is skipped), verify that all phase requirements are covered by at least one plan.

**Skip if:** `phase_req_ids` is null or TBD (no requirements mapped to this phase).

**Step 1: Extract requirement IDs claimed by plans**
```bash
# Collect all requirement IDs from plan frontmatter
PLAN_REQS=$(grep -h "requirements_addressed\|requirements:" ${PHASE_DIR}/*-PLAN.md 2>/dev/null | tr -d '[]' | tr ',' '\n' | sed 's/^[[:space:]]*//' | sort -u)
```

**Step 2: Compare against phase requirements from ROADMAP**

For each REQ-ID in `phase_req_ids`:
- If REQ-ID appears in `PLAN_REQS` → covered ✓
- If REQ-ID does NOT appear in any plan → uncovered ✗

**Step 3: Check CONTEXT.md features against plan objectives**

Read CONTEXT.md `<decisions>` section. Extract feature/capability names. Check each against plan `<objective>` blocks. Features not mentioned in any plan objective → potentially dropped.

**Step 4: Report**

If all requirements covered and no dropped features:
```
✓ Requirements coverage: {N}/{N} REQ-IDs covered by plans
```
→ Proceed to step 14.

If gaps found:
```
## ⚠ Requirements Coverage Gap

{M} of {N} phase requirements are not assigned to any plan:

| REQ-ID | Description | Plans |
|--------|-------------|-------|
| {id} | {from REQUIREMENTS.md} | None |

{K} CONTEXT.md features not found in plan objectives:
- {feature_name} — described in CONTEXT.md but no plan covers it

Options:
1. Re-plan to include missing requirements (recommended)
2. Move uncovered requirements to next phase
3. Proceed anyway — accept coverage gaps
```

Use AskUserQuestion to present the options.

## 14. Present Final Status

Route to `<offer_next>` OR `auto_advance` depending on flags/config.

## 15. Auto-Advance Check

Check for auto-advance trigger:

1. Parse `--auto` flag from $ARGUMENTS
2. **Sync chain flag with intent** — if user invoked manually (no `--auto`), clear the ephemeral chain flag from any previous interrupted `--auto` chain. This does NOT touch `workflow.auto_advance` (the user's persistent settings preference):
   ```bash
   if [[ ! "$ARGUMENTS" =~ --auto ]]; then
     node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-set workflow._auto_chain_active false 2>/dev/null
   fi
   ```
3. Read both the chain flag and user preference:
   ```bash
   AUTO_CHAIN=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get workflow._auto_chain_active 2>/dev/null || echo "false")
   AUTO_CFG=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get workflow.auto_advance 2>/dev/null || echo "false")
   ```

**If `--auto` flag present OR `AUTO_CHAIN` is true OR `AUTO_CFG` is true:**

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► AUTO-ADVANCING TO EXECUTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Plans ready. Launching execute-phase...
```

Launch execute-phase using the Skill tool to avoid nested Task sessions (which cause runtime freezes due to deep agent nesting):
```
Skill(skill="gsd:execute-phase", args="${PHASE} --auto --no-transition ${GSD_WS}")
```

The `--no-transition` flag tells execute-phase to return status after verification instead of chaining further. This keeps the auto-advance chain flat — each phase runs at the same nesting level rather than spawning deeper Task agents.

**Handle execute-phase return:**
- **PHASE COMPLETE** → Display final summary:
  ```
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GSD ► PHASE ${PHASE} COMPLETE ✓
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Auto-advance pipeline finished.

  Next: /gsd:discuss-phase ${NEXT_PHASE} --auto ${GSD_WS}
  ```
- **GAPS FOUND / VERIFICATION FAILED** → Display result, stop chain:
  ```
  Auto-advance stopped: Execution needs review.

  Review the output above and continue manually:
  /gsd:execute-phase ${PHASE} ${GSD_WS}
  ```

**If neither `--auto` nor config enabled:**
Route to `<offer_next>` (existing behavior).

</process>

<offer_next>

**If STACK_MODE is true**, output this markdown directly (not as a code block):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PHASE {X} PLANNED ✓ (Stacked PRs)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Phase {X}: {Name}** — {N} plan(s), stacked PR delivery

| Order | Plan | What it builds |
|-------|------|----------------|
| 1     | 01   | [objective]    |
| 2     | 02   | [objective]    |
| 3     | 03   | [objective]    |

Delivery: Stacked PRs
Research: {Completed | Used existing | Skipped}
Verification: {Passed | Passed with override | Skipped}

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Execute Phase {X} (Stack)** — deliver {N} plans as stacked PRs

/gsd:execute-phase {X} --stack

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────

**Also available:**
- cat .planning/phases/{phase-dir}/*-PLAN.md — review plans
- /gsd:plan-phase {X} --research — re-research first

───────────────────────────────────────────────────────────────

**Otherwise (not stack mode)**, output this markdown directly (not as a code block):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PHASE {X} PLANNED ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Phase {X}: {Name}** — {N} plan(s) in {M} wave(s)

| Wave | Plans | What it builds |
|------|-------|----------------|
| 1    | 01, 02 | [objectives] |
| 2    | 03     | [objective]  |

Research: {Completed | Used existing | Skipped}
Verification: {Passed | Passed with override | Skipped}

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Execute Phase {X}** — run all {N} plans

/gsd:execute-phase {X} ${GSD_WS}

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────

**Also available:**
- cat .planning/phases/{phase-dir}/*-PLAN.md — review plans
- /gsd:plan-phase {X} --research — re-research first
- /gsd:review --phase {X} --all — peer review plans with external AIs
- /gsd:plan-phase {X} --reviews — replan incorporating review feedback

───────────────────────────────────────────────────────────────
</offer_next>

<windows_troubleshooting>
**Windows users:** If plan-phase freezes during agent spawning (common on Windows due to
stdio deadlocks with MCP servers — see Claude Code issue anthropics/claude-code#28126):

1. **Force-kill:** Close the terminal (Ctrl+C may not work)
2. **Clean up orphaned processes:**
   ```powershell
   # Kill orphaned node processes from stale MCP servers
   Get-Process node -ErrorAction SilentlyContinue | Where-Object {$_.StartTime -lt (Get-Date).AddHours(-1)} | Stop-Process -Force
   ```
3. **Clean up stale task directories:**
   ```powershell
   # Remove stale subagent task dirs (Claude Code never cleans these on crash)
   Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\tasks\*" -ErrorAction SilentlyContinue
   ```
4. **Reduce MCP server count:** Temporarily disable non-essential MCP servers in settings.json
5. **Retry:** Restart Claude Code and run `/gsd:plan-phase` again

If freezes persist, try `--skip-research` to reduce the agent chain from 3 to 2 agents:
```
/gsd:plan-phase N --skip-research
```
</windows_troubleshooting>

<success_criteria>
- [ ] .planning/ directory validated
- [ ] Phase validated against roadmap
- [ ] Phase directory created if needed
- [ ] CONTEXT.md loaded early (step 4) and passed to ALL agents
- [ ] Research completed (unless --skip-research or --gaps or exists)
- [ ] gsd-phase-researcher spawned with CONTEXT.md
- [ ] Existing plans checked
- [ ] gsd-planner spawned with CONTEXT.md + RESEARCH.md
- [ ] Plans created (PLANNING COMPLETE or CHECKPOINT handled)
- [ ] gsd-plan-checker spawned with CONTEXT.md
- [ ] Verification passed OR user override OR max iterations with user decision
- [ ] User sees status between agent spawns
- [ ] User knows next steps
</success_criteria>
