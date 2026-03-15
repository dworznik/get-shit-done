const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

function writeQuickArtifacts(tmpDir, quickDirName) {
  const quickDir = path.join(tmpDir, '.planning', 'quick', quickDirName);
  fs.mkdirSync(quickDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# Project State\n', 'utf-8');

  const planPath = path.join(quickDir, `${quickDirName.split('-').slice(0, 2).join('-')}-PLAN.md`);
  const contextPath = path.join(quickDir, `${quickDirName.split('-').slice(0, 2).join('-')}-CONTEXT.md`);
  const summaryPath = path.join(quickDir, `${quickDirName.split('-').slice(0, 2).join('-')}-SUMMARY.md`);
  const verificationPath = path.join(quickDir, `${quickDirName.split('-').slice(0, 2).join('-')}-VERIFICATION.md`);

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
    supervisor_pre_status: 'pending',
    supervisor_post_status: 'pending',
    final_status: 'executed',
  }, null, 2), 'utf-8');

  return { quickDir, summaryPath, verificationPath };
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
    assert.strictEqual(output.stage, 'pre');
    const bundlePath = path.join(tmpDir, output.bundle_path);
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));

    assert.strictEqual(bundle.task.mode, 'focus');
    assert.strictEqual(bundle.task.classifier, 'small-feature');
    assert.strictEqual(bundle.task.plan_path.endsWith('-PLAN.md'), true);
    assert.ok(bundle.plan.must_haves.truths.length > 0, 'includes must_haves');
    assert.ok(bundle.plan.touched_files.includes('src/app.ts'), 'includes touched files');
    assert.ok(bundle.plan.constraints.includes('Keep the diff minimal'), 'includes constraints section');
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
    }, null, 2));

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
    }, null, 2));

    const result = runGsdTools(`supervisor-findings ${path.relative(tmpDir, findingsPath)}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'warnings');
    assert.strictEqual(output.findings.length, 1);
    assert.strictEqual(output.findings[0].category, 'spec-gap');
  });
});

describe('quick workflow supervisor prompt contract', () => {
  test('quick workflow includes run manifest and supervisor checkpoints', () => {
    const workflowPath = path.join(__dirname, '..', 'get-shit-done', 'workflows', 'quick.md');
    const content = fs.readFileSync(workflowPath, 'utf-8');

    assert.ok(content.includes('RUN_MANIFEST.json'), 'documents the run manifest');
    assert.ok(content.includes('supervisor-bundle'), 'builds supervisor bundles');
    assert.ok(content.includes('Skill(skill="gsd:supervisor"'), 'invokes the supervisor skill');
    assert.ok(content.includes('codex_supervisor_enabled'), 'uses the config gate');
  });
});
