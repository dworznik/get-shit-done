<purpose>
Deliver a list of narrow focus-mode changes as a managed stacked PR chain.

This workflow is a thin orchestrator over the existing focus/quick substrate.
Each slice still uses the normal focus execution contract. The stack layer adds:
- stack manifest creation
- branch and PR orchestration
- pause-on-failure behavior
- automatic descendant restacking during explicit resume/restack commands
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>
**Step 1: Parse arguments**

Parse `$ARGUMENTS` for:
- `--base <branch>` -> `$BASE_BRANCH`
- `--resume <stack-id>` -> `$RESUME_STACK_ID`
- `--restack-only <stack-id>` -> `$RESTACK_ONLY_STACK_ID`
- `--full` -> `$FULL_MODE`
- `--discuss` -> `$DISCUSS_MODE`
- Remaining text -> `$STACK_INPUT`

Rules:
- `--resume` and `--restack-only` are mutually exclusive
- `--base` is only valid when creating a new stack
- set `$TARGET_STACK_ID` to `$RESTACK_ONLY_STACK_ID` or `$RESUME_STACK_ID` when either is provided
- when creating a new stack, accept either:
  - pasted Markdown bullets / numbered list
  - a single `@file.md` reference
- if the stack input is empty in creation mode, ask for a Markdown list of slices

