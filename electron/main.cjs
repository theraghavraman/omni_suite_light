/**
 * OmniConverter Studio — Electron Main Process (electron/main.cjs)
 *
 * Wraps the existing HTML/JS Studio interface (index.html) in an Electron shell:
 * 1. Resolves the bundled Python runtime, Local Engine (omni_local_server.py),
 *    offline browser assets (vendor/), and bundled native CLI tools described by
 *    native-tools/<platform>-<arch>/TOOLS_MANIFEST.json.
 * 2. Starts the Python Local Engine in the background bound strictly to 127.0.0.1
 *    with OMNI_NO_BROWSER=1 so no external browser window is opened. A packaged app
 *    only ever uses its bundled runtime and tools (OMNI_TOOL_RESOLUTION=bundled,
 *    PATH limited to bundle + OS system directories).
 * 3. Polls http://127.0.0.1:<port>/healthz until the engine is ready, then loads
 *    http://127.0.0.1:<port>/ inside the BrowserWindow so ui_auth_bootstrap()
 *    injects window.OMNI_TOKEN and same-origin loopbacks succeed.
 * 4. Builds a truthful readiness report: native tools count as ready only when the
 *    engine has executed them successfully, offline assets only when their SHA-256
 *    matches the pinned manifest.
 * 5. Terminates the Python child process cleanly when Omni closes.
 *
 * Smoke-test mode: when OMNI_DESKTOP_SMOKE_REPORT=<file> is set, the app starts
 * normally, additionally runs the bundled environment verifier, writes a JSON report
 * to <file> and exits (0 = everything required is ready). Used by
 * scripts/smoke_test_desktop.py against installed/packaged builds.
 */
'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, net: electronNet, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { ComponentManager } = require('./components.cjs');

// Handle Squirrel.Windows install/update/uninstall shortcuts on Windows
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch (_) {
  // Optional when running outside Windows Squirrel installer context
}

const HOST = '127.0.0.1';
const DEFAULT_PORT = Number(process.env.OMNI_PORT || 8765);
const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_TIMEOUT_MS = Number(process.env.OMNI_ENGINE_START_TIMEOUT_MS || 120000);
const SMOKE_REPORT_PATH = process.env.OMNI_DESKTOP_SMOKE_REPORT || '';
const SMOKE_MODE = Boolean(SMOKE_REPORT_PATH);
// Smoke mode only: "all", "none" or a comma-separated list of component ids to install first.
const SMOKE_INSTALL = process.env.OMNI_SMOKE_INSTALL || 'none';

// Lets tests (and portable setups) keep all state in a chosen folder; must run before 'ready'.
if (app && process.env.OMNI_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.OMNI_USER_DATA_DIR));
}

let mainWindow = null;
let pythonProcess = null;
let enginePort = DEFAULT_PORT;
let engineToken = process.env.OMNI_TOKEN || crypto.randomBytes(24).toString('base64url');
let isQuitting = false;
let cachedReadiness = null;
let engineStartError = null;
let engineLogPath = null;
let engineLogStream = null;
const startupState = { usedFallbackUi: false, loadedUrl: null, browserOnly: false };
let componentsWindow = null;
let componentManager = null;
let componentsChanged = false;

class EngineNotInstalledError extends Error {}

function getComponentManager() {
  if (!componentManager) {
    const packaged = isPackagedApp();
    const catalogPath = packaged
      ? path.join(process.resourcesPath, 'components-catalog.json')
      : path.join(getRepoRoot(), 'build', 'components-catalog.json');
    componentManager = new ComponentManager({
      catalogPath,
      rootDir: path.join(app.getPath('userData'), 'components'),
      platform: `${process.platform}-${process.arch}`,
      fetchImpl: electronNet && typeof electronNet.fetch === 'function' ? (url, opts) => electronNet.fetch(url, opts) : globalThis.fetch,
      baseUrlOverride: process.env.OMNI_COMPONENTS_BASE_URL || '',
      log: (msg) => console.log(`[OmniComponents] ${msg}`),
    });
    componentManager.writeMergedManifest();
  }
  return componentManager;
}

