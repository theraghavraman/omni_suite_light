/**
 * OmniConverter Studio — Electron Main Process (electron/main.cjs)
 *
 * Wraps the existing HTML/JS Studio interface (index.html) in an Electron shell:
 * 1. Resolves the bundled Python runtime, Local Engine (omni_local_server.py),
 *    offline browser assets (vendor/), and bundled native CLI tools.
 * 2. Starts the Python Local Engine in the background bound strictly to 127.0.0.1
 *    with OMNI_NO_BROWSER=1 so no external browser window is opened.
 * 3. Polls http://127.0.0.1:<port>/healthz until the engine is ready, then loads
 *    http://127.0.0.1:<port>/ inside the BrowserWindow so ui_auth_bootstrap()
 *    injects window.OMNI_TOKEN and same-origin loopbacks succeed.
 * 4. Runs a first-launch readiness check across browser assets, Python modules,
 *    and native CLI tools (FFmpeg, qpdf, Poppler, Tesseract, LibreOffice, Calibre,
 *    ImageMagick, Pandoc, Ghostscript, 7-Zip).
 * 5. Terminates the Python child process cleanly when Omni closes.
 */
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

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
const HEALTH_POLL_INTERVAL_MS = 200;
const HEALTH_TIMEOUT_MS = 25000;

let mainWindow = null;
let pythonProcess = null;
let enginePort = DEFAULT_PORT;
let engineToken = process.env.OMNI_TOKEN || crypto.randomBytes(24).toString('base64url');
let isQuitting = false;
let cachedReadiness = null;

function isPackagedApp() {
  return Boolean(app && app.isPackaged);
}

function getRepoOrResourcesRoot() {
  if (isPackagedApp()) {
    return path.join(process.resourcesPath, 'omni-engine');
  }
  return path.resolve(__dirname, '..');
}

