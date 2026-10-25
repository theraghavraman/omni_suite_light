/* Omni Suite V2 browser security reference. This module is dependency-free and
 * safe for static hosting. Integrate by import or bundling; do not inject secrets.
 */
(function (root, factory) {
  const API = factory();
  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.OMNI_SECURITY = API;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';
  const MAX_DECK_BYTES = 5 * 1024 * 1024;
  const MAX_SLIDES = 300;
  const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
  const LAYOUTS = new Set(['title', 'section', 'content', 'two', 'image', 'blank']);
  const THEMES = new Set(['light', 'ocean', 'sunset', 'forest', 'dark', 'mono']);
  const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const toPlain = v => v != null && typeof v === 'object' && !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

  function safeImageDataURL(url) {
    if (typeof url !== 'string' || url.length > MAX_IMAGE_BYTES * 1.5) return null;
    // Blob URLs from current session should not be persisted in imported JSON.
    const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!m || m[2].length * 3 / 4 > MAX_IMAGE_BYTES) return null;
    return url;
  }
  const boundedText = (v, limit = 40000) => typeof v === 'string' ? v.slice(0, limit) : '';
  function validateDeck(data) {
    if (!toPlain(data) || !Array.isArray(data.slides) || !data.slides.length ||
        data.slides.length > MAX_SLIDES || (data.redmarkDeck !== undefined && data.redmarkDeck !== 2)) {
      throw new Error('Invalid deck schema or excessive slide count');
    }
    const slides = data.slides.map((s, idx) => {
      if (!toPlain(s)) throw new Error('Invalid slide at index ' + idx);
      const imageSrc = toPlain(s.image) ? safeImageDataURL(s.image.src) : null;
      return {
        id: 'safe' + idx + '-' + Math.random().toString(36).slice(2),
        layout: LAYOUTS.has(s.layout) ? s.layout : 'content',
        title: boundedText(s.title, 2000), body: boundedText(s.body),
        body2: boundedText(s.body2), notes: boundedText(s.notes),
        image: imageSrc ? {src:imageSrc, w:Math.min(10000, Math.max(1, Number(s.image.w) || 1)),
          h:Math.min(10000, Math.max(1, Number(s.image.h) || 1))} : null
      };
    });
    return {redmarkDeck:2, theme:THEMES.has(data.theme) ? data.theme : 'light', slides};
  }
  function parseDeckJSON(contents) {
    if (typeof contents !== 'string' || contents.length > MAX_DECK_BYTES) throw new Error('Deck exceeds limit');
    return validateDeck(JSON.parse(contents));
  }
  function sanitizerOrPlainText(html, dompurify) {
    if (!dompurify || typeof dompurify.sanitize !== 'function') {
      return {html:escapeHTML(html), rich:false};
    }
    return {html:dompurify.sanitize(String(html), {
      USE_PROFILES:{html:true}, FORBID_TAGS:['script','style','iframe','object','embed','form'],
      FORBID_ATTR:['srcdoc','onload','onerror','onclick']
    }), rich:true};
  }
  function rejectPoisonKeys(input, depth = 0) {
    if (depth > 50) throw new Error('Excessive nested document depth');
    if (Array.isArray(input)) return input.map(v => rejectPoisonKeys(v, depth + 1));
    if (toPlain(input)) {
      const safe = Object.create(null);
      for (const [key, value] of Object.entries(input)) {
        if (BAD_KEYS.has(key)) throw new Error('Disallowed object key');
        safe[key] = rejectPoisonKeys(value, depth + 1);
      }
      return safe;
    }
    return input;
  }
  function excelSafeCell(value, spreadsheet = true) {
    if (!spreadsheet || typeof value !== 'string') return value;
    const trimmed = value.replace(/^[\x00-\x20]+/, '');
    if (/^-(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+\-]?\d+)?$/i.test(trimmed)) return value;
    if (/^[\x00-\x20]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)) return "'" + value;
    return value;
  }
  function safeCsv(rows, separator = ',', spreadsheet = true) {
    if (!Array.isArray(rows) || rows.length > 100000) throw new Error('Too many CSV rows');
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const quote = v => '"' + String(excelSafeCell(v ?? '', spreadsheet)).replace(/"/g, '""') + '"';
    return [keys.map(quote).join(separator), ...rows.map(r => keys.map(k => quote(r[k])).join(separator))].join('\r\n');
  }
  function safeXml(rows) {
    if (!Array.isArray(rows) || rows.length > 20000) throw new Error('Too many XML rows');
    // The original key is preserved in an escaped attribute, so invalid XML name characters are irrelevant.
    return '<?xml version="1.0" encoding="UTF-8"?><rows>' + rows.map(row =>
      '<row>' + Object.entries(row).map(([key, value]) =>
        '<cell key="' + escapeHTML(key) + '">' + escapeHTML(value) + '</cell>').join('') + '</row>').join('') + '</rows>';
  }
  const ZIP_LIMITS = Object.freeze({archiveBytes: 150 * 1024 * 1024, entries: 5000,
    entryBytes: 60 * 1024 * 1024, aggregateBytes: 250 * 1024 * 1024});
  function zipBudget(zip, fileBytes, limits = ZIP_LIMITS) {
    if (fileBytes > limits.archiveBytes) throw new Error('Archive too large');
    let count = 0, total = 0;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const name = entry.name;
      if (!name || name.startsWith('/') || name.startsWith('\\') ||
          name.split('/').some(part => part === '..') || name.includes('\\')) {
        throw new Error('Unsafe archive entry path');
      }
      const size = entry._data && Number(entry._data.uncompressedSize);
      if (!Number.isFinite(size) || size < 0) throw new Error('Archive lacks trustworthy size metadata');
      count++; total += size;
      if (count > limits.entries || size > limits.entryBytes || total > limits.aggregateBytes) {
        throw new Error('Archive expansion budget exceeded');
      }
    }
    return {count, total};
  }
  function installZipBudget(JSZip) {
    if (!JSZip || typeof JSZip.loadAsync !== 'function' || JSZip.loadAsync.__omniBudgeted) return JSZip;
    const original = JSZip.loadAsync;
    const guarded = async function (input, options) {
      const fileBytes = Number(input && (input.size || input.byteLength || input.length)) || 0;
      if (fileBytes > ZIP_LIMITS.archiveBytes) throw new Error('Archive too large');
      const zip = await original.call(this, input, options);
      zipBudget(zip, fileBytes);
      return zip;
    };
    guarded.__omniBudgeted = true;
    JSZip.loadAsync = guarded;
    return JSZip;
  }
  function validMediaPairs(info, resolver, safeHttpUrl) {
    const entries = Array.isArray(info.downloads) ? info.downloads : [];
    return entries.map((download, index) => {
      if (!download || typeof download.url !== 'string') return null;
      const raw = download.url;
      const absolute = /^https?:\/\//i.test(raw);
      const relative = /^\/api\/(?:download|media-proxy)(?:[/?]|$)/.test(raw);
      if (!absolute && !relative) return null;
      const href = safeHttpUrl(absolute ? raw : resolver.replace(/\/$/, '') + raw);
      return href ? {download, href, index} : null;
    }).filter(Boolean);
  }
  function requireRemoteConsent({host, bytes, operation}) {
    const message = `Send ${bytes} bytes to ${host} for ${operation}? This leaves your device.`;
    return typeof window !== 'undefined' && typeof window.confirm === 'function' && window.confirm(message) === true;
  }
  return {escapeHTML, safeImageDataURL, validateDeck, parseDeckJSON, sanitizerOrPlainText,
    rejectPoisonKeys, excelSafeCell, safeCsv, safeXml, zipBudget, installZipBudget, validMediaPairs, requireRemoteConsent};
});
if (typeof window !== 'undefined') {
  const install = () => { if (window.JSZip && window.OMNI_SECURITY) window.OMNI_SECURITY.installZipBudget(window.JSZip); };
  install();
  document.addEventListener('omni:libs-ready', install);
}