function isPackagedApp() {
  return Boolean(app && app.isPackaged);
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function getRepoRoot() {
  return path.resolve(__dirname, '..');
}

/**
 * Packaged: <resources>/{omni-engine,python-runtime,native-tools,BUNDLE_MANIFEST.json}.
 * Development: the same layout under build/ when it has been staged, otherwise the
 * repository checkout (engine + UI) with a developer Python.
 */
function resolveResourcePaths() {
  const isWin = process.platform === 'win32';
  const platKey = `${process.platform}-${process.arch}`;
  const repoRoot = getRepoRoot();
  const packaged = isPackagedApp();
  const stageRoot = packaged ? process.resourcesPath : path.join(repoRoot, 'build');
  const bundleManifestPath = path.join(stageRoot, 'BUNDLE_MANIFEST.json');
  const stagedEngine = path.join(stageRoot, 'omni-engine');
  const engineRoot = packaged || fs.existsSync(path.join(stagedEngine, 'omni_local_server.py')) ? stagedEngine : repoRoot;

  const manager = app ? getComponentManager() : null;
  const componentPython = manager ? manager.pythonExecutable() : null;
  let pythonExe = '';
  let pythonSource = 'component';
  if (componentPython) {
    pythonExe = componentPython;
  } else if (!packaged && process.env.OMNI_PYTHON_EXE) {
    pythonExe = process.env.OMNI_PYTHON_EXE;
    pythonSource = 'OMNI_PYTHON_EXE';
  } else {
    pythonSource = 'not-installed'; // a packaged app never falls back to a host Python
  }

  const nativeToolsDir = manager ? manager.root : path.join(stageRoot, 'components');
  const pythonPath = manager ? manager.pythonPath() : [];

  return {
    isWin,
    platKey,
    packaged,
    stageRoot,
    bundleManifestPath,
    engineRoot,
    pythonExe,
    pythonSource,
    pythonPath,
    nativeToolsDir,
    nativeToolsBin: path.join(nativeToolsDir, 'bin'),
    toolsManifestPath: path.join(nativeToolsDir, 'TOOLS_MANIFEST.json'),
    serverScript: path.join(engineRoot, 'omni_local_server.py'),
    verifierScript: path.join(engineRoot, 'verify_local_environment.py'),
    uiIndexHtml: path.join(engineRoot, 'index.html'),
    vendorManifest: path.join(engineRoot, 'vendor', 'OFFLINE_ASSETS.txt'),
    offlinePins: path.join(engineRoot, 'offline_assets_manifest.json'),
    noticesPath: path.join(engineRoot, 'THIRD_PARTY_NOTICES.md'),
  };
}

function systemPathDirs() {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    return [path.join(root, 'System32'), root, path.join(root, 'System32', 'Wbem')];
  }
  return ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
}

/** Mirror of omni_environment.bundled_tool_environment(). */
function bundledToolEnvironment(root, manifest, baseEnv, sanitizePath) {
  const env = { ...baseEnv };
  for (const [key, rels] of Object.entries((manifest && manifest.env) || {})) {
    const values = Array.isArray(rels) ? rels : [rels];
    env[key] = values.map((rel) => path.join(root, rel)).join(path.delimiter);
  }
  const pathDirs = ((manifest && manifest.path_dirs) || []).map((rel) => path.join(root, rel));
  const tail = sanitizePath ? systemPathDirs() : [baseEnv.PATH || ''];
  env.PATH = [...pathDirs, ...tail].filter(Boolean).join(path.delimiter);
  env.OMNI_NATIVE_TOOLS_ROOT = root;
  env.OMNI_TOOL_RESOLUTION = 'bundled';
  return env;
}

function buildEngineEnvironment(paths, port) {
  const userDataDir = app ? app.getPath('userData') : path.join(os.homedir(), '.omni-studio');
  const allowedSqliteDir = path.join(userDataDir, 'sqlite-workspace');
  try {
    fs.mkdirSync(allowedSqliteDir, { recursive: true });
  } catch (_) {}

  const baseEnv = { ...process.env };
  for (const key of Object.keys(baseEnv)) {
    if (/^(PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|PYTHONEXECUTABLE|VIRTUAL_ENV|CONDA_PREFIX)$/i.test(key)) {
      delete baseEnv[key];
    }
  }

  const toolsManifest = readJsonFile(paths.toolsManifestPath);
  let env;
  if (toolsManifest && toolsManifest.tools) {
    // Packaged apps get a sanitized PATH so nothing outside the bundle can stand in for a tool.
    env = bundledToolEnvironment(paths.nativeToolsDir, toolsManifest, baseEnv, paths.packaged);
  } else {
    env = { ...baseEnv };
    if (paths.packaged) {
      env.OMNI_TOOL_RESOLUTION = 'bundled';
      env.PATH = systemPathDirs().join(path.delimiter);
    }
  }
  const pyBinDir = paths.pythonExe ? path.dirname(paths.pythonExe) : '';
  if (pyBinDir && path.isAbsolute(pyBinDir) && fs.existsSync(pyBinDir)) {
    env.PATH = [pyBinDir, env.PATH].filter(Boolean).join(path.delimiter);
  }
  if (paths.pythonPath && paths.pythonPath.length) {
    env.PYTHONPATH = paths.pythonPath.join(path.delimiter);
  }

  return {
    ...env,
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONNOUSERSITE: '1',
    OMNI_HOST: HOST,
    OMNI_PORT: String(port),
    OMNI_TOKEN: engineToken,
    OMNI_NO_BROWSER: '1',
    OMNI_UI_ROOT: paths.engineRoot,
    OMNI_DESKTOP_PACKAGED: paths.packaged ? '1' : '0',
    OMNI_ALLOWED_SQLITE_DIR: process.env.OMNI_ALLOWED_SQLITE_DIR || allowedSqliteDir,
  };
}

function findAvailablePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', () => {
      const fallback = net.createServer();
      fallback.unref();
      fallback.on('error', reject);
      fallback.listen(0, HOST, () => {
        const assigned = fallback.address().port;
        fallback.close(() => resolve(assigned));
      });
    });
    probe.listen(preferredPort, HOST, () => {
      const assigned = probe.address().port;
      probe.close(() => resolve(assigned));
    });
  });
}

function fetchLoopback(pathname, port = enginePort, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port,
        path: pathname,
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          Host: `${HOST}:${port}`,
          Origin: `http://${HOST}:${port}`,
          'Sec-Fetch-Site': 'same-origin',
          'X-Omni-Token': engineToken,
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks) }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchLoopbackJson(pathname, port = enginePort, timeoutMs = 2500) {
  const res = await fetchLoopback(pathname, port, timeoutMs);
  return { statusCode: res.statusCode, body: JSON.parse(res.body.toString('utf8') || '{}') };
}

function tailEngineLog(maxChars = 4000) {
  try {
    return fs.readFileSync(engineLogPath, 'utf8').slice(-maxChars);
  } catch (_) {
    return '';
  }
}

async function waitForEngineReady(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pythonProcess) {
      throw new Error(`The Python Local Engine exited during startup.\n${tailEngineLog(1500)}`);
    }
    try {
      const res = await fetchLoopbackJson('/healthz', port, 1200);
      if (res.statusCode === 200 && res.body && res.body.ok) {
        return res.body;
      }
    } catch (_) {
      // Engine still starting
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(`The Python Local Engine did not respond on http://${HOST}:${port}/healthz within ${Math.round(timeoutMs / 1000)}s.`);
}

function openEngineLog() {
  const logDir = app ? path.join(app.getPath('userData'), 'logs') : os.tmpdir();
  fs.mkdirSync(logDir, { recursive: true });
  engineLogPath = path.join(logDir, 'local-engine.log');
  if (engineLogStream) engineLogStream.end();
  engineLogStream = fs.createWriteStream(engineLogPath, { flags: 'w' });
  return engineLogStream;
}

