---
name: gsd:debug
description: Systematic debugging with persistent state across context resets
argument-hint: [issue description]
allowed-tools:
  - Read
  - Bash
  - Task
  - AskUserQuestion
---

<objective>
Debug issues using scientific method with subagent isolation.

**Orchestrator role:** Gather symptoms, spawn gsd-debugger agent, handle checkpoints, spawn continuations.

**Why subagent:** Investigation burns context fast (reading files, forming hypotheses, testing). Fresh 200k context per investigation. Main context stays lean for user interaction.
</objective>

<context>
User's issue: $ARGUMENTS

Check for active sessions:
```bash
ls .planning/debug/*.md 2>/dev/null | grep -v resolved | head -5
```

Detect whether the current branch belongs to a managed focus stack:
```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
STACK_CONTEXT=$(CURRENT_BRANCH="$CURRENT_BRANCH" node <<'NODE'
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const branch = process.env.CURRENT_BRANCH;
if (!branch) process.exit(0);

const stackRoot = path.join(cwd, '.planning', 'focus-stacks');
if (!fs.existsSync(stackRoot)) process.exit(0);

for (const entry of fs.readdirSync(stackRoot)) {
  const statePath = path.join(stackRoot, entry, 'state.json');
  if (!fs.existsSync(statePath)) continue;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const slice = (state.slices || []).find(item => item.branch === branch);
    if (!slice) continue;
    process.stdout.write(JSON.stringify({
      stack_id: state.stack_id || entry,
      stack_dir: path.posix.join('.planning', 'focus-stacks', entry),
      slice_index: slice.index,
      slice_title: slice.title,
      branch: slice.branch,
      parent_branch: slice.parent_branch,
      pr_url: slice.pr_url || null,
    }));
    process.exit(0);
  } catch {}
}
NODE
)
```
</context>

<process>

## 0. Initialize Context

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" state load)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Extract `commit_docs` from init JSON. Resolve debugger model:
```bash
debugger_model=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" resolve-model gsd-debugger --raw)
```

If `STACK_CONTEXT` is non-empty:
- display that debugging is happening on a stack-managed slice
- show the slice index/title, branch, parent branch, and PR URL if present
- remind the user that the fix must land on this slice branch, not on the top of the stack

## 1. Check Active Sessions

If active sessions exist AND no $ARGUMENTS:
- List sessions with status, hypothesis, next action
- User picks number to resume OR describes new issue

If $ARGUMENTS provided OR user describes new issue:
- Continue to symptom gathering

## 2. Gather Symptoms (if new issue)

Use AskUserQuestion for each:

1. **Expected behavior** - What should happen?
2. **Actual behavior** - What happens instead?
3. **Error messages** - Any errors? (paste or describe)
4. **Timeline** - When did this start? Ever worked?
5. **Reproduction** - How do you trigger it?

After all gathered, confirm ready to investigate.

## 3. Spawn gsd-debugger Agent

Fill prompt and spawn:

```markdown
<objective>
Investigate issue: {slug}

**Summary:** {trigger}
</objective>

<symptoms>
expected: {expected}
actual: {actual}
errors: {errors}
reproduction: {reproduction}
timeline: {timeline}
</symptoms>

<mode>
symptoms_prefilled: true
goal: find_and_fix
</mode>

<debug_file>
Create: .planning/debug/{slug}.md
</debug_file>

{if stack context exists}
<stack_context>
{STACK_CONTEXT}

Recovery after fix:
- /gsd:focus-stack --resume {stack_id}
- /gsd:focus-stack --restack-only {stack_id}
</stack_context>
{/if}
```

```
Task(
  prompt=filled_prompt,
  subagent_type="gsd-debugger",
  model="{debugger_model}",
  description="Debug {slug}"
)
```

## 4. Handle Agent Return

**If `## ROOT CAUSE FOUND`:**
- Display root cause and evidence summary
- Offer options:
  - "Fix now" - spawn fix subagent
  - "Plan fix" - suggest /gsd:plan-phase --gaps
  - "Manual fix" - done
- If stack context exists:
  - remind the user to make the fix on the current slice branch
  - remind them to run `/gsd:focus-stack --resume {stack_id}` after the fix so descendants restack automatically

**If `## CHECKPOINT REACHED`:**
- Present checkpoint details to user
- Get user response
- If checkpoint type is `human-verify`:
  - If user confirms fixed: continue so agent can finalize/resolve/archive
  - If user reports issues: continue so agent returns to investigation/fixing
- Spawn continuation agent (see step 5)

**If `## INVESTIGATION INCONCLUSIVE`:**
- Show what was checked and eliminated
- Offer options:
  - "Continue investigating" - spawn new agent with additional context
  - "Manual investigation" - done
  - "Add more context" - gather more symptoms, spawn again

## 5. Spawn Continuation Agent (After Checkpoint)

When user responds to checkpoint, spawn fresh agent:

```markdown
<objective>
Continue debugging {slug}. Evidence is in the debug file.
</objective>

<prior_state>
<files_to_read>
- .planning/debug/{slug}.md (Debug session state)
</files_to_read>
</prior_state>

<checkpoint_response>
**Type:** {checkpoint_type}
**Response:** {user_response}
</checkpoint_response>

<mode>
goal: find_and_fix
</mode>

{if stack context exists}
<stack_context>
{STACK_CONTEXT}
</stack_context>
{/if}
```

```
Task(
  prompt=continuation_prompt,
  subagent_type="gsd-debugger",
  model="{debugger_model}",
  description="Continue debug {slug}"
)
```

</process>

<success_criteria>
- [ ] Active sessions checked
- [ ] Symptoms gathered (if new)
- [ ] gsd-debugger spawned with context
- [ ] Checkpoints handled correctly
- [ ] Root cause confirmed before fixing
</success_criteria>
