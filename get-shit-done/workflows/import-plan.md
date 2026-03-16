<purpose>
Convert an existing agent-written plan into GSD planning artifacts without re-running the full questioning flow.

This workflow is for cases where the user already has a plan from another agent and wants that plan turned into roadmap phases that can be discussed and planned inside GSD.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

## 1. Parse Arguments

Parse `$ARGUMENTS` for:
- optional `--milestone <name>` override
- remaining input as `$PLAN_INPUT`

Accepted input forms:
- a single `@file.md` reference
- pasted markdown

If no plan input is provided:

```text
ERROR: Plan input required

Usage:
  /gsd:import-plan @plan.md
  /gsd:import-plan [paste the plan]
  /gsd:import-plan --milestone "v2.0 Parser" @plan.md
```

Exit.

## 2. Initialize

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init import-plan)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for:
- `importer_model`, `commit_docs`, `granularity`
- `mode`, `project_exists`, `requirements_exists`, `roadmap_exists`, `state_exists`
- `current_milestone`, `current_milestone_name`
- `next_phase_number`, `next_phase_padded`
- `imports_dir`, `import_id`, `date`, `timestamp`
- `project_path`, `requirements_path`, `roadmap_path`, `state_path`

## 3. Confirm Active Work Before Milestone Import

If `mode` is `milestone` and `roadmap_exists` is true:

```bash
ROADMAP_ANALYZE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" roadmap analyze)
if [[ "$ROADMAP_ANALYZE" == @file:* ]]; then ROADMAP_ANALYZE=$(cat "${ROADMAP_ANALYZE#@file:}"); fi
```

Extract `current_phase` from the analyze JSON.

If `current_phase` is not null, ask the user before importing:
- header: "Active work"
- question: "You still have unfinished roadmap work in Phase {current_phase}. Import this plan as a future milestone anyway?"
- options:
  - "Import future milestone" — keep the current active phase in STATE and append the imported roadmap work after it (Recommended)
  - "Cancel" — do not change planning artifacts right now

If the user cancels, stop.

## 4. Load And Normalize Source Plan

If `$PLAN_INPUT` is a single `@file` reference:
- read that file
- error if it cannot be read

If the plan is pasted directly:
- use the pasted markdown as-is

If the plan is wrapped in:

```markdown
<proposed_plan>
...
</proposed_plan>
```

strip only the wrapper tags and keep the inner markdown.

Determine a source title using this precedence:
1. first markdown `#` heading in the imported plan
2. `--milestone` override
3. `imported-plan`

Generate a slug:

```bash
SOURCE_SLUG=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" generate-slug "$SOURCE_TITLE" --raw)
```

If the slug is empty, use `imported-plan`.

Create the imports directory and save the raw source plan:

```bash
mkdir -p .planning/imports
```

Write to:

```text
.planning/imports/${import_id}-${source_slug}.md
```

This raw source file is the preserved source of truth for the import.

## 5. Spawn The Importer Agent

Display banner:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► IMPORT PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Mode: ${mode}
◆ Source: .planning/imports/${import_id}-${source_slug}.md
◆ Next phase number: ${next_phase_number}
```

Importer prompt:

```markdown
<import_context>
**Mode:** {bootstrap | milestone}
**Granularity:** {granularity}
**Current milestone:** {current_milestone} ({current_milestone_name})
**Next GSD phase number:** {next_phase_number}
**Milestone override:** {milestone_override_or_none}
**Imported source plan:** .planning/imports/{import_id}-{source_slug}.md

<files_to_read>
- .planning/imports/{import_id}-{source_slug}.md
- {project_path} (if it exists)
- {requirements_path} (if it exists)
- {roadmap_path} (if it exists)
- {state_path} (if it exists)
- ~/.claude/get-shit-done/templates/project.md
- ~/.claude/get-shit-done/templates/requirements.md
- ~/.claude/get-shit-done/templates/roadmap.md
- ~/.claude/get-shit-done/templates/state.md
</files_to_read>
</import_context>