async function startPythonEngine() {
  const paths = resolveResourcePaths();
  if (!fs.existsSync(paths.serverScript)) {
    throw new Error(`omni_local_server.py not found at ${paths.serverScript}`);
  }
  if (!paths.pythonExe) {
    throw new EngineNotInstalledError('The Local Engine component is not installed.');
  }
  if (path.isAbsolute(paths.pythonExe) && !fs.existsSync(paths.pythonExe)) {
    throw new Error(`The Local Engine runtime is missing (${paths.pythonExe}). Reinstall it from File → Manage Components….`);
  }

  // Development convenience only: attach to an engine the developer already started.
  if (!paths.packaged && process.env.OMNI_REUSE_ENGINE === '1') {
    try {
      const existing = await fetchLoopbackJson('/healthz', DEFAULT_PORT, 800);
      if (existing.statusCode === 200 && existing.body && existing.body.ok) {
        enginePort = DEFAULT_PORT;
        return { reused: true, port: enginePort, health: existing.body };
      }
    } catch (_) {}
  }

  enginePort = await findAvailablePort(DEFAULT_PORT);
  const env = buildEngineEnvironment(paths, enginePort);
  const logStream = openEngineLog();
  logStream.write(`[OmniDesktop] ${new Date().toISOString()} starting ${paths.pythonExe} ${paths.serverScript}\n`);

  pythonProcess = spawn(paths.pythonExe, ['-s', paths.serverScript], {
    cwd: paths.engineRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  pythonProcess.on('error', (err) => {
    logStream.write(`[OmniDesktop] failed to start engine: ${err.message}\n`);
    pythonProcess = null;
  });
  pythonProcess.stdout.on('data', (chunk) => {
    logStream.write(chunk);
    if (!isPackagedApp()) process.stdout.write(`[OmniEngine] ${chunk}`);
  });
  pythonProcess.stderr.on('data', (chunk) => {
    logStream.write(chunk);
    if (!isPackagedApp()) process.stderr.write(`[OmniEngine:err] ${chunk}`);
  });
  pythonProcess.on('exit', (code, signal) => {
    logStream.write(`[OmniDesktop] engine exited code=${code} signal=${signal}\n`);
    pythonProcess = null;
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('omni:engine-stopped', { code, signal });
    }
  });

  const health = await waitForEngineReady(enginePort);
  return { reused: false, port: enginePort, health };
}

async function stopPythonEngine() {
  if (!pythonProcess) return;
  const proc = pythonProcess;
  pythonProcess = null;

  await new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
        } else {
          proc.kill('SIGKILL');
        }
      } catch (_) {}
      resolve();
    }, 3500);

    proc.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(proc.pid), '/T'], { windowsHide: true });
      } else {
        proc.kill('SIGTERM');
      }
    } catch (_) {
      clearTimeout(killTimer);
      resolve();
    }
  });
}

/** UI labels/features per native tool group (groups come from omni_environment.NATIVE_GROUPS). */
const NATIVE_TOOL_SPECS = [
  { id: 'ffmpeg', component: 'ffmpeg', group: 'FFmpeg', label: 'FFmpeg', features: ['Audio Studio', 'Video Studio', 'Media Transcode'] },
  { id: 'ffprobe', component: 'ffmpeg', group: 'FFprobe', label: 'FFprobe', features: ['Media Stream Inspection'] },
  { id: 'yt-dlp', component: 'yt-dlp', group: 'yt-dlp', label: 'yt-dlp', features: ['Social Media Download Studio'] },
  { id: 'qpdf', component: 'qpdf', group: 'qpdf', label: 'qpdf', features: ['PDF Merge & Split', 'PDF Linearize & Compress'] },
  { id: 'pdftoppm', component: 'poppler', group: 'Poppler pdftoppm', label: 'Poppler (pdftoppm)', features: ['PDF High-DPI Page Rendering', 'PDF to PPTX'] },
  { id: 'pdftotext', component: 'poppler', group: 'Poppler pdftotext', label: 'Poppler (pdftotext)', features: ['PDF Structured Text Extraction', 'PDF to DOCX'] },
  { id: 'magick', component: 'imagemagick', group: 'ImageMagick', label: 'ImageMagick', features: ['Native Image Format Bridge (HEIC/JXL/TIFF/PSD)'] },
  { id: 'rsvg-convert', component: 'rsvg', group: 'rsvg-convert', label: 'librsvg (rsvg-convert)', features: ['SVG to PNG Rendering'] },
  { id: 'gs', component: 'ghostscript', group: 'Ghostscript', label: 'Ghostscript', features: ['PostScript & PDF Vector Processing'] },
  { id: 'tesseract', component: 'tesseract', group: 'Tesseract', label: 'Tesseract OCR', features: ['Multi-Language Native OCR'] },
  { id: 'soffice', component: 'libreoffice', group: 'LibreOffice', label: 'LibreOffice (soffice)', features: ['Office Format Converter', 'Unicode DOCX/PDF'] },
  { id: 'ebook-convert', component: 'calibre', group: 'Calibre', label: 'Calibre (ebook-convert)', features: ['Native Ebook Format Bridge (EPUB/MOBI/AZW3)'] },
  { id: 'pandoc', component: 'pandoc', group: 'Pandoc', label: 'Pandoc', features: ['Document Markup Interchange'] },
  { id: '7z', component: '7zip', group: '7-Zip', label: '7-Zip', features: ['7z Archive Compression'] },
];

const offlineVerifyCache = new Map();

