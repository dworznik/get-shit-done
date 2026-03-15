# GSD Slim-Path Refactor Plan

**Goal:** reshape `gsd-build/get-shit-done` into a faster, more accurate workflow for **small features delivered by a senior engineer mindset**, while preserving GSD's core value: context quality, atomic planning, and reliable execution.

**Primary outcome:** a trimmed workflow that defaults to **small-scope feature delivery**, **tight iteration loops**, **minimal orchestration**, and **higher accuracy per task**.

**Repository target:** `https://github.com/gsd-build/get-shit-done`

---

## 0. Agent brief

You are modifying the original GSD codebase.

Work like a senior engineer optimizing an existing successful product, not inventing a new framework.

Priorities, in order:
1. Preserve the parts that clearly improve accuracy.
2. Remove or hide anything that mainly adds ceremony, token cost, or latency for small-feature work.
3. Make the default path feel like: **spec -> implement -> self-review -> verify**.
4. Prefer reversible changes, feature flags, and incremental rollout.
5. Keep multi-runtime support unless it is clearly in the way of the small-feature mode.

Non-goals:
- Do **not** turn GSD into a swarm/orchestration platform.
- Do **not** add more agent types or more workflow stages.
- Do **not** expand enterprise workflow concepts.
- Do **not** optimize for large multi-phase milestone programs first.

---

## 1. What to preserve from current GSD

Keep these because they appear to be the core differentiators of GSD:

- **Context engineering** and bounded planning artifacts. The repo explicitly positions GSD as solving context rot through structured planning/state files.
- **Atomic task plans**, currently represented as XML task structures in `PLAN.md`.
- **Fresh-context execution via subagents**, but only when it materially improves quality.
- **Quick mode**, because the README already frames it as the path for bug fixes, small features, config changes, and one-off tasks.
- **Atomic commits** and state tracking, because these help recoverability and future agent context.

---

## 2. Product direction: "Senior Small-Feature Mode"

Introduce a new product direction inside GSD:

## Working name
- `senior`
- or `lean`
- or `small-feature`

Use one term consistently. Recommended: **`senior`**.

## Positioning
GSD should feel like:
- a senior engineer's delivery loop
- optimized for narrow, high-signal changes
- defaulting to precision over breadth
- using agents sparingly and intentionally

## Default workflow in this mode

```text
spec -> implement -> self-review -> verify
```

Optional branches:
- `research` only when the task touches unknown APIs/domains
- `discuss` only when requirements are ambiguous
- `full verify` only when the change is risky or user-facing

This mode should be the best path for:
- small feature delivery
- focused refactors
- bug fixes
- API wrappers/integrations
- test additions
- config/tooling changes

---

## 3. Core design changes

### 3.1 Reduce the default workflow surface

Current README emphasizes:
- `new-project`
- `discuss-phase`
- `plan-phase`
- `execute-phase`
- `verify-work`
- milestone management

That is powerful, but too much for the common solo-dev case.

### Target change
Make the **default mental model**:
- `/gsd:quick`
- optionally `/gsd:quick --full`
- optionally a new command like `/gsd:senior`

### Product decision
Either:
1. **evolve `quick` into the flagship mode**, or
2. create **`/gsd:senior`** as a narrow, opinionated version of `quick`

Recommended:
- keep `quick`
- add **`/gsd:senior`** as the opinionated fast path
- later consider making `quick` internally delegate to the same pipeline

---

### 3.2 Replace heavy multi-agent defaults with selective agent use

Current README says workflow agents can include:
- research
- plan_check
- verifier
- auto_advance
- parallel execution

For small features, these should **not** all be on by default.

### Target defaults for `senior` mode

```json
{
  "workflow": {
    "research": false,
    "plan_check": false,
    "verifier": true,
    "auto_advance": false
  },
  "parallelization": {
    "enabled": false
  }
}
```

Then turn them on only when the task qualifies.

### Heuristics
Enable additional steps only when:
- unknown external dependency or API -> enable `research`
- user-facing or high-risk behavior -> enable `verifier`
- multi-file/multi-slice task with nontrivial coupling -> enable `plan_check`
- independent slices proven safe -> allow `parallelization.enabled=true`

---

### 3.3 Add a self-review loop as a first-class primitive

This is the biggest accuracy improvement for small-feature work.

Every implementation task should support:

```text
SPEC
PATCH
SELF-REVIEW
FINAL PATCH
```

### Required behavior
After generating an implementation, the agent must:
1. critique its own patch
2. identify correctness, complexity, error-handling, and style issues
3. apply fixes immediately
4. only then hand off for verification or completion

