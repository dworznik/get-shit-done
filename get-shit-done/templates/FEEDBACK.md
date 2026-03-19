# Feedback Template

Template for `.planning/feedback/{phase}-{slice}-pr{N}.md` — per-slice bot review feedback session.

---

## File Template

```markdown
---
status: collecting | triaging | actionable | resolved
pr_number: {N}
pr_url: "{url}"
phase: "{phase_number}"
slice_id: "{plan_id or slice index}"
slice_title: "{title}"
bot_names: ["{bot1}"]
finding_count: 0
actionable_count: 0
created: {ISO}
updated: {ISO}
---

## Findings
<!-- APPEND during collection, UPDATE status during triage -->

- id: f1
  bot: coderabbit
  severity: major
  category: correctness
  status: actionable | dismissed | deferred
  file: "src/components/Example.tsx"
  line: 42
  title: "Missing null check before accessing user.name"
  suggestion: "Add optional chaining: user?.name"
  raw_comment: "[first 500 chars of verbatim bot comment]"
  comment_url: "https://github.com/..."

## Gaps
<!-- Generated from actionable findings, same YAML schema as UAT.md -->

- truth: "{finding title}"
  status: failed
  reason: "Bot review ({bot}): {raw_comment excerpt}"
  severity: major
  source: review-feedback
  feedback_id: f1
  artifacts:
    - path: "{file}"
      issue: "{title} at line {line}"
  missing:
    - "{suggestion}"
```

---

<section_rules>

**Frontmatter:**
- `status`: OVERWRITE — reflects current phase
- `pr_number`: IMMUTABLE — set on creation
- `pr_url`: IMMUTABLE — set on creation
- `phase`: IMMUTABLE — set on creation
- `slice_id`: IMMUTABLE — set on creation
- `slice_title`: IMMUTABLE — set on creation
- `bot_names`: OVERWRITE — updated if new bots found
- `finding_count`: OVERWRITE — updated during collection/triage
- `actionable_count`: OVERWRITE — updated during triage
- `created`: IMMUTABLE — set once
- `updated`: OVERWRITE — update on every change

**Findings:**
- APPEND during collection
- UPDATE `status` field during triage (actionable → dismissed/deferred)
- Each finding has unique `id` (f1, f2, ...)
- `status` values: actionable, dismissed, deferred

**Gaps:**
- Generated from findings with severity `blocker` or `major` and status `actionable`
- Same YAML schema as UAT.md gaps for plan-phase --gaps consumption
- `source: review-feedback` distinguishes from UAT gaps
- `feedback_id` links back to the finding

</section_rules>

<severity_guide>

Severity is determined from bot signals first, then keywords:

| Bot signal | Infer |
|------------|-------|
| CodeRabbit 🔴, Critical | blocker |
| CodeRabbit 🟠, Major | major |
| CodeRabbit 🟡, Minor | minor |
| CodeRabbit Nitpick, 💡 | cosmetic |
| Security, crash, vulnerability | blocker |
| Bug, wrong, incorrect, broken | major |
| Style, format, convention | minor |
| Typo, visual, cosmetic | cosmetic |

Default: **minor** (bot findings are typically style/convention)

</severity_guide>

<lifecycle>

**Creation:** When /gsd:review-feedback polls a PR and finds bot comments
- gsd-feedback-collector agent creates the file
- Sets status to "collecting"
- Populates Findings from parsed comments

**During triage:**
- status → "triaging"
- User reviews each finding: accept (actionable), dismiss, defer
- Actionable blockers/majors generate Gaps entries

**After triage:**
- status → "actionable" (if gaps exist) or "resolved" (if all dismissed/cosmetic)
- Gaps section ready for /gsd:plan-phase --gaps consumption

**On resolution:**
- status → "resolved"
- All findings addressed via gap closure or dismissed

</lifecycle>

<good_example>
```markdown
---
status: actionable
pr_number: 42
pr_url: "https://github.com/user/repo/pull/42"
phase: "4"
slice_id: "04-01"
slice_title: "Add comment system"
bot_names: ["coderabbitai[bot]"]
finding_count: 3
actionable_count: 1
created: 2025-01-15T10:30:00Z
updated: 2025-01-15T10:35:00Z
---

## Findings

- id: f1
  bot: coderabbitai[bot]
  severity: major
  category: correctness
  status: actionable
  file: "src/components/CommentList.tsx"
  line: 42
  title: "Missing null check before accessing user.name"
  suggestion: "Add optional chaining: user?.name"
  raw_comment: "🟠 **Major:** The `user.name` access on line 42 can throw if `user` is null..."
  comment_url: "https://github.com/user/repo/pull/42#discussion_r123"

- id: f2
  bot: coderabbitai[bot]
  severity: minor
  category: style
  status: dismissed
  file: "src/utils/format.ts"
  line: 15
  title: "Prefer template literal over string concatenation"
  suggestion: "Use `${firstName} ${lastName}` instead"
  raw_comment: "🟡 **Minor:** Consider using template literals for readability..."
  comment_url: "https://github.com/user/repo/pull/42#discussion_r124"

- id: f3
  bot: coderabbitai[bot]
  severity: cosmetic
  category: style
  status: dismissed
  file: "src/components/CommentList.tsx"
  line: 1
  title: "Missing JSDoc for exported component"
  suggestion: "Add /** ... */ above the export"
  raw_comment: "💡 Nitpick: Consider adding JSDoc documentation..."
  comment_url: "https://github.com/user/repo/pull/42#discussion_r125"

## Gaps

- truth: "Missing null check before accessing user.name"
  status: failed
  reason: "Bot review (coderabbitai[bot]): The user.name access on line 42 can throw if user is null"
  severity: major
  source: review-feedback
  feedback_id: f1
  artifacts:
    - path: "src/components/CommentList.tsx"
      issue: "Missing null check before accessing user.name at line 42"
  missing:
    - "Add optional chaining: user?.name"
```
</good_example>