function sha256OfFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Verify every pinned offline asset by SHA-256 (not just existence). */
function verifyOfflineManifest(manifestPath, engineRoot, pinsPath) {
  const pins = readJsonFile(pinsPath || path.join(engineRoot, 'offline_assets_manifest.json')) || {};
  const rels = Object.keys(pins);
  const missing = [];
  let verifiedCount = 0;
  for (const rel of rels) {
    const target = path.join(engineRoot, 'vendor', rel);
    let ok = false;
    try {
      const st = fs.statSync(target);
      const key = `${target}:${st.size}:${st.mtimeMs}`;
      if (!offlineVerifyCache.has(key)) {
        offlineVerifyCache.set(key, sha256OfFile(target) === pins[rel]);
      }
      ok = offlineVerifyCache.get(key);
    } catch (_) {
      ok = false;
    }
    if (ok) verifiedCount += 1;
    else missing.push(rel);
  }
  const manifestPresent = fs.existsSync(manifestPath);
  if (!manifestPresent) missing.push('OFFLINE_ASSETS.txt');
  return {
    ready: rels.length > 0 && missing.length === 0,
    verifiedCount,
    totalCount: rels.length,
    missing,
    manifestPresent,
  };
}

function toolsFromHealth(engineHealth, installedComponents, engineInstalled) {
  const groups = (engineHealth && engineHealth.tool_groups) || {};
  const installed = installedComponents || null;
  return NATIVE_TOOL_SPECS.map((spec) => {
    const info = groups[spec.group] || {};
    let reason = null;
    if (installed && !installed.includes(spec.component)) reason = 'Component not installed';
    else if (engineInstalled === false) reason = 'Local Engine not installed';
    else if (!engineHealth) reason = 'Local Engine offline';
    else if (!info.ready) reason = info.path ? 'Found but failed to run' : 'Not installed';
    return {
      id: spec.id,
      label: spec.label,
      group: spec.group,
      component: spec.component,
      required: info.required !== false,
      available: Boolean(info.ready),
      bundled: Boolean(info.bundled),
      path: info.path || null,
      version: info.version || null,
      reason,
      features: spec.features,
    };
  });
}

async function runReadinessCheck() {
  const paths = resolveResourcePaths();
  const offlineAssets = verifyOfflineManifest(paths.vendorManifest, paths.engineRoot, paths.offlinePins);
  const bundleManifest = readJsonFile(paths.bundleManifestPath);

  let engineHealth = null;
  if (!engineStartError && pythonProcess) {
    try {
      const resp = await fetchLoopbackJson('/api/health', enginePort, 180000);
      if (resp.statusCode === 200 && resp.body && resp.body.ok) {
        engineHealth = resp.body;
      }
    } catch (_) {}
  }

  const manager = getComponentManager();
  const componentList = manager.list();
  const installedIds = componentList.components.filter((c) => c.installed).map((c) => c.id);
  const engineInstalled = Boolean(paths.pythonExe);
  const tools = toolsFromHealth(engineHealth, installedIds, engineInstalled);
  const requiredTools = tools.filter((t) => t.required);
  const engineOnline = Boolean(engineHealth && engineHealth.ok);
  cachedReadiness = {
    checkedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    isPackaged: isPackagedApp(),
    bundle: bundleManifest
      ? { complete: Boolean(bundleManifest.complete), stagedAt: bundleManifest.staged_at, platform: bundleManifest.platform }
      : null,
    components: componentList.components.map((c) => ({ id: c.id, title: c.title, installed: c.installed, size: c.size })),
    engine: {
      installed: engineInstalled,
      online: engineOnline,
      url: `http://${HOST}:${enginePort}`,
      error: engineStartError ? String(engineStartError.message || engineStartError) : null,
      logPath: engineLogPath,
      apiVersion: engineHealth ? engineHealth.engine_api_version : null,
      build: engineHealth ? engineHealth.engine_build : null,
      pythonVersion: engineHealth ? engineHealth.python : null,
      pythonExecutable: engineHealth && engineHealth.python_executable ? engineHealth.python_executable : paths.pythonExe,
      pythonSource: paths.pythonSource,
      pythonModules: (engineHealth && engineHealth.python_modules) || {},
      doctor: engineHealth ? engineHealth.doctor : null,
    },
    offlineAssets,
    tools,
    summary: {
      browserStudiosReady: true,
      offlineVendorReady: offlineAssets.ready,
      localEngineReady: engineOnline,
      nativeToolsReady: tools.filter((t) => t.available).length,
      nativeToolsTotal: tools.length,
      requiredToolsReady: requiredTools.filter((t) => t.available).length,
      requiredToolsTotal: requiredTools.length,
      componentsInstalled: installedIds.length,
      componentsTotal: componentList.components.length,
      allRequiredReady: engineOnline && offlineAssets.ready && requiredTools.every((t) => t.available),
    },
  };
  return cachedReadiness;
}

