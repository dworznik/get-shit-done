<purpose>
Execute small, ad-hoc work through GSD's shared fast-path substrate.

This workflow powers both:
- `quick` mode — the lightest ad-hoc path
- `focus` mode — the recommended bounded small-feature path

Both modes use `.planning/quick/`, update STATE.md, and keep work out of ROADMAP.md.

Flags:
- `--discuss` adds lightweight clarification before planning
- `--research` spawns a focused research agent before planning
- `--full` forces plan-checking and verification
- `--mode quick|focus` selects the public wrapper; `quick` is the default

Flags are composable: `--discuss --research --full` gives discussion + research + plan-checking + verification.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>
**Step 1: Parse arguments and get task description**

Parse `$ARGUMENTS` for:
- `--mode quick|focus` → store as `$WORKFLOW_MODE` (default `quick`)
- `--full` flag → store as `$FULL_MODE`
- `--discuss` flag → store as `$DISCUSS_MODE`
- `--research` flag → store as `$RESEARCH_MODE`
- Remaining text → use as `$DESCRIPTION`

If `$DESCRIPTION` is empty after parsing, prompt interactively:

```
AskUserQuestion(
  header: "${WORKFLOW_MODE === 'focus' ? 'Focus Task' : 'Quick Task'}",
  question: "What do you want to do?",
  followUp: null
)
```

If still empty, re-prompt: "Please provide a task description."

Determine mode defaults:
- `quick` default: no classifier-driven escalation
- `focus` default: classifier-driven escalation and mandatory self-review

**Focus-mode task classifier**

Only when `$WORKFLOW_MODE === "focus"`, classify the task before planning:
- `tiny` — obvious, low-risk, single-slice tweak
- `small-feature` — bounded feature/fix with clear acceptance criteria
- `risky` — behaviorally risky, security-sensitive, or user-facing
- `unknown-domain` — unfamiliar dependency, API, or domain knowledge
- `multi-slice` — too broad for one atomic change set

Set workflow behavior from the classifier:

| Class | Research | Plan-check | Verify | Notes |
|------|----------|------------|--------|-------|
| `tiny` | off | off | off unless `--full` | still require self-review |
| `small-feature` | off | off | on | default focus path |
| `risky` | off | on | on | use stricter plan and checks |
| `unknown-domain` | on | off unless `--full` | on | plan should explicitly note research unknowns |
| `multi-slice` | off | on | on | planner must split or refuse oversized scope |

Then apply overrides:
- `--full` forces plan-check + verify on
- `--research` forces research on (in either mode)
- `--discuss` still behaves the same in either mode

Display a banner reflecting the selected mode:

If `$WORKFLOW_MODE === "focus"`:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► FOCUS MODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Workflow: spec -> implement -> self-review${VERIFY_ENABLED ? ' -> verify' : ''}
◆ Classifier: ${TASK_CLASS}
```

If `$WORKFLOW_MODE === "quick"`:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► QUICK TASK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Minimal fast path for ad-hoc work${RESEARCH_MODE ? ' (+ research)' : ''}${FULL_MODE ? ' (+ full)' : ''}${DISCUSS_MODE ? ' (+ discuss)' : ''}
```

---

**Step 2: Initialize**

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init quick "$DESCRIPTION")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for: `planner_model`, `executor_model`, `checker_model`, `verifier_model`, `commit_docs`, `branch_name`, `codex_supervisor_enabled`, `quick_id`, `slug`, `date`, `timestamp`, `quick_dir`, `task_dir`, `roadmap_exists`, `planning_exists`.

If `roadmap_exists` is false: error — fast-path tasks require an active project with ROADMAP.md. Run `/gsd:new-project` first.

---

**Step 2.5: Handle quick-task branching**

**If `branch_name` is empty/null:** Skip and continue on the current branch.

**If `branch_name` is set:** Check out the quick-task branch before any planning commits:

```bash
git checkout -b "$branch_name" 2>/dev/null || git checkout "$branch_name"
```

All quick-task commits for this run stay on that branch. User handles merge/rebase afterward.

---

**Step 3: Create task directory**

```bash
mkdir -p "${task_dir}"
```

Create and store:
```bash
QUICK_DIR=".planning/quick/${quick_id}-${slug}"
mkdir -p "$QUICK_DIR"
RUN_MANIFEST="$QUICK_DIR/RUN_MANIFEST.json"
```

Report:
```
Creating ${WORKFLOW_MODE} task ${quick_id}: ${DESCRIPTION}
Directory: ${QUICK_DIR}
```

