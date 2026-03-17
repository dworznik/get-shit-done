/**
 * Commands — Standalone utility commands
 */
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { safeReadFile, loadConfig, isGitIgnored, execGit, normalizePhaseName, comparePhaseNum, getArchivedPhaseDirs, generateSlugInternal, getMilestoneInfo, getMilestonePhaseFilter, resolveModelInternal, stripShippedMilestones, extractCurrentMilestone, planningDir, planningPaths, toPosixPath, output, error, findPhaseInternal, extractOneLinerFromBody, getRoadmapPhaseInternal, detectRuntimeContext } = require('./core.cjs');
const { extractFrontmatter, parseMustHavesBlock } = require('./frontmatter.cjs');
const { MODEL_PROFILES } = require('./model-profiles.cjs');

const SUPERVISOR_TERMINAL_STATES = new Set(['passed', 'warnings', 'blocked', 'failed', 'timeout']);

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function parseQuickDir(cwd, quickDirArg) {
  if (!quickDirArg) {
    error('quick-dir required');
  }

  const fullPath = path.isAbsolute(quickDirArg) ? quickDirArg : path.join(cwd, quickDirArg);
  if (!fs.existsSync(fullPath)) {
    error(`Quick directory not found: ${quickDirArg}`);
  }

  const relPath = toPosixPath(path.relative(cwd, fullPath)) || '.';
  return { fullPath, relPath };
}

function findQuickArtifact(fullDir, suffix) {
  try {
    const matches = fs.readdirSync(fullDir)
      .filter(name => name.endsWith(suffix))
      .sort();
    return matches.length > 0 ? path.join(fullDir, matches[0]) : null;
  } catch {
    return null;
  }
}

