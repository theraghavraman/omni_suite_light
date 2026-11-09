/**
 * OmniConverter Studio — optional component manager (electron/components.cjs)
 *
 * The installer ships a catalog (resources/components-catalog.json) listing every optional
 * component (Python runtime, Python libraries, LibreOffice, Calibre, FFmpeg, ...) with its
 * archive name, size and SHA-256. Components the user selects are downloaded, verified
 * against that pinned SHA-256 *before* extraction, extracted into a staging folder and moved
 * atomically into <userData>/components/<id>. Nothing is installed system-wide and nothing
 * needs administrator rights. Omni works with any subset installed, including none.
 *
 * Layout under <userData>/components:
 *   <id>/component.json      per-component manifest written at build time
 *   state.json               installed versions/digests, first-run setup flag
 *   TOOLS_MANIFEST.json      merged tool manifest read by the Local Engine
 *   .downloads/, .staging-*  transient
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SINGLE_VALUE_ENV = new Set(['TESSDATA_PREFIX', 'FONTCONFIG_FILE', 'FONTCONFIG_PATH', 'MAGICK_GHOSTSCRIPT_PATH']);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** Mirror of stage_desktop_bundle.merge_component_manifests(). */
function mergeComponentManifests(installed, platform) {
  const tools = {};
  const env = {};
  const pathDirs = [];
  for (const [id, manifest] of Object.entries(installed)) {
    for (const [name, entry] of Object.entries(manifest.tools || {})) {
      if (!tools[name]) tools[name] = { ...entry, path: `${id}/${entry.path}`, component: id };
    }
    for (const [key, values] of Object.entries(manifest.env || {})) {
      const resolved = values.map((v) => `${id}/${v}`);
      if (SINGLE_VALUE_ENV.has(key)) {
        if (!env[key]) env[key] = resolved.slice(0, 1);
      } else {
        env[key] = env[key] || [];
        for (const v of resolved) if (!env[key].includes(v)) env[key].push(v);
      }
    }
    for (const dir of manifest.path_dirs || []) pathDirs.push(`${id}/${dir}`);
  }
  if (platform.startsWith('win32') && tools.gswin64c && !env.MAGICK_GHOSTSCRIPT_PATH) {
    env.MAGICK_GHOSTSCRIPT_PATH = [path.posix.dirname(tools.gswin64c.path)];
  }
  return { schema_version: 1, platform, tools, env, path_dirs: pathDirs };
}

function resolveSelection(catalog, ids) {
  const byId = new Map((catalog.components || []).map((c) => [c.id, c]));
  const ordered = [];
  const visit = (id, chain = []) => {
    if (ordered.includes(id)) return;
    const entry = byId.get(id);
    if (!entry) throw new Error(`Unknown component "${id}"`);
    if (chain.includes(id)) throw new Error(`Component dependency cycle: ${[...chain, id].join(' -> ')}`);
    for (const dep of entry.requires || []) visit(dep, [...chain, id]);
    ordered.push(id);
  };
  for (const id of ids) visit(id);
  return ordered;
}

function tarExecutable() {
  if (process.platform === 'win32') {
    return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  }
  return fs.existsSync('/usr/bin/tar') ? '/usr/bin/tar' : 'tar';
}

