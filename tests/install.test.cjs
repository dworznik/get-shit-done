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

describe('installer exposes focus command across runtimes', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test('installs focus command for Claude and Gemini nested commands', () => {
    const claudeDir = makeTempDir('gsd-install-claude-');
    const geminiDir = makeTempDir('gsd-install-gemini-');

    runInstaller(['--claude', '--global', '--config-dir', claudeDir]);
    runInstaller(['--gemini', '--global', '--config-dir', geminiDir]);

    assert.ok(fs.existsSync(path.join(claudeDir, 'commands', 'gsd', 'focus.md')));
    assert.ok(fs.existsSync(path.join(geminiDir, 'commands', 'gsd', 'focus.toml')));
  });

  test('installs focus command for OpenCode flattened commands', () => {
    const openCodeDir = makeTempDir('gsd-install-opencode-');

    runInstaller(['--opencode', '--global', '--config-dir', openCodeDir]);

    const commandPath = path.join(openCodeDir, 'command', 'gsd-focus.md');
    assert.ok(fs.existsSync(commandPath), 'OpenCode flattened focus command exists');

    const content = fs.readFileSync(commandPath, 'utf8');
    assert.ok(content.includes('--mode focus'), 'OpenCode command keeps focus-mode delegation');
  });

  test('installs focus command for Codex as a skill', () => {
    const codexDir = makeTempDir('gsd-install-codex-');

    runInstaller(['--codex', '--global', '--config-dir', codexDir]);

    const skillPath = path.join(codexDir, 'skills', 'gsd-focus', 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), 'Codex focus skill exists');

    const content = fs.readFileSync(skillPath, 'utf8');
    assert.ok(content.includes('$ARGUMENTS') || content.includes('Focus'), 'Codex focus skill has converted command content');
  });
});
