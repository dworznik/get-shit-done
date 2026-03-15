# Agent Guide

## Project Purpose

This repository builds and ships `get-shit-done-cc`, an npm package that installs GSD workflows, commands, agents, templates, and hooks for Claude Code, OpenCode, Gemini, and Codex.

The repo is mostly prompt and installer logic, not an application runtime.

## Source Of Truth

- `bin/install.js`: installer and runtime-specific file conversion/copying
- `commands/gsd/`: source command prompts
- `get-shit-done/workflows/`: shared workflow prompts invoked by commands
- `agents/`: subagent prompts used by workflows
- `get-shit-done/bin/`: CLI utilities used by workflows and tests
- `tests/`: Node test suites for CLI helpers, config loading, installer behavior, and integrations

Do not edit installed/generated runtime output under temp config dirs. Change the source files in this repo.

## Current Fast Path Design

- `/gsd:focus` is the recommended bounded small-feature path.
- `/gsd:quick` is the lower-ceremony sibling.
- Both are implemented through `get-shit-done/workflows/quick.md`.
- Focus-mode behavior is prompt-driven. There is no new persistent config schema for it.

## Editing Rules

- Keep changes reversible and prompt-driven where possible.
- Preserve the existing full milestone/phase workflow unless a change is explicitly meant to affect it.
- When changing fast-path behavior, update all three layers together:
  1. command wrapper in `commands/gsd/`
  2. shared workflow in `get-shit-done/workflows/`
  3. affected agent prompts in `agents/`
- When adding a new command, also update docs/help and installer coverage.

## Installer Notes

- Claude Code installs nested command markdown under `commands/gsd/`.
- OpenCode installs flattened command markdown under `command/gsd-*.md`.
- Gemini installs command TOML under `commands/gsd/*.toml`.
- Codex converts commands into `skills/gsd-*/SKILL.md`.

The installer is directory-driven, so new commands typically do not require router changes.

## Testing

Use targeted tests first:

```bash
node --test tests/install.test.cjs tests/init.test.cjs tests/core.test.cjs tests/codex-config.test.cjs
```

Full suite:

```bash
npm test
```

If you touch config behavior, also run:

```bash
node --test tests/config.test.cjs
```

## High-Signal Review Checklist

- Does the change update the source prompt rather than a generated artifact?
- Does a new command propagate correctly across Claude, Gemini, OpenCode, and Codex?
- Do docs and help output describe the same behavior?
- If fast-path behavior changed, do quick/focus workflow prompts and agent prompts still agree?
