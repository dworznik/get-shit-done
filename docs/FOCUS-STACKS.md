# Focus Stacks

Focus stacks deliver a list of bounded focus-mode slices as stacked pull requests.

Use this when:
- each change is still small enough for focus mode
- you want one reviewable PR per slice
- later slices depend on earlier slices
- you do not want to manually manage rebases after lower-slice fixes

## Command

```text
/gsd:focus-stack [--base <branch>] [--resume <stack-id>] [--restack-only <stack-id>] [--full] [--discuss] [@file|pasted list]
```

## Core Contract

Each slice still follows normal focus mode:

```text
spec -> implement -> self-review -> verify
```

The stack layer adds:
- one branch per slice
- one commit per slice
- one PR per slice
- automatic descendant restacking during explicit stack resume/restack runs

## Artifacts

Stack state lives in:

- `.planning/focus-stacks/<stack-id>/state.json`
- `.planning/focus-stacks/<stack-id>/STACK.md`

Slice execution artifacts stay in the existing quick-task area:

- `.planning/quick/<quick-id>-<slug>/PLAN.md`
- `.planning/quick/<quick-id>-<slug>/SUMMARY.md`
- optional `VERIFICATION.md`

## Debugging Inside A Stack

Debugging is slice-local.

If slice `2/5` fails:
- the stack stops on slice 2
- slices 3-5 are marked `blocked-by-ancestor`
- you debug and fix slice 2 on its own branch
- you do not patch the top branch directly

Recovery commands:

```text
/gsd:focus-stack --resume <stack-id>
/gsd:focus-stack --restack-only <stack-id>
```

`--resume` restacks descendants if needed, then continues execution.
`--restack-only` updates descendant branches and PRs without continuing new work.

## Restacking

Restacking is automatic during explicit stack operations, not in the background.

When a lower slice branch changes:
1. GSD detects the new `HEAD` SHA for that slice
2. Every descendant branch rebases in order onto its updated parent
3. Successful descendants are force-pushed with lease
4. Existing PRs stay open and update automatically because their source branches moved
5. Already-complete descendants rerun verification before the stack continues

If any descendant hits a conflict:
- restacking stops immediately
- that slice becomes `restack-conflict`
- higher slices stay blocked
- `STACK.md` records where manual conflict resolution is required

## Branches And PRs

- Slice 1 branches from the chosen base branch
- Slice `n` branches from slice `n-1`
- Default branch naming follows the existing `feature/` convention
- PR titles use stack position, for example `[2/4] Add JSON progress output`

Each PR body should include:
- stack ID
- parent PR link
- slice summary
- acceptance criteria
- note that descendant PRs are auto-restacked by GSD

## Input Shape

Pass either:
- a pasted Markdown bullet/numbered list
- `@path/to/file.md`

Each item should already be a bounded focus-style slice. If an item is still too large, the planner must split it or stop.
