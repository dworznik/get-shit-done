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
    assert.ok(fs.existsSync(path.join(geminiDir, 'commands', 'gsd', 'focus.toml')));
    assert.ok(fs.existsSync(path.join(geminiDir, 'commands', 'gsd', 'focus-stack.toml')));
  });

  test('installs focus and focus-stack commands for OpenCode flattened commands', () => {
    const openCodeDir = makeTempDir('gsd-install-opencode-');

    runInstaller(['--opencode', '--global', '--config-dir', openCodeDir]);

    const focusCommandPath = path.join(openCodeDir, 'command', 'gsd-focus.md');
    const stackCommandPath = path.join(openCodeDir, 'command', 'gsd-focus-stack.md');
    assert.ok(fs.existsSync(focusCommandPath), 'OpenCode flattened focus command exists');
    assert.ok(fs.existsSync(stackCommandPath), 'OpenCode flattened focus-stack command exists');

    const focusContent = fs.readFileSync(focusCommandPath, 'utf8');
    const stackContent = fs.readFileSync(stackCommandPath, 'utf8');
    assert.ok(focusContent.includes('--mode focus'), 'OpenCode focus command keeps focus-mode delegation');
    assert.ok(stackContent.includes('focus-stack'), 'OpenCode focus-stack command content exists');
  });

  test('installs focus and focus-stack commands for Codex as skills', () => {
    const codexDir = makeTempDir('gsd-install-codex-');

    runInstaller(['--codex', '--global', '--config-dir', codexDir]);

    const focusSkillPath = path.join(codexDir, 'skills', 'gsd-focus', 'SKILL.md');
    const stackSkillPath = path.join(codexDir, 'skills', 'gsd-focus-stack', 'SKILL.md');
    assert.ok(fs.existsSync(focusSkillPath), 'Codex focus skill exists');
    assert.ok(fs.existsSync(stackSkillPath), 'Codex focus-stack skill exists');

    const focusContent = fs.readFileSync(focusSkillPath, 'utf8');
    const stackContent = fs.readFileSync(stackSkillPath, 'utf8');
    assert.ok(focusContent.includes('$ARGUMENTS') || focusContent.includes('Focus'), 'Codex focus skill has converted command content');
    assert.ok(stackContent.includes('$ARGUMENTS') || stackContent.includes('focus-stack'), 'Codex focus-stack skill has converted command content');
  });
});
