const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const INSTALLER_PATH = path.join(__dirname, '..', 'bin', 'install.js');

const tempDirs = [];

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runInstaller(args) {
  execFileSync(process.execPath, [INSTALLER_PATH, ...args], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('installer exposes focus commands across runtimes', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test('installs focus and focus-stack commands for Claude and Gemini nested commands', () => {
    const claudeDir = makeTempDir('gsd-install-claude-');
    const geminiDir = makeTempDir('gsd-install-gemini-');

    runInstaller(['--claude', '--global', '--config-dir', claudeDir]);
    runInstaller(['--gemini', '--global', '--config-dir', geminiDir]);

    assert.ok(fs.existsSync(path.join(claudeDir, 'commands', 'gsd', 'focus.md')));
    assert.ok(fs.existsSync(path.join(claudeDir, 'commands', 'gsd', 'focus-stack.md')));
    assert.ok(fs.existsSync(path.join(claudeDir, 'commands', 'gsd', 'import-plan.md')));
    assert.ok(fs.existsSync(path.join(claudeDir, 'commands', 'gsd', 'review-feedback.md')));
    assert.ok(!fs.existsSync(path.join(claudeDir, 'commands', 'gsd', 'supervisor.md')));
    assert.ok(fs.existsSync(path.join(geminiDir, 'commands', 'gsd', 'focus.toml')));
    assert.ok(fs.existsSync(path.join(geminiDir, 'commands', 'gsd', 'focus-stack.toml')));
    assert.ok(fs.existsSync(path.join(geminiDir, 'commands', 'gsd', 'import-plan.toml')));
    assert.ok(!fs.existsSync(path.join(geminiDir, 'commands', 'gsd', 'supervisor.toml')));
  });

  test('installs focus and focus-stack commands for OpenCode flattened commands', () => {
    const openCodeDir = makeTempDir('gsd-install-opencode-');

    runInstaller(['--opencode', '--global', '--config-dir', openCodeDir]);

    const focusCommandPath = path.join(openCodeDir, 'command', 'gsd-focus.md');
    const stackCommandPath = path.join(openCodeDir, 'command', 'gsd-focus-stack.md');
    const importCommandPath = path.join(openCodeDir, 'command', 'gsd-import-plan.md');
    const supervisorCommandPath = path.join(openCodeDir, 'command', 'gsd-supervisor.md');
    assert.ok(fs.existsSync(focusCommandPath), 'OpenCode flattened focus command exists');
    assert.ok(fs.existsSync(stackCommandPath), 'OpenCode flattened focus-stack command exists');
    assert.ok(fs.existsSync(importCommandPath), 'OpenCode flattened import-plan command exists');
    assert.ok(!fs.existsSync(supervisorCommandPath), 'OpenCode should not install supervisor command');

    const focusContent = fs.readFileSync(focusCommandPath, 'utf8');
    const stackContent = fs.readFileSync(stackCommandPath, 'utf8');
    const importContent = fs.readFileSync(importCommandPath, 'utf8');
    assert.ok(focusContent.includes('--mode focus'), 'OpenCode focus command keeps focus-mode delegation');
    assert.ok(stackContent.includes('focus-stack'), 'OpenCode focus-stack command content exists');
    assert.ok(importContent.includes('import-plan'), 'OpenCode import-plan command content exists');
  });

  test('installs focus and focus-stack commands for Codex as skills', () => {
    const codexDir = makeTempDir('gsd-install-codex-');

    runInstaller(['--codex', '--global', '--config-dir', codexDir]);

    const focusSkillPath = path.join(codexDir, 'skills', 'gsd-focus', 'SKILL.md');
    const stackSkillPath = path.join(codexDir, 'skills', 'gsd-focus-stack', 'SKILL.md');
    const importSkillPath = path.join(codexDir, 'skills', 'gsd-import-plan', 'SKILL.md');
    const supervisorSkillPath = path.join(codexDir, 'skills', 'gsd-supervisor', 'SKILL.md');
    assert.ok(fs.existsSync(focusSkillPath), 'Codex focus skill exists');
    assert.ok(fs.existsSync(stackSkillPath), 'Codex focus-stack skill exists');
    assert.ok(fs.existsSync(importSkillPath), 'Codex import-plan skill exists');
    assert.ok(fs.existsSync(supervisorSkillPath), 'Codex supervisor skill exists');

    const focusContent = fs.readFileSync(focusSkillPath, 'utf8');
    const stackContent = fs.readFileSync(stackSkillPath, 'utf8');
    const importContent = fs.readFileSync(importSkillPath, 'utf8');
    const supervisorContent = fs.readFileSync(supervisorSkillPath, 'utf8');
    assert.ok(focusContent.includes('$ARGUMENTS') || focusContent.includes('Focus'), 'Codex focus skill has converted command content');
    assert.ok(stackContent.includes('$ARGUMENTS') || stackContent.includes('focus-stack'), 'Codex focus-stack skill has converted command content');
    assert.ok(importContent.includes('{{GSD_ARGS}}') || importContent.includes('import-plan'), 'Codex import-plan skill has converted command content');
    assert.ok(supervisorContent.includes('SUPERVISOR-FINDINGS.json'), 'Codex supervisor skill has converted command content');
  });

  test('installs review-feedback command, agent, and template for Claude', () => {
    const claudeDir = makeTempDir('gsd-install-feedback-');

    runInstaller(['--claude', '--global', '--config-dir', claudeDir]);

    assert.ok(fs.existsSync(path.join(claudeDir, 'commands', 'gsd', 'review-feedback.md')),
      'review-feedback command exists');
    assert.ok(fs.existsSync(path.join(claudeDir, 'agents', 'gsd-feedback-collector.md')),
      'gsd-feedback-collector agent exists');
    assert.ok(fs.existsSync(path.join(claudeDir, 'get-shit-done', 'templates', 'FEEDBACK.md')),
      'FEEDBACK.md template exists');
    assert.ok(fs.existsSync(path.join(claudeDir, 'get-shit-done', 'workflows', 'review-feedback.md')),
      'review-feedback workflow exists');
  });
});
