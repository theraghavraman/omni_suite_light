#!/usr/bin/env node
/**
 * OmniConverter Studio — single desktop build entry point (scripts/desktop_build.cjs)
 *
 *   node scripts/desktop_build.cjs stage     # stage build/ (portable Python, tools, assets)
 *   node scripts/desktop_build.cjs package   # stage + electron-forge package
 *   node scripts/desktop_build.cjs make      # stage + electron-forge make (installers in out/make)
 *   node scripts/desktop_build.cjs smoke ... # clean-environment smoke test of a packaged/installed app
 *
 * `npm run desktop:*` and the GitHub Actions installer workflow both call this script, so
 * local and CI installers go through the identical staging and verification steps.
 * Extra arguments after the command are forwarded to scripts/stage_desktop_bundle.py.
 * Set OMNI_SKIP_STAGE=1 to reuse an already-staged (and verified-complete) build/.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const [command = 'make', ...stageArgs] = process.argv.slice(2);

if (!['stage', 'package', 'make', 'smoke'].includes(command)) {
  console.error(`Unknown command "${command}". Use stage, package, make or smoke.`);
  process.exit(2);
}

function findPython() {
  const candidates = [];
  if (process.env.OMNI_BUILD_PYTHON) candidates.push([process.env.OMNI_BUILD_PYTHON]);
  if (process.platform === 'win32') candidates.push(['python'], ['py', '-3']);
  candidates.push(['python3'], ['python']);
  for (const [exe, ...args] of candidates) {
    const probe = spawnSync(exe, [...args, '-c', 'import sys; assert sys.version_info >= (3, 10); print(sys.executable)'], {
      encoding: 'utf8',
    });
    if (probe.status === 0) return [exe, ...args];
  }
  throw new Error('Python 3.10+ is required on the build machine (set OMNI_BUILD_PYTHON to choose one).');
}

function run(exe, args, label) {
  console.log(`[desktop-build] ${label}: ${[exe, ...args].join(' ')}`);
  const result = spawnSync(exe, args, { cwd: repoRoot, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`[desktop-build] ${label} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

if (command === 'smoke') {
  const [py, ...pyArgs] = findPython();
  run(py, [...pyArgs, path.join('scripts', 'smoke_test_desktop.py'), ...stageArgs], 'smoke');
  process.exit(0);
}

if (process.env.OMNI_SKIP_STAGE !== '1') {
  const [py, ...pyArgs] = findPython();
  run(py, [...pyArgs, path.join('scripts', 'stage_desktop_bundle.py'), ...stageArgs], 'stage');
}

if (command !== 'stage') {
  const forgeCli = require.resolve('@electron-forge/cli/dist/electron-forge.js', { paths: [repoRoot] });
  run(process.execPath, [forgeCli, command], `electron-forge ${command}`);
}