### Why this matters
Small-feature quality usually fails because the first patch is "close enough" but flawed. A forced self-review loop raises accuracy without needing a full extra orchestration layer.

### Implementation idea
Create or revise the implementation prompt templates so that the execution agent always performs:
- brief spec synthesis
- minimal patch
- explicit review checklist
- one correction pass

---

### 3.4 Force single-step execution by default

A common failure mode is that the agent changes too much at once.

### Rule
Default to:
- one atomic step
- one bounded change set
- one verifiable outcome

### Prompt policy
Each execution task should explicitly include:
- exact goal
- constraints
- touched files
- acceptance criteria
- what not to change

If the requested change is too large, the system should split it before implementation.

---

### 3.5 Tighten plan shape for LLM execution

Current XML planning is directionally good. Keep the concept, but trim the payload.

### New plan schema target
For small features, optimize plans around these fields:

```xml
<task type="small-feature">
  <name>Add dark mode toggle</name>
  <goal>User can enable and persist dark mode</goal>
  <files>src/settings.tsx, src/theme.ts</files>
  <constraints>
    No unrelated refactors.
    Preserve existing theme API.
    Add tests if theme persistence path exists.
  </constraints>
  <steps>
    Add toggle UI.
    Persist preference.
    Load preference at startup.
  </steps>
  <verify>
    Settings page toggles theme.
    Preference survives reload.
    Existing theme tests still pass.
  </verify>
  <review>
    Check edge cases, error handling, and unnecessary complexity.
  </review>
</task>
```

### Requirements
- Keep plans short.
- Avoid phase language in small-feature mode.
- Add explicit `review` guidance.
- Add explicit `constraints` and `do-not-touch` semantics.

---

## 4. Repo-level implementation plan

## Phase 1 - Map and isolate the current fast path

### Objective
Identify the minimal execution surface needed to support a slim workflow.

### Files/directories to inspect first
- `README.md`
- `package.json`
- `bin/`
- `commands/gsd/`
- `agents/`
- `get-shit-done/`
- `hooks/`
- `tests/`
- `docs/`

### Deliverables
1. A short architecture note describing:
   - installer flow
   - command registration flow
   - prompt/template locations
   - runtime-specific adapters
   - where planning/execution agent prompts live
2. A dependency map for:
   - `quick`
   - planning
   - execution
   - verification
3. A list of features that are:
   - essential for small-feature mode
   - optional but useful
   - fat to trim or hide

### Acceptance criteria
- You can point to the exact files that implement `quick`, planning, execution, and verification behavior.
- You know which files must change to add a new `senior` mode or evolve `quick`.

---

## Phase 2 - Define the slim workflow contract

### Objective
Create one authoritative workflow contract that all prompts, commands, and docs follow.

### Deliverables
Create a new internal design doc, for example:
- `docs/SENIOR-MODE.md`

### Required content
- target user: solo dev / senior IC / narrow feature scope
- workflow: `spec -> implement -> self-review -> verify`
- decision tree for when to enable research, discuss, verifier, parallelization
- plan schema for small-feature mode
- output contract for implementation agents
- rollback and safety requirements

### Output contract for agents
Use this exact structure or a close equivalent:

```text
GOAL
CONSTRAINTS
PLAN
PATCH
SELF-REVIEW
FIXES APPLIED
VERIFY
```

### Acceptance criteria
- There is exactly one slim workflow contract.
- All future code and prompt changes can be checked against it.

---

## Phase 3 - Build `senior` mode on top of `quick`

### Objective
Avoid a giant rewrite. Reuse the fastest existing path.

### Strategy
Use `quick` as the base because the README already describes it as the right mode for small features and one-off tasks.

### Implementation tasks
1. Add a new command:
   - `/gsd:senior`
   - or `/gsd:quick --senior`
2. Make it call the same underlying path as `quick` with a stricter config preset.
3. Default config should:
   - disable research
   - disable plan check
   - enable verifier only when task risk is medium/high
   - disable parallel execution
   - force minimal plan size
   - require self-review pass
4. Preserve `--full` as the opt-in heavy mode.

### Acceptance criteria
- A user can run one command and get the slim path.
- The command produces smaller artifacts and fewer subagent steps than standard GSD.
- The implementation path is mostly reused, not duplicated.

---

## Phase 4 - Rewrite prompt templates for small-feature accuracy

### Objective
Improve correctness and iteration speed mainly through prompt design, not more infrastructure.

