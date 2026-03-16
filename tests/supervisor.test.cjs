const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

function writeQuickArtifacts(tmpDir, quickDirName) {
  const quickDir = path.join(tmpDir, '.planning', 'quick', quickDirName);
  fs.mkdirSync(quickDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# Project State\n', 'utf-8');

  const baseName = quickDirName.split('-').slice(0, 2).join('-');
  const planPath = path.join(quickDir, `${baseName}-PLAN.md`);
  const contextPath = path.join(quickDir, `${baseName}-CONTEXT.md`);
  const summaryPath = path.join(quickDir, `${baseName}-SUMMARY.md`);
  const verificationPath = path.join(quickDir, `${baseName}-VERIFICATION.md`);

  fs.writeFileSync(contextPath, '# Context\n\n## Decisions\n- Use cards\n', 'utf-8');
  fs.writeFileSync(planPath, [
    '---',
    'phase: quick',
    'plan: 01',
    'requirements: [QK-01]',
    'depends_on: []',
    'files_modified: [src/app.ts, src/view.ts]',
    'must_haves:',
    '  truths:',
    '    - "Feature output is wired to the UI"',
    '  artifacts:',
    '    - path: src/app.ts',
    '      provides: request handler',
    '  key_links:',
    '    - source: src/app.ts',
    '      target: src/view.ts',
    '      reason: render output',
    '---',
    '',
    '## Constraints',
    '- Keep the diff minimal',
    '',
    '## Do Not Touch',
    '- Do not rewrite routing',
    '',
    '## Review',
    '- Confirm only planned files changed',
    '',
    '## Assumptions',
    '- Existing build pipeline stays unchanged',
    '',
    '## Open Questions',
    '- Whether the API response should include metadata',
    '',
    '<tasks>',
    '<task type="auto">',
    '<name>Implement handler</name>',
    '<files>src/app.ts, src/view.ts</files>',
    '<action>Implement the flow.</action>',
    '<verify><automated>npm test</automated></verify>',
    '<done>Flow works.</done>',
    '</task>',
    '</tasks>',
    '',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(summaryPath, [
    '---',
    'one-liner: Added quick task handler wiring',
    'key-files:',
    '  created: [src/app.ts]',
    '  modified: [src/view.ts]',
    'requirements-completed: [QK-01]',
    'key-decisions:',
    '  - Keep cards: Matches the approved context',
    '---',
    '',
    '# Summary',
    '',
    '## Deviations from Plan',
    'None - plan executed exactly as written.',
    '',
    '## Issues Encountered',
    'None',
    '',
    '## Self-Check: PASSED',
    '',
    '1. **Task 1** - `abc1234` (feat)',
    'Plan metadata: `def5678`',
    '',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(verificationPath, '---\nstatus: passed\n---\n# Verification\n', 'utf-8');

  fs.writeFileSync(path.join(quickDir, 'RUN_MANIFEST.json'), JSON.stringify({
    run_id: '240101-abc',
    mode: 'focus',
    classifier: 'small-feature',
    description: 'Add quick task handler',
    quick_dir: `.planning/quick/${quickDirName}`,
    context_path: `.planning/quick/${quickDirName}/${path.basename(contextPath)}`,
    plan_path: `.planning/quick/${quickDirName}/${path.basename(planPath)}`,
    summary_path: `.planning/quick/${quickDirName}/${path.basename(summaryPath)}`,
    verification_path: `.planning/quick/${quickDirName}/${path.basename(verificationPath)}`,
    stack_state_path: null,
    planner_status: 'checked',
    execution_status: 'completed',
    verification_status: 'passed',
    supervisor_runtime: 'claude',
    supervisor_transport: 'tmux',
    supervisor_pre_tmux_target: null,
    supervisor_post_tmux_target: null,
    supervisor_pre_status: 'pending',
    supervisor_post_status: 'pending',
    final_status: 'executed',
  }, null, 2), 'utf-8');

  return { quickDir };
}

describe('supervisor bundle commands', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('builds preflight bundle from quick artifacts', () => {
    const quickDirName = '240101-abc-add-handler';
    writeQuickArtifacts(tmpDir, quickDirName);

    const result = runGsdTools(`supervisor-bundle .planning/quick/${quickDirName} --stage pre`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const bundle = JSON.parse(fs.readFileSync(path.join(tmpDir, output.bundle_path), 'utf-8'));

    assert.strictEqual(bundle.stage, 'pre');
    assert.strictEqual(bundle.task.mode, 'focus');
    assert.strictEqual(bundle.task.classifier, 'small-feature');
    assert.strictEqual(bundle.task.plan_path.endsWith('-PLAN.md'), true);
    assert.ok(bundle.plan.must_haves.truths.length > 0, 'includes must_haves');
    assert.ok(bundle.plan.touched_files.includes('src/app.ts'), 'includes touched files');
    assert.ok(bundle.plan.constraints.includes('Keep the diff minimal'), 'includes constraints section');
    assert.strictEqual(bundle.artifacts.status_path.endsWith('SUPERVISOR-PRE-STATUS.json'), true);
    assert.strictEqual(bundle.artifacts.findings_path.endsWith('SUPERVISOR-PRE-FINDINGS.json'), true);
    assert.strictEqual(bundle.execution, undefined, 'pre bundle should not include execution section');
  });

  test('builds postflight bundle with summary and verifier data', () => {
    const quickDirName = '240101-abc-add-handler';
    writeQuickArtifacts(tmpDir, quickDirName);

    const result = runGsdTools(`supervisor-bundle .planning/quick/${quickDirName} --stage post`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const bundle = JSON.parse(fs.readFileSync(path.join(tmpDir, output.bundle_path), 'utf-8'));

    assert.strictEqual(bundle.stage, 'post');
    assert.strictEqual(bundle.execution.summary.one_liner, 'Added quick task handler wiring');
    assert.deepStrictEqual(bundle.execution.changed_files.sort(), ['src/app.ts', 'src/view.ts']);
    assert.strictEqual(bundle.execution.self_check, 'passed');
    assert.strictEqual(bundle.execution.verifier.status, 'passed');
    assert.ok(bundle.execution.commit_hashes.includes('abc1234'), 'includes commit hashes');
    assert.strictEqual(bundle.artifacts.report_path.endsWith('SUPERVISOR-POST-REPORT.md'), true);
  });

  test('includes focus-stack context when quick dir belongs to a slice', () => {
    const quickDirName = '240101-abc-add-handler';
    writeQuickArtifacts(tmpDir, quickDirName);

    const stackDir = path.join(tmpDir, '.planning', 'focus-stacks', '240101-def-stack');
    fs.mkdirSync(stackDir, { recursive: true });
    fs.writeFileSync(path.join(stackDir, 'state.json'), JSON.stringify({
      stack_id: '240101-def',
      slices: [
        { index: 1, title: 'Base slice', status: 'complete', branch: 'feature/base', quick_dir: '.planning/quick/240101-aaa-base' },
        { index: 2, title: 'Add handler', status: 'pending', branch: 'feature/add-handler', parent_branch: 'feature/base', quick_dir: `.planning/quick/${quickDirName}` },
      ],
    }, null, 2), 'utf-8');

    const result = runGsdTools(`supervisor-bundle .planning/quick/${quickDirName} --stage pre`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const bundle = JSON.parse(fs.readFileSync(path.join(tmpDir, output.bundle_path), 'utf-8'));
    assert.strictEqual(bundle.stack_context.stack_id, '240101-def');
    assert.strictEqual(bundle.stack_context.slice_index, 2);
    assert.strictEqual(bundle.stack_context.parent_branch, 'feature/base');
    assert.strictEqual(bundle.task.stack_state_path.endsWith('/state.json'), true);
  });

  test('normalizes findings status via supervisor-findings', () => {
    const findingsPath = path.join(tmpDir, 'findings.json');
    fs.writeFileSync(findingsPath, JSON.stringify({
      stage: 'pre',
      findings: [
        {
          severity: 'warning',
          category: 'spec-gap',
          title: 'Missing review guidance',
          evidence: 'The bundle has no review section.',
          recommended_action: 'Add review guidance to the plan.',
        },
      ],
    }, null, 2), 'utf-8');

    const result = runGsdTools(`supervisor-findings ${path.relative(tmpDir, findingsPath)}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'warnings');
    assert.strictEqual(output.findings.length, 1);
    assert.strictEqual(output.findings[0].category, 'spec-gap');
  });
});

describe('supervisor launch and wait commands', () => {
  let tmpDir;
  let fakeBinDir;
  let fakeTmuxLog;
  let oldPath;
  let oldTmux;

  beforeEach(() => {
    tmpDir = createTempProject();
    writeQuickArtifacts(tmpDir, '240101-abc-add-handler');
    runGsdTools('supervisor-bundle .planning/quick/240101-abc-add-handler --stage pre', tmpDir);

    fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-fake-bin-'));
    fakeTmuxLog = path.join(fakeBinDir, 'tmux.log');
    const fakeTmuxPath = path.join(fakeBinDir, 'tmux');
    const fakeCodexPath = path.join(fakeBinDir, 'fake-codex');

    fs.writeFileSync(fakeTmuxPath, `#!/bin/sh
echo "$@" >> "${fakeTmuxLog}"
cmd="$1"
shift
case "$cmd" in
  new-window)
    printf '%s\\n' "test-session:9"
    ;;
  has-session)
    exit 0
    ;;
  kill-window)
    exit 0
    ;;
  send-keys)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`, 'utf-8');
    fs.writeFileSync(fakeCodexPath, '#!/bin/sh\nsleep 60\n', 'utf-8');
    fs.chmodSync(fakeTmuxPath, 0o755);
    fs.chmodSync(fakeCodexPath, 0o755);

    oldPath = process.env.PATH;
    oldTmux = process.env.TMUX;
    process.env.PATH = `${fakeBinDir}:${oldPath}`;
    process.env.TMUX = 'test-session,1,0';

    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({
      workflow: {
        codex_supervisor: true,
        codex_supervisor_transport: 'tmux',
        codex_launch_command: 'fake-codex',
        codex_boot_delay_ms: 0,
        codex_supervisor_timeout_seconds: 1,
        codex_supervisor_poll_ms: 100,
        codex_keep_window_on_failure: false,
        codex_keep_window_on_success: false,
      },
    }, null, 2), 'utf-8');
  });

  afterEach(() => {
    process.env.PATH = oldPath;
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
    cleanup(tmpDir);
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
  });

  test('launch writes running status and tmux target', () => {
    const result = runGsdTools('supervisor-launch .planning/quick/240101-abc-add-handler --stage pre', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state, 'running');
    assert.strictEqual(output.transport, 'tmux');
    assert.strictEqual(output.tmux_target, 'test-session:9');

    const status = JSON.parse(fs.readFileSync(path.join(tmpDir, '.planning', 'quick', '240101-abc-add-handler', 'SUPERVISOR-PRE-STATUS.json'), 'utf-8'));
    assert.strictEqual(status.state, 'running');

    const log = fs.readFileSync(fakeTmuxLog, 'utf-8');
    assert.ok(log.includes('new-window'), 'creates a new tmux window');
    assert.ok(log.includes('send-keys'), 'bootstraps the supervisor command');
  });

  test('wait returns passed status and copies latest findings/report', () => {
    const launch = runGsdTools('supervisor-launch .planning/quick/240101-abc-add-handler --stage pre', tmpDir);
    assert.ok(launch.success, `Launch failed: ${launch.error}`);

    const quickDir = path.join(tmpDir, '.planning', 'quick', '240101-abc-add-handler');
    fs.writeFileSync(path.join(quickDir, 'SUPERVISOR-PRE-FINDINGS.json'), JSON.stringify({
      stage: 'pre',
      status: 'passed',
      findings: [],
    }, null, 2), 'utf-8');
    fs.writeFileSync(path.join(quickDir, 'SUPERVISOR-PRE-REPORT.md'), '# Report\n', 'utf-8');
    fs.writeFileSync(path.join(quickDir, 'SUPERVISOR-PRE-STATUS.json'), JSON.stringify({
      run_id: '240101-abc',
      stage: 'pre',
      runtime: 'claude',
      transport: 'tmux',
      state: 'passed',
      bundle_path: '.planning/quick/240101-abc-add-handler/SUPERVISOR-PRE.json',
      findings_path: '.planning/quick/240101-abc-add-handler/SUPERVISOR-PRE-FINDINGS.json',
      report_path: '.planning/quick/240101-abc-add-handler/SUPERVISOR-PRE-REPORT.md',
      tmux_target: 'test-session:9',
      window_name: 'gsd-supervisor-240101-abc-pre',
      launch_command: 'fake-codex',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error: null,
    }, null, 2), 'utf-8');

    const result = runGsdTools('supervisor-wait .planning/quick/240101-abc-add-handler --stage pre', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state, 'passed');
    assert.ok(fs.existsSync(path.join(quickDir, 'SUPERVISOR-FINDINGS.json')));
    assert.ok(fs.existsSync(path.join(quickDir, 'SUPERVISOR-REPORT.md')));
  });

  test('wait preserves blocked terminal state', () => {
    const quickDir = path.join(tmpDir, '.planning', 'quick', '240101-abc-add-handler');
    fs.writeFileSync(path.join(quickDir, 'SUPERVISOR-PRE-STATUS.json'), JSON.stringify({
      run_id: '240101-abc',
      stage: 'pre',
      runtime: 'claude',
      transport: 'tmux',
      state: 'blocked',
      bundle_path: '.planning/quick/240101-abc-add-handler/SUPERVISOR-PRE.json',
      findings_path: '.planning/quick/240101-abc-add-handler/SUPERVISOR-PRE-FINDINGS.json',
      report_path: '.planning/quick/240101-abc-add-handler/SUPERVISOR-PRE-REPORT.md',
      tmux_target: 'test-session:9',
      window_name: 'gsd-supervisor-240101-abc-pre',
      launch_command: 'fake-codex',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error: null,
    }, null, 2), 'utf-8');

    const result = runGsdTools('supervisor-wait .planning/quick/240101-abc-add-handler --stage pre', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state, 'blocked');
  });

  test('launch fails cleanly when TMUX is missing', () => {
    delete process.env.TMUX;
    const result = runGsdTools('supervisor-launch .planning/quick/240101-abc-add-handler --stage pre', tmpDir);
    assert.ok(result.success, `Command failed unexpectedly: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state, 'failed');
    assert.match(output.error, /TMUX|tmux/i);
  });

  test('wait times out when status never reaches a terminal state', () => {
    const quickDir = path.join(tmpDir, '.planning', 'quick', '240101-abc-add-handler');
    fs.writeFileSync(path.join(quickDir, 'SUPERVISOR-PRE-STATUS.json'), JSON.stringify({
      run_id: '240101-abc',
      stage: 'pre',
      runtime: 'claude',
      transport: 'tmux',
      state: 'running',
      bundle_path: '.planning/quick/240101-abc-add-handler/SUPERVISOR-PRE.json',
      findings_path: '.planning/quick/240101-abc-add-handler/SUPERVISOR-PRE-FINDINGS.json',
      report_path: '.planning/quick/240101-abc-add-handler/SUPERVISOR-PRE-REPORT.md',
      tmux_target: null,
      window_name: 'gsd-supervisor-240101-abc-pre',
      launch_command: 'fake-codex',
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    }, null, 2), 'utf-8');

    const result = runGsdTools('supervisor-wait .planning/quick/240101-abc-add-handler --stage pre', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state, 'timeout');
  });
});

describe('quick workflow supervisor prompt contract', () => {
  test('quick workflow includes run manifest and supervisor checkpoints', () => {
    const workflowPath = path.join(__dirname, '..', 'get-shit-done', 'workflows', 'quick.md');
    const content = fs.readFileSync(workflowPath, 'utf-8');

    assert.ok(content.includes('RUN_MANIFEST.json'), 'documents the run manifest');
    assert.ok(content.includes('supervisor-bundle'), 'builds supervisor bundles');
    assert.ok(content.includes('supervisor-launch'), 'launches the tmux handoff');
    assert.ok(content.includes('supervisor-wait'), 'waits for the tmux handoff');
    assert.ok(content.includes('Skill(skill="gsd:supervisor"'), 'keeps direct Codex invocation');
    assert.ok(content.includes('codex_supervisor_enabled'), 'uses the config gate');
  });
});