function runTar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(tarExecutable(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}: ${stderr.slice(-800)}`))));
  });
}

function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch (_) {
    return Infinity;
  }
}

class ComponentManager {
  constructor({ catalogPath, rootDir, platform, fetchImpl, baseUrlOverride, log }) {
    this.catalogPath = catalogPath;
    this.root = rootDir;
    this.platform = platform;
    this.fetch = fetchImpl || globalThis.fetch;
    this.baseUrlOverride = baseUrlOverride || '';
    this.log = log || (() => {});
    this.controllers = new Map();
    fs.mkdirSync(this.root, { recursive: true });
  }

  catalog() {
    const catalog = readJson(this.catalogPath);
    if (!catalog || !Array.isArray(catalog.components)) return { components: [], platform: this.platform, missing: true };
    return catalog;
  }

  baseUrl() {
    const base = this.baseUrlOverride || this.catalog().base_url || '';
    return base.endsWith('/') ? base : `${base}/`;
  }

  statePath() {
    return path.join(this.root, 'state.json');
  }

  state() {
    const state = readJson(this.statePath()) || {};
    return { installed: state.installed || {}, setupCompleted: Boolean(state.setupCompleted) };
  }

  saveState(state) {
    writeJsonAtomic(this.statePath(), state);
  }

  componentDir(id) {
    return path.join(this.root, id);
  }

  componentManifest(id) {
    return readJson(path.join(this.componentDir(id), 'component.json'));
  }

  isInstalled(id) {
    const entry = this.state().installed[id];
    return Boolean(entry && this.componentManifest(id));
  }

  installedManifests() {
    const out = {};
    for (const id of Object.keys(this.state().installed)) {
      const manifest = this.componentManifest(id);
      if (manifest) out[id] = manifest;
    }
    return out;
  }

  /** Rewrite <root>/TOOLS_MANIFEST.json from the installed components. */
  writeMergedManifest() {
    const merged = mergeComponentManifests(this.installedManifests(), this.platform);
    writeJsonAtomic(path.join(this.root, 'TOOLS_MANIFEST.json'), merged);
    return merged;
  }

  pythonExecutable() {
    const manifest = this.isInstalled('python-runtime') ? this.componentManifest('python-runtime') : null;
    if (!manifest || !manifest.python) return null;
    const exe = path.join(this.componentDir('python-runtime'), manifest.python);
    return fs.existsSync(exe) ? exe : null;
  }

  pythonPath() {
    const manifest = this.isInstalled('python-libraries') ? this.componentManifest('python-libraries') : null;
    if (!manifest) return [];
    return (manifest.python_path || []).map((rel) => path.join(this.componentDir('python-libraries'), rel));
  }

  list() {
    const catalog = this.catalog();
    const state = this.state();
    return {
      platform: this.platform,
      catalogMissing: Boolean(catalog.missing),
      baseUrl: this.baseUrl(),
      setupCompleted: state.setupCompleted,
      components: catalog.components.map((c) => ({
        ...c,
        installed: this.isInstalled(c.id),
        installedVersion: state.installed[c.id] ? state.installed[c.id].version : null,
        updateAvailable: Boolean(state.installed[c.id] && state.installed[c.id].sha256 !== c.sha256),
      })),
    };
  }

  markSetupCompleted() {
    const state = this.state();
    state.setupCompleted = true;
    this.saveState(state);
  }

  cancel(id) {
    const controller = this.controllers.get(id);
    if (controller) controller.abort();
  }

  /**
   * Download with resume: an interrupted transfer continues with an HTTP Range request
   * (when the server supports it). The complete file is hashed and must match the
   * catalog's SHA-256 before anything is extracted.
   */
  async download(entry, dest, onProgress, signal, attempts = 6) {
    const url = new URL(entry.file, this.baseUrl()).toString();
    const total = entry.size || 0;
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (signal && signal.aborted) throw Object.assign(new Error('Cancelled.'), { name: 'AbortError' });
      let have = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      try {
        const headers = have ? { Range: `bytes=${have}-` } : {};
        const response = await this.fetch(url, { signal, redirect: 'follow', headers });
        if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { fatal: response.status === 404 });
        if (have && response.status !== 206) have = 0; // server ignored Range: start over
        const out = fs.createWriteStream(dest, { flags: have ? 'a' : 'w' });
        let received = have;
        let lastEmit = 0;
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            received += chunk.length;
            if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
            const now = Date.now();
            if (now - lastEmit > 250) {
              lastEmit = now;
              onProgress({ id: entry.id, phase: 'downloading', received, total });
            }
          }
        } finally {
          await new Promise((r) => out.end(r));
        }
        if (total && received < total) throw new Error(`connection closed after ${received} of ${total} bytes`);
        break;
      } catch (err) {
        if (err && (err.name === 'AbortError' || err.fatal)) {
          fs.rmSync(dest, { force: true });
          throw err;
        }
        lastError = err;
        this.log(`download of ${entry.file} attempt ${attempt} failed: ${err.message}`);
        if (attempt === attempts) {
          fs.rmSync(dest, { force: true });
          throw new Error(`Download of ${entry.file} was interrupted repeatedly (${err.message}). Check the connection and retry.`);
        }
        await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * attempt)));
      }
    }
    const size = fs.statSync(dest).size;
    const actual = await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      fs.createReadStream(dest).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
    });
    if ((total && size !== total) || actual !== entry.sha256) {
      fs.rmSync(dest, { force: true });
      throw new Error(`Checksum mismatch for ${entry.file}: expected ${entry.sha256}, got ${actual}. The download was discarded.`);
    }
    onProgress({ id: entry.id, phase: 'verified', received: size, total });
    void lastError;
  }

  async installOne(entry, onProgress) {
    const downloads = path.join(this.root, '.downloads');
    fs.mkdirSync(downloads, { recursive: true });
    const needed = (entry.size || 0) + (entry.installed_size || 0) * 1.1;
    const available = freeBytes(this.root);
    if (available < needed) {
      throw new Error(`Not enough disk space for ${entry.title}: needs ${Math.ceil(needed / 1e6)} MB, ${Math.floor(available / 1e6)} MB free.`);
    }
    const archive = path.join(downloads, `${entry.id}-${entry.sha256.slice(0, 12)}.tar.gz.part`);
    const controller = new AbortController();
    this.controllers.set(entry.id, controller);
    const staging = path.join(this.root, `.staging-${entry.id}-${crypto.randomBytes(4).toString('hex')}`);
    try {
      onProgress({ id: entry.id, phase: 'downloading', received: 0, total: entry.size });
      await this.download(entry, archive, onProgress, controller.signal);
      onProgress({ id: entry.id, phase: 'extracting' });
      fs.mkdirSync(staging, { recursive: true });
      await runTar(['-xzf', archive, '-C', staging]);
      const manifest = readJson(path.join(staging, 'component.json'));
      if (!manifest || manifest.id !== entry.id || manifest.platform !== this.platform) {
        throw new Error(`${entry.file} is not the ${entry.id} component for ${this.platform}`);
      }
      const target = this.componentDir(entry.id);
      const previous = `${target}.old-${Date.now()}`;
      if (fs.existsSync(target)) fs.renameSync(target, previous);
      fs.renameSync(staging, target);
      fs.rmSync(previous, { recursive: true, force: true });
      const state = this.state();
      state.installed[entry.id] = { version: entry.version, sha256: entry.sha256, installedAt: new Date().toISOString() };
      this.saveState(state);
      this.writeMergedManifest();
      onProgress({ id: entry.id, phase: 'installed' });
    } finally {
      this.controllers.delete(entry.id);
      fs.rmSync(archive, { force: true });
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  /** Install ids (plus their dependencies). Each component succeeds or fails on its own. */
  async install(ids, onProgress = () => {}) {
    const catalog = this.catalog();
    const order = resolveSelection(catalog, ids);
    const byId = new Map(catalog.components.map((c) => [c.id, c]));
    const results = {};
    for (const id of order) {
      const entry = byId.get(id);
      const current = this.state().installed[id];
      if (current && current.sha256 === entry.sha256 && this.componentManifest(id)) {
        results[id] = { ok: true, skipped: true };
        onProgress({ id, phase: 'installed', skipped: true });
        continue;
      }
      const missingDeps = (entry.requires || []).filter((dep) => !this.isInstalled(dep));
      if (missingDeps.length) {
        results[id] = { ok: false, error: `Requires ${missingDeps.join(', ')}, which did not install.` };
        onProgress({ id, phase: 'failed', error: results[id].error });
        continue;
      }
      try {
        this.log(`installing component ${id}`);
        await this.installOne(entry, onProgress);
        results[id] = { ok: true };
      } catch (err) {
        const message = err && err.name === 'AbortError' ? 'Cancelled.' : String((err && err.message) || err);
        this.log(`component ${id} failed: ${message}`);
        results[id] = { ok: false, error: message };
        onProgress({ id, phase: 'failed', error: message });
      }
    }
    return results;
  }

  remove(id) {
    const state = this.state();
    fs.rmSync(this.componentDir(id), { recursive: true, force: true });
    delete state.installed[id];
    this.saveState(state);
    this.writeMergedManifest();
    return this.list();
  }
}

module.exports = { ComponentManager, mergeComponentManifests, resolveSelection, tarExecutable };
