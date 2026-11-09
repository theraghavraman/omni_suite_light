/* OmniConverter Studio — Component Manager window logic (electron/components-ui.js) */
'use strict';

(function () {
  const api = window.omniComponents;
  const listEl = document.getElementById('list');
  const totalEl = document.getElementById('total');
  const noteEl = document.getElementById('note');
  const installBtn = document.getElementById('install');
  const skipBtn = document.getElementById('skip');
  let data = { components: [] };
  const selected = new Set();
  const progress = new Map();
  let busy = false;

  const mb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
  const byId = () => new Map(data.components.map((c) => [c.id, c]));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    for (const child of children || []) if (child) node.appendChild(child);
    return node;
  }

  function select(id, on) {
    const map = byId();
    if (on) {
      const add = (cid) => {
        const c = map.get(cid);
        if (!c || c.installed) return;
        selected.add(cid);
        (c.requires || []).forEach(add);
      };
      add(id);
    } else {
      const drop = (cid) => {
        selected.delete(cid);
        data.components.filter((c) => (c.requires || []).includes(cid)).forEach((c) => drop(c.id));
      };
      drop(id);
    }
    render();
  }

  function statusLine(c) {
    const p = progress.get(c.id);
    if (!p) return null;
    if (p.phase === 'downloading') {
      const wrap = el('div', {}, [
        el('progress', { max: String(p.total || c.size || 1), value: String(p.received || 0) }),
        el('div', { class: 'status', text: `Downloading ${mb(p.received || 0)} of ${mb(p.total || c.size)}` }),
      ]);
      const cancel = el('button', { class: 'link', text: 'Cancel' });
      cancel.onclick = () => api.cancel(c.id);
      wrap.appendChild(cancel);
      return wrap;
    }
    const text = {
      queued: 'Waiting…',
      verified: 'Checksum verified',
      extracting: 'Installing…',
      installed: p.skipped ? 'Already installed' : 'Installed',
      failed: `Failed: ${p.error}`,
    }[p.phase] || p.phase;
    return el('div', { class: `status ${p.phase === 'failed' ? 'err' : p.phase === 'installed' ? 'ok' : ''}`, text });
  }

  function render() {
    listEl.textContent = '';
    if (data.catalogMissing || !data.components.length) {
      listEl.appendChild(el('div', { class: 'empty', text: 'No optional components are available for this build. OmniConverter Studio runs in browser-only mode.' }));
    }
    const map = byId();
    for (const c of data.components) {
      const box = el('input', { type: 'checkbox', checked: c.installed || selected.has(c.id), disabled: busy || c.installed, 'aria-label': c.title });
      box.onchange = () => select(c.id, box.checked);
      const requires = (c.requires || []).map((r) => (map.get(r) || { title: r }).title);
      const titleRow = el('div', { class: 'title', text: c.title }, [
        c.installed ? el('span', { class: 'badge ok', text: c.updateAvailable ? 'Installed (update available)' : 'Installed' }) : null,
        !c.installed && c.recommended ? el('span', { class: 'badge rec', text: 'Recommended' }) : null,
      ]);
      const body = el('div', {}, [
        titleRow,
        el('div', { class: 'desc', text: c.description }),
        requires.length ? el('div', { class: 'desc', text: `Requires: ${requires.join(', ')}` }) : null,
        statusLine(c),
      ]);
      const meta = el('div', { class: 'meta' }, [
        el('div', { text: `${mb(c.size)} download` }),
        el('div', { text: `${mb(c.installed_size)} on disk` }),
      ]);
      if (c.installed && !busy) {
        const remove = el('button', { class: 'link', text: 'Remove' });
        remove.onclick = async () => {
          data = await api.remove(c.id);
          progress.delete(c.id);
          render();
        };
        meta.appendChild(remove);
      }
      listEl.appendChild(el('label', { class: 'item' }, [box, body, meta]));
    }
    const chosen = data.components.filter((c) => selected.has(c.id));
    const download = chosen.reduce((sum, c) => sum + (c.size || 0), 0);
    const disk = chosen.reduce((sum, c) => sum + (c.installed_size || 0), 0);
    totalEl.textContent = chosen.length ? `${chosen.length} selected · ${mb(download)} download · ${mb(disk)} on disk` : 'Nothing selected';
    installBtn.disabled = busy || chosen.length === 0;
    installBtn.textContent = busy ? 'Installing…' : 'Install selected';
    skipBtn.textContent = data.components.some((c) => c.installed) ? 'Done' : 'Continue without installing';
    skipBtn.disabled = busy;
  }

  document.getElementById('recommended').onclick = () => {
    selected.clear();
    data.components.filter((c) => c.recommended).forEach((c) => select(c.id, true));
  };
  document.getElementById('all').onclick = () => data.components.forEach((c) => select(c.id, true));
  document.getElementById('none').onclick = () => { selected.clear(); render(); };

  installBtn.onclick = async () => {
    busy = true;
    [...selected].forEach((id) => progress.set(id, { phase: 'queued' }));
    noteEl.textContent = 'Downloading and verifying. You can keep using OmniConverter Studio meanwhile.';
    render();
    const results = await api.install([...selected]);
    busy = false;
    const failed = Object.entries(results).filter(([, r]) => !r.ok);
    selected.clear();
    data = await api.list();
    noteEl.textContent = failed.length
      ? `${failed.length} component(s) could not be installed. Everything else is ready; you can retry the failed ones.`
      : 'All selected components are installed. Click Done to restart the Local Engine with them.';
    render();
  };

  skipBtn.onclick = () => api.finish();

  api.onProgress((p) => {
    progress.set(p.id, p);
    render();
  });

  api.list().then((d) => {
    data = d;
    if (!d.components.some((c) => c.installed)) {
      d.components.filter((c) => c.recommended).forEach((c) => selected.add(c.id));
    }
    render();
  });
})();