function startupPage(message, detail) {
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>OmniConverter Studio</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#FFE9CF;font:15px -apple-system,Segoe UI,sans-serif;color:#3b2a1a}
.card{max-width:560px;padding:28px 32px;background:#fff8ef;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 8px}p{margin:6px 0;line-height:1.45}pre{white-space:pre-wrap;font-size:12px;background:#f3e6d6;padding:10px;border-radius:8px;max-height:220px;overflow:auto}</style></head>
<body><div class="card"><h1>${esc(message)}</h1>${detail ? `<pre>${esc(detail)}</pre>` : '<p>Starting the bundled Local Engine. The first launch can take up to a minute while Python libraries load.</p>'}</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function createMainWindow() {
  const paths = resolveResourcePaths();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'OmniConverter Studio',
    backgroundColor: '#FFE9CF',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  // Open external HTTP(S) links in the user's default OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== HOST && parsed.hostname !== 'localhost') {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    } catch (_) {}
    return { action: 'allow' };
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (cachedReadiness && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('omni:readiness-report', cachedReadiness);
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  await mainWindow.loadURL(startupPage('Starting OmniConverter Studio…'));

  try {
    engineStartError = null;
    await startPythonEngine();
    await runReadinessCheck();
    startupState.loadedUrl = `http://${HOST}:${enginePort}/`;
    await mainWindow.loadURL(startupState.loadedUrl);
  } catch (err) {
    if (err instanceof EngineNotInstalledError) {
      // Not an error: the user chose browser-only mode (no Local Engine component).
      engineStartError = null;
      startupState.browserOnly = true;
      await runReadinessCheck();
      startupState.loadedUrl = `file://${paths.uiIndexHtml}`;
      await mainWindow.loadFile(paths.uiIndexHtml);
      return;
    }
    engineStartError = err;
    console.error('[OmniDesktop] Local Engine failed to start:', err.message);
    await stopPythonEngine();
    await runReadinessCheck();
    if (!SMOKE_MODE) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Local Engine unavailable',
        message: 'The bundled Local Engine could not be started.',
        detail: `${err.message}\n\nBrowser-only studios will still open. Engine-backed conversions (Office, OCR, media, PDF tools) stay unavailable until the engine starts (READY pill → Restart engine).\n\nLog: ${engineLogPath || 'not created'}`,
        buttons: ['Continue in browser-only mode'],
      });
    }
    startupState.usedFallbackUi = true;
    startupState.loadedUrl = `file://${paths.uiIndexHtml}`;
    await mainWindow.loadFile(paths.uiIndexHtml);
  }
}

function openComponentsWindow() {
  if (componentsWindow && !componentsWindow.isDestroyed()) {
    componentsWindow.focus();
    return componentsWindow;
  }
  componentsWindow = new BrowserWindow({
    width: 860,
    height: 760,
    minWidth: 640,
    minHeight: 520,
    title: 'OmniConverter Studio — Components',
    backgroundColor: '#FFE9CF',
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'components-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  componentsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  componentsWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  componentsWindow.on('closed', () => {
    componentsWindow = null;
    getComponentManager().markSetupCompleted();
    if (componentsChanged) {
      // Closed with the window button after installing/removing: apply the changes anyway.
      componentsChanged = false;
      applyComponentChanges().catch((err) => console.error('[OmniDesktop] applying component changes failed:', err));
    }
  });
  componentsWindow.loadFile(path.join(__dirname, 'components.html'));
  return componentsWindow;
}

/** Restart the engine with whatever components are installed now and reload the UI. */
async function applyComponentChanges() {
  await stopPythonEngine();
  engineStartError = null;
  startupState.browserOnly = false;
  startupState.usedFallbackUi = false;
  const paths = resolveResourcePaths();
  try {
    await startPythonEngine();
    await runReadinessCheck();
    startupState.loadedUrl = `http://${HOST}:${enginePort}/`;
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(startupState.loadedUrl);
  } catch (err) {
    if (!(err instanceof EngineNotInstalledError)) engineStartError = err;
    startupState.browserOnly = err instanceof EngineNotInstalledError;
    startupState.usedFallbackUi = !startupState.browserOnly;
    await runReadinessCheck();
    startupState.loadedUrl = `file://${paths.uiIndexHtml}`;
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadFile(paths.uiIndexHtml);
  }
  return cachedReadiness;
}