Write the initial run manifest:
```bash
QUICK_DIR="$QUICK_DIR" RUN_MANIFEST="$RUN_MANIFEST" QUICK_ID="$quick_id" WORKFLOW_MODE="$WORKFLOW_MODE" TASK_CLASS="${WORKFLOW_MODE === 'focus' ? TASK_CLASS : 'quick'}" DESCRIPTION="$DESCRIPTION" CONTEXT_PATH="" PLAN_PATH="" SUMMARY_PATH="" STACK_STATE_PATH="" SUPERVISOR_ENABLED="${codex_supervisor_enabled}" node <<'NODE'
const fs = require('fs');
const path = require('path');
const manifest = {
  run_id: process.env.QUICK_ID,
  mode: process.env.WORKFLOW_MODE,
  classifier: process.env.TASK_CLASS,
  description: process.env.DESCRIPTION,
  quick_dir: process.env.QUICK_DIR,
  context_path: process.env.CONTEXT_PATH || null,
  plan_path: process.env.PLAN_PATH || null,
  summary_path: process.env.SUMMARY_PATH || null,
  stack_state_path: process.env.STACK_STATE_PATH || null,
  planner_status: 'pending',
  execution_status: 'pending',
  verification_status: 'pending',
  supervisor_pre_status: process.env.SUPERVISOR_ENABLED === 'true' ? 'pending' : 'disabled',
  supervisor_post_status: process.env.SUPERVISOR_ENABLED === 'true' ? 'pending' : 'disabled',
  final_status: 'planning',
};
fs.writeFileSync(process.env.RUN_MANIFEST, JSON.stringify(manifest, null, 2));
NODE
```

---

**Step 4: Discussion phase (only when `$DISCUSS_MODE`)**

If enabled, run the existing quick discussion flow:
- identify 2-4 concrete gray areas
- ask focused questions only where the choice changes the implementation
- write `${QUICK_DIR}/${quick_id}-CONTEXT.md`

Keep it lean. This file should capture locked decisions, examples, and references only.

After writing CONTEXT.md, update `RUN_MANIFEST.json` `context_path`.

---

**Step 4.75: Research phase (only when `$RESEARCH_MODE`)**