function toRelOrNull(cwd, filePath) {
  return filePath ? toPosixPath(path.relative(cwd, filePath)) : null;
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sleepMs(ms) {
  if (!ms || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function normalizeSupervisorKind(kind) {
  return kind === 'phase' ? 'phase' : 'quick';
}

function validSupervisorStages(kind) {
  return kind === 'phase' ? ['plan', 'execute'] : ['pre', 'post'];
}

function supervisorManifestName(kind) {
  return kind === 'phase' ? 'PHASE_RUN_MANIFEST.json' : 'RUN_MANIFEST.json';
}

function supervisorArtifactPaths(fullPath, relPath, kind, stage) {
  const normalizedKind = normalizeSupervisorKind(kind);
  const stageUpper = String(stage || '').toUpperCase();
  const prefix = normalizedKind === 'phase' ? 'PHASE-SUPERVISOR' : 'SUPERVISOR';
  const bundleName = `${prefix}-${stageUpper}.json`;
  const statusName = `${prefix}-${stageUpper}-STATUS.json`;
  const findingsName = `${prefix}-${stageUpper}-FINDINGS.json`;
  const reportName = `${prefix}-${stageUpper}-REPORT.md`;
  const latestFindingsName = normalizedKind === 'phase' ? 'PHASE-SUPERVISOR-FINDINGS.json' : 'SUPERVISOR-FINDINGS.json';
  const latestReportName = normalizedKind === 'phase' ? 'PHASE-SUPERVISOR-REPORT.md' : 'SUPERVISOR-REPORT.md';

  return {
    abs: {
      bundle: path.join(fullPath, bundleName),
      status: path.join(fullPath, statusName),
      findings: path.join(fullPath, findingsName),
      report: path.join(fullPath, reportName),
      latestFindings: path.join(fullPath, latestFindingsName),
      latestReport: path.join(fullPath, latestReportName),
    },
    rel: {
      bundle: toPosixPath(path.join(relPath, bundleName)),
      status: toPosixPath(path.join(relPath, statusName)),
      findings: toPosixPath(path.join(relPath, findingsName)),
      report: toPosixPath(path.join(relPath, reportName)),
      latestFindings: toPosixPath(path.join(relPath, latestFindingsName)),
      latestReport: toPosixPath(path.join(relPath, latestReportName)),
    },
  };
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function readSupervisorStatus(filePath) {
  return readJsonIfExists(filePath);
}

function updateLatestSupervisorOutputs(paths) {
  if (fs.existsSync(paths.abs.findings)) {
    fs.copyFileSync(paths.abs.findings, paths.abs.latestFindings);
  }
  if (fs.existsSync(paths.abs.report)) {
    fs.copyFileSync(paths.abs.report, paths.abs.latestReport);
  }
}

function findSourceJsonArtifacts(fullPath, kind) {
  const manifestName = supervisorManifestName(kind);
  try {
    return fs.readdirSync(fullPath)
      .filter(name => name.endsWith('.json'))
      .filter(name => !(
        name === manifestName ||
        /^SUPERVISOR-(PRE|POST)(-STATUS|-FINDINGS)?\.json$/.test(name) ||
        /^PHASE-SUPERVISOR-(PLAN|EXECUTE)(-STATUS|-FINDINGS)?\.json$/.test(name) ||
        name === 'SUPERVISOR-FINDINGS.json' ||
        name === 'PHASE-SUPERVISOR-FINDINGS.json'
      ))
      .sort();
  } catch {
    return [];
  }
}

function resolveCodexSupervisorTransport(config, runtime, env = process.env) {
  const configured = config.codex_supervisor_transport || 'auto';
  if (configured !== 'auto') {
    return {
      configured,
      resolved: configured,
      error: configured === 'tmux' && !env.TMUX
        ? 'workflow.codex_supervisor_transport=tmux requires TMUX to be set.'
        : null,
    };
  }

  if (runtime === 'codex') {
    return { configured, resolved: 'direct', error: null };
  }

  if (runtime === 'claude' && env.TMUX) {
    return { configured, resolved: 'tmux', error: null };
  }

  return {
    configured,
    resolved: 'unavailable',
    error: 'workflow.codex_supervisor_transport=auto requires Codex runtime or a Claude session running inside tmux.',
  };
}

function ensureCommandExists(command) {
  try {
    execSync(`command -v ${shellEscape(command)}`, {
      stdio: 'pipe',
      shell: '/bin/zsh',
    });
    return true;
  } catch {
    return false;
  }
}

function captureTmuxPane(tmuxTarget, cwd) {
  try {
    return execFileSync('tmux', ['capture-pane', '-p', '-t', tmuxTarget], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

function waitForTmuxPaneToSettle(tmuxTarget, cwd, maxWaitMs) {
  const timeoutMs = Math.max(0, Number(maxWaitMs) || 0);
  if (timeoutMs <= 0) return;

  const pollMs = 250;
  const start = Date.now();
  let previous = null;
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    const current = captureTmuxPane(tmuxTarget, cwd);
    if (!current) {
      sleepMs(pollMs);
      continue;
    }

    if (current === previous) {
      stableCount += 1;
      if (stableCount >= 2) return;
    } else {
      stableCount = 0;
      previous = current;
    }

    sleepMs(pollMs);
  }
}

function maybeResubmitBootstrap(tmuxTarget, cwd, bootstrap) {
  const pane = captureTmuxPane(tmuxTarget, cwd);
  if (!pane) return false;

  const lines = pane.split('\n').map(line => line.trimEnd());
  const lastNonEmpty = [...lines].reverse().find(line => line.trim().length > 0) || '';
  const stillWaitingForSubmit =
    lastNonEmpty.includes(bootstrap) ||
    lastNonEmpty.trim().startsWith('$gsd-supervisor ') ||
    lastNonEmpty.includes('gsd-supervisor --bundle');

  if (stillWaitingForSubmit) {
    try {
      execFileSync('tmux', ['send-keys', '-t', tmuxTarget, 'C-m'], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function sendTmuxSubmit(tmuxTarget, cwd) {
  execFileSync('tmux', ['send-keys', '-t', tmuxTarget, 'C-m'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function supervisorBaseStatus({ manifest, stage, runtime, transport, paths, launchCommand, tmuxTarget, windowName, errorMessage }) {
  return {
    run_id: manifest.run_id || path.basename(paths.abs.bundle, '.json'),
    stage,
    runtime,
    transport,
    state: 'pending',
    bundle_path: paths.rel.bundle,
    findings_path: paths.rel.findings,
    report_path: paths.rel.report,
    tmux_target: tmuxTarget || null,
    window_name: windowName || null,
    launch_command: launchCommand || null,
    started_at: null,
    completed_at: null,
    error: errorMessage || null,
  };
}

function findArtifactBySuffixes(fullDir, suffixes) {
  try {
    const suffixList = Array.isArray(suffixes) ? suffixes : [suffixes];
    const matches = fs.readdirSync(fullDir)
      .filter(name => suffixList.some(suffix => name.endsWith(suffix)))
      .sort();
    return matches.length > 0 ? path.join(fullDir, matches[0]) : null;
  } catch {
    return null;
  }
}

function extractPhaseNumberFromDir(fullPath) {
  const match = path.basename(fullPath).match(/^(\d+[A-Z]?(?:\.\d+)*)/i);
  return match ? match[1] : null;
}

function extractRequirementsFromRoadmapSection(section) {
  if (!section) return [];
  const match = section.match(/^\*\*Requirements\*\*:[^\S\n]*([^\n]*)$/mi);
  if (!match) return [];
  const raw = match[1].replace(/[\[\]]/g, '').trim();
  if (!raw || raw === 'TBD') return [];
  return raw.split(',').map(value => value.trim()).filter(Boolean);
}

function extractDependsOnPhases(section) {
  if (!section) return { raw: null, phase_numbers: [] };
  const match = section.match(/^\*\*Depends on:\*\*\s*([^\n]+)$/mi);
  const raw = match ? match[1].trim() : null;
  if (!raw || /^none$/i.test(raw)) {
    return { raw, phase_numbers: [] };
  }
  const phaseNumbers = [...raw.matchAll(/Phase\s+(\d+[A-Z]?(?:\.\d+)*)/gi)].map(item => item[1]);
  return { raw, phase_numbers: [...new Set(phaseNumbers)] };
}

function extractSuccessCriteria(section) {
  if (!section) return [];
  const match = section.match(/\*\*Success Criteria\*\*[^\n]*:\s*\n((?:\s*\d+\.\s*[^\n]+\n?)+)/i);
  if (!match) return [];
  return match[1]
    .trim()
    .split('\n')
    .map(line => line.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean);
}

function extractCheckpointTypes(planContent) {
  if (!planContent) return [];
  return [...new Set(
    [...planContent.matchAll(/type="checkpoint:([^"]+)"/g)].map(match => match[1].trim()).filter(Boolean)
  )];
}

function indexPhasePlansFromDir(cwd, fullPath, relPath) {
  const phaseFiles = fs.existsSync(fullPath) ? fs.readdirSync(fullPath) : [];
  const planFiles = phaseFiles.filter(name => name.endsWith('-PLAN.md') || name === 'PLAN.md').sort();
  const summaryFiles = phaseFiles.filter(name => name.endsWith('-SUMMARY.md') || name === 'SUMMARY.md').sort();
  const completedPlanIds = new Set(summaryFiles.map(name => name.replace('-SUMMARY.md', '').replace('SUMMARY.md', '')));
  const plans = [];
  const waves = {};
  const incomplete = [];
  let hasCheckpoints = false;

  for (const planFile of planFiles) {
    const planPath = path.join(fullPath, planFile);
    const content = readTextIfExists(planPath) || '';
    const frontmatter = extractFrontmatter(content);
    const planId = planFile.replace('-PLAN.md', '').replace('PLAN.md', '');
    const wave = parseInt(frontmatter.wave, 10) || 1;
    const checkpointTypes = extractCheckpointTypes(content);
    const autonomous = frontmatter.autonomous !== undefined
      ? frontmatter.autonomous === true || frontmatter.autonomous === 'true'
      : checkpointTypes.length === 0;
    const taskCount = (content.match(/<task[\s>]/gi) || []).length || (content.match(/##\s*Task\s*\d+/gi) || []).length;
    const hasSummary = completedPlanIds.has(planId);
    if (!hasSummary) incomplete.push(planId);
    if (checkpointTypes.length > 0 || !autonomous) hasCheckpoints = true;

    const planSummary = summarizePlan(cwd, planPath) || {};
    const plan = {
      id: planId,
      path: toPosixPath(path.join(relPath, planFile)),
      wave,
      autonomous,
      checkpoint_types: checkpointTypes,
      objective: xmlBlocks(content, 'objective')[0] || frontmatter.objective || null,
      requirements: frontmatter.requirements || [],
      depends_on: frontmatter.depends_on || [],
      files_modified: frontmatter.files_modified || [],
      task_count: taskCount,
      has_summary: hasSummary,
      gap_closure: frontmatter.gap_closure === true || frontmatter.gap_closure === 'true',
      must_haves: planSummary.must_haves || { truths: [], artifacts: [], key_links: [] },
      touched_files: planSummary.touched_files || [],
    };

    plans.push(plan);
    const waveKey = String(wave);
    if (!waves[waveKey]) waves[waveKey] = [];
    waves[waveKey].push(planId);
  }

  return {
    phase_dir: relPath,
    plans,
    waves,
    incomplete,
    has_checkpoints: hasCheckpoints,
    plan_count: plans.length,
    summary_count: summaryFiles.length,
    summary_paths: summaryFiles.map(name => toPosixPath(path.join(relPath, name))),
  };
}

function summarizeVerification(cwd, verificationPath) {
  if (!verificationPath) return null;
  const content = readTextIfExists(verificationPath);
  if (!content) return null;
  const frontmatter = extractFrontmatter(content);
  return {
    path: toRelOrNull(cwd, verificationPath),
    status: extractVerificationStatus(content),
    score: frontmatter.score || null,
    previous_status: frontmatter.re_verification?.previous_status || null,
    gaps: frontmatter.gaps || [],
    human_verification: frontmatter.human_verification || [],
    gaps_summary: markdownSection(content, 'Gaps Summary'),
    human_verification_section: markdownSection(content, 'Human Verification Required'),
    requirements_coverage_section: markdownSection(content, 'Requirements Coverage'),
  };
}

function summarizeUat(cwd, uatPath) {
  if (!uatPath) return null;
  const content = readTextIfExists(uatPath);
  if (!content) return null;
  const frontmatter = extractFrontmatter(content);
  const currentTestSection = markdownSection(content, 'Current Test');
  const summarySection = markdownSection(content, 'Summary');
  const gapsSection = markdownSection(content, 'Gaps');
  const currentTestNameMatch = currentTestSection ? currentTestSection.match(/name:\s*(.+)/i) : null;
  return {
    path: toRelOrNull(cwd, uatPath),
    status: frontmatter.status || null,
    started: frontmatter.started || null,
    updated: frontmatter.updated || null,
    current_test: currentTestNameMatch ? currentTestNameMatch[1].trim() : null,
    summary: summarySection || null,
    gaps: gapsSection || null,
  };
}

function collectDependencyPhaseContext(cwd, dependencyPhaseNumbers) {
  return dependencyPhaseNumbers.map(phaseNumber => {
    const phaseInfo = findPhaseInternal(cwd, phaseNumber);
    if (!phaseInfo?.directory) {
      return {
        phase_number: phaseNumber,
        found: false,
        phase_name: null,
        phase_dir: null,
        summaries: [],
      };
    }

    const fullDir = path.join(cwd, phaseInfo.directory);
    const summaries = (phaseInfo.summaries || []).map(name => {
      const summary = summarizeSummary(cwd, path.join(fullDir, name)) || {};
      return {
        plan_id: name.replace('-SUMMARY.md', '').replace('SUMMARY.md', ''),
        ...summary,
      };
    });

    return {
      phase_number: phaseInfo.phase_number,
      found: true,
      phase_name: phaseInfo.phase_name,
      phase_dir: phaseInfo.directory,
      plan_count: phaseInfo.plans?.length || 0,
      summary_count: phaseInfo.summaries?.length || 0,
      summaries,
    };
  });
}

function markdownSection(content, heading) {
  if (!content) return null;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^## ${escaped}\\s*\\n([\\s\\S]*?)(?=^##\\s|\\Z)`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function xmlBlocks(content, tagName) {
  if (!content) return [];
  const matches = [...content.matchAll(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'g'))];
  return matches.map(match => match[1].trim()).filter(Boolean);
}

function extractTaskFiles(planContent) {
  const values = xmlBlocks(planContent, 'files');
  const files = [];
  for (const value of values) {
    const lines = value.split('\n').map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
      const normalized = line.replace(/^[-*]\s*/, '');
      for (const part of normalized.split(',')) {
        const item = part.trim();
        if (item) files.push(item);
      }
    }
  }
  return [...new Set(files)];
}

function extractTaskNames(planContent) {
  return xmlBlocks(planContent, 'name');
}

function extractAssumptionBullets(section) {
  if (!section) return [];
  return section
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[-*]\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+/, '').trim());
}

function extractCommitHashes(summaryContent) {
  if (!summaryContent) return [];
  const hashes = new Set();
  for (const match of summaryContent.matchAll(/`([a-f0-9]{7,40})`/g)) {
    hashes.add(match[1]);
  }
  return [...hashes];
}

function extractSelfCheck(summaryContent) {
  if (!summaryContent) return null;
  const explicitMatch = summaryContent.match(/^##\s*Self-Check:\s*(PASSED|FAILED)\s*$/mi);
  if (explicitMatch) return explicitMatch[1].toLowerCase();

  const sectionPattern = /##\s*(?:Self[- ]?Check|Verification|Quality Check)(?::\s*(PASSED|FAILED))?/i;
  const sectionMatch = summaryContent.match(sectionPattern);
  if (!sectionMatch) return null;
  if (sectionMatch[1]) return sectionMatch[1].toLowerCase();

  const checkSection = summaryContent.slice(sectionMatch.index);
  const passPattern = /(?:all\s+)?(?:pass|passed|✓|✅|complete|succeeded)/i;
  const failPattern = /(?:fail|failed|✗|❌|incomplete|blocked)/i;
  if (failPattern.test(checkSection)) return 'failed';
  if (passPattern.test(checkSection)) return 'passed';
  return null;
}

function extractVerificationStatus(verificationContent) {
  if (!verificationContent) return null;
  const frontmatter = extractFrontmatter(verificationContent);
  if (frontmatter.status) return frontmatter.status;
  const inline = verificationContent.match(/^status:\s*([a-z_]+)/mi);
  return inline ? inline[1] : null;
}

function findStackContext(cwd, quickRelDir) {
  const stackRoot = path.join(cwd, '.planning', 'focus-stacks');
  if (!fs.existsSync(stackRoot)) return null;

  const normalizedQuick = toPosixPath(quickRelDir);

  for (const entry of fs.readdirSync(stackRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const statePath = path.join(stackRoot, entry.name, 'state.json');
    const state = readJsonIfExists(statePath);
    if (!state || !Array.isArray(state.slices)) continue;

    const sliceIndex = state.slices.findIndex(slice => {
      return slice && slice.quick_dir && toPosixPath(slice.quick_dir) === normalizedQuick;
    });
    if (sliceIndex === -1) continue;

    const slice = state.slices[sliceIndex];
    const parent = sliceIndex > 0 ? state.slices[sliceIndex - 1] : null;
    return {
      stack_id: state.stack_id || entry.name,
      stack_dir: toPosixPath(path.join('.planning', 'focus-stacks', entry.name)),
      state_path: toPosixPath(path.join('.planning', 'focus-stacks', entry.name, 'state.json')),
      slice_index: slice.index ?? sliceIndex + 1,
      slice_title: slice.title || null,
      slice_status: slice.status || null,
      quick_dir: slice.quick_dir || normalizedQuick,
      branch: slice.branch || null,
      parent_branch: slice.parent_branch || parent?.branch || null,
      dependency_note: slice.dependency_note || null,
      parent_slice: parent ? {
        index: parent.index ?? sliceIndex,
        title: parent.title || null,
        status: parent.status || null,
        branch: parent.branch || null,
      } : null,
      sibling_statuses: state.slices.map(item => ({
        index: item.index ?? null,
        title: item.title || null,
        status: item.status || null,
      })),
    };
  }

  return null;
}

function summarizePlan(cwd, planPath) {
  if (!planPath) return null;
  const content = readTextIfExists(planPath);
  if (!content) return null;
  const frontmatter = extractFrontmatter(content);
  const rawTruths = parseMustHavesBlock(content, 'truths');
  const rawArtifacts = parseMustHavesBlock(content, 'artifacts');
  const rawKeyLinks = parseMustHavesBlock(content, 'key_links');
  const parsedMustHaves = frontmatter.must_haves || {};
  const mustHaves = {
    truths: rawTruths.length > 0 ? rawTruths : (parsedMustHaves.truths || []),
    artifacts: rawArtifacts.length > 0 ? rawArtifacts : (parsedMustHaves.artifacts || []),
    key_links: rawKeyLinks.length > 0 ? rawKeyLinks : (parsedMustHaves.key_links || []),
  };
  const filesModified = frontmatter.files_modified || [];
  const taskFiles = extractTaskFiles(content);

  return {
    path: toRelOrNull(cwd, planPath),
    requirements: frontmatter.requirements || [],
    depends_on: frontmatter.depends_on || [],
    files_modified: filesModified,
    task_files: taskFiles,
    touched_files: [...new Set([...filesModified, ...taskFiles])],
    must_haves: mustHaves,
    constraints: markdownSection(content, 'Constraints'),
    do_not_touch: markdownSection(content, 'Do Not Touch'),
    review: markdownSection(content, 'Review'),
    assumptions: extractAssumptionBullets(markdownSection(content, 'Assumptions')),
    open_questions: extractAssumptionBullets(markdownSection(content, 'Open Questions')),
    task_names: extractTaskNames(content),
  };
}

function summarizeSummary(cwd, summaryPath) {
  if (!summaryPath) return null;
  const content = readTextIfExists(summaryPath);
  if (!content) return null;
  const frontmatter = extractFrontmatter(content);
  const keyFiles = frontmatter['key-files'] || {};
  const created = keyFiles.created || [];
  const modified = keyFiles.modified || [];

  return {
    path: toRelOrNull(cwd, summaryPath),
    one_liner: frontmatter['one-liner'] || null,
    requirements_completed: frontmatter['requirements-completed'] || [],
    key_files: {
      created,
      modified,
      all: [...new Set([...created, ...modified])],
    },
    decisions: frontmatter['key-decisions'] || [],
    deviations_section: markdownSection(content, 'Deviations from Plan'),
    issues_section: markdownSection(content, 'Issues Encountered'),
    self_check: extractSelfCheck(content),
    commit_hashes: extractCommitHashes(content),
  };
}

function normalizeFinding(finding) {
  return {
    severity: finding?.severity || 'info',
    category: finding?.category || 'general',
    title: finding?.title || 'Untitled finding',
    evidence: finding?.evidence || '',
    recommended_action: finding?.recommended_action || '',
  };
}

function normalizeSupervisorFindings(content) {
  let parsed = null;

  try {
    parsed = JSON.parse(content);
  } catch {
    const fenced = content.match(/```json\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        parsed = JSON.parse(fenced[1]);
      } catch {}
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      stage: null,
      status: 'blocked',
      findings: [{
        severity: 'blocker',
        category: 'parse',
        title: 'Supervisor findings were not valid JSON',
        evidence: content.trim(),
        recommended_action: 'Re-run the Codex supervisor and ensure it returns the expected JSON payload.',
      }],
    };
  }

  const findings = Array.isArray(parsed.findings) ? parsed.findings.map(normalizeFinding) : [];
  const status = parsed.status || (findings.some(f => f.severity === 'blocker')
    ? 'blocked'
    : findings.length > 0
      ? 'warnings'
      : 'passed');

  return {
    stage: parsed.stage || null,
    status,
    findings,
  };
}

function cmdSupervisorBundle(cwd, dirArg, stage, raw, kind = 'quick') {
  const normalizedKind = normalizeSupervisorKind(kind);
  if (!stage || !validSupervisorStages(normalizedKind).includes(stage)) {
    const stageHelp = normalizedKind === 'phase' ? 'plan|execute' : 'pre|post';
    error(`Usage: supervisor-bundle <dir> --stage ${stageHelp}${normalizedKind === 'phase' ? ' --kind phase' : ''}`);
  }

  const { fullPath, relPath } = parseQuickDir(cwd, dirArg);
  const manifestPath = path.join(fullPath, supervisorManifestName(normalizedKind));
  const manifest = readJsonIfExists(manifestPath) || {};
  const paths = supervisorArtifactPaths(fullPath, relPath, normalizedKind, stage);

  if (normalizedKind === 'phase') {
    const phaseNumber = manifest.phase_number || extractPhaseNumberFromDir(fullPath);
    const phaseInfo = phaseNumber ? findPhaseInternal(cwd, phaseNumber) : null;
    const roadmapPhase = phaseNumber ? getRoadmapPhaseInternal(cwd, phaseNumber) : null;
    const contextPath = manifest.context_path ? path.join(cwd, manifest.context_path) : findArtifactBySuffixes(fullPath, ['-CONTEXT.md', 'CONTEXT.md']);
    const researchPath = manifest.research_path ? path.join(cwd, manifest.research_path) : findArtifactBySuffixes(fullPath, ['-RESEARCH.md', 'RESEARCH.md']);
    const importPath = manifest.import_path ? path.join(cwd, manifest.import_path) : findArtifactBySuffixes(fullPath, ['-IMPORT.md', 'IMPORT.md']);
    const validationPath = manifest.validation_path ? path.join(cwd, manifest.validation_path) : findArtifactBySuffixes(fullPath, ['-VALIDATION.md', 'VALIDATION.md']);
    const verificationPath = manifest.verification_path ? path.join(cwd, manifest.verification_path) : findArtifactBySuffixes(fullPath, ['-VERIFICATION.md', 'VERIFICATION.md']);
    const uatPath = manifest.uat_path ? path.join(cwd, manifest.uat_path) : findArtifactBySuffixes(fullPath, ['-UAT.md', 'UAT.md']);
    const planIndex = indexPhasePlansFromDir(cwd, fullPath, relPath);
    const dependsOn = extractDependsOnPhases(roadmapPhase?.section || '');
    const phaseRequirements = extractRequirementsFromRoadmapSection(roadmapPhase?.section || '');
    const dependencyPhases = collectDependencyPhaseContext(cwd, dependsOn.phase_numbers);

    const bundle = {
      kind: 'phase',
      stage,
      generated_at: new Date().toISOString(),
      phase: {
        run_id: manifest.run_id || `phase-${phaseNumber || path.basename(fullPath)}`,
        phase_number: phaseNumber,
        phase_name: manifest.phase_name || phaseInfo?.phase_name || roadmapPhase?.phase_name || null,
        phase_slug: manifest.phase_slug || phaseInfo?.phase_slug || null,
        phase_dir: relPath,
        goal: roadmapPhase?.goal || null,
        success_criteria: extractSuccessCriteria(roadmapPhase?.section || ''),
        requirements: phaseRequirements,
        depends_on: dependsOn.phase_numbers,
        depends_on_raw: dependsOn.raw,
        planner_status: manifest.planner_status || null,
        checker_status: manifest.checker_status || null,
        execution_status: manifest.execution_status || null,
        verification_status: manifest.verification_status || null,
        supervisor_plan_status: manifest.supervisor_plan_status || null,
        supervisor_execute_status: manifest.supervisor_execute_status || null,
        final_status: manifest.final_status || null,
        runtime_context: manifest.supervisor_runtime || null,
        supervisor_transport: manifest.supervisor_transport || null,
      },
      artifacts: {
        manifest_path: toRelOrNull(cwd, manifestPath),
        state_path: '.planning/STATE.md',
        roadmap_path: '.planning/ROADMAP.md',
        requirements_path: '.planning/REQUIREMENTS.md',
        context_path: toRelOrNull(cwd, contextPath),
        research_path: toRelOrNull(cwd, researchPath),
        import_path: toRelOrNull(cwd, importPath),
        validation_path: toRelOrNull(cwd, validationPath),
        verification_path: toRelOrNull(cwd, verificationPath),
        uat_path: toRelOrNull(cwd, uatPath),
        bundle_path: paths.rel.bundle,
        status_path: paths.rel.status,
        findings_path: paths.rel.findings,
        report_path: paths.rel.report,
        latest_findings_path: paths.rel.latestFindings,
        latest_report_path: paths.rel.latestReport,
      },
      plans: planIndex,
      dependencies: dependencyPhases,
      source_artifacts: {
        json_sidecars: findSourceJsonArtifacts(fullPath, 'phase').map(name => toPosixPath(path.join(relPath, name))),
      },
    };

    if (stage === 'execute') {
      const verification = summarizeVerification(cwd, verificationPath);
      const uat = summarizeUat(cwd, uatPath);
      const effectiveVerificationStatus = manifest.verification_status || verification?.status || null;
      const verificationPassed =
        effectiveVerificationStatus === 'passed' ||
        effectiveVerificationStatus === 'human_needed-approved';
      const summaries = (phaseInfo?.summaries || planIndex.summary_paths.map(summaryPath => path.basename(summaryPath))).map(name => {
        const summary = summarizeSummary(cwd, path.join(fullPath, name)) || {};
        return {
          plan_id: name.replace('-SUMMARY.md', '').replace('SUMMARY.md', ''),
          ...summary,
        };
      });

      bundle.execution = {
        summaries,
        verifier: verification,
        uat,
        completion_ready: {
          all_plans_completed: planIndex.incomplete.length === 0 && planIndex.plan_count > 0,
          verification_passed: verificationPassed,
          has_uat: !!uat,
          ready_for_phase_complete: planIndex.incomplete.length === 0 && verificationPassed,
        },
      };
    }

    fs.writeFileSync(paths.abs.bundle, JSON.stringify(bundle, null, 2), 'utf-8');
    output({
      kind: 'phase',
      stage,
      bundle_path: paths.rel.bundle,
      phase_dir: relPath,
    }, raw, paths.rel.bundle);
    return;
  }

  const planPath = manifest.plan_path
    ? path.join(cwd, manifest.plan_path)
    : findQuickArtifact(fullPath, '-PLAN.md');
  const contextPath = manifest.context_path
    ? path.join(cwd, manifest.context_path)
    : findQuickArtifact(fullPath, '-CONTEXT.md');
  const summaryPath = manifest.summary_path
    ? path.join(cwd, manifest.summary_path)
    : findQuickArtifact(fullPath, '-SUMMARY.md');
  const verificationPath = manifest.verification_path
    ? path.join(cwd, manifest.verification_path)
    : findQuickArtifact(fullPath, '-VERIFICATION.md');
  const stackContext = manifest.stack_state_path
    ? {
        ...findStackContext(cwd, relPath),
        state_path: manifest.stack_state_path,
      }
    : findStackContext(cwd, relPath);

  const plan = summarizePlan(cwd, planPath);
  const summary = stage === 'post' ? summarizeSummary(cwd, summaryPath) : null;
  const verificationContent = stage === 'post' && verificationPath ? readTextIfExists(verificationPath) : null;
  const verificationStatus = extractVerificationStatus(verificationContent);

  const bundle = {
    kind: 'quick',
    stage,
    generated_at: new Date().toISOString(),
    task: {
      run_id: manifest.run_id || path.basename(fullPath),
      mode: manifest.mode || 'quick',
      classifier: manifest.classifier || (manifest.mode === 'focus' ? 'unknown' : 'quick'),
      description: manifest.description || null,
      quick_dir: relPath,
      context_path: toRelOrNull(cwd, contextPath),
      plan_path: toRelOrNull(cwd, planPath),
      summary_path: toRelOrNull(cwd, summaryPath),
      stack_state_path: manifest.stack_state_path || stackContext?.state_path || null,
      planner_status: manifest.planner_status || null,
      execution_status: manifest.execution_status || null,
      verification_status: manifest.verification_status || verificationStatus,
      supervisor_pre_status: manifest.supervisor_pre_status || null,
      supervisor_post_status: manifest.supervisor_post_status || null,
      final_status: manifest.final_status || null,
    },
    artifacts: {
      manifest_path: toRelOrNull(cwd, manifestPath),
      state_path: '.planning/STATE.md',
      context_path: toRelOrNull(cwd, contextPath),
      plan_path: toRelOrNull(cwd, planPath),
      summary_path: toRelOrNull(cwd, summaryPath),
      verification_path: toRelOrNull(cwd, verificationPath),
      stack_state_path: manifest.stack_state_path || stackContext?.state_path || null,
      bundle_path: paths.rel.bundle,
      status_path: paths.rel.status,
      findings_path: paths.rel.findings,
      report_path: paths.rel.report,
      latest_findings_path: paths.rel.latestFindings,
      latest_report_path: paths.rel.latestReport,
    },
    plan,
    stack_context: stackContext,
    source_artifacts: {
      json_sidecars: findSourceJsonArtifacts(fullPath, 'quick').map(name => toPosixPath(path.join(relPath, name))),
    },
  };

  if (stage === 'post') {
    bundle.execution = {
      summary,
      changed_files: summary?.key_files?.all || [],
      commit_hashes: summary?.commit_hashes || [],
      self_check: summary?.self_check || null,
      verifier: {
        path: toRelOrNull(cwd, verificationPath),
        status: verificationStatus,
      },
      unresolved: {
        deviations: summary?.deviations_section || null,
        issues: summary?.issues_section || null,
      },
    };
  }

  fs.writeFileSync(paths.abs.bundle, JSON.stringify(bundle, null, 2), 'utf-8');
  output({
    kind: 'quick',
    stage,
    bundle_path: paths.rel.bundle,
    quick_dir: relPath,
  }, raw, paths.rel.bundle);
}

function cmdSupervisorFindings(cwd, findingsPathArg, raw) {
  if (!findingsPathArg) {
    error('findings-path required for supervisor-findings');
  }

  const fullPath = path.isAbsolute(findingsPathArg) ? findingsPathArg : path.join(cwd, findingsPathArg);
  if (!fs.existsSync(fullPath)) {
    output({ error: 'File not found', path: findingsPathArg }, raw);
    return;
  }

  const normalized = normalizeSupervisorFindings(fs.readFileSync(fullPath, 'utf-8'));
  normalized.path = toPosixPath(path.relative(cwd, fullPath));
  output(normalized, raw, normalized.status);
}

function cmdSupervisorLaunch(cwd, dirArg, stage, raw, kind = 'quick') {
  const normalizedKind = normalizeSupervisorKind(kind);
  if (!stage || !validSupervisorStages(normalizedKind).includes(stage)) {
    const stageHelp = normalizedKind === 'phase' ? 'plan|execute' : 'pre|post';
    error(`Usage: supervisor-launch <dir> --stage ${stageHelp}${normalizedKind === 'phase' ? ' --kind phase' : ''}`);
  }

  const { fullPath, relPath } = parseQuickDir(cwd, dirArg);
  const paths = supervisorArtifactPaths(fullPath, relPath, normalizedKind, stage);
  const manifest = readJsonIfExists(path.join(fullPath, supervisorManifestName(normalizedKind))) || {};
  const config = loadConfig(cwd);
  const runtime = detectRuntimeContext();
  const transport = resolveCodexSupervisorTransport(config, runtime);
  const launchCommand = config.codex_launch_command || 'codex';
  const runId = manifest.run_id || path.basename(fullPath);
  const windowName = `gsd-supervisor-${normalizedKind}-${runId.replace(/[^a-zA-Z0-9-]/g, '-')}-${stage}`;

  if (!fs.existsSync(paths.abs.bundle)) {
    error(`Supervisor bundle not found: ${paths.rel.bundle}. Run supervisor-bundle first.`);
  }

  const fail = (message) => {
    const status = supervisorBaseStatus({
      manifest,
      stage,
      runtime,
      transport: transport.resolved,
      paths,
      launchCommand,
      windowName,
      errorMessage: message,
    });
    status.state = 'failed';
    status.completed_at = new Date().toISOString();
    writeJsonFile(paths.abs.status, status);
    output(status, raw, 'failed');
  };

  if (transport.error) {
    return fail(transport.error);
  }

  if (transport.resolved !== 'tmux') {
    return fail(`supervisor-launch only supports tmux transport, resolved transport was "${transport.resolved}".`);
  }

  if (!process.env.TMUX) {
    return fail('TMUX is not set. Start the Claude session inside tmux before enabling automated Codex supervisor handoff.');
  }

  if (!ensureCommandExists('tmux')) {
    return fail('tmux is not installed or not available on PATH.');
  }

  const status = supervisorBaseStatus({
    manifest,
    stage,
    runtime,
    transport: 'tmux',
    paths,
    launchCommand,
    windowName,
  });
  status.state = 'launching';
  status.started_at = new Date().toISOString();
  writeJsonFile(paths.abs.status, status);

  let tmuxTarget = null;
  try {
    tmuxTarget = execFileSync('tmux', [
      'new-window',
      '-P',
      '-F',
      '#{session_name}:#{window_index}',
      '-n',
      windowName,
      '-c',
      cwd,
      launchCommand,
    ], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    return fail(`Failed to create tmux window: ${String(err.stderr || err.message || '').trim()}`);
  }

  status.tmux_target = tmuxTarget || null;
  writeJsonFile(paths.abs.status, status);

  sleepMs(Math.max(0, Number(config.codex_boot_delay_ms) || 0));
  waitForTmuxPaneToSettle(tmuxTarget, cwd, 1500);

  const bootstrap = [
    '$gsd-supervisor',
    '--bundle', shellEscape(paths.abs.bundle),
    '--stage', stage,
    '--status', shellEscape(paths.abs.status),
    '--findings', shellEscape(paths.abs.findings),
    '--report', shellEscape(paths.abs.report),
  ].join(' ');

  try {
    execFileSync('tmux', ['send-keys', '-t', tmuxTarget, '-l', bootstrap], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    sendTmuxSubmit(tmuxTarget, cwd);
    sleepMs(250);
    // A second submit is harmless if Codex already accepted the command,
    // and often fixes cases where startup focus races the first newline.
    sendTmuxSubmit(tmuxTarget, cwd);
    sleepMs(250);
    maybeResubmitBootstrap(tmuxTarget, cwd, bootstrap);
  } catch (err) {
    return fail(`Failed to send bootstrap command to tmux window: ${String(err.stderr || err.message || '').trim()}`);
  }

  status.state = 'running';
  writeJsonFile(paths.abs.status, status);
  output(status, raw, tmuxTarget || 'running');
}

function cmdSupervisorWait(cwd, dirArg, stage, raw, kind = 'quick') {
  const normalizedKind = normalizeSupervisorKind(kind);
  if (!stage || !validSupervisorStages(normalizedKind).includes(stage)) {
    const stageHelp = normalizedKind === 'phase' ? 'plan|execute' : 'pre|post';
    error(`Usage: supervisor-wait <dir> --stage ${stageHelp}${normalizedKind === 'phase' ? ' --kind phase' : ''}`);
  }

  const { fullPath, relPath } = parseQuickDir(cwd, dirArg);
  const paths = supervisorArtifactPaths(fullPath, relPath, normalizedKind, stage);
  const config = loadConfig(cwd);
  const pollMs = Math.max(100, Number(config.codex_supervisor_poll_ms) || 2000);
  const timeoutMs = Math.max(pollMs, (Number(config.codex_supervisor_timeout_seconds) || 1800) * 1000);
  const started = Date.now();
  let status = readSupervisorStatus(paths.abs.status);

  if (!status) {
    error(`Supervisor status file not found: ${paths.rel.status}. Run supervisor-launch first.`);
  }

  while (!SUPERVISOR_TERMINAL_STATES.has(status.state)) {
    if (Date.now() - started >= timeoutMs) {
      status.state = 'timeout';
      status.completed_at = new Date().toISOString();
      status.error = status.error || `Timed out waiting for supervisor after ${Math.round(timeoutMs / 1000)} seconds.`;
      writeJsonFile(paths.abs.status, status);
      break;
    }

    if (status.tmux_target && ensureCommandExists('tmux')) {
      try {
        execFileSync('tmux', ['has-session', '-t', status.tmux_target], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        status.state = 'failed';
        status.completed_at = new Date().toISOString();
        status.error = status.error || `Supervisor tmux window exited before writing a terminal status: ${status.tmux_target}`;
        writeJsonFile(paths.abs.status, status);
        break;
      }
    }

    sleepMs(pollMs);
    status = readSupervisorStatus(paths.abs.status) || status;
  }

  if ((status.state === 'passed' || status.state === 'warnings' || status.state === 'blocked')
      && (!fs.existsSync(paths.abs.findings) || !fs.existsSync(paths.abs.report))) {
    const artifactWaitStart = Date.now();
    while (Date.now() - artifactWaitStart < timeoutMs) {
      if (fs.existsSync(paths.abs.findings) && fs.existsSync(paths.abs.report)) {
        break;
      }
      sleepMs(pollMs);
      status = readSupervisorStatus(paths.abs.status) || status;
      if (status.state === 'failed' || status.state === 'timeout') break;
    }

    if (!fs.existsSync(paths.abs.findings) || !fs.existsSync(paths.abs.report)) {
      status.state = 'timeout';
      status.completed_at = new Date().toISOString();
      status.error = status.error || 'Supervisor reached a terminal state before writing findings/report artifacts.';
      writeJsonFile(paths.abs.status, status);
    }
  }

  if (status.state === 'passed' || status.state === 'warnings' || status.state === 'blocked') {
    updateLatestSupervisorOutputs(paths);
  }

  if (status.tmux_target && ensureCommandExists('tmux')) {
    const keepOnFailure = !!config.codex_keep_window_on_failure;
    const keepOnSuccess = !!config.codex_keep_window_on_success;
    const shouldKill =
      ((status.state === 'passed' || status.state === 'warnings' || status.state === 'blocked') && !keepOnSuccess) ||
      ((status.state === 'failed' || status.state === 'timeout') && !keepOnFailure);

    if (shouldKill) {
      try {
        execFileSync('tmux', ['kill-window', '-t', status.tmux_target], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {}
    }
  }

  status.path = paths.rel.status;
  output(status, raw, status.state);
}

function cmdGenerateSlug(text, raw) {
  if (!text) {
    error('text required for slug generation');
  }

  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const result = { slug };
  output(result, raw, slug);
}

function cmdCurrentTimestamp(format, raw) {
  const now = new Date();
  let result;

  switch (format) {
    case 'date':
      result = now.toISOString().split('T')[0];
      break;
    case 'filename':
      result = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
      break;
    case 'full':
    default:
      result = now.toISOString();
      break;
  }

  output({ timestamp: result }, raw, result);
}

function cmdListTodos(cwd, area, raw) {
  const pendingDir = path.join(planningDir(cwd), 'todos', 'pending');

  let count = 0;
  const todos = [];

  try {
    const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(pendingDir, file), 'utf-8');
        const createdMatch = content.match(/^created:\s*(.+)$/m);
        const titleMatch = content.match(/^title:\s*(.+)$/m);
        const areaMatch = content.match(/^area:\s*(.+)$/m);

        const todoArea = areaMatch ? areaMatch[1].trim() : 'general';

        // Apply area filter if specified
        if (area && todoArea !== area) continue;

        count++;
        todos.push({
          file,
          created: createdMatch ? createdMatch[1].trim() : 'unknown',
          title: titleMatch ? titleMatch[1].trim() : 'Untitled',
          area: todoArea,
          path: toPosixPath(path.relative(cwd, path.join(pendingDir, file))),
        });
      } catch { /* intentionally empty */ }
    }
  } catch { /* intentionally empty */ }

  const result = { count, todos };
  output(result, raw, count.toString());
}

function cmdVerifyPathExists(cwd, targetPath, raw) {
  if (!targetPath) {
    error('path required for verification');
  }

  // Reject null bytes and validate path does not contain traversal attempts
  if (targetPath.includes('\0')) {
    error('path contains null bytes');
  }

  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);

  try {
    const stats = fs.statSync(fullPath);
    const type = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
    const result = { exists: true, type };
    output(result, raw, 'true');
  } catch {
    const result = { exists: false, type: null };
    output(result, raw, 'false');
  }
}

function cmdHistoryDigest(cwd, raw) {
  const phasesDir = planningPaths(cwd).phases;
  const digest = { phases: {}, decisions: [], tech_stack: new Set() };

  // Collect all phase directories: archived + current
  const allPhaseDirs = [];

  // Add archived phases first (oldest milestones first)
  const archived = getArchivedPhaseDirs(cwd);
  for (const a of archived) {
    allPhaseDirs.push({ name: a.name, fullPath: a.fullPath, milestone: a.milestone });
  }

  // Add current phases
  if (fs.existsSync(phasesDir)) {
    try {
      const currentDirs = fs.readdirSync(phasesDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
      for (const dir of currentDirs) {
        allPhaseDirs.push({ name: dir, fullPath: path.join(phasesDir, dir), milestone: null });
      }
    } catch { /* intentionally empty */ }
  }

  if (allPhaseDirs.length === 0) {
    digest.tech_stack = [];
    output(digest, raw);
    return;
  }

  try {
    for (const { name: dir, fullPath: dirPath } of allPhaseDirs) {
      const summaries = fs.readdirSync(dirPath).filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');

      for (const summary of summaries) {
        try {
          const content = fs.readFileSync(path.join(dirPath, summary), 'utf-8');
          const fm = extractFrontmatter(content);

          const phaseNum = fm.phase || dir.split('-')[0];

          if (!digest.phases[phaseNum]) {
            digest.phases[phaseNum] = {
              name: fm.name || dir.split('-').slice(1).join(' ') || 'Unknown',
              provides: new Set(),
              affects: new Set(),
              patterns: new Set(),
            };
          }

          // Merge provides
          if (fm['dependency-graph'] && fm['dependency-graph'].provides) {
            fm['dependency-graph'].provides.forEach(p => digest.phases[phaseNum].provides.add(p));
          } else if (fm.provides) {
            fm.provides.forEach(p => digest.phases[phaseNum].provides.add(p));
          }

          // Merge affects
          if (fm['dependency-graph'] && fm['dependency-graph'].affects) {
            fm['dependency-graph'].affects.forEach(a => digest.phases[phaseNum].affects.add(a));
          }

          // Merge patterns
          if (fm['patterns-established']) {
            fm['patterns-established'].forEach(p => digest.phases[phaseNum].patterns.add(p));
          }

          // Merge decisions
          if (fm['key-decisions']) {
            fm['key-decisions'].forEach(d => {
              digest.decisions.push({ phase: phaseNum, decision: d });
            });
          }

          // Merge tech stack
          if (fm['tech-stack'] && fm['tech-stack'].added) {
            fm['tech-stack'].added.forEach(t => digest.tech_stack.add(typeof t === 'string' ? t : t.name));
          }

        } catch (e) {
          // Skip malformed summaries
        }
      }
    }

    // Convert Sets to Arrays for JSON output
    Object.keys(digest.phases).forEach(p => {
      digest.phases[p].provides = [...digest.phases[p].provides];
      digest.phases[p].affects = [...digest.phases[p].affects];
      digest.phases[p].patterns = [...digest.phases[p].patterns];
    });
    digest.tech_stack = [...digest.tech_stack];

    output(digest, raw);
  } catch (e) {
    error('Failed to generate history digest: ' + e.message);
  }
}

function cmdResolveModel(cwd, agentType, raw) {
  if (!agentType) {
    error('agent-type required');
  }

  const config = loadConfig(cwd);
  const profile = config.model_profile || 'balanced';
  const model = resolveModelInternal(cwd, agentType);

  const agentModels = MODEL_PROFILES[agentType];
  const result = agentModels
    ? { model, profile }
    : { model, profile, unknown_agent: true };
  output(result, raw, model);
}

function cmdCommit(cwd, message, files, raw, amend, noVerify) {
  if (!message && !amend) {
    error('commit message required');
  }

  // Sanitize commit message: strip invisible chars and injection markers
  // that could hijack agent context when commit messages are read back
  if (message) {
    const { sanitizeForPrompt } = require('./security.cjs');
    message = sanitizeForPrompt(message);
  }

  const config = loadConfig(cwd);

  // Check commit_docs config
  if (!config.commit_docs) {
    const result = { committed: false, hash: null, reason: 'skipped_commit_docs_false' };
    output(result, raw, 'skipped');
    return;
  }

  // Check if .planning is gitignored
  if (isGitIgnored(cwd, '.planning')) {
    const result = { committed: false, hash: null, reason: 'skipped_gitignored' };
    output(result, raw, 'skipped');
    return;
  }

  // Ensure branching strategy branch exists before first commit (#1278).
  // Pre-execution workflows (discuss, plan, research) commit artifacts but the branch
  // was previously only created during execute-phase — too late.
  if (config.branching_strategy && config.branching_strategy !== 'none') {
    let branchName = null;
    if (config.branching_strategy === 'phase') {
      // Determine which phase we're committing for from the file paths
      const phaseMatch = (files || []).join(' ').match(/(\d+)-/);
      if (phaseMatch) {
        const phaseNum = phaseMatch[1];
        const phaseInfo = findPhaseInternal(cwd, phaseNum);
        if (phaseInfo) {
          branchName = config.phase_branch_template
            .replace('{phase}', phaseInfo.phase_number)
            .replace('{slug}', phaseInfo.phase_slug || 'phase');
        }
      }
    } else if (config.branching_strategy === 'milestone') {
      const milestone = getMilestoneInfo(cwd);
      if (milestone && milestone.version) {
        branchName = config.milestone_branch_template
          .replace('{milestone}', milestone.version)
          .replace('{slug}', generateSlugInternal(milestone.name) || 'milestone');
      }
    }
    if (branchName) {
      const currentBranch = execGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (currentBranch.exitCode === 0 && currentBranch.stdout.trim() !== branchName) {
        // Create branch if it doesn't exist, or switch to it if it does
        const create = execGit(cwd, ['checkout', '-b', branchName]);
        if (create.exitCode !== 0) {
          execGit(cwd, ['checkout', branchName]);
        }
      }
    }
  }

  // Stage files
  const filesToStage = files && files.length > 0 ? files : ['.planning/'];
  for (const file of filesToStage) {
    const fullPath = path.join(cwd, file);
    if (!fs.existsSync(fullPath)) {
      // File was deleted/moved — stage the deletion
      execGit(cwd, ['rm', '--cached', '--ignore-unmatch', file]);
    } else {
      execGit(cwd, ['add', file]);
    }
  }

  // Commit (--no-verify skips pre-commit hooks, used by parallel executor agents)
  const commitArgs = amend ? ['commit', '--amend', '--no-edit'] : ['commit', '-m', message];
  if (noVerify) commitArgs.push('--no-verify');
  const commitResult = execGit(cwd, commitArgs);
  if (commitResult.exitCode !== 0) {
    if (commitResult.stdout.includes('nothing to commit') || commitResult.stderr.includes('nothing to commit')) {
      const result = { committed: false, hash: null, reason: 'nothing_to_commit' };
      output(result, raw, 'nothing');
      return;
    }
    const result = { committed: false, hash: null, reason: 'nothing_to_commit', error: commitResult.stderr };
    output(result, raw, 'nothing');
    return;
  }

  // Get short hash
  const hashResult = execGit(cwd, ['rev-parse', '--short', 'HEAD']);
  const hash = hashResult.exitCode === 0 ? hashResult.stdout : null;
  const result = { committed: true, hash, reason: 'committed' };
  output(result, raw, hash || 'committed');
}

function cmdCommitToSubrepo(cwd, message, files, raw) {
  if (!message) {
    error('commit message required');
  }

  const config = loadConfig(cwd);
  const subRepos = config.sub_repos;

  if (!subRepos || subRepos.length === 0) {
    error('no sub_repos configured in .planning/config.json');
  }

  if (!files || files.length === 0) {
    error('--files required for commit-to-subrepo');
  }

  // Group files by sub-repo prefix
  const grouped = {};
  const unmatched = [];
  for (const file of files) {
    const match = subRepos.find(repo => file.startsWith(repo + '/'));
    if (match) {
      if (!grouped[match]) grouped[match] = [];
      grouped[match].push(file);
    } else {
      unmatched.push(file);
    }
  }

  if (unmatched.length > 0) {
    process.stderr.write(`Warning: ${unmatched.length} file(s) did not match any sub-repo prefix: ${unmatched.join(', ')}\n`);
  }

  const repos = {};
  for (const [repo, repoFiles] of Object.entries(grouped)) {
    const repoCwd = path.join(cwd, repo);

    // Stage files (strip sub-repo prefix for paths relative to that repo)
    for (const file of repoFiles) {
      const relativePath = file.slice(repo.length + 1);
      execGit(repoCwd, ['add', relativePath]);
    }

    // Commit
    const commitResult = execGit(repoCwd, ['commit', '-m', message]);
    if (commitResult.exitCode !== 0) {
      if (commitResult.stdout.includes('nothing to commit') || commitResult.stderr.includes('nothing to commit')) {
        repos[repo] = { committed: false, hash: null, files: repoFiles, reason: 'nothing_to_commit' };
        continue;
      }
      repos[repo] = { committed: false, hash: null, files: repoFiles, reason: 'error', error: commitResult.stderr };
      continue;
    }

    // Get hash
    const hashResult = execGit(repoCwd, ['rev-parse', '--short', 'HEAD']);
    const hash = hashResult.exitCode === 0 ? hashResult.stdout : null;
    repos[repo] = { committed: true, hash, files: repoFiles };
  }

  const result = {
    committed: Object.values(repos).some(r => r.committed),
    repos,
    unmatched: unmatched.length > 0 ? unmatched : undefined,
  };
  output(result, raw, Object.entries(repos).map(([r, v]) => `${r}:${v.hash || 'skip'}`).join(' '));
}

function cmdSummaryExtract(cwd, summaryPath, fields, raw) {
  if (!summaryPath) {
    error('summary-path required for summary-extract');
  }

  const fullPath = path.join(cwd, summaryPath);

  if (!fs.existsSync(fullPath)) {
    output({ error: 'File not found', path: summaryPath }, raw);
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const fm = extractFrontmatter(content);

  // Parse key-decisions into structured format
  const parseDecisions = (decisionsList) => {
    if (!decisionsList || !Array.isArray(decisionsList)) return [];
    return decisionsList.map(d => {
      const colonIdx = d.indexOf(':');
      if (colonIdx > 0) {
        return {
          summary: d.substring(0, colonIdx).trim(),
          rationale: d.substring(colonIdx + 1).trim(),
        };
      }
      return { summary: d, rationale: null };
    });
  };

  // Build full result
  const fullResult = {
    path: summaryPath,
    one_liner: fm['one-liner'] || extractOneLinerFromBody(content) || null,
    key_files: fm['key-files'] || [],
    tech_added: (fm['tech-stack'] && fm['tech-stack'].added) || [],
    patterns: fm['patterns-established'] || [],
    decisions: parseDecisions(fm['key-decisions']),
    requirements_completed: fm['requirements-completed'] || [],
  };

  // If fields specified, filter to only those fields
  if (fields && fields.length > 0) {
    const filtered = { path: summaryPath };
    for (const field of fields) {
      if (fullResult[field] !== undefined) {
        filtered[field] = fullResult[field];
      }
    }
    output(filtered, raw);
    return;
  }

  output(fullResult, raw);
}

async function cmdWebsearch(query, options, raw) {
  const apiKey = process.env.BRAVE_API_KEY;

  if (!apiKey) {
    // No key = silent skip, agent falls back to built-in WebSearch
    output({ available: false, reason: 'BRAVE_API_KEY not set' }, raw, '');
    return;
  }

  if (!query) {
    output({ available: false, error: 'Query required' }, raw, '');
    return;
  }

  const params = new URLSearchParams({
    q: query,
    count: String(options.limit || 10),
    country: 'us',
    search_lang: 'en',
    text_decorations: 'false'
  });

  if (options.freshness) {
    params.set('freshness', options.freshness);
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey
        }
      }
    );

    if (!response.ok) {
      output({ available: false, error: `API error: ${response.status}` }, raw, '');
      return;
    }

    const data = await response.json();

    const results = (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
      age: r.age || null
    }));

    output({
      available: true,
      query,
      count: results.length,
      results
    }, raw, results.map(r => `${r.title}\n${r.url}\n${r.description}`).join('\n\n'));
  } catch (err) {
    output({ available: false, error: err.message }, raw, '');
  }
}

function cmdProgressRender(cwd, format, raw) {
  const phasesDir = planningPaths(cwd).phases;
  const roadmapPath = planningPaths(cwd).roadmap;
  const milestone = getMilestoneInfo(cwd);

  const phases = [];
  let totalPlans = 0;
  let totalSummaries = 0;

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => comparePhaseNum(a, b));

    for (const dir of dirs) {
      const dm = dir.match(/^(\d+(?:\.\d+)*)-?(.*)/);
      const phaseNum = dm ? dm[1] : dir;
      const phaseName = dm && dm[2] ? dm[2].replace(/-/g, ' ') : '';
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').length;
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').length;

      totalPlans += plans;
      totalSummaries += summaries;

      let status;
      if (plans === 0) status = 'Pending';
      else if (summaries >= plans) status = 'Complete';
      else if (summaries > 0) status = 'In Progress';
      else status = 'Planned';

      phases.push({ number: phaseNum, name: phaseName, plans, summaries, status });
    }
  } catch { /* intentionally empty */ }

  const percent = totalPlans > 0 ? Math.min(100, Math.round((totalSummaries / totalPlans) * 100)) : 0;

  if (format === 'table') {
    // Render markdown table
    const barWidth = 10;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
    let out = `# ${milestone.version} ${milestone.name}\n\n`;
    out += `**Progress:** [${bar}] ${totalSummaries}/${totalPlans} plans (${percent}%)\n\n`;
    out += `| Phase | Name | Plans | Status |\n`;
    out += `|-------|------|-------|--------|\n`;
    for (const p of phases) {
      out += `| ${p.number} | ${p.name} | ${p.summaries}/${p.plans} | ${p.status} |\n`;
    }
    output({ rendered: out }, raw, out);
  } else if (format === 'bar') {
    const barWidth = 20;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
    const text = `[${bar}] ${totalSummaries}/${totalPlans} plans (${percent}%)`;
    output({ bar: text, percent, completed: totalSummaries, total: totalPlans }, raw, text);
  } else {
    // JSON format
    output({
      milestone_version: milestone.version,
      milestone_name: milestone.name,
      phases,
      total_plans: totalPlans,
      total_summaries: totalSummaries,
      percent,
    }, raw);
  }
}

/**
 * Match pending todos against a phase's goal/name/requirements.
 * Returns todos with relevance scores based on keyword, area, and file overlap.
 * Used by discuss-phase to surface relevant todos before scope-setting.
 */
function cmdTodoMatchPhase(cwd, phase, raw) {
  if (!phase) { error('phase required for todo match-phase'); }

  const pendingDir = path.join(planningDir(cwd), 'todos', 'pending');
  const todos = [];

  // Load pending todos
  try {
    const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(pendingDir, file), 'utf-8');
        const titleMatch = content.match(/^title:\s*(.+)$/m);
        const areaMatch = content.match(/^area:\s*(.+)$/m);
        const filesMatch = content.match(/^files:\s*(.+)$/m);
        const body = content.replace(/^(title|area|files|created|priority):.*$/gm, '').trim();

        todos.push({
          file,
          title: titleMatch ? titleMatch[1].trim() : 'Untitled',
          area: areaMatch ? areaMatch[1].trim() : 'general',
          files: filesMatch ? filesMatch[1].trim().split(/[,\s]+/).filter(Boolean) : [],
          body: body.slice(0, 200), // first 200 chars for context
        });
      } catch {}
    }
  } catch {}

  if (todos.length === 0) {
    output({ phase, matches: [], todo_count: 0 }, raw);
    return;
  }

  // Load phase goal/name from ROADMAP
  const phaseInfo = getRoadmapPhaseInternal(cwd, phase);
  const phaseName = phaseInfo ? (phaseInfo.phase_name || '') : '';
  const phaseGoal = phaseInfo ? (phaseInfo.goal || '') : '';
  const phaseSection = phaseInfo ? (phaseInfo.section || '') : '';

  // Build keyword set from phase name + goal + section text
  const phaseText = `${phaseName} ${phaseGoal} ${phaseSection}`.toLowerCase();
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'will', 'are', 'was', 'has', 'have', 'been', 'not', 'but', 'all', 'can', 'into', 'each', 'when', 'any', 'use', 'new']);
  const phaseKeywords = new Set(
    phaseText.split(/[\s\-_/.,;:()\[\]{}|]+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length > 2 && !stopWords.has(w))
  );

  // Find phase directory to get expected file paths
  const phaseInfoDisk = findPhaseInternal(cwd, phase);
  const phasePlans = [];
  if (phaseInfoDisk && phaseInfoDisk.found) {
    try {
      const phaseDir = path.join(cwd, phaseInfoDisk.directory);
      const planFiles = fs.readdirSync(phaseDir).filter(f => f.endsWith('-PLAN.md'));
      for (const pf of planFiles) {
        try {
          const planContent = fs.readFileSync(path.join(phaseDir, pf), 'utf-8');
          const fmFiles = planContent.match(/files_modified:\s*\[([^\]]*)\]/);
          if (fmFiles) {
            phasePlans.push(...fmFiles[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean));
          }
        } catch {}
      }
    } catch {}
  }

  // Score each todo for relevance
  const matches = [];
  for (const todo of todos) {
    let score = 0;
    const reasons = [];

    // Keyword match: todo title/body terms in phase text
    const todoWords = `${todo.title} ${todo.body}`.toLowerCase()
      .split(/[\s\-_/.,;:()\[\]{}|]+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length > 2 && !stopWords.has(w));

    const matchedKeywords = todoWords.filter(w => phaseKeywords.has(w));
    if (matchedKeywords.length > 0) {
      score += Math.min(matchedKeywords.length * 0.2, 0.6);
      reasons.push(`keywords: ${[...new Set(matchedKeywords)].slice(0, 5).join(', ')}`);
    }

    // Area match: todo area appears in phase text
    if (todo.area !== 'general' && phaseText.includes(todo.area.toLowerCase())) {
      score += 0.3;
      reasons.push(`area: ${todo.area}`);
    }

    // File match: todo files overlap with phase plan files
    if (todo.files.length > 0 && phasePlans.length > 0) {
      const fileOverlap = todo.files.filter(f =>
        phasePlans.some(pf => pf.includes(f) || f.includes(pf))
      );
      if (fileOverlap.length > 0) {
        score += 0.4;
        reasons.push(`files: ${fileOverlap.slice(0, 3).join(', ')}`);
      }
    }

    if (score > 0) {
      matches.push({
        file: todo.file,
        title: todo.title,
        area: todo.area,
        score: Math.round(score * 100) / 100,
        reasons,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  output({ phase, matches, todo_count: todos.length }, raw);
}

function cmdTodoComplete(cwd, filename, raw) {
  if (!filename) {
    error('filename required for todo complete');
  }

  const pendingDir = path.join(planningDir(cwd), 'todos', 'pending');
  const completedDir = path.join(planningDir(cwd), 'todos', 'completed');
  const sourcePath = path.join(pendingDir, filename);

  if (!fs.existsSync(sourcePath)) {
    error(`Todo not found: ${filename}`);
  }

  // Ensure completed directory exists
  fs.mkdirSync(completedDir, { recursive: true });

  // Read, add completion timestamp, move
  let content = fs.readFileSync(sourcePath, 'utf-8');
  const today = new Date().toISOString().split('T')[0];
  content = `completed: ${today}\n` + content;

  fs.writeFileSync(path.join(completedDir, filename), content, 'utf-8');
  fs.unlinkSync(sourcePath);

  output({ completed: true, file: filename, date: today }, raw, 'completed');
}

function cmdScaffold(cwd, type, options, raw) {
  const { phase, name } = options;
  const padded = phase ? normalizePhaseName(phase) : '00';
  const today = new Date().toISOString().split('T')[0];

  // Find phase directory
  const phaseInfo = phase ? findPhaseInternal(cwd, phase) : null;
  const phaseDir = phaseInfo ? path.join(cwd, phaseInfo.directory) : null;

  if (phase && !phaseDir && type !== 'phase-dir') {
    error(`Phase ${phase} directory not found`);
  }

  let filePath, content;

  switch (type) {
    case 'context': {
      filePath = path.join(phaseDir, `${padded}-CONTEXT.md`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} — Context\n\n## Decisions\n\n_Decisions will be captured during /gsd:discuss-phase ${phase}_\n\n## Discretion Areas\n\n_Areas where the executor can use judgment_\n\n## Deferred Ideas\n\n_Ideas to consider later_\n`;
      break;
    }
    case 'uat': {
      filePath = path.join(phaseDir, `${padded}-UAT.md`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\nstatus: pending\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} — User Acceptance Testing\n\n## Test Results\n\n| # | Test | Status | Notes |\n|---|------|--------|-------|\n\n## Summary\n\n_Pending UAT_\n`;
      break;
    }
    case 'verification': {
      filePath = path.join(phaseDir, `${padded}-VERIFICATION.md`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\nstatus: pending\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} — Verification\n\n## Goal-Backward Verification\n\n**Phase Goal:** [From ROADMAP.md]\n\n## Checks\n\n| # | Requirement | Status | Evidence |\n|---|------------|--------|----------|\n\n## Result\n\n_Pending verification_\n`;
      break;
    }
    case 'phase-dir': {
      if (!phase || !name) {
        error('phase and name required for phase-dir scaffold');
      }
      const slug = generateSlugInternal(name);
      const dirName = `${padded}-${slug}`;
      const phasesParent = planningPaths(cwd).phases;
      fs.mkdirSync(phasesParent, { recursive: true });
      const dirPath = path.join(phasesParent, dirName);
      fs.mkdirSync(dirPath, { recursive: true });
      output({ created: true, directory: toPosixPath(path.relative(cwd, dirPath)), path: dirPath }, raw, dirPath);
      return;
    }
    default:
      error(`Unknown scaffold type: ${type}. Available: context, uat, verification, phase-dir`);
  }

  if (fs.existsSync(filePath)) {
    output({ created: false, reason: 'already_exists', path: filePath }, raw, 'exists');
    return;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  const relPath = toPosixPath(path.relative(cwd, filePath));
  output({ created: true, path: relPath }, raw, relPath);
}

function cmdStats(cwd, format, raw) {
  const phasesDir = planningPaths(cwd).phases;
  const roadmapPath = planningPaths(cwd).roadmap;
  const reqPath = planningPaths(cwd).requirements;
  const statePath = planningPaths(cwd).state;
  const milestone = getMilestoneInfo(cwd);
  const isDirInMilestone = getMilestonePhaseFilter(cwd);

  // Phase & plan stats (reuse progress pattern)
  const phasesByNumber = new Map();
  let totalPlans = 0;
  let totalSummaries = 0;

  try {
    const roadmapContent = extractCurrentMilestone(fs.readFileSync(roadmapPath, 'utf-8'), cwd);
    const headingPattern = /#{2,4}\s*Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:\s*([^\n]+)/gi;
    let match;
    while ((match = headingPattern.exec(roadmapContent)) !== null) {
      phasesByNumber.set(match[1], {
        number: match[1],
        name: match[2].replace(/\(INSERTED\)/i, '').trim(),
        plans: 0,
        summaries: 0,
        status: 'Not Started',
      });
    }
  } catch { /* intentionally empty */ }

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(isDirInMilestone)
      .sort((a, b) => comparePhaseNum(a, b));

    for (const dir of dirs) {
      const dm = dir.match(/^(\d+[A-Z]?(?:\.\d+)*)-?(.*)/i);
      const phaseNum = dm ? dm[1] : dir;
      const phaseName = dm && dm[2] ? dm[2].replace(/-/g, ' ') : '';
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').length;
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').length;

      totalPlans += plans;
      totalSummaries += summaries;

      let status;
      if (plans === 0) status = 'Not Started';
      else if (summaries >= plans) status = 'Complete';
      else if (summaries > 0) status = 'In Progress';
      else status = 'Planned';

      const existing = phasesByNumber.get(phaseNum);
      phasesByNumber.set(phaseNum, {
        number: phaseNum,
        name: existing?.name || phaseName,
        plans,
        summaries,
        status,
      });
    }
  } catch { /* intentionally empty */ }

  const phases = [...phasesByNumber.values()].sort((a, b) => comparePhaseNum(a.number, b.number));
  const completedPhases = phases.filter(p => p.status === 'Complete').length;
  const planPercent = totalPlans > 0 ? Math.min(100, Math.round((totalSummaries / totalPlans) * 100)) : 0;
  const percent = phases.length > 0 ? Math.min(100, Math.round((completedPhases / phases.length) * 100)) : 0;

  // Requirements stats
  let requirementsTotal = 0;
  let requirementsComplete = 0;
  try {
    if (fs.existsSync(reqPath)) {
      const reqContent = fs.readFileSync(reqPath, 'utf-8');
      const checked = reqContent.match(/^- \[x\] \*\*/gm);
      const unchecked = reqContent.match(/^- \[ \] \*\*/gm);
      requirementsComplete = checked ? checked.length : 0;
      requirementsTotal = requirementsComplete + (unchecked ? unchecked.length : 0);
    }
  } catch { /* intentionally empty */ }

  // Last activity from STATE.md
  let lastActivity = null;
  try {
    if (fs.existsSync(statePath)) {
      const stateContent = fs.readFileSync(statePath, 'utf-8');
      const activityMatch = stateContent.match(/^last_activity:\s*(.+)$/im)
        || stateContent.match(/\*\*Last Activity:\*\*\s*(.+)/i)
        || stateContent.match(/^Last Activity:\s*(.+)$/im)
        || stateContent.match(/^Last activity:\s*(.+)$/im);
      if (activityMatch) lastActivity = activityMatch[1].trim();
    }
  } catch { /* intentionally empty */ }

  // Git stats
  let gitCommits = 0;
  let gitFirstCommitDate = null;
  const commitCount = execGit(cwd, ['rev-list', '--count', 'HEAD']);
  if (commitCount.exitCode === 0) {
    gitCommits = parseInt(commitCount.stdout, 10) || 0;
  }
  const rootHash = execGit(cwd, ['rev-list', '--max-parents=0', 'HEAD']);
  if (rootHash.exitCode === 0 && rootHash.stdout) {
    const firstCommit = rootHash.stdout.split('\n')[0].trim();
    const firstDate = execGit(cwd, ['show', '-s', '--format=%as', firstCommit]);
    if (firstDate.exitCode === 0) {
      gitFirstCommitDate = firstDate.stdout || null;
    }
  }

  const result = {
    milestone_version: milestone.version,
    milestone_name: milestone.name,
    phases,
    phases_completed: completedPhases,
    phases_total: phases.length,
    total_plans: totalPlans,
    total_summaries: totalSummaries,
    percent,
    plan_percent: planPercent,
    requirements_total: requirementsTotal,
    requirements_complete: requirementsComplete,
    git_commits: gitCommits,
    git_first_commit_date: gitFirstCommitDate,
    last_activity: lastActivity,
  };

  if (format === 'table') {
    const barWidth = 10;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
    let out = `# ${milestone.version} ${milestone.name} \u2014 Statistics\n\n`;
    out += `**Progress:** [${bar}] ${completedPhases}/${phases.length} phases (${percent}%)\n`;
    if (totalPlans > 0) {
      out += `**Plans:** ${totalSummaries}/${totalPlans} complete (${planPercent}%)\n`;
    }
    out += `**Phases:** ${completedPhases}/${phases.length} complete\n`;
    if (requirementsTotal > 0) {
      out += `**Requirements:** ${requirementsComplete}/${requirementsTotal} complete\n`;
    }
    out += '\n';
    out += `| Phase | Name | Plans | Completed | Status |\n`;
    out += `|-------|------|-------|-----------|--------|\n`;
    for (const p of phases) {
      out += `| ${p.number} | ${p.name} | ${p.plans} | ${p.summaries} | ${p.status} |\n`;
    }
    if (gitCommits > 0) {
      out += `\n**Git:** ${gitCommits} commits`;
      if (gitFirstCommitDate) out += ` (since ${gitFirstCommitDate})`;
      out += '\n';
    }
    if (lastActivity) out += `**Last activity:** ${lastActivity}\n`;
    output({ rendered: out }, raw, out);
  } else {
    output(result, raw);
  }
}

module.exports = {
  cmdGenerateSlug,
  cmdCurrentTimestamp,
  cmdListTodos,
  cmdVerifyPathExists,
  cmdHistoryDigest,
  cmdResolveModel,
  cmdCommit,
  cmdCommitToSubrepo,
  cmdSummaryExtract,
  cmdSupervisorBundle,
  cmdSupervisorLaunch,
  cmdSupervisorWait,
  cmdSupervisorFindings,
  cmdWebsearch,
  cmdProgressRender,
  cmdTodoComplete,
  cmdTodoMatchPhase,
  cmdScaffold,
  cmdStats,
};