Display a banner:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► FOCUS STACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Workflow: slice -> focus execute -> PR -> restack descendants as needed
◆ Mode: ${RESTACK_ONLY_STACK_ID ? 'restack-only' : RESUME_STACK_ID ? 'resume' : 'create'}
```

---

**Step 2: Initialize**

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init focus-stack "$STACK_INPUT")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for:
- `planner_model`, `executor_model`, `checker_model`, `verifier_model`, `debugger_model`
- `commit_docs`
- `stack_id`, `stack_slug`, `description`
- `branch_prefix`, `current_branch`, `git_available`, `git_status_clean`
- `gh_available`, `gh_authenticated`
- `focus_stack_dir`, `stack_dir`, `state_path`, `stack_doc_path`
- `roadmap_exists`, `planning_exists`

Hard requirements:
- active project with `.planning/ROADMAP.md`
- git repository available
- clean worktree before create/resume/restack
- `gh` installed and authenticated

If any requirement fails, stop with the exact blocker and the command needed to fix it.

---

**Step 3: Load or create stack state**

Stack state lives in:
- `${stack_dir}/state.json` (machine-readable)
- `${stack_dir}/STACK.md` (human-readable)

If `$RESUME_STACK_ID` or `$RESTACK_ONLY_STACK_ID` is set:
- locate `.planning/focus-stacks/${TARGET_STACK_ID}*`
- load `state.json`
- validate that the recorded branches still exist locally or on origin
- validate that slice `quick_dir` entries still exist

If creating a new stack:
- create `${stack_dir}`
- normalize the input into `slices[]`
- preserve original order
- require each item to represent one bounded focus slice

Normalized slice shape:

```json
{
  "index": 1,
  "title": "Add --json flag to /gsd:progress",
  "spec": "full normalized focus spec",
  "status": "pending",
  "classification": "small-feature",
  "quick_dir": null,
  "branch": null,
  "parent_branch": null,
  "pr_number": null,
  "pr_url": null,
  "head_sha": null,
  "last_restacked_sha": null,
  "last_verified_sha": null,
  "blocker": null
}
```

Write an initial `STACK.md` with:
- stack goal
- base branch
- slice order
- current status table
- recovery commands (`--resume`, `--restack-only`)

---

**Step 4: Build the stack manifest**

For new stacks, spawn `gsd-planner` once to normalize the list into stackable slices.

Planner contract:
- do not merge unrelated items
- one slice becomes one PR
- split only when an item is obviously too large
- if an item still cannot fit a bounded focus slice, refuse and explain why
- produce ordered slices with:
  - title
  - normalized spec
  - expected touched files
  - classification (`tiny`, `small-feature`, `risky`, `unknown-domain`, `multi-slice`)
  - acceptance criteria
  - dependency note when slice `n` relies on `n-1`

Write planner output to `${stack_dir}/STACK.md` and `state.json`.

If any slice remains `multi-slice` after normalization, stop and ask the user to split it before continuing.

---

**Step 5: Restack changed descendants before continuing**

This step runs for `--resume` and `--restack-only`.

Because each slice branch is squashed to a single commit (Step 6 sub-step 5),
restacking is a simple single-commit rebase with minimal conflict surface.

Detect changed completed slices:
- for each completed slice, compare the current branch `HEAD` SHA to `head_sha` in `state.json`
- if unchanged, do nothing
- if changed, mark all descendants `needs_restack`

For each descendant in order:
1. Checkout the descendant branch
   ```bash
   git checkout "${descendant_branch}"
   ```
2. Rebase the single slice commit onto the updated parent
   ```bash
   git rebase "${parent_branch}"
   ```
   With single-commit branches (enforced by the Step 6 squash), this replays
   exactly one commit, minimizing conflict surface.
3. If rebase succeeds:
   - ```bash
     git push --force-with-lease
     ```
   - update `last_restacked_sha` and `head_sha`
   - if slice status is `complete`, rerun verification before proceeding
4. If rebase conflicts:
   - `git rebase --abort`
   - stop immediately
   - mark the slice `restack-conflict`
   - mark higher descendants `blocked-by-ancestor`
   - write conflict details to `STACK.md`
   - do not continue upward

PR update rules after successful restack:
- keep the same PR number
- refresh PR body summary if parent branch or parent PR link changed
- note the new parent SHA and restack timestamp

If `--restack-only` was requested:
- stop after this step
- print the resulting stack status and next action

---

**Step 6: Execute pending or blocked slices**

Find the first slice with status:
- `pending`
- `blocked`
- `blocked-by-ancestor` after a now-resolved lower slice

Process slices strictly in order. For each slice:

1. Determine branch names
   - slice 1 parent: `$BASE_BRANCH` or recorded base branch
   - slice `n` parent: branch from slice `n-1`
   - `NN` = zero-padded slice index (`01`, `02`, ...)
   - `slice-slug` = normalized slug from the slice title
   - branch name: `${branch_prefix}${stack_slug || 'focus-stack'}-${NN}-${slice-slug}`

2. Create or reuse branch
   - `git checkout <parent>`
   - `git checkout -b <branch>` if new, otherwise `git checkout <branch>`

3. Create a per-slice quick task directory
   - use the existing quick/focus substrate under `.planning/quick/`
   - record the resulting `quick_dir` back into `state.json`

4. Execute the slice through focus-mode rules
   - use the slice spec as the task description
   - require `spec -> implement -> self-review`
   - require verification except for `tiny` slices unless `--full` forces it on
   - risky and oversized slices must trigger plan-checking

5. Squash slice commits into a single commit
   - the parent branch point is the parent slice branch (or `$BASE_BRANCH` for slice 1)
   - collapse all commits while keeping changes staged:
     ```bash
     git reset --soft "${PARENT_BRANCH}"
     ```
   - create a single conventional commit:
     ```bash
     git commit -m "feat(stack-${stack_slug}): [${index}/${total}] ${slice.title}"
     ```
   - verify: `git log --oneline ${PARENT_BRANCH}..HEAD` must show exactly 1 commit

6. Open or update PR
   - create PR with `gh pr create`
   - target base branch for slice 1, parent slice branch for others
   - PR title format: `[${index}/${total}] ${slice.title}`
   - PR body must include:
     - stack ID
     - parent PR link when applicable
     - normalized spec summary
     - acceptance criteria
     - note that descendants are auto-restacked by GSD

7. Record success
   - update `status` to `complete`
   - store `head_sha`, `last_verified_sha`, `pr_number`, `pr_url`
   - refresh `STACK.md`

Failure rules:
- if planning/execution/verification fails on slice `n`, mark slice `failed`
- mark all higher slices `blocked-by-ancestor`
- write the recovery instruction:
  - debug and fix on this slice branch
  - then run `/gsd:focus-stack --resume ${stack_id}` or `/gsd:focus-stack --restack-only ${stack_id}`
- stop immediately; do not continue higher slices

---

**Step 7: Stack-aware debug handoff**

When a slice fails and debugging is needed:
- tell the user to debug on the failing slice branch, not the top stack branch
- point to the slice quick artifact directory and stack state paths
- include:
  - stack ID
  - slice index/title
  - branch
  - parent branch
  - PR URL

Debug recovery contract:
- `/gsd:debug` investigates the failing slice in place
- any fix lands on that same slice branch
- `/gsd:focus-stack --resume ${stack_id}` restacks descendants and resumes work
- `/gsd:focus-stack --restack-only ${stack_id}` only updates descendants/PRs

---

**Step 8: Final reporting**

Always leave both artifacts current:
- `${stack_dir}/state.json`
- `${stack_dir}/STACK.md`

Final summary should state:
- stack ID
- base branch
- completed slice count / total
- any open blockers
- exact next command to run

Success criteria:
- all slices complete
- every slice has its own branch and PR
- descendant PRs are restacked after lower-slice branch changes
- no manual branch management is required for normal recovery
</process>