Skip this step entirely if NOT `$RESEARCH_MODE`.

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► RESEARCHING ${WORKFLOW_MODE === 'focus' ? 'FOCUS' : 'QUICK'} TASK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Investigating approaches for: ${DESCRIPTION}
```

Spawn a single focused researcher (not 4 parallel researchers like full phases — quick tasks need targeted research, not broad domain surveys):

```
Task(
  prompt="
<research_context>

**Mode:** ${WORKFLOW_MODE}
**Task:** ${DESCRIPTION}
**Output:** ${QUICK_DIR}/${quick_id}-RESEARCH.md

<files_to_read>
- .planning/STATE.md (Project state — what's already built)
- .planning/PROJECT.md (Project context)
- ./CLAUDE.md (if exists — project-specific guidelines)
${DISCUSS_MODE ? '- ' + QUICK_DIR + '/' + quick_id + '-CONTEXT.md (User decisions — research should align with these)' : ''}
</files_to_read>

</research_context>

<focus>
This is a ${WORKFLOW_MODE} task, not a full phase. Research should be concise and targeted:
1. Best libraries/patterns for this specific task
2. Common pitfalls and how to avoid them
3. Integration points with existing codebase
4. Any constraints or gotchas worth knowing before planning

Do NOT produce a full domain survey. Target 1-2 pages of actionable findings.
</focus>

<output>
Write research to: ${QUICK_DIR}/${quick_id}-RESEARCH.md
Use standard research format but keep it lean — skip sections that don't apply.
Return: ## RESEARCH COMPLETE with file path
</output>
",
  subagent_type="gsd-phase-researcher",
  model="{planner_model}",
  description="Research: ${DESCRIPTION}"
)
```

After researcher returns:
1. Verify research exists at `${QUICK_DIR}/${quick_id}-RESEARCH.md`
2. Report: "Research complete: ${QUICK_DIR}/${quick_id}-RESEARCH.md"

If research file not found, warn but continue: "Research agent did not produce output — proceeding to planning without research."

---

**Step 5: Plan the work**

Spawn `gsd-planner` with a single-plan requirement.

Planner prompt must include:

```markdown
<planning_context>
**Mode:** ${WORKFLOW_MODE}
**Planning flavor:** ${PLAN_CHECK_ENABLED ? WORKFLOW_MODE + '-checked' : WORKFLOW_MODE}
**Task Description:** ${DESCRIPTION}
**Classifier:** ${WORKFLOW_MODE === 'focus' ? TASK_CLASS : 'quick'}
**Directory:** ${QUICK_DIR}
**Self-review required:** ${WORKFLOW_MODE === 'focus' ? 'true' : 'false'}

<files_to_read>
- .planning/STATE.md
- ./CLAUDE.md (if exists)
${DISCUSS_MODE ? '- ' + QUICK_DIR + '/' + quick_id + '-CONTEXT.md' : ''}
${RESEARCH_MODE ? '- ' + QUICK_DIR + '/' + quick_id + '-RESEARCH.md (Research findings — use to inform implementation choices)' : ''}
</files_to_read>
</planning_context>

<constraints>
- Create a SINGLE plan with 1-3 focused tasks
- Keep the artifact lean and execution-oriented
- Include exact touched files
- Include explicit constraints
- Include explicit do-not-touch guidance
- Include review guidance before completion
- Prefer minimal diffs and reversible changes
- Do not redesign unrelated parts
${RESEARCH_MODE ? '- Research findings are available — use them to inform library/pattern choices' : ''}
${WORKFLOW_MODE === 'focus' ? '- Write the plan for: spec -> implement -> self-review' : ''}
${WORKFLOW_MODE === 'focus' && TASK_CLASS === 'multi-slice' ? '- If the work is too broad, split it into smaller slices or explicitly refuse oversized scope' : ''}
${WORKFLOW_MODE === 'focus' && TASK_CLASS === 'unknown-domain' ? '- Call out the unknown external dependency/API and constrain the plan around verified usage only' : ''}
${VERIFY_ENABLED ? '- Generate must_haves in frontmatter (truths, artifacts, key_links)' : ''}
</constraints>

<output>
Write plan to: ${QUICK_DIR}/${quick_id}-PLAN.md
Return: ## PLANNING COMPLETE with plan path and a one-line scope summary
</output>
```

After planner returns:
- verify `${QUICK_DIR}/${quick_id}-PLAN.md` exists
- report the plan path

Update `RUN_MANIFEST.json`:
- `plan_path` → `${QUICK_DIR}/${quick_id}-PLAN.md`
- `planner_status` → `planned`
- `final_status` → `planned`

---

**Step 5.5: Plan-check loop (when enabled)**

Run this step when:
- `--full` is set, or
- `focus` mode classified the task as `risky` or `multi-slice`

Spawn `gsd-plan-checker` with quick/focus context:

```markdown
<verification_context>
**Mode:** ${WORKFLOW_MODE}
**Task Description:** ${DESCRIPTION}
**Classifier:** ${WORKFLOW_MODE === 'focus' ? TASK_CLASS : 'quick'}

<files_to_read>
- ${QUICK_DIR}/${quick_id}-PLAN.md
${DISCUSS_MODE ? '- ' + QUICK_DIR + '/' + quick_id + '-CONTEXT.md' : ''}
</files_to_read>

**Scope:** This is a quick/focus task, not a full roadmap phase. Verify against the task goal and bounded scope, not roadmap-phase delivery.
</verification_context>

<check_dimensions>
- Requirement coverage against the task description
- Task completeness: files, action, verify, done
- Scope sanity: still a single bounded change set
- Constraints + do-not-touch completeness
- Review guidance present
- must_haves derivation when verification is enabled
${DISCUSS_MODE ? '- Context compliance against CONTEXT.md' : ''}
${WORKFLOW_MODE === 'focus' ? '- Classifier sanity: does the plan match the selected task class?' : ''}
</check_dimensions>
```

If issues are found:
- revise with `gsd-planner`
- cap the loop at 2 iterations
- if unresolved after 2 rounds, ask whether to force proceed or abort

If the plan-check loop passes, update `RUN_MANIFEST.json` `planner_status` to `checked`.

---

**Step 5.75: Codex supervisor preflight (only when `codex_supervisor_enabled`)**

Run this step only when the init JSON indicates `codex_supervisor_enabled: true`.

Build the preflight bundle:
```bash
PRE_BUNDLE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" supervisor-bundle "$QUICK_DIR" --stage pre --raw)
```

Invoke the Codex-only supervisor skill:
```text
Skill(skill="gsd:supervisor", args="--bundle ${PRE_BUNDLE} --stage pre")
```

After it returns:
- verify `${QUICK_DIR}/SUPERVISOR-FINDINGS.json` exists
- read normalized findings:
```bash
SUPERVISOR_PRE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" supervisor-findings "${QUICK_DIR}/SUPERVISOR-FINDINGS.json")
if [[ "$SUPERVISOR_PRE" == @file:* ]]; then SUPERVISOR_PRE=$(cat "${SUPERVISOR_PRE#@file:}"); fi
SUPERVISOR_PRE_STATUS=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" supervisor-findings "${QUICK_DIR}/SUPERVISOR-FINDINGS.json" --raw)
```
- update `RUN_MANIFEST.json` `supervisor_pre_status`

Gate behavior:
- `blocked` → stop before execution, present the supervisor findings, keep `final_status` as `blocked`
- `warnings` → continue and record warnings in the manifest
- `passed` → continue normally

---

**Step 6: Execute**

Spawn `gsd-executor` with plan reference and explicit focus metadata:

```markdown
Execute ${WORKFLOW_MODE} task ${quick_id}.

<files_to_read>
- ${QUICK_DIR}/${quick_id}-PLAN.md
- .planning/STATE.md
- ./CLAUDE.md (if exists)
- .claude/skills/ or .agents/skills/ (if either exists)
</files_to_read>

<execution_contract>
Mode: ${WORKFLOW_MODE}
Task description: ${DESCRIPTION}
Classifier: ${WORKFLOW_MODE === 'focus' ? TASK_CLASS : 'quick'}
Self-review required: ${WORKFLOW_MODE === 'focus' ? 'true' : 'false'}
Required output shape:
GOAL
CONSTRAINTS
PLAN
PATCH
SELF-REVIEW
FIXES APPLIED
VERIFY
</execution_contract>

<constraints>
- Execute all tasks in the plan
- Commit each task atomically
- Create summary at: ${QUICK_DIR}/${quick_id}-SUMMARY.md
- Do NOT update ROADMAP.md
- Keep diffs minimal and bounded
</constraints>
```

After executor returns:
- verify `${QUICK_DIR}/${quick_id}-SUMMARY.md` exists
- extract commit hash from output when available
- treat the known Claude runtime `classifyHandoffIfNeeded is not defined` bug as non-fatal if summary and commits exist

Update `RUN_MANIFEST.json`:
- `summary_path` → `${QUICK_DIR}/${quick_id}-SUMMARY.md`
- `execution_status` → `completed`
- `final_status` → `executed`

---

**Step 6.5: Verify (when enabled)**

Run this step when:
- `--full` is set, or
- `focus` mode classified the task as anything except `tiny`

Spawn `gsd-verifier`:

```markdown
Verify ${WORKFLOW_MODE} task goal achievement.
Task directory: ${QUICK_DIR}
Task goal: ${DESCRIPTION}
Classifier: ${WORKFLOW_MODE === 'focus' ? TASK_CLASS : 'quick'}

<files_to_read>
- ${QUICK_DIR}/${quick_id}-PLAN.md
</files_to_read>

Check must_haves against the actual codebase. This is a quick/focus task, not a roadmap phase. Create VERIFICATION.md at ${QUICK_DIR}/${quick_id}-VERIFICATION.md.
```

Read verification status:
```bash
grep "^status:" "${QUICK_DIR}/${quick_id}-VERIFICATION.md" | cut -d: -f2 | tr -d ' '
```

Map statuses:
- `passed` -> `Verified`
- `human_needed` -> `Needs Review`
- `gaps_found` -> `Gaps`

If gaps are found, offer:
- re-run executor to close them
- accept as-is

Update `RUN_MANIFEST.json` `verification_status` to the mapped verification status.

---

**Step 6.75: Codex supervisor postflight (only when `codex_supervisor_enabled`)**

Run this step only when the init JSON indicates `codex_supervisor_enabled: true`.

Build the postflight bundle:
```bash
POST_BUNDLE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" supervisor-bundle "$QUICK_DIR" --stage post --raw)
```

Invoke the Codex-only supervisor skill:
```text
Skill(skill="gsd:supervisor", args="--bundle ${POST_BUNDLE} --stage post")
```

After it returns:
- verify `${QUICK_DIR}/SUPERVISOR-FINDINGS.json` exists
- read normalized findings:
```bash
SUPERVISOR_POST=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" supervisor-findings "${QUICK_DIR}/SUPERVISOR-FINDINGS.json")
if [[ "$SUPERVISOR_POST" == @file:* ]]; then SUPERVISOR_POST=$(cat "${SUPERVISOR_POST#@file:}"); fi
SUPERVISOR_POST_STATUS=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" supervisor-findings "${QUICK_DIR}/SUPERVISOR-FINDINGS.json" --raw)
```
- update `RUN_MANIFEST.json` `supervisor_post_status`

Gate behavior:
- `blocked` → stop before final success reporting, keep `final_status` as `blocked`
- `warnings` → continue and record warnings in the manifest
- `passed` → continue normally

---

**Step 7: Update STATE.md**

Update the `### Quick Tasks Completed` table in STATE.md.

If verification ran, use the Status column. Otherwise keep the existing lighter table shape unless the table already has Status.

Use:
```markdown
| ${quick_id} | ${DESCRIPTION} | ${date} | ${commit_hash} | ${VERIFICATION_STATUS} | [${quick_id}-${slug}](./quick/${quick_id}-${slug}/) |
```

or, without status:

```markdown
| ${quick_id} | ${DESCRIPTION} | ${date} | ${commit_hash} | [${quick_id}-${slug}](./quick/${quick_id}-${slug}/) |
```

Update the `Last activity` line:
```text
Last activity: ${date} - Completed ${WORKFLOW_MODE} task ${quick_id}: ${DESCRIPTION}
```

---

**Step 8: Final commit and completion**

Stage and commit:
- `${QUICK_DIR}/${quick_id}-PLAN.md`
- `${QUICK_DIR}/RUN_MANIFEST.json`
- `${QUICK_DIR}/${quick_id}-SUMMARY.md`
- `.planning/STATE.md`
- `${QUICK_DIR}/${quick_id}-CONTEXT.md` when discussion ran
- `${QUICK_DIR}/${quick_id}-RESEARCH.md` when research ran
- `${QUICK_DIR}/${quick_id}-VERIFICATION.md` when verification ran
- `${QUICK_DIR}/SUPERVISOR-PRE.json` when supervisor preflight ran
- `${QUICK_DIR}/SUPERVISOR-POST.json` when supervisor postflight ran
- `${QUICK_DIR}/SUPERVISOR-FINDINGS.json` when supervisor ran
- `${QUICK_DIR}/SUPERVISOR-REPORT.md` when supervisor ran

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" commit "docs(quick-${quick_id}): ${DESCRIPTION}" --files ${file_list}
```

Get final hash:
```bash
commit_hash=$(git rev-parse --short HEAD)
```

Completion output:

```text
GSD > ${WORKFLOW_MODE === 'focus' ? 'FOCUS MODE COMPLETE' : 'QUICK TASK COMPLETE'}${VERIFY_ENABLED ? ' (VERIFIED PATH)' : ''}

Task ${quick_id}: ${DESCRIPTION}
${RESEARCH_MODE ? 'Research: ' + QUICK_DIR + '/' + quick_id + '-RESEARCH.md' : ''}
Summary: ${QUICK_DIR}/${quick_id}-SUMMARY.md
${VERIFY_ENABLED ? 'Verification: ' + QUICK_DIR + '/' + quick_id + '-VERIFICATION.md (' + VERIFICATION_STATUS + ')' : ''}
Commit: ${commit_hash}

Ready for next task: ${WORKFLOW_MODE === 'focus' ? '/gsd:focus' : '/gsd:quick'}
```

</process>

<success_criteria>
- [ ] ROADMAP.md validation passes
- [ ] `--mode`, `--full`, `--discuss`, and `--research` flags parsed from arguments when present
- [ ] Focus mode classifies the task before planning
- [ ] Slug generated (lowercase, hyphens, max 40 chars)
- [ ] Quick ID generated (YYMMDD-xxx format, 2s Base36 precision)
- [ ] Directory created at `.planning/quick/YYMMDD-xxx-slug/`
- [ ] (--discuss) Decisions captured in `${quick_id}-CONTEXT.md`
- [ ] (--research) Research agent spawned, `${quick_id}-RESEARCH.md` created
- [ ] `${quick_id}-PLAN.md` created by planner (honors CONTEXT.md when --discuss, uses RESEARCH.md when --research)
- [ ] Focus mode requires a bounded single-plan artifact with review guidance
- [ ] Plan checker runs when forced or escalated by classifier
- [ ] `RUN_MANIFEST.json` is created and updated through the task lifecycle
- [ ] Codex supervisor preflight writes `SUPERVISOR-PRE.json` and findings when enabled
- [ ] `${quick_id}-SUMMARY.md` created by executor
- [ ] Focus mode requires a self-review pass before completion
- [ ] Verification runs when forced or enabled by classifier
- [ ] Codex supervisor postflight writes `SUPERVISOR-POST.json` and findings when enabled
- [ ] STATE.md updated with the quick task row
- [ ] Artifacts committed
</success_criteria>
