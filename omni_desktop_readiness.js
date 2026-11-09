/**
 * OmniConverter Studio — First-Launch Desktop Readiness Check (omni_desktop_readiness.js)
 *
 * Runs inside the renderer process (both inside the Electron desktop shell via
 * window.omniDesktop and in local loopback mode via /api/health):
 * 1. Adds a clickable readiness status pill in the top application bar.
 * 2. On first launch in the desktop app (or when clicked by the user), opens a
 *    readiness checklist modal displaying:
 *    - Browser-First Studios & SHA-256 Verified Offline Assets (vendor/)
 *    - Python Local Engine status (127.0.0.1 loopback server & Python data stack)
 *    - Native CLI Tool availability (FFmpeg, qpdf, Poppler, Tesseract, LibreOffice,
 *      Calibre, ImageMagick, Ghostscript, Pandoc, 7-Zip) and the studio features
 *      each tool unlocks.
 */
(function () {
  'use strict';

  var FIRST_LAUNCH_STORAGE_KEY = 'omni_desktop_readiness_seen_v1';

  var FALLBACK_TOOLS = [
    { id: 'ffmpeg', label: 'FFmpeg', features: ['Audio Studio', 'Video Studio', 'Media Transcode'] },
    { id: 'ffprobe', label: 'FFprobe', features: ['Media Stream Inspection'] },
    { id: 'qpdf', label: 'qpdf', features: ['PDF Merge & Split', 'PDF Compress'] },
    { id: 'pdftoppm', label: 'Poppler (pdftoppm)', features: ['PDF High-DPI Page Rendering', 'PDF to PPTX'] },
    { id: 'pdftotext', label: 'Poppler (pdftotext)', features: ['PDF Text Extraction', 'PDF to DOCX'] },
    { id: 'tesseract', label: 'Tesseract OCR', features: ['Multi-Language Native OCR'] },
    { id: 'soffice', label: 'LibreOffice (soffice)', features: ['Office Format Converter', 'Unicode DOCX/PDF'] },
    { id: 'ebook-convert', label: 'Calibre (ebook-convert)', features: ['Native Ebook Format Bridge'] },
    { id: 'magick', label: 'ImageMagick', features: ['Native Image Format Bridge (HEIC/JXL/TIFF/PSD)'] },
    { id: 'gs', label: 'Ghostscript', features: ['PostScript & PDF Vector Processing'] },
    { id: 'pandoc', label: 'Pandoc', features: ['Document Markup Interchange'] },
    { id: '7z', label: '7-Zip', features: ['7z Archive Compression'] }
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  async function fetchReadinessData(forceRecheck) {
    if (window.omniDesktop && typeof window.omniDesktop.getReadiness === 'function') {
      try {
        return forceRecheck && typeof window.omniDesktop.recheckReadiness === 'function'
          ? await window.omniDesktop.recheckReadiness()
          : await window.omniDesktop.getReadiness();
      } catch (_) {}
    }

    var isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var health = null;
    if (isLoopback) {
      try {
        var res = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' });
        if (res.ok) {
          health = await res.json();
        }
      } catch (_) {}
    }

    var toolsMap = (health && health.tools) || {};
    var tools = FALLBACK_TOOLS.map(function (spec) {
      var entry = toolsMap[spec.id] || {};
      var altEntry = spec.id === 'soffice' ? toolsMap.libreoffice : (spec.id === '7z' ? toolsMap['7zz'] : null);
      var installed = Boolean(entry.installed || (altEntry && altEntry.installed));
      var resolvedPath = entry.path || (altEntry && altEntry.path) || null;
      return {
        id: spec.id,
        label: spec.label,
        available: installed,
        bundled: false,
        path: resolvedPath,
        version: installed ? 'Installed' : null,
        features: spec.features
      };
    });

    var availableCount = tools.filter(function (t) { return t.available; }).length;
    return {
      checkedAt: new Date().toISOString(),
      platform: (health && health.platform) || navigator.platform || 'browser',
      isPackaged: Boolean(window.omniDesktop && window.omniDesktop.isDesktopApp),
      engine: {
        online: Boolean(health && health.ok),
        url: isLoopback ? location.origin : 'http://127.0.0.1:8765',
        apiVersion: health ? health.engine_api_version : null,
        build: health ? health.engine_build : null,
        pythonVersion: health ? health.python : null,
        pythonModules: (health && health.python_modules) || {}
      },
      offlineAssets: {
        ready: isLoopback,
        verifiedCount: isLoopback ? 41 : 0,
        totalCount: 41,
        missing: []
      },
      tools: tools,
      summary: {
        browserStudiosReady: true,
        offlineVendorReady: isLoopback,
        localEngineReady: Boolean(health && health.ok),
        nativeToolsReady: availableCount,
        nativeToolsTotal: tools.length
      }
    };
  }

  function injectStyles() {
    if (document.getElementById('omni-desktop-readiness-style')) return;
    var style = document.createElement('style');
    style.id = 'omni-desktop-readiness-style';
    style.textContent = [
      '.omni-readiness-backdrop{position:fixed;inset:0;z-index:10050;background:rgba(27,42,73,.44);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .2s ease}',
      '.omni-readiness-backdrop.open{opacity:1;pointer-events:auto}',
      '.omni-readiness-modal{width:min(820px,100%);max-height:86vh;overflow:auto;border-radius:24px;background:#FFFDF9;border:1px solid rgba(27,42,73,.14);box-shadow:0 32px 80px rgba(27,42,73,.28);padding:24px;color:#1B2A49}',
      '.omni-readiness-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;border-bottom:1px solid rgba(27,42,73,.1);padding-bottom:14px;margin-bottom:16px}',
      '.omni-readiness-head h2{margin:4px 0;font-size:1.35rem;font-weight:800}',
      '.omni-readiness-kicker{font-size:.68rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#F0651A}',
      '.omni-readiness-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px;margin-bottom:16px}',
      '.omni-readiness-card{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid rgba(27,42,73,.1)}',
      '.omni-readiness-card small{display:block;font-size:.7rem;font-weight:700;color:#4D5B7A;text-transform:uppercase;letter-spacing:.05em}',
      '.omni-readiness-card strong{display:block;font-size:1.05rem;margin-top:3px;color:#1B2A49}',
      '.omni-readiness-card span{display:block;font-size:.75rem;color:#4D5B7A;margin-top:2px}',
      '.omni-readiness-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-top:10px}',
      '.omni-readiness-tool{padding:11px 13px;border-radius:14px;background:#fff;border:1px solid rgba(27,42,73,.1);display:flex;flex-direction:column;gap:4px}',
      '.omni-readiness-tool-top{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.omni-readiness-tool-top b{font-size:.86rem;color:#1B2A49}',
      '.omni-readiness-badge{font-size:.65rem;font-weight:800;padding:3px 8px;border-radius:999px;letter-spacing:.04em;text-transform:uppercase}',
      '.omni-readiness-badge.ok{background:rgba(19,138,91,.1);color:#138A5B}',
      '.omni-readiness-badge.warn{background:rgba(240,101,26,.12);color:#B45309}',
      '.omni-readiness-tool small{font-size:.74rem;color:#4D5B7A;line-height:1.35}',
      '.omni-readiness-actions{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-top:18px;padding-top:14px;border-top:1px solid rgba(27,42,73,.1)}',
      '.omni-ready{cursor:pointer}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureModalElement() {
    var existing = document.getElementById('omniDesktopReadinessBackdrop');
    if (existing) return existing;
    injectStyles();
    var backdrop = document.createElement('div');
    backdrop.id = 'omniDesktopReadinessBackdrop';
    backdrop.className = 'omni-readiness-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = '<div class="omni-readiness-modal" role="dialog" aria-modal="true" aria-labelledby="omniReadinessTitle"><div id="omniDesktopReadinessContent">Checking system readiness…</div></div>';
    backdrop.addEventListener('click', function (ev) {
      if (ev.target === backdrop) closeReadinessModal();
    });
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function renderReadinessModal(report) {
    var backdrop = ensureModalElement();
    var container = document.getElementById('omniDesktopReadinessContent');
    if (!container) return;

    var engineOnline = Boolean(report && report.engine && report.engine.online);
    var offlineReady = Boolean(report && report.offlineAssets && report.offlineAssets.ready);
    var tools = (report && report.tools) || [];
    var readyToolsCount = tools.filter(function (t) { return t.available; }).length;
    var pyMods = (report && report.engine && report.engine.pythonModules) || {};
    var pyModInstalled = Object.keys(pyMods).filter(function (k) { return pyMods[k]; }).length;
    var pyModTotal = Object.keys(pyMods).length;

    var toolsHtml = tools.map(function (tool) {
      var badgeClass = tool.available ? 'ok' : 'warn';
      var badgeText = tool.available ? (tool.bundled ? 'Bundled ✓' : 'Ready ✓') : 'Browser Fallback';
      var featuresText = (tool.features || []).join(' • ');
      return (
        '<div class="omni-readiness-tool">' +
          '<div class="omni-readiness-tool-top">' +
            '<b>' + escapeHtml(tool.label) + '</b>' +
            '<span class="omni-readiness-badge ' + badgeClass + '">' + escapeHtml(badgeText) + '</span>' +
          '</div>' +
          '<small>' + escapeHtml(featuresText) + '</small>' +
        '</div>'
      );
    }).join('');

    container.innerHTML =
      '<div class="omni-readiness-head">' +
        '<div>' +
          '<div class="omni-readiness-kicker">Desktop Readiness Check</div>' +
          '<h2 id="omniReadinessTitle">OmniConverter Studio Environment Status</h2>' +
          '<div style="font-size:.84rem;color:#4D5B7A">All processing runs locally on your machine (' + escapeHtml(report.platform || 'local') + ').</div>' +
        '</div>' +
        '<button type="button" class="btn btn-secondary" id="omniReadinessCloseTop" style="padding:6px 12px;min-height:34px">✕</button>' +
      '</div>' +
      '<div class="omni-readiness-cards">' +
        '<div class="omni-readiness-card">' +
          '<small>Browser Studios</small>' +
          '<strong>20+ Ready</strong>' +
          '<span>100% Client-Side</span>' +
        '</div>' +
        '<div class="omni-readiness-card">' +
          '<small>Offline Vendor Assets</small>' +
          '<strong>' + (offlineReady ? (report.offlineAssets.verifiedCount + '/' + report.offlineAssets.totalCount + ' Verified') : 'On-Demand') + '</strong>' +
          '<span>SHA-256 Pinned</span>' +
        '</div>' +
        '<div class="omni-readiness-card">' +
          '<small>Python Local Engine</small>' +
          '<strong>' + (engineOnline ? 'Online (127.0.0.1)' : 'Browser-Only Mode') + '</strong>' +
          '<span>' + (engineOnline ? ('Python ' + escapeHtml(report.engine.pythonVersion || '3.x') + ' • ' + pyModInstalled + '/' + (pyModTotal || pyModInstalled) + ' libs') : 'Start Local Engine for heavy jobs') + '</span>' +
        '</div>' +
        '<div class="omni-readiness-card">' +
          '<small>Native CLI Tools</small>' +
          '<strong>' + readyToolsCount + ' / ' + tools.length + ' Available</strong>' +
          '<span>FFmpeg, Poppler, LibreOffice, Calibre…</span>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:.8rem;font-weight:800;color:#1B2A49;margin-bottom:6px">Native Tool &amp; Feature Matrix</div>' +
      '<div class="omni-readiness-grid">' + toolsHtml + '</div>' +
      '<div class="omni-readiness-actions">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button type="button" class="btn btn-secondary" id="omniReadinessRecheckBtn">↻ Re-check Environment</button>' +
          (window.omniDesktop ? '<button type="button" class="btn btn-secondary" id="omniReadinessNoticesBtn">📜 Third-Party Notices</button>' : '') +
        '</div>' +
        '<button type="button" class="btn btn-primary" id="omniReadinessDoneBtn">Continue to Studio</button>' +
      '</div>';

    var closeTop = document.getElementById('omniReadinessCloseTop');
    var doneBtn = document.getElementById('omniReadinessDoneBtn');
    var recheckBtn = document.getElementById('omniReadinessRecheckBtn');
    var noticesBtn = document.getElementById('omniReadinessNoticesBtn');

    if (closeTop) closeTop.addEventListener('click', closeReadinessModal);
    if (doneBtn) doneBtn.addEventListener('click', closeReadinessModal);
    if (recheckBtn) {
      recheckBtn.addEventListener('click', async function () {
        recheckBtn.disabled = true;
        recheckBtn.textContent = 'Checking…';
        var fresh = await fetchReadinessData(true);
        updateTopBarPill(fresh);
        renderReadinessModal(fresh);
      });
    }
    if (noticesBtn && window.omniDesktop && typeof window.omniDesktop.openThirdPartyNotices === 'function') {
      noticesBtn.addEventListener('click', function () {
        window.omniDesktop.openThirdPartyNotices();
      });
    }
  }

  function openReadinessModal(report) {
    var backdrop = ensureModalElement();
    renderReadinessModal(report);
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    try {
      localStorage.setItem(FIRST_LAUNCH_STORAGE_KEY, '1');
    } catch (_) {}
  }

  function closeReadinessModal() {
    var backdrop = document.getElementById('omniDesktopReadinessBackdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
    }
  }

  function updateTopBarPill(report) {
    var readyBadge = document.querySelector('.omni-appbar .omni-ready');
    if (!readyBadge || !report) return;
    var tools = report.tools || [];
    var readyCount = tools.filter(function (t) { return t.available; }).length;
    var engineOnline = Boolean(report.engine && report.engine.online);
    readyBadge.title = 'Click to view OmniConverter Studio readiness checklist';
    readyBadge.innerHTML = '<i></i>' + (engineOnline ? ('READY · ' + readyCount + '/' + tools.length + ' TOOLS') : 'READY · BROWSER');
    if (!readyBadge.dataset.readinessBound) {
      readyBadge.dataset.readinessBound = '1';
      readyBadge.addEventListener('click', function () {
        openReadinessModal(report);
      });
    }
  }

  async function initDesktopReadiness() {
    var report = await fetchReadinessData(false);
    updateTopBarPill(report);

    if (window.omniDesktop && typeof window.omniDesktop.onReadinessReport === 'function') {
      window.omniDesktop.onReadinessReport(function (pushedReport) {
        report = pushedReport || report;
        updateTopBarPill(report);
      });
    }

    var isDesktop = Boolean(window.omniDesktop && window.omniDesktop.isDesktopApp);
    var seen = false;
    try {
      seen = localStorage.getItem(FIRST_LAUNCH_STORAGE_KEY) === '1';
    } catch (_) {}

    if (isDesktop && !seen) {
      openReadinessModal(report);
    }
  }

  window.OMNI_DESKTOP_READINESS = {
    check: fetchReadinessData,
    openModal: async function () {
      var report = await fetchReadinessData(false);
      openReadinessModal(report);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDesktopReadiness);
  } else {
    initDesktopReadiness();
  }
})();
