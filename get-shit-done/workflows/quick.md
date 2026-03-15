<purpose>
Execute small, ad-hoc work through GSD's shared fast-path substrate.

This workflow powers both:
- `quick` mode — the lightest ad-hoc path
- `focus` mode — the recommended bounded small-feature path

Both modes use `.planning/quick/`, update STATE.md, and keep work out of ROADMAP.md.

Flags:
- `--discuss` adds lightweight clarification before planning
- `--full` forces plan-checking and verification
- `--mode quick|focus` selects the public wrapper; `quick` is the default
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

◆ Minimal fast path for ad-hoc work
```

---

**Step 2: Initialize**

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init quick "$DESCRIPTION")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for: `planner_model`, `executor_model`, `checker_model`, `verifier_model`, `commit_docs`, `quick_id`, `slug`, `date`, `timestamp`, `quick_dir`, `task_dir`, `roadmap_exists`, `planning_exists`.

If `roadmap_exists` is false: error — fast-path tasks require an active project with ROADMAP.md. Run `/gsd:new-project` first.

---

**Step 3: Create task directory**

```bash
mkdir -p "${task_dir}"
```

Create and store:
```bash
QUICK_DIR=".planning/quick/${quick_id}-${slug}"
mkdir -p "$QUICK_DIR"
```

Report:
```
Creating ${WORKFLOW_MODE} task ${quick_id}: ${DESCRIPTION}
Directory: ${QUICK_DIR}
```

---

**Step 4: Discussion phase (only when `$DISCUSS_MODE`)**

If enabled, run the existing quick discussion flow:
- identify 2-4 concrete gray areas
- ask focused questions only where the choice changes the implementation
- write `${QUICK_DIR}/${quick_id}-CONTEXT.md`

Keep it lean. This file should capture locked decisions, examples, and references only.

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
- `${QUICK_DIR}/${quick_id}-SUMMARY.md`
- `.planning/STATE.md`
- `${QUICK_DIR}/${quick_id}-CONTEXT.md` when discussion ran
- `${QUICK_DIR}/${quick_id}-VERIFICATION.md` when verification ran

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
Summary: ${QUICK_DIR}/${quick_id}-SUMMARY.md
${VERIFY_ENABLED ? 'Verification: ' + QUICK_DIR + '/' + quick_id + '-VERIFICATION.md (' + VERIFICATION_STATUS + ')' : ''}
Commit: ${commit_hash}

Ready for next task: ${WORKFLOW_MODE === 'focus' ? '/gsd:focus' : '/gsd:quick'}
```

</process>

<success_criteria>
- [ ] ROADMAP.md validation passes
- [ ] `--mode`, `--full`, and `--discuss` are parsed when present
- [ ] Focus mode classifies the task before planning
- [ ] Slug generated (lowercase, hyphens, max 40 chars)
- [ ] Quick ID generated (YYMMDD-xxx format, 2s Base36 precision)
- [ ] Directory created at `.planning/quick/YYMMDD-xxx-slug/`
- [ ] (--discuss) Decisions captured in `${quick_id}-CONTEXT.md`
- [ ] `${quick_id}-PLAN.md` created by planner
- [ ] Focus mode requires a bounded single-plan artifact with review guidance
- [ ] Plan checker runs when forced or escalated by classifier
- [ ] `${quick_id}-SUMMARY.md` created by executor
- [ ] Focus mode requires a self-review pass before completion
- [ ] Verification runs when forced or enabled by classifier
- [ ] STATE.md updated with the quick task row
- [ ] Artifacts committed
</success_criteria>