function installApplicationMenu() {
  const manageItem = { label: 'Manage Components…', click: () => openComponentsWindow() };
  const template = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, manageItem, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }]
      : []),
    { label: 'File', submenu: [manageItem, { type: 'separator' }, process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function runBundledVerifier(paths) {
  return new Promise((resolve) => {
    const env = buildEngineEnvironment(paths, enginePort);
    execFile(
      paths.pythonExe,
      ['-s', paths.verifierScript, '--json'],
      { cwd: paths.engineRoot, env, timeout: 900000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        let parsed = null;
        try {
          parsed = JSON.parse(String(stdout).trim().split(/\r?\n/).pop());
        } catch (_) {}
        resolve({ exitCode: error ? (error.code ?? 1) : 0, report: parsed, stderr: String(stderr || '').slice(-4000) });
      }
    );
  });
}

async function runSmokeTest() {
  const paths = resolveResourcePaths();
  const readiness = await runReadinessCheck();
  const report = {
    schema: 2,
    mode: SMOKE_INSTALL,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath,
    userData: app.getPath('userData'),
    componentsRoot: getComponentManager().root,
    packaged: isPackagedApp(),
    startup: startupState,
    readiness,
    engineLogTail: tailEngineLog(6000),
    renderer: null,
    vendorFetch: null,
    verifier: null,
  };
  try {
    report.renderer = await mainWindow.webContents.executeJavaScript(
      '({ href: location.href, tokenType: typeof window.OMNI_TOKEN, desktopBridge: Boolean(window.omniDesktop && window.omniDesktop.isDesktopApp), title: document.title, hasUi: Boolean(document.querySelector("body") && document.body.children.length > 0) })'
    );
  } catch (err) {
    report.renderer = { error: err.message };
  }
  const engineRunning = Boolean(pythonProcess) && !engineStartError;
  if (engineRunning) {
    try {
      const res = await fetchLoopback('/vendor/pdfjs/build/pdf.mjs', enginePort, 10000);
      report.vendorFetch = { statusCode: res.statusCode, bytes: res.body.length };
    } catch (err) {
      report.vendorFetch = { error: err.message };
    }
    report.verifier = await runBundledVerifier(paths);
  }
  const shotDir = process.env.OMNI_SMOKE_SCREENSHOT_DIR;
  if (shotDir) {
    // Visual proof for CI artifacts: the studio window and the component picker.
    fs.mkdirSync(shotDir, { recursive: true });
    try {
      await new Promise((r) => setTimeout(r, 1500));
      fs.writeFileSync(path.join(shotDir, `studio-${SMOKE_INSTALL === 'none' ? 'base' : 'full'}.png`), (await mainWindow.webContents.capturePage()).toPNG());
      const picker = openComponentsWindow();
      await new Promise((resolve) => (picker.webContents.isLoading() ? picker.webContents.once('did-finish-load', resolve) : resolve()));
      await new Promise((r) => setTimeout(r, 1000));
      fs.writeFileSync(path.join(shotDir, `components-${SMOKE_INSTALL === 'none' ? 'base' : 'full'}.png`), (await picker.webContents.capturePage()).toPNG());
      report.screenshots = fs.readdirSync(shotDir);
    } catch (err) {
      report.screenshots = { error: err.message };
    }
  }
  const installs = startupState.componentInstall || {};
  const installsOk = Object.values(installs).every((r) => r.ok);
  if (SMOKE_INSTALL === 'none') {
    // Base installer only: the app must open in browser-only mode, never pretend tools exist.
    report.ok = Boolean(
      startupState.browserOnly &&
        !startupState.usedFallbackUi &&
        readiness.engine.installed === false &&
        readiness.offlineAssets.ready &&
        readiness.tools.every((t) => !t.available && t.reason === 'Component not installed') &&
        report.renderer && report.renderer.desktopBridge && report.renderer.hasUi
    );
  } else {
    report.ok = Boolean(
      installsOk &&
        readiness.summary.allRequiredReady &&
        !startupState.usedFallbackUi &&
        report.renderer && report.renderer.tokenType === 'string' &&
        report.vendorFetch && report.vendorFetch.statusCode === 200 &&
        report.verifier && report.verifier.exitCode === 0
    );
  }
  fs.mkdirSync(path.dirname(SMOKE_REPORT_PATH), { recursive: true });
  fs.writeFileSync(SMOKE_REPORT_PATH, JSON.stringify(report, null, 2));
  isQuitting = true;
  await stopPythonEngine();
  app.exit(report.ok ? 0 : 3);
}

function registerIpcHandlers() {
  ipcMain.handle('omni:get-readiness', async () => {
    if (!cachedReadiness) {
      return runReadinessCheck();
    }
    return cachedReadiness;
  });

  ipcMain.handle('omni:recheck-readiness', async () => {
    return runReadinessCheck();
  });

  ipcMain.handle('omni:get-engine-config', () => ({
    host: HOST,
    port: enginePort,
    baseUrl: `http://${HOST}:${enginePort}`,
  }));

  ipcMain.handle('omni:restart-engine', async () => {
    await stopPythonEngine();
    try {
      engineStartError = null;
      await startPythonEngine();
    } catch (err) {
      engineStartError = err;
    }
    return runReadinessCheck();
  });

  ipcMain.handle('omni:open-components', () => {
    openComponentsWindow();
    return true;
  });

  ipcMain.handle('omni-components:list', () => getComponentManager().list());
  ipcMain.handle('omni-components:install', async (event, ids) => {
    const sender = event.sender;
    const results = await getComponentManager().install(Array.isArray(ids) ? ids : [], (progress) => {
      if (!sender.isDestroyed()) sender.send('omni-components:progress', progress);
    });
    if (Object.values(results).some((r) => r.ok && !r.skipped)) componentsChanged = true;
    return results;
  });
  ipcMain.handle('omni-components:cancel', (_event, id) => {
    getComponentManager().cancel(String(id));
    return true;
  });
  ipcMain.handle('omni-components:remove', async (_event, id) => {
    await stopPythonEngine(); // release files (Windows locks binaries in use)
    componentsChanged = true;
    return getComponentManager().remove(String(id));
  });
  ipcMain.handle('omni-components:finish', async () => {
    getComponentManager().markSetupCompleted();
    componentsChanged = false;
    if (componentsWindow && !componentsWindow.isDestroyed()) componentsWindow.close();
    return applyComponentChanges();
  });

  ipcMain.handle('omni:open-notices', async () => {
    const { noticesPath } = resolveResourcePaths();
    if (fs.existsSync(noticesPath)) {
      await shell.openPath(noticesPath);
      return { ok: true, path: noticesPath };
    }
    return { ok: false, error: 'THIRD_PARTY_NOTICES.md not found' };
  });
}

if (app) {
  const gotSingleInstanceLock = SMOKE_MODE || app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });

    app.whenReady().then(async () => {
      registerIpcHandlers();
      if (SMOKE_MODE) {
        try {
          const manager = getComponentManager();
          const wanted = SMOKE_INSTALL === 'all'
            ? manager.catalog().components.map((c) => c.id)
            : SMOKE_INSTALL === 'none' ? [] : SMOKE_INSTALL.split(',').map((x) => x.trim()).filter(Boolean);
          const progressLog = [];
          startupState.componentInstall = wanted.length
            ? await manager.install(wanted, (p) => { if (p.phase !== 'downloading') progressLog.push(p); })
            : {};
          startupState.componentProgress = progressLog;
          await createMainWindow();
          await runSmokeTest();
        } catch (err) {
          try {
            fs.writeFileSync(SMOKE_REPORT_PATH, JSON.stringify({ ok: false, error: String((err && err.stack) || err) }, null, 2));
          } catch (_) {}
          isQuitting = true;
          await stopPythonEngine();
          app.exit(4);
        }
        return;
      }
      installApplicationMenu();
      await createMainWindow();
      if (!getComponentManager().state().setupCompleted) {
        openComponentsWindow(); // first launch: let the user choose what to install
      }

      app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          await createMainWindow();
        }
      });
    });

    app.on('before-quit', async (event) => {
      if (!isQuitting && pythonProcess) {
        event.preventDefault();
        isQuitting = true;
        await stopPythonEngine();
        app.quit();
      }
    });

    app.on('window-all-closed', async () => {
      if (process.platform !== 'darwin') {
        isQuitting = true;
        await stopPythonEngine();
        app.quit();
      }
    });
  }
}

module.exports = {
  resolveResourcePaths,
  buildEngineEnvironment,
  bundledToolEnvironment,
  verifyOfflineManifest,
  toolsFromHealth,
  NATIVE_TOOL_SPECS,
};
