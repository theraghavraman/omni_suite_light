#!/usr/bin/env node
/**
 * Regression tests for the Electron shell's readiness and packaging logic.
 * Runs under plain Node (require('electron') yields a path string there, so main.cjs
 * skips app wiring and only exports its helpers).
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const shellMain = require(path.join(repoRoot, 'electron', 'main.cjs'));
const forge = require(path.join(repoRoot, 'electron', 'forge.config.cjs'));

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test('offline readiness verifies SHA-256, not just existence or manifest lines', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-offline-'));
  fs.mkdirSync(path.join(root, 'vendor', 'lib'), { recursive: true });
  const good = Buffer.from('good asset');
  fs.writeFileSync(path.join(root, 'vendor', 'lib', 'a.js'), good);
  fs.writeFileSync(path.join(root, 'vendor', 'lib', 'b.js'), 'tampered');
  const pins = {
    'lib/a.js': crypto.createHash('sha256').update(good).digest('hex'),
    'lib/b.js': crypto.createHash('sha256').update('original').digest('hex'),
  };
  fs.writeFileSync(path.join(root, 'offline_assets_manifest.json'), JSON.stringify(pins));
  const manifest = path.join(root, 'vendor', 'OFFLINE_ASSETS.txt');
  fs.writeFileSync(manifest, 'OmniConverter offline browser assets\n\nlib/a.js\t10\tSHA256=x\n');
  let res = shellMain.verifyOfflineManifest(manifest, root, path.join(root, 'offline_assets_manifest.json'));
  assert.equal(res.totalCount, 2);
  assert.equal(res.verifiedCount, 1);
  assert.equal(res.ready, false);
  assert.deepEqual(res.missing, ['lib/b.js']);
  fs.writeFileSync(path.join(root, 'vendor', 'lib', 'b.js'), 'original');
  res = shellMain.verifyOfflineManifest(manifest, root, path.join(root, 'offline_assets_manifest.json'));
  assert.equal(res.ready, true);
  assert.equal(res.verifiedCount, 2);
});

test('tools are only available when the engine reports they executed', () => {
  const offline = shellMain.toolsFromHealth(null);
  assert.ok(offline.every((t) => !t.available && t.reason === 'Local Engine offline'));
  const health = {
    tool_groups: {
      FFmpeg: { required: true, ready: true, path: '/bundle/bin/ffmpeg', bundled: true },
      qpdf: { required: true, ready: false, path: '/bundle/bin/qpdf', bundled: true },
    },
  };
  const tools = shellMain.toolsFromHealth(health);
  assert.equal(tools.find((t) => t.id === 'ffmpeg').available, true);
  const qpdf = tools.find((t) => t.id === 'qpdf');
  assert.equal(qpdf.available, false);
  assert.equal(qpdf.reason, 'Found but failed to run');
  assert.equal(tools.find((t) => t.id === 'pandoc').reason, 'Not installed');
  const notInstalled = shellMain.toolsFromHealth(health, ['python-runtime', 'ffmpeg'], true);
  assert.equal(notInstalled.find((t) => t.id === 'soffice').reason, 'Component not installed');
  assert.equal(notInstalled.find((t) => t.id === 'ffmpeg').available, true);
});

test('Electron tool specs cover every required native group in omni_environment', () => {
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const groups = JSON.parse(
    execFileSync(py, ['-c', 'import json, omni_environment as e; print(json.dumps(list(e.REQUIRED_NATIVE_GROUPS)))'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
  );
  const specGroups = shellMain.NATIVE_TOOL_SPECS.map((s) => s.group);
  assert.deepEqual([...specGroups].sort(), [...groups].sort());
});

test('bundled tool environment sanitizes PATH and resolves manifest env vars', () => {
  const root = path.join(os.tmpdir(), 'bundle-root');
  const env = shellMain.bundledToolEnvironment(
    root,
    { env: { TESSDATA_PREFIX: ['share/tessdata'], GS_LIB: ['a', 'b'] }, path_dirs: ['bin'] },
    { PATH: '/opt/homebrew/bin:/usr/local/bin', HOME: '/home/x' },
    true
  );
  assert.equal(env.TESSDATA_PREFIX, path.join(root, 'share/tessdata'));
  assert.equal(env.GS_LIB, [path.join(root, 'a'), path.join(root, 'b')].join(path.delimiter));
  assert.ok(env.PATH.startsWith(path.join(root, 'bin')));
  assert.ok(!env.PATH.includes('/opt/homebrew'));
  assert.equal(env.OMNI_TOOL_RESOLUTION, 'bundled');
});

test('packaged app.asar contains only the Electron shell', () => {
  const ignore = forge._internal.ignoreAppFile;
  for (const keep of ['/package.json', '/electron', '/electron/main.cjs', '/electron/preload.cjs', '/electron/components.cjs', '/electron/components-preload.cjs', '/electron/components.html', '/electron/components-ui.js', '/node_modules/electron-squirrel-startup/index.js']) {
    assert.equal(ignore(keep), false, keep);
  }
  for (const drop of ['/index.html', '/vendor/pdfjs/build/pdf.mjs', '/build', '/.desktop-cache', '/tests/x.py', '/electron/forge.config.cjs', '/.venv']) {
    assert.equal(ignore(drop), true, drop);
  }
  assert.ok(!forge.packagerConfig.extraResource, 'extraResource rewrites symlinks; resources are copied by the hook');
  assert.equal(typeof forge.hooks.packageAfterCopy, 'function');
});


const { ComponentManager, mergeComponentManifests, resolveSelection } = require(path.join(repoRoot, 'electron', 'components.cjs'));

function makeComponent(dir, id, platform, extra) {
  const src = path.join(dir, `src-${id}`);
  fs.mkdirSync(path.join(src, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(src, 'bin', 'tool'), '#!/bin/sh\necho ok\n', { mode: 0o755 });
  fs.writeFileSync(path.join(src, 'component.json'), JSON.stringify({ id, platform, version: '1.0.0', kind: 'native', tools: { [`${id}-tool`]: { path: 'bin/tool' } }, env: {}, path_dirs: ['bin'], ...extra }));
  const archive = path.join(dir, `${id}.tar.gz`);
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-czf', archive, '-C', src, '.']);
  const bytes = fs.readFileSync(archive);
  return { id, title: id, file: `${id}.tar.gz`, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length, installed_size: 100, bytes };
}

async function asyncTests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-components-'));
  const platform = `${process.platform}-${process.arch}`;
  const runtime = makeComponent(dir, 'python-runtime', platform, { kind: 'python-runtime', python: 'bin/tool', tools: {} });
  const ffmpeg = makeComponent(dir, 'ffmpeg', platform, { requires: ['python-runtime'] });
  const tampered = makeComponent(dir, 'qpdf', platform, {});
  // Same length, different bytes: must be rejected by the SHA-256 check, not the size check.
  const corrupted = Buffer.from(tampered.bytes);
  corrupted[corrupted.length - 1] ^= 0xff;
  const served = { 'python-runtime.tar.gz': runtime.bytes, 'ffmpeg.tar.gz': ffmpeg.bytes, 'qpdf.tar.gz': corrupted };
  const catalog = { platform, base_url: 'https://components.example/', components: [
    { ...runtime, bytes: undefined, requires: [] },
    { ...ffmpeg, bytes: undefined, requires: ['python-runtime'] },
    { ...tampered, bytes: undefined, requires: ['python-runtime'] },
  ] };
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalog));
  const fetched = [];
  const manager = new ComponentManager({
    catalogPath: path.join(dir, 'catalog.json'),
    rootDir: path.join(dir, 'userdata', 'components'),
    platform,
    fetchImpl: async (url) => {
      fetched.push(url);
      const name = url.split('/').pop();
      return served[name] ? new Response(served[name]) : new Response('missing', { status: 404 });
    },
  });

  assert.deepEqual(resolveSelection(catalog, ['ffmpeg']), ['python-runtime', 'ffmpeg']);
  assert.equal(manager.pythonExecutable(), null, 'nothing installed yet');
  const results = await manager.install(['ffmpeg', 'qpdf']);
  assert.equal(results['python-runtime'].ok, true);
  assert.equal(results.ffmpeg.ok, true);
  assert.equal(results.qpdf.ok, false);
  assert.match(results.qpdf.error, /Checksum mismatch/);
  assert.ok(!fs.existsSync(path.join(manager.root, 'qpdf')), 'tampered archive must never be extracted');
  assert.ok(fetched.every((u) => u.startsWith('https://components.example/')));
  const merged = JSON.parse(fs.readFileSync(path.join(manager.root, 'TOOLS_MANIFEST.json'), 'utf8'));
  assert.equal(merged.tools['ffmpeg-tool'].path, 'ffmpeg/bin/tool');
  assert.ok(!merged.tools['qpdf-tool']);
  assert.ok(manager.pythonExecutable().endsWith(path.join('python-runtime', 'bin', 'tool')));
  const second = await manager.install(['ffmpeg']);
  assert.equal(second.ffmpeg.skipped, true, 'same digest is not downloaded again');
  manager.remove('ffmpeg');
  assert.ok(!fs.existsSync(path.join(manager.root, 'ffmpeg')));
  assert.ok(!JSON.parse(fs.readFileSync(path.join(manager.root, 'TOOLS_MANIFEST.json'), 'utf8')).tools['ffmpeg-tool']);
  passed += 1;
  console.log('ok - component manager verifies, installs, merges and removes components');

  // Interrupted transfer resumes with a Range request and still verifies the whole file.
  const flakyRoot = path.join(dir, 'flaky', 'components');
  let calls = 0;
  const flaky = new ComponentManager({
    catalogPath: path.join(dir, 'catalog.json'),
    rootDir: flakyRoot,
    platform,
    fetchImpl: async (url, opts) => {
      calls += 1;
      const bytes = served[url.split('/').pop()];
      const range = opts && opts.headers && opts.headers.Range;
      if (!range) {
        // first attempt: send half the file, then the stream simply ends (dropped connection)
        return new Response(bytes.subarray(0, Math.floor(bytes.length / 2)), { status: 200 });
      }
      const from = Number(range.replace('bytes=', '').replace('-', ''));
      return new Response(bytes.subarray(from), { status: 206 });
    },
  });
  const resumed = await flaky.install(['python-runtime']);
  assert.equal(resumed['python-runtime'].ok, true, JSON.stringify(resumed));
  assert.ok(calls >= 2, 'a resume request was made');
  assert.ok(flaky.pythonExecutable());
  passed += 1;
  console.log('ok - interrupted component downloads resume and verify');

  const env = mergeComponentManifests({ a: { env: { GS_LIB: ['x'], TESSDATA_PREFIX: ['t'] } }, b: { env: { GS_LIB: ['y'], TESSDATA_PREFIX: ['u'] } } }, 'darwin-arm64').env;
  assert.deepEqual(env.GS_LIB, ['a/x', 'b/y']);
  assert.deepEqual(env.TESSDATA_PREFIX, ['a/t']);
  passed += 1;
  console.log('ok - merged component environment');
}

asyncTests().then(() => console.log(`${passed} desktop shell tests passed`)).catch((err) => {
  console.error(err);
  process.exit(1);
});