function resolveResourcePaths() {
  const isWin = process.platform === 'win32';
  const platKey = `${process.platform}-${process.arch}`;
  const engineRoot = getRepoOrResourcesRoot();
  const baseStageRoot = isPackagedApp()
    ? process.resourcesPath
    : path.join(engineRoot, 'build');

  const pythonRuntimeDir = path.join(baseStageRoot, 'python-runtime');
  const bundledPythonExe = isWin
    ? path.join(pythonRuntimeDir, 'python.exe')
    : path.join(pythonRuntimeDir, 'bin', 'python3');

  const venvPythonExe = isWin
    ? path.join(engineRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(engineRoot, '.venv', 'bin', 'python3');

  let pythonExe = process.env.OMNI_PYTHON_EXE || '';
  if (!pythonExe) {
    if (fs.existsSync(bundledPythonExe)) {
      pythonExe = bundledPythonExe;
    } else if (fs.existsSync(venvPythonExe)) {
      pythonExe = venvPythonExe;
    } else if (!isWin) {
      const candidates = [
        '/opt/homebrew/bin/python3.13',
        '/opt/homebrew/bin/python3.12',
        '/opt/homebrew/bin/python3.11',
        '/usr/local/bin/python3.13',
        '/usr/local/bin/python3.12',
        '/usr/local/bin/python3.11',
        '/opt/homebrew/bin/python3',
        '/usr/local/bin/python3',
      ];
      pythonExe = candidates.find((p) => fs.existsSync(p)) || 'python3';
    } else {
      pythonExe = 'python';
    }
  }

  const nativeToolsDir = path.join(baseStageRoot, 'native-tools', platKey);
  const nativeToolsBin = path.join(nativeToolsDir, 'bin');
  const tessdataDir = path.join(nativeToolsDir, 'share', 'tessdata');
  const serverScript = path.join(engineRoot, 'omni_local_server.py');
  const uiIndexHtml = path.join(engineRoot, 'index.html');
  const vendorManifest = path.join(engineRoot, 'vendor', 'OFFLINE_ASSETS.txt');
  const noticesPath = path.join(engineRoot, 'THIRD_PARTY_NOTICES.md');

  return {
    isWin,
    platKey,
    engineRoot,
    pythonRuntimeDir,
    pythonExe,
    nativeToolsDir,
    nativeToolsBin,
    tessdataDir,
    serverScript,
    uiIndexHtml,
    vendorManifest,
    noticesPath,
  };
}

function buildEngineEnvironment(paths, port) {
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const extraBinDirs = [];

  if (fs.existsSync(paths.nativeToolsBin)) {
    extraBinDirs.push(paths.nativeToolsBin);
  }
  const pyBinDir = path.dirname(paths.pythonExe);
  if (pyBinDir && pyBinDir !== '.' && fs.existsSync(pyBinDir)) {
    extraBinDirs.push(pyBinDir);
  }
  if (process.platform === 'darwin') {
    for (const macDir of ['/opt/homebrew/bin', '/usr/local/bin', '/Applications/LibreOffice.app/Contents/MacOS', '/Applications/calibre.app/Contents/MacOS']) {
      if (fs.existsSync(macDir)) {
        extraBinDirs.push(macDir);
      }
    }
  }

  const userDataDir = app ? app.getPath('userData') : path.join(os.homedir(), '.omni-studio');
  const allowedSqliteDir = path.join(userDataDir, 'sqlite-workspace');
  try {
    fs.mkdirSync(allowedSqliteDir, { recursive: true });
  } catch (_) {}

  const env = {
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
    OMNI_HOST: HOST,
    OMNI_PORT: String(port),
    OMNI_TOKEN: engineToken,
    OMNI_NO_BROWSER: '1',
    OMNI_UI_ROOT: paths.engineRoot,
    OMNI_BUNDLED_TOOLS_DIR: extraBinDirs.join(pathSep),
    OMNI_ALLOWED_SQLITE_DIR: process.env.OMNI_ALLOWED_SQLITE_DIR || allowedSqliteDir,
    PATH: [...extraBinDirs, process.env.PATH || ''].filter(Boolean).join(pathSep),
  };

  if (fs.existsSync(paths.tessdataDir)) {
    env.TESSDATA_PREFIX = paths.tessdataDir;
  }

  return env;
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

function fetchLoopbackJson(pathname, port = enginePort, timeoutMs = 2500) {
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
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw || '{}');
            resolve({ statusCode: res.statusCode || 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function waitForEngineReady(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
  throw new Error(`Python Local Engine did not respond on http://${HOST}:${port}/healthz within ${timeoutMs}ms`);
}

async function startPythonEngine() {
  const paths = resolveResourcePaths();
  if (!fs.existsSync(paths.serverScript)) {
    throw new Error(`omni_local_server.py not found at ${paths.serverScript}`);
  }

  // Reuse an already-running Local Engine on DEFAULT_PORT if one is healthy
  try {
    const existing = await fetchLoopbackJson('/healthz', DEFAULT_PORT, 800);
    if (existing.statusCode === 200 && existing.body && existing.body.ok) {
      enginePort = DEFAULT_PORT;
      return { reused: true, port: enginePort, health: existing.body };
    }
  } catch (_) {}

  enginePort = await findAvailablePort(DEFAULT_PORT);
  const env = buildEngineEnvironment(paths, enginePort);

  pythonProcess = spawn(paths.pythonExe, [paths.serverScript], {
    cwd: paths.engineRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  pythonProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[OmniEngine] ${chunk}`);
  });
  pythonProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[OmniEngine:err] ${chunk}`);
  });
  pythonProcess.on('exit', (code, signal) => {
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

const NATIVE_TOOL_SPECS = [
  { id: 'ffmpeg', label: 'FFmpeg', bin: 'ffmpeg', args: ['-version'], features: ['Audio Studio', 'Video Studio', 'Media Transcode'] },
  { id: 'ffprobe', label: 'FFprobe', bin: 'ffprobe', args: ['-version'], features: ['Media Stream Inspection'] },
  { id: 'qpdf', label: 'qpdf', bin: 'qpdf', args: ['--version'], features: ['PDF Merge & Split', 'PDF Linearize & Compress'] },
  { id: 'pdftoppm', label: 'Poppler (pdftoppm)', bin: 'pdftoppm', args: ['-v'], features: ['PDF High-DPI Page Rendering', 'PDF to PPTX'] },
  { id: 'pdftotext', label: 'Poppler (pdftotext)', bin: 'pdftotext', args: ['-v'], features: ['PDF Structured Text Extraction', 'PDF to DOCX'] },
  { id: 'tesseract', label: 'Tesseract OCR', bin: 'tesseract', args: ['--version'], features: ['Multi-Language Native OCR'] },
  { id: 'soffice', label: 'LibreOffice (soffice)', bin: 'soffice', args: ['--version'], features: ['Office Format Converter', 'Unicode DOCX/PDF'] },
  { id: 'ebook-convert', label: 'Calibre (ebook-convert)', bin: 'ebook-convert', args: ['--version'], features: ['Native Ebook Format Bridge (EPUB/MOBI/AZW3)'] },
  { id: 'magick', label: 'ImageMagick', bin: 'magick', args: ['-version'], features: ['Native Image Format Bridge (HEIC/JXL/TIFF/PSD)'] },
  { id: 'gs', label: 'Ghostscript', bin: 'gs', args: ['--version'], features: ['PostScript & PDF Vector Processing'] },
  { id: 'pandoc', label: 'Pandoc', bin: 'pandoc', args: ['--version'], features: ['Document Markup Interchange'] },
  { id: '7z', label: '7-Zip', bin: '7z', args: ['i'], features: ['7z Archive Compression'] },
];

function verifyOfflineManifest(manifestPath, engineRoot) {
  if (!fs.existsSync(manifestPath)) {
    return { ready: false, verifiedCount: 0, totalCount: 0, missing: ['vendor/OFFLINE_ASSETS.txt'] };
  }
  const lines = fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/).filter(Boolean);
  let verifiedCount = 0;
  const missing = [];
  for (const line of lines) {
    const parts = line.split('\t');
    const relPath = parts[0];
    if (!relPath) continue;
    const targetPath = path.join(engineRoot, 'vendor', relPath);
    if (fs.existsSync(targetPath)) {
      verifiedCount += 1;
    } else {
      missing.push(relPath);
    }
  }
  return {
    ready: missing.length === 0 && verifiedCount > 0,
    verifiedCount,
    totalCount: lines.length,
    missing,
  };
}

async function probeCliTool(spec, env, engineToolsMap) {
  const fromEngine = engineToolsMap && engineToolsMap[spec.id];
  const binToRun = (fromEngine && fromEngine.path) ? fromEngine.path : spec.bin;
  const bundledRoot = resolveResourcePaths().nativeToolsDir;

  try {
    const { stdout, stderr } = await execFileAsync(binToRun, spec.args, {
      env,
      timeout: 3500,
      windowsHide: true,
    });
    const firstLine = `${stdout || ''}\n${stderr || ''}`
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) || 'Available';
    const resolvedPath = (fromEngine && fromEngine.path) || binToRun;
    return {
      id: spec.id,
      label: spec.label,
      available: true,
      bundled: Boolean(resolvedPath && resolvedPath.startsWith(bundledRoot)),
      path: resolvedPath,
      version: firstLine.slice(0, 110),
      features: spec.features,
    };
  } catch (_) {
    if (fromEngine && fromEngine.installed) {
      return {
        id: spec.id,
        label: spec.label,
        available: true,
        bundled: Boolean(fromEngine.path && fromEngine.path.startsWith(bundledRoot)),
        path: fromEngine.path,
        version: 'Installed',
        features: spec.features,
      };
    }
    return {
      id: spec.id,
      label: spec.label,
      available: false,
      bundled: false,
      path: null,
      version: null,
      features: spec.features,
    };
  }
}

async function runReadinessCheck() {
  const paths = resolveResourcePaths();
  const env = buildEngineEnvironment(paths, enginePort);
  const offlineAssets = verifyOfflineManifest(paths.vendorManifest, paths.engineRoot);

  let engineHealth = null;
  try {
    const resp = await fetchLoopbackJson('/api/health', enginePort, 3000);
    if (resp.statusCode === 200 && resp.body && resp.body.ok) {
      engineHealth = resp.body;
    }
  } catch (_) {}

  const engineToolsMap = (engineHealth && engineHealth.tools) || {};
  const tools = await Promise.all(
    NATIVE_TOOL_SPECS.map((spec) => probeCliTool(spec, env, engineToolsMap))
  );

  const availableToolsCount = tools.filter((t) => t.available).length;
  cachedReadiness = {
    checkedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    isPackaged: isPackagedApp(),
    engine: {
      online: Boolean(engineHealth && engineHealth.ok),
      url: `http://${HOST}:${enginePort}`,
      apiVersion: engineHealth ? engineHealth.engine_api_version : null,
      build: engineHealth ? engineHealth.engine_build : null,
      pythonVersion: engineHealth ? engineHealth.python : null,
      pythonExecutable: paths.pythonExe,
      pythonModules: engineHealth ? engineHealth.python_modules : {},
      doctor: engineHealth ? engineHealth.doctor : null,
    },
    offlineAssets,
    tools,
    summary: {
      browserStudiosReady: true,
      offlineVendorReady: offlineAssets.ready,
      localEngineReady: Boolean(engineHealth && engineHealth.ok),
      nativeToolsReady: availableToolsCount,
      nativeToolsTotal: tools.length,
    },
  };
  return cachedReadiness;
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

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  try {
    await startPythonEngine();
    await runReadinessCheck();
    await mainWindow.loadURL(`http://${HOST}:${enginePort}/`);
  } catch (err) {
    console.error('[OmniDesktop] Engine startup fallback to static UI:', err.message);
    await runReadinessCheck();
    await mainWindow.loadFile(paths.uiIndexHtml);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (cachedReadiness && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('omni:readiness-report', cachedReadiness);
    }
  });
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
    await startPythonEngine();
    return runReadinessCheck();
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
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
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
      await createMainWindow();

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
  verifyOfflineManifest,
  NATIVE_TOOL_SPECS,
};
