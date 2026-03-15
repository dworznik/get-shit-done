# Focus Mode

Focus mode is GSD's slim path for narrow, high-signal delivery work.

It is optimized for solo developers making bounded changes without paying the full milestone/phase ceremony cost.

## Target User

- Solo developer or senior IC working in an existing project
- Narrow feature, bug fix, integration slice, refactor, or tooling change
- Wants precision, minimal diffs, and reliable verification

## Default Workflow

```text
spec -> implement -> self-review -> verify
```

Optional escalation only when the task needs it:

- `discuss` when requirements are ambiguous
- `research` when the domain or dependency is unfamiliar
- `plan-check` when scope or coupling increases risk
- `full verify` when the change is risky or user-facing

## Task Classifier

Every focus task should be classified before planning.

| Class | Meaning | Default route |
|-------|---------|---------------|
| `tiny` | One-file or very small change, low risk, obvious implementation | spec -> implement -> self-review |
| `small-feature` | Small bounded feature or fix with clear acceptance criteria | spec -> implement -> self-review -> verify |
| `risky` | User-facing, security-sensitive, or behaviorally risky change | spec -> plan-check -> implement -> self-review -> verify |
| `unknown-domain` | Touches an unfamiliar API, library, or external dependency | research -> spec -> implement -> self-review -> verify |
| `multi-slice` | Too broad for one atomic change set | split first, then route each slice separately |

## Escalation Rules

- Enable `research` for `unknown-domain`.
- Enable `plan-check` for `risky` or obviously coupled work.
- Enable `verify` for every class except `tiny`, unless `--full` forces it on.
- Refuse oversized plans: split `multi-slice` work rather than letting it drift into a large patch.
- Keep parallel execution off by default for focus mode.

## Artifact Limits

Focus mode should keep active artifacts lean:

- Required: `PLAN.md`, `SUMMARY.md`
- Optional: `CONTEXT.md`, `VERIFICATION.md`
- Avoid phase-style research or roadmap artifacts unless the task is explicitly escalated there

Plans should be short and execution-oriented:

- Single plan only
- 1-3 focused tasks
- Exact touched files
- Clear constraints
- Explicit `do-not-touch` guidance
- Review guidance before completion

## Safety And Rollback

- Prefer minimal, reversible diffs.
- Preserve existing abstractions unless they are the direct problem.
- Do not redesign unrelated code.
- Keep unrelated refactors out of scope.
- Stop and split if the work no longer fits a bounded change set.

## Executor Output Contract

Focus-mode implementation prompts should use this structure:

```text
GOAL
CONSTRAINTS
PLAN
PATCH
SELF-REVIEW
FIXES APPLIED
VERIFY
```

`SELF-REVIEW` is mandatory before the work is considered complete.