### Prompt changes
Revise execution prompts so they explicitly instruct the model to:
1. write a short spec first
2. implement the smallest sufficient patch
3. review the patch critically
4. fix issues before returning
5. verify against concrete criteria

### Mandatory review checklist
Every implementation prompt should include checks for:
- correctness
- unnecessary complexity
- edge cases
- error handling
- style / architecture violations
- tests affected or needed
- scope creep / unrelated edits

### Senior-engineer stance
Execution prompts should say things like:
- prefer minimal diffs
- preserve existing abstractions unless clearly broken
- do not redesign unrelated parts
- avoid speculative refactors
- make reversible changes
- update tests only where behavior changes

### Acceptance criteria
- Implementation prompt files encode the self-review loop.
- Small-feature tasks produce tighter diffs.
- Prompt payload is shorter than the current equivalent path.

---

## Phase 5 - Trim or hide fat from the primary UX

### Objective
Improve iteration speed by simplifying what users see first.

### Changes
1. Update README to make the small-feature path the first thing a solo dev sees.
2. Move heavier milestone/phase language lower in the docs.
3. Reframe the product around two paths:
   - **Fast path:** `quick` / `senior`
   - **Full path:** milestone/phase flow
4. In settings/docs, present workflow agents as optional quality levers, not defaults.

### Suggested README order
1. What GSD is
2. Small-feature fast path
3. Example: spec -> implement -> self-review -> verify
4. When to use full project/phase mode
5. Advanced workflow agents

### Acceptance criteria
- A new user can understand the fast path in under 60 seconds.
- The README does not lead with enterprise-ish workflow complexity.

---

## Phase 6 - Add risk-based escalation instead of always-on ceremony

### Objective
Keep the system lean by only invoking heavier steps when needed.

### Add a task classifier
Before execution, classify the task:
- `tiny`
- `small-feature`
- `risky`
- `unknown-domain`
- `multi-slice`

### Routing rules
- `tiny` -> spec + implement + self-review
- `small-feature` -> spec + implement + self-review + verify
- `risky` -> discuss + plan-check + implement + self-review + verify
- `unknown-domain` -> research + spec + implement + self-review + verify
- `multi-slice` -> split first, then execute sequentially

### Acceptance criteria
- The system no longer pays the research/checker/verifier tax for every task.
- Escalation is explicit and inspectable.

---

## Phase 7 - Make artifacts smaller and more execution-oriented

### Objective
Reduce context bloat and improve agent comprehension.

### Changes
1. Cap small-feature artifacts aggressively.
2. Remove repeated background text from generated files.
3. Keep only execution-relevant information in active plan files.
4. Archive verbose rationale elsewhere if needed.

### Target artifact set for `senior` mode
- `PLAN.md`
- `SUMMARY.md`
- optional `VERIFY.md`

Avoid generating full research/context files unless the classifier says they are required.

### Acceptance criteria
- Active task artifact footprint is much smaller than the full workflow.
- Generated files are easier for an LLM to re-load in later iterations.

---

## Phase 8 - Tune config and model usage for iteration speed

### Objective
Favor faster loops while keeping enough accuracy.

### Recommendations
- Make `balanced` or a new `senior` profile the default for slim mode.
- Keep planning/review strong, but avoid always using the heaviest configuration.
- Prefer a single implementer path plus self-review rather than planner + checker + verifier + multiple executors on every task.

### Possible profile

```json
{
  "profile": "senior",
  "planning": "Sonnet or equivalent strong mid-tier",
  "execution": "Sonnet or equivalent",
  "verification": "Sonnet or equivalent",
  "research": "off by default"
}
```

Use actual runtime-supported model naming where the codebase expects it.

### Acceptance criteria
- Slim mode reduces tokens and wall-clock time versus current default flows.
- Accuracy does not regress on representative small-feature tasks.

---

## Phase 9 - Test the new path against representative tasks

### Objective
Verify that the trimmed workflow actually improves small-feature delivery.

### Benchmark task set
Use 8-12 real tasks across categories:
- add one UI control
- add one API endpoint
- change CLI flag behavior
- add one config option
- patch one bug
- add a test suite for one module
- wrap one external library
- small refactor with tests preserved

### Measure
For each task capture:
- time to first acceptable patch
- total tokens / model calls if available
- files changed
- number of retries needed
- correctness on first pass
- amount of unrelated churn
- human edits required after completion

### Success criteria
Compared with the current default path, slim mode should produce:
- faster completion
- fewer unrelated edits
- fewer prompt steps
- equal or better first-pass correctness

---

## Phase 10 - Roll out safely

### Objective
Ship without breaking users who like the current workflow.

