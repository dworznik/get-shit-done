# Claude Project Notes

Read `AGENTS.md` first for the repo-specific guide.

## Practical Summary

- This repo is the source for GSD installer logic plus prompt/workflow files.
- `commands/gsd/`, `get-shit-done/workflows/`, and `agents/` are the primary edit surface.
- `/gsd:focus` and `/gsd:quick` share `get-shit-done/workflows/quick.md`.
- Avoid adding new config schema or new CLI/init surfaces unless the behavior cannot stay prompt-driven.

## Useful Commands

```bash
npm test
node --test tests/install.test.cjs tests/init.test.cjs tests/core.test.cjs tests/codex-config.test.cjs
```

## When Adding Or Changing Commands

- Update `commands/gsd/`
- Update `get-shit-done/workflows/help.md`
- Update README / user-guide copy if behavior is user-facing
- Add or update installer coverage in `tests/install.test.cjs`