<instructions>
Convert the imported plan into GSD planning artifacts.

Required rules:
- Prefer explicit imported `Phase N` sections when present
- If explicit phases are missing, derive ordered phases from implementation order, deliverables, or milestone sections
- If the plan still cannot yield a coherent phase sequence, stop and return `## IMPORT BLOCKED`
- Preserve imported phase titles/order, but renumber to GSD sequence when appending to an existing project
- Create stable imported requirement IDs using `IMP{import_index}-NN` unless the source already has stable IDs worth preserving
- Imported notes are baseline assumptions, not confirmed user decisions
- Write per-phase `NN-IMPORT.md` files instead of pre-filling `CONTEXT.md`

Fresh-project mode:
- Create or replace `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`

Milestone mode:
- Update `PROJECT.md` with the imported milestone goal and summary
- Append imported requirements into `REQUIREMENTS.md`
- Append imported phases into `ROADMAP.md`
- Keep `STATE.md` pointed at the current active phase if roadmap work is still in progress; otherwise point it at the first imported phase

For every imported phase, create:
- phase directory `.planning/phases/{NN}-{slug}/`
- `{NN}-IMPORT.md` containing:
  - imported goal
  - imported outputs / deliverables
  - mapped requirement IDs
  - success criteria
  - constraints / non-goals
  - source section anchors
  - open questions for later discuss-phase refinement

ROADMAP requirements:
- include both the summary checklist and the detail sections
- detail sections must include `Goal`, `Depends on`, `Requirements`, `Success Criteria`, and `Plans: TBD`
- add progress rows for imported phases

REQUIREMENTS requirements:
- synthesize requirements from use cases, deliverables, and acceptance criteria
- update Traceability so every imported requirement maps to exactly one imported phase

Return:
- `## IMPORT COMPLETE` on success
- imported milestone/project name
- first imported phase number
- imported phase count
- list of files written
</instructions>
```

```text
Task(
  prompt=import_prompt,
  subagent_type="gsd-plan-importer",
  model="{importer_model}",
  description="Import external plan into GSD"
)
```

## 6. Validate Import Artifacts

After the agent returns `## IMPORT COMPLETE`, validate:

```bash
test -f ".planning/imports/${import_id}-${source_slug}.md"
test -f .planning/ROADMAP.md
test -f .planning/REQUIREMENTS.md
find .planning/phases -maxdepth 2 -name "*-IMPORT.md" | head -1
```

If any required artifact is missing, stop and report the missing file.

## 7. Commit Planning Docs

If `commit_docs` is true:

```bash
IMPORT_DOCS=$(find .planning/imports .planning/phases -name "*-IMPORT.md" -print 2>/dev/null)
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" commit \
  "docs(roadmap): import external plan" \
  --files .planning/PROJECT.md .planning/REQUIREMENTS.md .planning/ROADMAP.md .planning/STATE.md $IMPORT_DOCS
```

## 8. Present Next Steps

Present:

```text
Imported plan saved:
- .planning/imports/${import_id}-${source_slug}.md

GSD artifacts updated:
- .planning/PROJECT.md
- .planning/REQUIREMENTS.md
- .planning/ROADMAP.md
- .planning/phases/*-IMPORT.md

Recommended next step:
  /gsd:discuss-phase {first_imported_phase}

If you want to skip discussion and plan from the imported baseline:
  /gsd:plan-phase {first_imported_phase}
```

</process>

<success_criteria>
- Valid plan input accepted from `@file` or pasted markdown
- Raw source plan saved under `.planning/imports/`
- Imported requirements mapped to imported phases
- ROADMAP.md created or updated with valid phase detail sections
- Per-phase `IMPORT.md` files created
- Existing project imports append as future milestone work instead of clobbering active execution state
- User knows whether to run `/gsd:discuss-phase` or `/gsd:plan-phase` next
</success_criteria>