### Rollout plan
1. Introduce slim mode behind a separate command or config flag.
2. Keep existing commands working.
3. Document slim mode as recommended for small features.
4. After evidence from benchmarks, consider changing defaults.

### Acceptance criteria
- Existing users are not broken.
- New users naturally discover the fast path.

---

## 5. Concrete change list for the agent

Use this as the execution checklist.

### A. Discovery
- [ ] Identify the files implementing `quick`
- [ ] Identify the files implementing plan generation
- [ ] Identify the execution agent prompt/template files
- [ ] Identify verification prompt/template files
- [ ] Identify config defaults and workflow-agent toggles
- [ ] Identify README/doc sections that foreground heavy workflows

### B. Design
- [ ] Write `docs/SENIOR-MODE.md`
- [ ] Define the slim task classifier
- [ ] Define the slim plan schema
- [ ] Define the self-review output contract

### C. Code
- [ ] Add `senior` command or `quick --senior`
- [ ] Add slim-mode config preset
- [ ] Disable heavy steps by default in slim mode
- [ ] Add mandatory self-review pass in execution prompts
- [ ] Add risk-based escalation logic
- [ ] Reduce parallelization by default

### D. Docs
- [ ] Rewrite README intro around fast path first
- [ ] Add examples for tiny/small-feature/risky tasks
- [ ] Explain when to escalate to full workflow

### E. Tests
- [ ] Add tests for command routing
- [ ] Add tests for config preset behavior
- [ ] Add tests that slim mode includes self-review instructions
- [ ] Add tests for escalation rules
- [ ] Add regression tests for existing quick/full flows

---

## 6. Prompt patterns to add

## 6.1 Small-feature implementation prompt

```text
You are implementing a small, senior-scoped software change.

First produce a short spec.
Then implement the smallest sufficient patch.
Then review your own patch critically.
Then fix any issues you found before returning.

Rules:
- Prefer minimal diffs.
- Do not redesign unrelated code.
- Preserve existing abstractions unless clearly broken.
- Add or update tests only where behavior changes.
- Call out assumptions explicitly.

Output exactly:
GOAL
CONSTRAINTS
PLAN
PATCH
SELF-REVIEW
FIXES APPLIED
VERIFY
```

## 6.2 Self-review checklist

```text
Review the patch for:
- correctness
- edge cases
- missing error handling
- unnecessary complexity
- style/architecture violations
- test impact
- scope creep
```

## 6.3 Escalation prompt

```text
Classify this task as one of:
- tiny
- small-feature
- risky
- unknown-domain
- multi-slice

Only escalate if the task genuinely needs more process.
Default to the lightest path that preserves correctness.
```

---

## 7. What to trim first

Trim these first because they are most likely to slow down small-feature work:

1. **Always-on research**
2. **Always-on plan verification**
3. **Parallel execution by default**
4. **Long multi-phase framing for narrow tasks**
5. **Verbose artifacts that restate context instead of sharpening action**

Do **not** trim first:
1. atomic commits
2. structured plans
3. verification hooks
4. bounded context files
5. the ability to escalate to the full flow

---

## 8. Suggested implementation order

Execute in this order:

1. Map current code paths.
2. Write `docs/SENIOR-MODE.md`.
3. Add slim config preset.
4. Add `senior` command or `quick --senior`.
5. Rewrite execution prompts to include self-review.
6. Add task classification and escalation.
7. Shrink artifacts for slim mode.
8. Update README and docs.
9. Add tests.
10. Benchmark against current behavior.

---

## 9. Definition of done

This refactor is done when all of the following are true:

- A solo dev can use one obvious command for small features.
- The default output is a short, high-signal spec and a minimal patch.
- Every implementation task performs self-review before completion.
- Heavy workflow agents are opt-in or risk-triggered, not always on.
- Docs lead with the fast path.
- Benchmarks show faster iterations with equal or better correctness.
- The original full GSD workflow still exists for users who want it.

---

## 10. Final instruction to the executing agent

When making changes:
- prefer small commits
- keep behavior reversible
- preserve backward compatibility where reasonable
- bias toward deleting complexity instead of adding knobs
- optimize for repeated daily use by one experienced developer
- whenever unsure, choose the version that reduces prompt length, branching, and ceremony

If you must choose between:
- **more orchestration** and **clearer prompts** -> choose **clearer prompts**
- **more artifacts** and **smaller sharper artifacts** -> choose **smaller sharper artifacts**
- **more agents** and **a stronger self-review loop** -> choose **a stronger self-review loop**

