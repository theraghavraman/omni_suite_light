    document.addEventListener('DOMContentLoaded', () => {
      const status = document.getElementById('omniCapabilityStatus');
      if (status) {
        const caps = [];
        if (window.CompressionStream) caps.push('stream compression');
        if (window.MediaRecorder) caps.push('video recording');
        if (window.showDirectoryPicker) caps.push('folder export');
        status.textContent = caps.length ? caps.join(' • ') : 'basic browser mode';
      }
    });
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = window.OMNI_PDF_WORKER || 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    // Tabs
    const navBtns = document.querySelectorAll('.nav-btn');
    const modulePanels = document.querySelectorAll('.module-panel');

    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        navBtns.forEach(b => b.classList.remove('active'));
        modulePanels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.getAttribute('data-tab')).classList.add('active');
      });
    });

    // ==========================================
    // BULLETPROOF ENCODING SANITIZER (Fixes WinAnsi 0x0009 Bug)
    // ==========================================
    function sanitizeForWinAnsi(str) {
      if (!str) return '';
      return String(str)
        .replace(/\t/g, '    ')                     // Eliminate 0x0009 tab bug
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // Smart quotes
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // Smart apostrophes
        .replace(/[\u2013\u2014\u2015]/g, '-')       // En/Em dashes
        .replace(/\u2026/g, '...')                   // Ellipsis
        .replace(/\u2022/g, '*')                     // Bullet
        .replace(/\u00A0/g, ' ')                     // Non-breaking space
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')      // Replace non-WinAnsi characters
        .replace(/[\r\n]+/g, ' ');
    }

    function formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(2) + ' MB';
    }

    function omniNotify(message, isError=false) {
      let el = document.getElementById('omniMobileStatus');
      if (!el) {
        el = document.createElement('div');
        el.id = 'omniMobileStatus';
        el.className = 'mobile-status';
        document.body.appendChild(el);
      }
      el.textContent = message;
      el.classList.add('show');
      clearTimeout(window.__omniStatusTimer);
      window.__omniStatusTimer = setTimeout(() => el.classList.remove('show'), isError ? 5000 : 2600);
    }
    function omniDownload(blob, filename) {
      if (!blob || !blob.size) throw new Error('No output was generated.');
      downloadBlob(blob, filename);
    }
    window.addEventListener('error', e => {
      console.error('OmniConverter error:', e.error || e.message);
      omniNotify('A tool error occurred. Check the selected file/format and try again.', true);
    });
    window.addEventListener('unhandledrejection', e => {
      console.error('OmniConverter promise error:', e.reason);
      omniNotify('A conversion step failed. Please try again with the same file or a smaller one.', true);
    });

    function formatTime(sec) {
      sec = Math.max(0, sec || 0);
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    function parsePageRange(rangeStr, totalPages) {
      if (!rangeStr || !rangeStr.trim()) {
        return Array.from({ length: totalPages }, (_, i) => i + 1);
      }
      const pages = new Set();
      const parts = rangeStr.split(',');
      for (const part of parts) {
        const clean = part.trim();
        if (clean.includes('-')) {
          const [startStr, endStr] = clean.split('-');
          const start = parseInt(startStr, 10);
          const end = parseInt(endStr, 10);
          if (!isNaN(start) && !isNaN(end)) {
            for (let p = Math.max(1, start); p <= Math.min(totalPages, end); p++) pages.add(p);
          }
        } else {
          const p = parseInt(clean, 10);
          if (!isNaN(p) && p >= 1 && p <= totalPages) pages.add(p);
        }
      }
      return Array.from(pages).sort((a, b) => a - b);
    }

    function escapeXml(str) {
      return String(str || '').replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
        }
      });
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    function setupDragDrop(el, onFiles) {
      ['dragenter', 'dragover'].forEach(n => {
        el.addEventListener(n, (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('dragover'); });
      });
      ['dragleave', 'drop'].forEach(n => {
        el.addEventListener(n, (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('dragover'); });
      });
      el.addEventListener('drop', (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
      });
    }


    // ==========================================
    // IMAGE RESIZE / DPI / PHOTO PRESETS
    // ==========================================
    const imgResizeDropzone = document.getElementById('imgResizeDropzone');
    const imgResizeInput = document.getElementById('imgResizeInput');
    const imgResizeControls = document.getElementById('imgResizeControls');
    const imgResizeName = document.getElementById('imgResizeName');
    const imgResizeMeta = document.getElementById('imgResizeMeta');
    const imgResizeReset = document.getElementById('imgResizeReset');
    const imgResizeWidth = document.getElementById('imgResizeWidth');
    const imgResizeHeight = document.getElementById('imgResizeHeight');
    const imgResizeLock = document.getElementById('imgResizeLock');
    const imgResizeDpi = document.getElementById('imgResizeDpi');
    const imgResizeOutput = document.getElementById('imgResizeOutput');
    const imgResizeWidthMm = document.getElementById('imgResizeWidthMm');
    const imgResizeHeightMm = document.getElementById('imgResizeHeightMm');
    const imgResizePixelsBtn = document.getElementById('imgResizePixelsBtn');
    const imgResizeDpiBtn = document.getElementById('imgResizeDpiBtn');
    const imgPassportBtn = document.getElementById('imgPassportBtn');
    const imgId2x2Btn = document.getElementById('imgId2x2Btn');
    const imgSignatureBtn = document.getElementById('imgSignatureBtn');
    const imgResizeResults = document.getElementById('imgResizeResults');
    const imgResizeGrid = document.getElementById('imgResizeGrid');
    const imgResizeResultTitle = document.getElementById('imgResizeResultTitle');
    const imgResizeResultMeta = document.getElementById('imgResizeResultMeta');
    let imgResizeFile = null;
    let imgResizeObjectUrl = null;

    imgResizeDropzone.addEventListener('click', () => imgResizeInput.click());
    setupDragDrop(imgResizeDropzone, files => { if (files[0]) loadResizeImage(files[0]); });
    imgResizeInput.addEventListener('change', e => { if (e.target.files[0]) loadResizeImage(e.target.files[0]); });

    function loadResizeImage(file) {
      if (!file.type.startsWith('image/')) return alert('Please choose an image file.');
      imgResizeFile = file;
      if (imgResizeObjectUrl) URL.revokeObjectURL(imgResizeObjectUrl);
      imgResizeObjectUrl = URL.createObjectURL(file);
      imgResizeDropzone.style.display = 'none';
      imgResizeControls.style.display = 'flex';
      imgResizeName.textContent = file.name;
      imgResizeMeta.textContent = 'Loading dimensions…';
      const im = new Image();
      im.onload = () => {
        imgResizeWidth.value = im.naturalWidth;
        imgResizeHeight.value = im.naturalHeight;
        imgResizeMeta.textContent = `${im.naturalWidth} × ${im.naturalHeight} px • ${formatFileSize(file.size)}`;
        URL.revokeObjectURL(im.src);
      };
      im.src = imgResizeObjectUrl;
    }

    function mmToPx(mm, dpi) { return Math.max(1, Math.round((Number(mm) / 25.4) * Number(dpi))); }

    function updateResizeHeightFromWidth() {
      if (!imgResizeFile || imgResizeLock.value === 'stretch') return;
      const im = document.querySelector('#imgResizePreviewTemp');
      if (!im) return;
    }

    async function renderResizedImage(width, height, mode, title) {
      if (!imgResizeFile) return;
      const bitmap = await createImageBitmap(imgResizeFile);
      const srcW = bitmap.width, srcH = bitmap.height;
      width = Math.max(1, Math.min(12000, Math.round(width)));
      height = Math.max(1, Math.min(12000, Math.round(height)));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (mode === 'cover') {
        const scale = Math.max(width / srcW, height / srcH);
        const dw = srcW * scale, dh = srcH * scale;
        ctx.drawImage(bitmap, (width - dw) / 2, (height - dh) / 2, dw, dh);
      } else if (mode === 'contain') {
        const scale = Math.min(width / srcW, height / srcH);
        const dw = srcW * scale, dh = srcH * scale;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(bitmap, (width - dw) / 2, (height - dh) / 2, dw, dh);
      } else {
        ctx.drawImage(bitmap, 0, 0, width, height);
      }

      const outMime = imgResizeOutput.value === 'png' ? 'image/png' : imgResizeOutput.value === 'webp' ? 'image/webp' : 'image/jpeg';
      const outExt = imgResizeOutput.value;
      if (outExt === 'jpg') {
        const bg = document.createElement('canvas');
        bg.width = canvas.width; bg.height = canvas.height;
        const bctx = bg.getContext('2d'); bctx.fillStyle='#fff'; bctx.fillRect(0,0,bg.width,bg.height); bctx.drawImage(canvas,0,0);
        canvas.width = bg.width; canvas.height = bg.height; ctx.drawImage(bg,0,0);
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, outMime, outExt === 'png' ? undefined : 0.94));
      if (!blob) throw new Error('Your browser could not encode the resized image.');
      const safeBase = imgResizeFile.name.replace(/\.[^/.]+$/, '') || 'image';
      const filename = `${safeBase}_${width}x${height}px.${outExt}`;
      const url = URL.createObjectURL(blob);
      imgResizeGrid.innerHTML = `
        <div class="page-card">
          <div class="page-preview-wrapper"><img src="${url}" alt="Resized preview"></div>
          <div class="page-meta">
            <div><div class="page-num">${width} × ${height} px</div><div class="file-meta">${title}</div></div>
            <a class="btn-download-single" href="${url}" download="${filename}">Save</a>
          </div>
        </div>`;
      imgResizeResults.style.display = 'block';
      imgResizeResultTitle.textContent = title;
      imgResizeResultMeta.textContent = `${width} × ${height} px • ${formatFileSize(blob.size)}`;
      imgResizeResults.scrollIntoView({behavior:'smooth', block:'nearest'});
      if (bitmap.close) bitmap.close();
    }

    imgResizePixelsBtn.addEventListener('click', () => renderResizedImage(Number(imgResizeWidth.value), Number(imgResizeHeight.value), imgResizeLock.value, 'Custom pixel dimensions'));
    imgResizeDpiBtn.addEventListener('click', () => {
      const dpi = Number(imgResizeDpi.value) || 300;
      const w = mmToPx(imgResizeWidthMm.value, dpi);
      const h = mmToPx(imgResizeHeightMm.value, dpi);
      imgResizeWidth.value = w; imgResizeHeight.value = h;
      renderResizedImage(w, h, imgResizeLock.value === 'stretch' ? 'stretch' : 'cover', `${imgResizeWidthMm.value} × ${imgResizeHeightMm.value} mm @ ${dpi} DPI → ${w} × ${h} px`);
    });

    imgPassportBtn.addEventListener('click', () => {
      imgResizeDpi.value = '300';
      imgResizeWidthMm.value = '35';
      imgResizeHeightMm.value = '45';
      imgResizeWidth.value = 413;
      imgResizeHeight.value = 531;
      renderResizedImage(413, 531, 'cover', 'Indian passport/visa photo preset • 35 × 45 mm @ 300 DPI');
    });

    imgId2x2Btn.addEventListener('click', () => {
      imgResizeDpi.value = '300';
      imgResizeWidthMm.value = '50.8';
      imgResizeHeightMm.value = '50.8';
      imgResizeWidth.value = 600;
      imgResizeHeight.value = 600;
      renderResizedImage(600, 600, 'cover', '2 × 2 inch ID photo preset @ 300 DPI');
    });

    imgSignatureBtn.addEventListener('click', () => {
      imgResizeDpi.value = '300';
      imgResizeWidthMm.value = '35';
      imgResizeHeightMm.value = '15';
      imgResizeWidth.value = 413;
      imgResizeHeight.value = 177;
      renderResizedImage(413, 177, 'contain', 'Signature preset • 35 × 15 mm @ 300 DPI');
    });

    imgResizeReset.addEventListener('click', () => {
      imgResizeFile = null;
      if (imgResizeObjectUrl) { URL.revokeObjectURL(imgResizeObjectUrl); imgResizeObjectUrl = null; }
      imgResizeDropzone.style.display = 'flex';
      imgResizeControls.style.display = 'none';
      imgResizeResults.style.display = 'none';
      imgResizeGrid.innerHTML = '';
      imgResizeInput.value = '';
    });

    // ==========================================
    // FILE COMPRESSION / DECOMPRESSION
    // ==========================================
    const compressDropzone = document.getElementById('compressDropzone');
    const compressInput = document.getElementById('compressInput');
    const compressControls = document.getElementById('compressControls');
    const compressSummary = document.getElementById('compressSummary');
    const compressMeta = document.getElementById('compressMeta');
    const compressReset = document.getElementById('compressReset');
    const compressFormat = document.getElementById('compressFormat');
    const compressLevel = document.getElementById('compressLevel');
    const compressBtn = document.getElementById('compressBtn');
    const compressProgress = document.getElementById('compressProgress');
    const compressProgressBar = document.getElementById('compressProgressBar');
    const compressProgressText = document.getElementById('compressProgressText');
    const compressProgressPercent = document.getElementById('compressProgressPercent');
    var compressFiles = window.compressFiles || [];

    const decompressDropzone = document.getElementById('decompressDropzone');
    const decompressInput = document.getElementById('decompressInput');
    const decompressControls = document.getElementById('decompressControls');
    const decompressName = document.getElementById('decompressName');
    const decompressMeta = document.getElementById('decompressMeta');
    const decompressReset = document.getElementById('decompressReset');
    const decompressBtn = document.getElementById('decompressBtn');
    const decompressSaveAll = document.getElementById('decompressSaveAll');
    const decompressList = document.getElementById('decompressList');
    var decompressFile = window.decompressFile || null;
    let decompressedItems = [];

    function setCompressionProgress(p, text) {
      const n = Math.max(0, Math.min(100, Math.round(p)));
      compressProgressBar.style.width = n + '%';
      compressProgressPercent.textContent = n + '%';
      compressProgressText.textContent = text || 'Working…';
    }

    function compressionStreamSupported(format, decompress=false) {
      const C = decompress ? window.DecompressionStream : window.CompressionStream;
      if (!C) return false;
      try { new C(format); return true; } catch (_) { return false; }
    }

    function streamCompress(file, format) {
      const stream = new CompressionStream(format);
      return new Response(file.stream().pipeThrough(stream)).blob();
    }

    function streamDecompress(blob, format) {
      const stream = new DecompressionStream(format);
      return new Response(blob.stream().pipeThrough(stream)).blob();
    }

    function chooseCompressedName(file, format) {
      const base = file.name.replace(/\.(gz|gzip|deflate|br)$/i, '');
      if (format === 'gzip') return base + '.gz';
      if (format === 'deflate') return base + '.deflate';
      if (format === 'brotli') return base + '.br';
      return base + '.zip';
    }

    function updateCompressionSelection() {
      const singleOnly = compressFormat.value !== 'zip';
      if (singleOnly && compressFiles.length > 1) {
        compressMeta.textContent = 'This format accepts one file — only the first file will be used.';
      } else {
        compressMeta.textContent = `${compressFiles.length} file(s) • ${formatFileSize(compressFiles.reduce((n,f)=>n+f.size,0))}`;
      }
    }

    compressDropzone.addEventListener('click', () => compressInput.click());
    setupDragDrop(compressDropzone, files => {
      compressFiles = Array.from(files);
      compressDropzone.style.display = 'none';
      compressControls.style.display = 'flex';
      compressSummary.textContent = `${compressFiles.length} file(s) selected`;
      updateCompressionSelection();
    });
    compressInput.addEventListener('change', e => {
      compressFiles = Array.from(e.target.files);
      if (compressFiles.length) {
        compressDropzone.style.display = 'none';
        compressControls.style.display = 'flex';
        compressSummary.textContent = `${compressFiles.length} file(s) selected`;
        updateCompressionSelection();
      }
    });
    compressFormat.addEventListener('change', updateCompressionSelection);

    compressReset.addEventListener('click', () => {
      compressFiles = [];
      compressDropzone.style.display = 'flex';
      compressControls.style.display = 'none';
      compressInput.value = '';
    });

    compressBtn.addEventListener('click', async () => {
      if (!compressFiles.length) return;
      compressBtn.disabled = true;
      compressProgress.style.display = 'block';
      setCompressionProgress(3, 'Preparing…');
      try {
        const format = compressFormat.value;
        const level = Number(compressLevel.value);
        let outBlob, outName;

        if (format === 'zip') {
          if (!window.JSZip) throw new Error('ZIP engine is unavailable.');
          const zip = new JSZip();
          compressFiles.forEach(f => zip.file(f.name, f));
          outBlob = await zip.generateAsync({type:'blob', compression: level === 0 ? 'STORE' : 'DEFLATE', compressionOptions:{level:Math.max(1,level)}}, meta => {
            setCompressionProgress(meta.percent, 'Building ZIP…');
          });
          outName = 'compressed_files.zip';
        } else {
          const f = compressFiles[0];
          const streamFormat = format === 'gzip' ? 'gzip' : (format === 'deflate' ? 'deflate' : 'br');
          if (!compressionStreamSupported(streamFormat)) throw new Error(format === 'brotli' ? 'Brotli compression is not supported by this browser.' : 'Streaming compression is not supported by this browser.');
          setCompressionProgress(20, 'Compressing…');
          outBlob = await streamCompress(f, streamFormat);
          outName = chooseCompressedName(f, format);
          setCompressionProgress(95, 'Finalizing…');
        }

        downloadBlob(outBlob, outName);
        setCompressionProgress(100, `Done • ${formatFileSize(outBlob.size)} output`);
      } catch (err) {
        alert('Compression error: ' + (err.message || err));
        setCompressionProgress(0, 'Compression failed');
      } finally {
        compressBtn.disabled = false;
      }
    });

    decompressDropzone.addEventListener('click', () => decompressInput.click());
    decompressInput.addEventListener('change', e => {
      if (e.target.files[0]) loadDecompressFile(e.target.files[0]);
    });
    setupDragDrop(decompressDropzone, files => { if (files[0]) loadDecompressFile(files[0]); });

    function loadDecompressFile(file) {
      decompressFile = file;
      decompressDropzone.style.display = 'none';
      decompressControls.style.display = 'flex';
      decompressName.textContent = file.name;
      decompressMeta.textContent = formatFileSize(file.size);
      decompressList.innerHTML = '';
      decompressSaveAll.style.display = 'none';
      decompressedItems = [];
    }

    decompressReset.addEventListener('click', () => {
      decompressFile = null;
      decompressedItems = [];
      decompressDropzone.style.display = 'flex';
      decompressControls.style.display = 'none';
      decompressList.innerHTML = '';
      decompressInput.value = '';
    });

    function addExtractedItem(name, blob) {
      decompressedItems.push({name, blob});
      const row = document.createElement('div');
      row.className = 'item-row';
      const url = URL.createObjectURL(blob);
      row.innerHTML = `<div><div class="item-row-title">${escapeXml(name)}</div><div class="item-row-meta">${formatFileSize(blob.size)}</div></div><div class="item-row-actions"><a class="btn-download-single" href="${url}" download="${name}">Save</a></div>`;
      decompressList.appendChild(row);
    }

    async function extractNativeArchive(file, format) {
      const base = 'http://127.0.0.1:8765';
      const health = await fetch(base + '/api/health', {cache:'no-store'});
      if (!health.ok) throw new Error('Local Engine is not running. Start the current Omni Local Engine to extract ' + format.toUpperCase() + ' archives.');
      const h = await health.json();
      if (!h.token || Number(h.engine_api_version || 0) < 4) throw new Error('Current Omni Local Engine is required for ' + format.toUpperCase() + ' extraction.');
      const upload = await fetch(base + '/api/upload', {
        method:'POST',
        headers:{Origin:location.origin,'X-Omni-Token':h.token,'Content-Type':file.type||'application/octet-stream','X-Filename':encodeURIComponent(file.name)},
        body:file
      });
      if (!upload.ok) throw new Error('Local upload failed: HTTP ' + upload.status);
      const uj = await upload.json();
      const process = await fetch(base + '/api/process', {
        method:'POST',
        headers:{Origin:location.origin,'X-Omni-Token':h.token,'Content-Type':'application/json'},
        body:JSON.stringify({op:'archive_extract',input:uj.file_id,format})
      });
      const pj = await process.json();
      if (!process.ok || !pj.ok) throw new Error(pj.error || 'Native archive extraction failed');
      const download = await fetch(base + '/api/download/' + encodeURIComponent(pj.file_id), {headers:{Origin:location.origin,'X-Omni-Token':h.token}});
      if (!download.ok) throw new Error('Extracted archive download failed');
      return await download.blob();
    }

    decompressBtn.addEventListener('click', async () => {
      if (!decompressFile) return;
      decompressBtn.disabled = true;
      decompressList.innerHTML = '';
      decompressedItems = [];
      try {
        const lower = decompressFile.name.toLowerCase();
        if (lower.endsWith('.zip')) {
          if (!window.JSZip) throw new Error('ZIP engine is unavailable.');
          const zip = await JSZip.loadAsync(decompressFile);
          const entries = Object.values(zip.files).filter(e => !e.dir);
          for (let i=0; i<entries.length; i++) {
            const entry = entries[i];
            const blob = await entry.async('blob');
            addExtractedItem(entry.name, blob);
          }
        } else if (lower.endsWith('.7z') || lower.endsWith('.rar')) {
          const nativeFormat = lower.endsWith('.7z') ? '7z' : 'rar';
          const archiveBlob = await extractNativeArchive(decompressFile, nativeFormat);
          if (!window.JSZip) throw new Error('ZIP engine is unavailable for displaying extracted native archive contents.');
          const zip = await JSZip.loadAsync(archiveBlob);
          const entries = Object.values(zip.files).filter(e => !e.dir);
          for (const entry of entries) addExtractedItem(entry.name, await entry.async('blob'));
        } else {
          let format = null;
          if (lower.endsWith('.gz') || lower.endsWith('.gzip')) format = 'gzip';
          else if (lower.endsWith('.deflate')) format = 'deflate';
          else if (lower.endsWith('.br')) format = 'br';
          else throw new Error('Unknown compression type. Use .zip, .7z, .rar, .gz, .deflate or .br.');
          if (!compressionStreamSupported(format, true)) throw new Error('This browser does not support decompression for ' + format + '.');
          const blob = await streamDecompress(decompressFile, format);
          const outputName = decompressFile.name.replace(/\.(gz|gzip|deflate|br)$/i, '') || 'decompressed.bin';
          addExtractedItem(outputName, blob);
        }
        decompressMeta.textContent = `${decompressedItems.length} extracted item(s)`;
        decompressSaveAll.style.display = decompressedItems.length > 1 ? 'inline-flex' : 'none';
      } catch (err) {
        alert('Decompression error: ' + (err.message || err));
      } finally {
        decompressBtn.disabled = false;
      }
    });

    decompressSaveAll.addEventListener('click', async () => {
      if (!decompressedItems.length || !window.JSZip) return;
      const zip = new JSZip();
      decompressedItems.forEach(item => zip.file(item.name, item.blob));
      const blob = await zip.generateAsync({type:'blob', compression:'DEFLATE', compressionOptions:{level:6}});
      downloadBlob(blob, 'extracted_files.zip');
    });

    // ==========================================
    // 1. PDF TO IMAGES & MERGE
    // ==========================================
    const pdf2imgDropzone = document.getElementById('pdf2imgDropzone');
    const pdf2imgInput = document.getElementById('pdf2imgInput');
    const pdf2imgControls = document.getElementById('pdf2imgControls');
    const pdf2imgName = document.getElementById('pdf2imgName');
    const pdf2imgMeta = document.getElementById('pdf2imgMeta');
    const pdf2imgReset = document.getElementById('pdf2imgReset');
    const pdf2imgFormat = document.getElementById('pdf2imgFormat');
    const pdf2imgDpi = document.getElementById('pdf2imgDpi');
    const pdf2imgPages = document.getElementById('pdf2imgPages');
    const pdf2imgBtn = document.getElementById('pdf2imgBtn');
    const pdf2imgResultsSection = document.getElementById('pdf2imgResultsSection');
    const pdf2imgGrid = document.getElementById('pdf2imgGrid');
    const pdf2imgDownloadAll = document.getElementById('pdf2imgDownloadAll');


    // Large-file PDF transport. PDF.js requests only the byte ranges it needs,
    // avoiding a full-file ArrayBuffer for large local PDFs.
    class FileRangeTransport extends pdfjsLib.PDFDataRangeTransport {
      constructor(file) {
        super(file.size, null, true);
        this.file = file;
      }
      requestDataRange(begin, end) {
        this.file.slice(begin, end).arrayBuffer().then(buffer => {
          this.onDataRange(begin, new Uint8Array(buffer));
        }).catch(err => {
          console.error('PDF range read failed', err);
          this.onDataRange(begin, new Uint8Array(0));
        });
      }
    }

    let currentPdfDoc = null;
    let currentPdfFile = null;
    let pdfConvertedImgs = [];

    pdf2imgDropzone.addEventListener('click', () => pdf2imgInput.click());
    setupDragDrop(pdf2imgDropzone, (files) => { if (files[0]) loadPdfForImg(files[0]); });
    pdf2imgInput.addEventListener('change', (e) => { if (e.target.files[0]) loadPdfForImg(e.target.files[0]); });

    async function loadPdfForImg(file) {
      currentPdfFile = file;
      pdf2imgDropzone.style.display = 'none';
      pdf2imgControls.style.display = 'flex';
      pdf2imgName.textContent = file.name;
      pdf2imgMeta.textContent = 'Opening large-file PDF engine…';

      try {
        const transport = new FileRangeTransport(file);
        currentPdfDoc = await pdfjsLib.getDocument({
          range: transport,
          length: file.size,
          disableAutoFetch: true,
          disableStream: true,
          rangeChunkSize: 1024 * 1024,
          useWorkerFetch: false
        }).promise;
        pdf2imgMeta.textContent = `${currentPdfDoc.numPages} pages • ${formatFileSize(file.size)} • Large-file mode`;
      } catch (e) {
        console.warn('Range PDF loader failed; using compatibility loader', e);
        try {
          const ab = await file.arrayBuffer();
          currentPdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
          pdf2imgMeta.textContent = `${currentPdfDoc.numPages} pages • ${formatFileSize(file.size)}`;
        } catch (fallbackError) {
          alert('Could not read this PDF. It may be encrypted, damaged, or unsupported.\\n\\n' + fallbackError.message);
          resetPdf2Img();
        }
      }
    }

    pdf2imgReset.addEventListener('click', resetPdf2Img);
    function resetPdf2Img() {
      currentPdfDoc = null;
      currentPdfFile = null;
      pdfConvertedImgs = [];
      pdf2imgDropzone.style.display = 'block';
      pdf2imgControls.style.display = 'none';
      pdf2imgResultsSection.style.display = 'none';
      pdf2imgGrid.innerHTML = '';
      pdf2imgInput.value = '';
    }

    pdf2imgBtn.addEventListener('click', async () => {
      if (!currentPdfDoc) return;
      pdf2imgBtn.disabled = true;
      pdfConvertedImgs = [];
      pdf2imgGrid.innerHTML = '';

      const scale = parseFloat(pdf2imgDpi.value) || 2.0;
      const fmt = pdf2imgFormat.value;
      const pages = parsePageRange(pdf2imgPages.value, currentPdfDoc.numPages);

      try {
      for (let i = 0; i < pages.length; i++) {
        const pNum = pages[i];
        const page = await currentPdfDoc.getPage(pNum);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d');

        if (fmt === 'jpg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        let mime = 'image/jpeg';
        let ext = fmt;
        if (fmt === 'png') mime = 'image/png';
        else if (fmt === 'webp') mime = 'image/webp';
        else if (fmt === 'avif') mime = 'image/avif';

        let blob = await new Promise(r => canvas.toBlob(r, mime, 0.95));
        if (!blob || blob.type !== mime) {
          blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
          ext = 'jpg';
          omniNotify('Requested image codec is unavailable; exported JPG instead.', false);
        }

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const filename = `${currentPdfFile.name.replace(/\.[^/.]+$/, "")}_page_${pNum}.${ext}`;
        pdfConvertedImgs.push({ pNum, blob, dataUrl, filename, ext });
        if (page.cleanup) page.cleanup();
        pdf2imgCount.textContent = `Converted ${i + 1} / ${pages.length} pages`;
      }

      pdf2imgResultsSection.style.display = 'block';
      pdfConvertedImgs.forEach(img => {
        const card = document.createElement('div');
        card.className = 'page-card';
        card.innerHTML = `
          <div class="page-preview-wrapper"><img src="${img.dataUrl}"></div>
          <div class="page-meta">
            <div class="page-num">Page ${img.pNum}</div>
            <a class="btn-download-single" href="${URL.createObjectURL(img.blob)}" download="${img.filename}">Save .${img.ext.toUpperCase()}</a>
          </div>
        `;
        pdf2imgGrid.appendChild(card);
      });
      } catch (err) {
        console.error('PDF to image error', err);
        alert('PDF to image failed: ' + err.message);
      } finally {
        pdf2imgBtn.disabled = false;
      }
      pdf2imgResultsSection.scrollIntoView({ behavior: 'smooth' });
    });

    pdf2imgDownloadAll.addEventListener('click', async () => {
      if (!pdfConvertedImgs.length) return;
      const totalBytes = pdfConvertedImgs.reduce((n, x) => n + (x.blob?.size || 0), 0);
      if (totalBytes > 300 * 1024 * 1024 || pdfConvertedImgs.length > 150) {
        alert('The output is ' + formatFileSize(totalBytes) + '. Individual page downloads remain available; ZIP is disabled for this large job to prevent browser memory exhaustion.');
        return;
      }
      const zip = new JSZip();
      pdfConvertedImgs.forEach(item => zip.file(item.filename, item.blob, { compression: 'STORE' }));
      const zipBlob = await zip.generateAsync({ type: 'blob', streamFiles: true });
      downloadBlob(zipBlob, `${currentPdfFile.name.replace(/\.[^/.]+$/, "")}_images.zip`);
    });

    // Large-job folder export: writes one rendered page at a time.
    // This avoids retaining the complete output set in browser RAM.
    const pdf2imgFolderExport = document.getElementById('pdf2imgFolderExport');
    if (pdf2imgFolderExport) {
      pdf2imgFolderExport.addEventListener('click', async () => {
        if (!currentPdfDoc || !currentPdfFile) return;
        if (!window.showDirectoryPicker) {
          alert('Folder export is not supported by this browser. Use a Chromium-based desktop browser, or use the individual Save buttons.');
          return;
        }

        pdf2imgFolderExport.disabled = true;
        const originalText = pdf2imgFolderExport.textContent;
        try {
          const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
          const scale = parseFloat(pdf2imgDpi.value) || 2.0;
          const fmt = pdf2imgFormat.value;
          const pages = parsePageRange(pdf2imgPages.value, currentPdfDoc.numPages);

          for (let i = 0; i < pages.length; i++) {
            const pNum = pages[i];
            pdf2imgFolderExport.textContent = `Rendering ${i + 1}/${pages.length}…`;
            const page = await currentPdfDoc.getPage(pNum);
            const vp = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width;
            canvas.height = vp.height;
            const ctx = canvas.getContext('2d', { alpha: fmt !== 'jpg' });
            if (fmt === 'jpg') {
              ctx.fillStyle = '#fff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            await page.render({ canvasContext: ctx, viewport: vp }).promise;

            let mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : fmt === 'avif' ? 'image/avif' : 'image/jpeg';
            let ext = fmt === 'png' ? 'png' : fmt === 'webp' ? 'webp' : fmt === 'avif' ? 'avif' : 'jpg';
            const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.92));
            if (!blob) throw new Error('Browser could not encode page ' + pNum);

            const safeBase = currentPdfFile.name.replace(/\.[^/.]+$/, '');
            const handle = await dir.getFileHandle(`${safeBase}_page_${String(pNum).padStart(4, "0")}.${ext}`, { create: true });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();

            canvas.width = 1;
            canvas.height = 1;
            if (page.cleanup) page.cleanup();
            await new Promise(requestAnimationFrame);
          }
          alert('Export complete. ' + pages.length + ' page(s) written to the selected folder.');
        } catch (err) {
          if (err && err.name !== 'AbortError') {
            console.error('Folder export error', err);
            alert('Folder export stopped: ' + err.message);
          }
        } finally {
          pdf2imgFolderExport.disabled = false;
          pdf2imgFolderExport.textContent = originalText;
        }
      });
    }

    // Merge PDFs
    const pdfMergeInput = document.getElementById('pdfMergeInput');
    const pdfMergeBtn = document.getElementById('pdfMergeBtn');
    pdfMergeBtn.addEventListener('click', async () => {
      const files = Array.from(pdfMergeInput.files);
      if (files.length < 2) { alert('Please select at least 2 PDF files.'); return; }
      pdfMergeBtn.disabled = true;
      try {
        const merged = await PDFLib.PDFDocument.create();
        for (const file of files) {
          const ab = await file.arrayBuffer();
          const doc = await PDFLib.PDFDocument.load(ab, { ignoreEncryption: true });
          const pages = await merged.copyPages(doc, doc.getPageIndices());
          pages.forEach(p => merged.addPage(p));
        }
        const bytes = await merged.save();
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'merged.pdf');
      } catch (e) {
        alert('Merge error: ' + e.message);
      } finally {
        pdfMergeBtn.disabled = false;
      }
    });

    // Split PDF
    const pdfSplitInput = document.getElementById('pdfSplitInput');
    const pdfSplitRange = document.getElementById('pdfSplitRange');
    const pdfSplitBtn = document.getElementById('pdfSplitBtn');
    pdfSplitBtn.addEventListener('click', async () => {
      const file = pdfSplitInput.files[0];
      if (!file) { alert('Please choose a PDF to split.'); return; }
      pdfSplitBtn.disabled = true;
      try {
        const ab = await file.arrayBuffer();
        const doc = await PDFLib.PDFDocument.load(ab, { ignoreEncryption: true });
        const total = doc.getPageCount();
        const targetPages = parsePageRange(pdfSplitRange.value, total);

        const newDoc = await PDFLib.PDFDocument.create();
        const indices = targetPages.map(p => p - 1);
        const copied = await newDoc.copyPages(doc, indices);
        copied.forEach(p => newDoc.addPage(p));

        const bytes = await newDoc.save();
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${file.name.replace(/\.[^/.]+$/, "")}_split.pdf`);
      } catch (e) {
        alert('Split error: ' + e.message);
      } finally {
        pdfSplitBtn.disabled = false;
      }
    });

    // ==========================================
    // 2. WORD & DOCS (DOCX TO PDF & TXT, TEXT TO DOCX)
    // ==========================================
    const w2pDropzone = document.getElementById('w2pDropzone');
    const w2pInput = document.getElementById('w2pInput');
    const w2pControls = document.getElementById('w2pControls');
    const w2pFileName = document.getElementById('w2pFileName');
    const w2pFileMeta = document.getElementById('w2pFileMeta');
    const w2pResetBtn = document.getElementById('w2pResetBtn');
    const w2pRunBtn = document.getElementById('w2pRunBtn');
    const w2pTxtBtn = document.getElementById('w2pTxtBtn');

    let currentW2pFile = null;
    let extractedDocxText = '';

    w2pDropzone.addEventListener('click', () => w2pInput.click());
    setupDragDrop(w2pDropzone, (files) => { if (files[0]) loadW2pFile(files[0]); });
    w2pInput.addEventListener('change', (e) => { if (e.target.files[0]) loadW2pFile(e.target.files[0]); });

    async function loadW2pFile(file) {
      currentW2pFile = file;
      w2pDropzone.style.display = 'none';
      w2pControls.style.display = 'flex';
      w2pFileName.textContent = file.name;
      w2pFileMeta.textContent = formatFileSize(file.size);

      try {
        const ab = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(ab);
        const docXml = zip.file('word/document.xml');
        if (docXml) {
          const xmlStr = await docXml.async('text');
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
          const pElements = xmlDoc.getElementsByTagName('w:p');
          const paras = [];

          for (let i = 0; i < pElements.length; i++) {
            let pText = '';
            const tElements = pElements[i].getElementsByTagName('w:t');
            for (let j = 0; j < tElements.length; j++) pText += tElements[j].textContent;
            const clean = sanitizeForWinAnsi(pText.trim());
            if (clean) paras.push(clean);
          }
          extractedDocxText = paras.join('\n\n');
        }
      } catch (e) {
        console.error(e);
      }
    }

    w2pResetBtn.addEventListener('click', () => {
      currentW2pFile = null; extractedDocxText = '';
      w2pDropzone.style.display = 'block'; w2pControls.style.display = 'none';
      w2pInput.value = '';
    });

    w2pTxtBtn.addEventListener('click', () => {
      if (!extractedDocxText) return;
      downloadBlob(new Blob([extractedDocxText], { type: 'text/plain;charset=utf-8' }), `${currentW2pFile.name.replace(/\.docx$/i, "")}.txt`);
    });

    w2pRunBtn.addEventListener('click', async () => {
      if (!extractedDocxText) { alert('No readable text found in DOCX.'); return; }
      w2pRunBtn.disabled = true;

      try {
        const pdfDoc = await PDFLib.PDFDocument.create();
        const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);

        const pageW = 612; const pageH = 792; const margin = 45;
        let page = pdfDoc.addPage([pageW, pageH]);
        let y = pageH - margin;

        const paragraphs = extractedDocxText.split('\n\n');

        for (const p of paragraphs) {
          const isH = p.length < 55 && !p.endsWith('.');
          const curFont = isH ? fontBold : font;
          const sz = isH ? 14 : 10.5;
          const lh = sz + 5;

          const words = p.split(' ');
          let line = '';

          for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (curFont.widthOfTextAtSize(test, sz) > (pageW - margin * 2)) {
              if (y < margin + lh) { page = pdfDoc.addPage([pageW, pageH]); y = pageH - margin; }
              page.drawText(line, { x: margin, y, size: sz, font: curFont });
              y -= lh;
              line = w;
            } else {
              line = test;
            }
          }
          if (line) {
            if (y < margin + lh) { page = pdfDoc.addPage([pageW, pageH]); y = pageH - margin; }
            page.drawText(line, { x: margin, y, size: sz, font: curFont });
            y -= (lh + 6);
          }
        }

        const bytes = await pdfDoc.save();
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${currentW2pFile.name.replace(/\.[^/.]+$/, "")}.pdf`);
      } catch (e) {
        alert('Conversion error: ' + e.message);
      } finally {
        w2pRunBtn.disabled = false;
      }
    });

    // PDF to DOCX
    const p2wDropzone = document.getElementById('p2wDropzone');
    const p2wInput = document.getElementById('p2wInput');
    const p2wControls = document.getElementById('p2wControls');
    const p2wFileName = document.getElementById('p2wFileName');
    const p2wFileMeta = document.getElementById('p2wFileMeta');
    const p2wResetBtn = document.getElementById('p2wResetBtn');
    const p2wMode = document.getElementById('p2wMode');
    const p2wRunBtn = document.getElementById('p2wRunBtn');

    let currentP2wPdf = null;
    let currentP2wFile = null;

    p2wDropzone.addEventListener('click', () => p2wInput.click());
    setupDragDrop(p2wDropzone, (files) => { if (files[0]) loadP2wPdf(files[0]); });
    p2wInput.addEventListener('change', (e) => { if (e.target.files[0]) loadP2wPdf(e.target.files[0]); });

    async function loadP2wPdf(file) {
      currentP2wFile = file;
      p2wDropzone.style.display = 'none';
      p2wControls.style.display = 'flex';
      p2wFileName.textContent = file.name;
      p2wFileMeta.textContent = 'Reading PDF…';

      try {
        // PDF.js expects binary PDF data as a typed byte array. Using Uint8Array
        // here also keeps this path consistent with the other PDF loaders.
        const ab = await file.arrayBuffer();
        const bytes = new Uint8Array(ab);
        currentP2wPdf = await pdfjsLib.getDocument({
          data: bytes,
          useWorkerFetch: false,
          isEvalSupported: true
        }).promise;
        p2wFileMeta.textContent = `${currentP2wPdf.numPages} pages • ${formatFileSize(file.size)}`;
      } catch (e) {
        console.error('PDF to Word: PDF.js could not open file', e);

        // Retry once with a fresh byte buffer. This helps with browsers that
        // detach/reuse the first ArrayBuffer during PDF.js initialization.
        try {
          const retryBytes = new Uint8Array(await file.arrayBuffer());
          currentP2wPdf = await pdfjsLib.getDocument({ data: retryBytes }).promise;
          p2wFileMeta.textContent = `${currentP2wPdf.numPages} pages • ${formatFileSize(file.size)}`;
        } catch (retryError) {
          console.error('PDF to Word retry failed', retryError);
          const reason = retryError?.message || e?.message || 'Unknown PDF.js error';
          alert('Could not read this PDF. It may be encrypted, damaged, or unsupported.\\n\\n' + reason);
          resetP2w();
        }
      }
    }
    p2wResetBtn.addEventListener('click', resetP2w);
    function resetP2w() {
      currentP2wPdf = null; currentP2wFile = null;
      p2wDropzone.style.display = 'block'; p2wControls.style.display = 'none';
      p2wInput.value = '';
    }

    p2wRunBtn.addEventListener('click', async () => {
      if (!currentP2wPdf) return;
      p2wRunBtn.disabled = true;
      const mode = p2wMode.value;
      const zip = new JSZip();

      try {
        let bodyXml = '';
        let relsXml = '';

        for (let i = 1; i <= currentP2wPdf.numPages; i++) {
          const page = await currentP2wPdf.getPage(i);
          if (mode === 'visual' || mode === 'hybrid') {
            const vp = page.getViewport({ scale: 2.0 });
            const cvs = document.createElement('canvas');
            cvs.width = vp.width; cvs.height = vp.height;
            const ctx = cvs.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cvs.width, cvs.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;

            const blob = await new Promise(r => cvs.toBlob(r, 'image/jpeg', 0.95));
            zip.file(`word/media/img${i}.jpg`, blob);
            relsXml += `  <Relationship Id="rIdImg${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img${i}.jpg"/>\n`;

            const cx = 5800000;
            const cy = Math.round(cx / (vp.width / vp.height));

            bodyXml += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${i}" name="Page ${i}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${i}" name="Img ${i}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${i}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
          }

          if (mode === 'hybrid' || mode === 'reflow') {
            const textContent = await page.getTextContent();
            textContent.items.forEach(it => {
              if (it.str.trim()) {
                bodyXml += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(it.str)}</w:t></w:r></w:p>`;
              }
            });
          }
          if (i < currentP2wPdf.numPages) bodyXml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        }

        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
        zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsXml}</Relationships>`);
        zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`);

        const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        downloadBlob(blob, `${currentP2wFile.name.replace(/\.[^/.]+$/, "")}.docx`);
      } catch (err) {
        alert('DOCX error: ' + err.message);
      } finally {
        p2wRunBtn.disabled = false;
      }
    });

    // Text to DOCX / PDF
    const t2dTitle = document.getElementById('t2dTitle');
    const t2dStyle = document.getElementById('t2dStyle');
    const t2dText = document.getElementById('t2dText');
    const t2dDocxBtn = document.getElementById('t2dDocxBtn');
    const t2dPdfBtn = document.getElementById('t2dPdfBtn');

    t2dDocxBtn.addEventListener('click', async () => {
      const title = t2dTitle.value || 'Document';
      const text = t2dText.value;
      const detectH = t2dStyle.value === 'headings';
      const zip = new JSZip();

      const lines = text.replace(/\r/g, '').split('\n');
      let body = '';
      for (const line of lines) {
        if (!line.trim()) { body += '<w:p/>'; continue; }
        let t = escapeXml(line);
        let pPr = '';
        if (detectH && /^#{1,6}\s+/.test(line)) {
          const m = line.match(/^(#{1,6})\s+(.*)$/);
          t = escapeXml(m[2]);
          pPr = `<w:pPr><w:pStyle w:val="Heading${m[1].length}"/></w:pPr>`;
        }
        body += `<w:p>${pPr}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
      }

      zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
      zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
      zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`);

      const b = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      downloadBlob(b, `${title.replace(/[^\w\-]+/g, '_')}.docx`);
    });

    t2dPdfBtn.addEventListener('click', async () => {
      const title = t2dTitle.value || 'Document';
      const text = t2dText.value;
      const pdfDoc = await PDFLib.PDFDocument.create();
      const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);

      const pageW = 612; const pageH = 792; const margin = 45;
      let page = pdfDoc.addPage([pageW, pageH]);
      let y = pageH - margin;

      const lines = text.replace(/\r/g, '').split('\n');

      for (const line of lines) {
        if (!line.trim()) { y -= 12; continue; }
        const isH = /^#{1,3}\s+/.test(line);
        const clean = sanitizeForWinAnsi(isH ? line.replace(/^#{1,3}\s+/, '') : line);
        const curFont = isH ? fontBold : font;
        const sz = isH ? 14 : 10.5;
        const lh = sz + 5;

        if (y < margin + lh) { page = pdfDoc.addPage([pageW, pageH]); y = pageH - margin; }
        page.drawText(clean, { x: margin, y, size: sz, font: curFont });
        y -= (lh + (isH ? 6 : 2));
      }

      const bytes = await pdfDoc.save();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${title.replace(/[^\w\-]+/g, '_')}.pdf`);
    });

    // ==========================================
    // 3. EPUB STUDIO (WITH WINANSI FIX & PAGE RENDERING)
    // ==========================================
    const epubDropzone = document.getElementById('epubDropzone');
    const epubInput = document.getElementById('epubInput');
    const epubControls = document.getElementById('epubControls');
    const epubFileName = document.getElementById('epubFileName');
    const epubFileMeta = document.getElementById('epubFileMeta');
    const epubResetBtn = document.getElementById('epubResetBtn');
    const epubTargetAction = document.getElementById('epubTargetAction');
    const epubRunBtn = document.getElementById('epubRunBtn');
    const epubProgressWrapper = document.getElementById('epubProgressWrapper');
    const epubProgressBar = document.getElementById('epubProgressBar');
    const epubProgressText = document.getElementById('epubProgressText');
    const epubProgressPercent = document.getElementById('epubProgressPercent');

    let currentEpubZip = null;
    let currentEpubFile = null;

    epubDropzone.addEventListener('click', () => epubInput.click());
    setupDragDrop(epubDropzone, (files) => { if (files[0]) loadEpub(files[0]); });
    epubInput.addEventListener('change', (e) => { if (e.target.files[0]) loadEpub(e.target.files[0]); });

    async function loadEpub(file) {
      currentEpubFile = file;
      epubDropzone.style.display = 'none';
      epubControls.style.display = 'flex';
      epubFileName.textContent = file.name;
      epubFileMeta.textContent = formatFileSize(file.size);

      try {
        const ab = await file.arrayBuffer();
        currentEpubZip = await JSZip.loadAsync(ab);
      } catch (e) {
        alert('Could not read EPUB archive.');
        resetEpubModule();
      }
    }

    epubResetBtn.addEventListener('click', resetEpubModule);
    function resetEpubModule() {
      currentEpubFile = null; currentEpubZip = null;
      epubDropzone.style.display = 'block'; epubControls.style.display = 'none';
      epubProgressWrapper.style.display = 'none'; epubInput.value = '';
    }

    epubRunBtn.addEventListener('click', async () => {
      if (!currentEpubZip) return;
      const action = epubTargetAction.value;
      epubRunBtn.disabled = true;
      epubProgressWrapper.style.display = 'block';

      try {
        if (action === 'pdf' || action === 'txt') {
          epubProgressText.textContent = 'Parsing EPUB text content...';
          epubProgressBar.style.width = '30%';

          const htmlFiles = Object.keys(currentEpubZip.files).filter(f => /\.(xhtml|html|htm)$/i.test(f));
          const paragraphs = [];

          for (const f of htmlFiles) {
            const htmlStr = await currentEpubZip.file(f).async('text');
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlStr, 'text/html');
            doc.querySelectorAll('script, style, nav').forEach(el => el.remove());
            const nodes = doc.querySelectorAll('h1, h2, h3, h4, p');

            nodes.forEach(n => {
              const raw = n.textContent.trim();
              if (raw) {
                const clean = sanitizeForWinAnsi(raw);
                if (clean) paragraphs.push({ text: clean, isHeader: /^H[1-4]$/i.test(n.tagName) });
              }
            });
          }

          if (action === 'txt') {
            const fullTxt = paragraphs.map(p => p.text).join('\n\n');
            downloadBlob(new Blob([fullTxt], { type: 'text/plain;charset=utf-8' }), `${currentEpubFile.name.replace(/\.[^/.]+$/, "")}.txt`);
          } else {
            epubProgressBar.style.width = '70%';
            epubProgressText.textContent = 'Generating PDF...';

            const pdfDoc = await PDFLib.PDFDocument.create();
            const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
            const fontBold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);

            const pageW = 612; const pageH = 792; const margin = 45;
            let page = pdfDoc.addPage([pageW, pageH]);
            let y = pageH - margin;

            for (const item of paragraphs) {
              const curFont = item.isHeader ? fontBold : font;
              const sz = item.isHeader ? 14 : 10.5;
              const lh = sz + 5;

              const words = item.text.split(' ');
              let line = '';

              for (const word of words) {
                const test = line ? line + ' ' + word : word;
                const textW = curFont.widthOfTextAtSize(test, sz);

                if (textW > (pageW - margin * 2)) {
                  if (y < margin + lh) { page = pdfDoc.addPage([pageW, pageH]); y = pageH - margin; }
                  page.drawText(line, { x: margin, y, size: sz, font: curFont });
                  y -= lh;
                  line = word;
                } else {
                  line = test;
                }
              }

              if (line) {
                if (y < margin + lh) { page = pdfDoc.addPage([pageW, pageH]); y = pageH - margin; }
                page.drawText(line, { x: margin, y, size: sz, font: curFont });
                y -= (lh + 6);
              }
            }

            epubProgressBar.style.width = '100%';
            const bytes = await pdfDoc.save();
            downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${currentEpubFile.name.replace(/\.[^/.]+$/, "")}.pdf`);
          }

        } else if (action === 'jpg_pages') {
          // Render readable book pages with text + headings to JPGs
          epubProgressText.textContent = 'Rendering readable book pages to JPG...';
          epubProgressBar.style.width = '30%';

          const htmlFiles = Object.keys(currentEpubZip.files).filter(f => /\.(xhtml|html|htm)$/i.test(f));
          const zipOut = new JSZip();
          let pageIndex = 1;

          for (let fIdx = 0; fIdx < htmlFiles.length; fIdx++) {
            const f = htmlFiles[fIdx];
            const htmlStr = await currentEpubZip.file(f).async('text');
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlStr, 'text/html');
            doc.querySelectorAll('script, style, nav').forEach(el => el.remove());
            const nodes = doc.querySelectorAll('h1, h2, h3, p');

            const canvas = document.createElement('canvas');
            canvas.width = 1000;
            canvas.height = 1400;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#0f172a';

            let curY = 80;
            const leftMargin = 70;
            const maxWidth = canvas.width - (leftMargin * 2);

            ctx.font = '600 18px sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText(`Chapter ${fIdx + 1} • Page ${pageIndex}`, leftMargin, 45);
            ctx.fillStyle = '#0f172a';

            let hasContent = false;

            nodes.forEach(node => {
              const text = node.textContent.trim();
              if (!text) return;
              hasContent = true;

              const isHeading = /^H[1-3]$/i.test(node.tagName);
              const fontSize = isHeading ? 28 : 20;
              const lineHeight = fontSize + 12;
              ctx.font = isHeading ? `700 ${fontSize}px sans-serif` : `400 ${fontSize}px Georgia, serif`;

              const words = text.split(' ');
              let line = '';

              for (const w of words) {
                const test = line ? line + ' ' + w : w;
                if (ctx.measureText(test).width > maxWidth) {
                  if (curY < canvas.height - 80) {
                    ctx.fillText(line, leftMargin, curY);
                    curY += lineHeight;
                  }
                  line = w;
                } else {
                  line = test;
                }
              }
              if (line && curY < canvas.height - 80) {
                ctx.fillText(line, leftMargin, curY);
                curY += (lineHeight + (isHeading ? 14 : 8));
              }
            });

            if (hasContent) {
              const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
              zipOut.file(`page_${String(pageIndex).padStart(3, '0')}.jpg`, blob);
              pageIndex++;
            }
          }

          epubProgressBar.style.width = '100%';
          const zipBlob = await zipOut.generateAsync({ type: 'blob' });
          downloadBlob(zipBlob, `${currentEpubFile.name.replace(/\.[^/.]+$/, "")}_rendered_pages.zip`);

        } else {
          // Extract embedded illustrations / photos
          epubProgressText.textContent = 'Extracting images...';
          const imgZip = new JSZip();
          let count = 0;
          const files = Object.keys(currentEpubZip.files);
          for (const f of files) {
            if (/\.(jpg|jpeg|png|webp|gif)$/i.test(f)) {
              const blob = await currentEpubZip.file(f).async('blob');
              imgZip.file(f.split('/').pop(), blob);
              count++;
            }
          }
          if (count === 0) alert('No images found in EPUB.');
          else {
            const outZip = await imgZip.generateAsync({ type: 'blob' });
            downloadBlob(outZip, `${currentEpubFile.name.replace(/\.[^/.]+$/, "")}_images.zip`);
          }
        }

      } catch (err) {
        alert('EPUB error: ' + err.message);
      } finally {
        epubRunBtn.disabled = false;
        epubProgressWrapper.style.display = 'none';
      }
    });

    // PDF to EPUB
    const p2eDropzone = document.getElementById('p2eDropzone');
    const p2eInput = document.getElementById('p2eInput');
    const p2eControls = document.getElementById('p2eControls');
    const p2eFileName = document.getElementById('p2eFileName');
    const p2eFileMeta = document.getElementById('p2eFileMeta');
    const p2eResetBtn = document.getElementById('p2eResetBtn');
    const p2eMode = document.getElementById('p2eMode');
    const p2eTitle = document.getElementById('p2eTitle');
    const p2eAuthor = document.getElementById('p2eAuthor');
    const p2eRunBtn = document.getElementById('p2eRunBtn');

    let currentP2ePdf = null;
    let currentP2eFile = null;

    p2eDropzone.addEventListener('click', () => p2eInput.click());
    setupDragDrop(p2eDropzone, (files) => { if (files[0]) loadP2ePdf(files[0]); });
    p2eInput.addEventListener('change', (e) => { if (e.target.files[0]) loadP2ePdf(e.target.files[0]); });

    async function loadP2ePdf(file) {
      currentP2eFile = file;
      p2eDropzone.style.display = 'none';
      p2eControls.style.display = 'flex';
      p2eFileName.textContent = file.name;
      p2eTitle.value = file.name.replace(/\.[^/.]+$/, "");

      try {
        const ab = await file.arrayBuffer();
        currentP2ePdf = await pdfjsLib.getDocument({ data: ab }).promise;
        p2eFileMeta.textContent = `${currentP2ePdf.numPages} pages`;
      } catch (e) {
        alert('Could not read PDF.');
        resetP2e();
      }
    }

    p2eResetBtn.addEventListener('click', resetP2e);
    function resetP2e() {
      currentP2ePdf = null; currentP2eFile = null;
      p2eDropzone.style.display = 'block'; p2eControls.style.display = 'none';
      p2eInput.value = '';
    }

    p2eRunBtn.addEventListener('click', async () => {
      if (!currentP2ePdf) return;
      p2eRunBtn.disabled = true;
      p2eRunBtn.textContent = 'Generating EPUB 3...';

      const mode = p2eMode.value;
      const title = escapeXml(p2eTitle.value || 'eBook');
      const author = escapeXml(p2eAuthor.value || 'Author');
      const uuid = 'urn:uuid:' + Math.random().toString(36).substring(2) + Date.now();
      const zip = new JSZip();

      try {
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
        zip.file('OEBPS/stylesheet.css', `body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",serif;line-height:1.6;margin:0;padding:1.5rem;color:#1e293b;background:#fff}.page-container{max-width:800px;margin:0 auto;page-break-after:always}.page-image{max-width:100%;height:auto;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.1);border:1px solid #e2e8f0;margin-bottom:1.5rem}h1,h2{color:#0f172a;margin-top:1.25rem;margin-bottom:0.5rem}p{margin-bottom:0.75rem;font-size:1rem}`);

        let manifest = '';
        let spine = '';
        let navPoints = '';
        let navList = '';

        for (let i = 1; i <= currentP2ePdf.numPages; i++) {
          const page = await currentP2ePdf.getPage(i);
          const vp = page.getViewport({ scale: 2.0 });
          const cvs = document.createElement('canvas');
          cvs.width = vp.width; cvs.height = vp.height;
          const ctx = cvs.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cvs.width, cvs.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;

          const imgBlob = await new Promise(r => cvs.toBlob(r, 'image/jpeg', 0.95));
          zip.file(`OEBPS/images/page_${i}.jpg`, imgBlob);
          manifest += `    <item id="img_${i}" href="images/page_${i}.jpg" media-type="image/jpeg"/>\n`;

          const textContent = await page.getTextContent();
          let pageText = '';
          textContent.items.forEach(it => { if (it.str.trim()) pageText += `<p>${escapeXml(it.str)}</p>\n`; });

          const chapterHtml = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Page ${i}</title><link rel="stylesheet" type="text/css" href="stylesheet.css"/></head><body><div class="page-container"><img src="images/page_${i}.jpg" class="page-image" alt="Page ${i}"/>${pageText}</div>



</body></html>`;

          zip.file(`OEBPS/page_${i}.xhtml`, chapterHtml);
          manifest += `    <item id="p_${i}" href="page_${i}.xhtml" media-type="application/xhtml+xml"/>\n`;
          spine += `    <itemref idref="p_${i}"/>\n`;
          navPoints += `    <navPoint id="np_${i}" playOrder="${i}"><navLabel><text>Page ${i}</text></navLabel><content src="page_${i}.xhtml"/></navPoint>\n`;
          navList += `      <li><a href="page_${i}.xhtml">Page ${i}</a></li>\n`;
        }

        zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Table of Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Table of Contents</h1><ol>${navList}</ol></nav></body></html>`);
        manifest += `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n`;

        zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uuid}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${title}</text></docTitle><navMap>${navPoints}</navMap></ncx>`);

        zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:identifier id="BookID">${uuid}</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="stylesheet.css" media-type="text/css"/>${manifest}</manifest><spine toc="ncx">${spine}</spine></package>`);

        const epubBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
        downloadBlob(epubBlob, `${currentP2eFile.name.replace(/\.[^/.]+$/, "")}.epub`);

      } catch (err) {
        alert('EPUB generation error: ' + err.message);
      } finally {
        p2eRunBtn.disabled = false;
        p2eRunBtn.textContent = 'Create & Download EPUB';
      }
    });

    // ==========================================
    // 4. IMAGE TOOLS (CONVERT & TO PDF)
    // ==========================================
    const imgDropzone = document.getElementById('imgDropzone');
    const imgInput = document.getElementById('imgInput');
    const imgControls = document.getElementById('imgControls');
    const imgSummary = document.getElementById('imgSummary');
    const imgResetBtn = document.getElementById('imgResetBtn');
    const imgTargetFmt = document.getElementById('imgTargetFmt');
    const imgQualitySelect = document.getElementById('imgQualitySelect');
    const imgRunBtn = document.getElementById('imgRunBtn');
    const imgResultsSection = document.getElementById('imgResultsSection');
    const imgGrid = document.getElementById('imgGrid');
    const imgDownloadAll = document.getElementById('imgDownloadAll');

    var imgFiles = window.imgFiles || [];
    let convertedImageResults = [];

    imgDropzone.addEventListener('click', () => imgInput.click());
    setupDragDrop(imgDropzone, (files) => handleImgs(Array.from(files)));
    imgInput.addEventListener('change', (e) => handleImgs(Array.from(e.target.files)));

    function handleImgs(files) {
      imgFiles = files.filter(f => f.type.startsWith('image/'));
      if (!imgFiles.length) return;
      imgDropzone.style.display = 'none';
      imgControls.style.display = 'flex';
      imgSummary.textContent = `${imgFiles.length} image(s) selected`;
    }

    imgResetBtn.addEventListener('click', () => {
      imgFiles = []; convertedImageResults = [];
      imgDropzone.style.display = 'block'; imgControls.style.display = 'none';
      imgResultsSection.style.display = 'none'; imgInput.value = '';
    });

    imgRunBtn.addEventListener('click', async () => {
      if (!imgFiles.length) return;
      imgRunBtn.disabled = true;
      convertedImageResults = [];
      imgGrid.innerHTML = '';

      const target = imgTargetFmt.value;
      const q = parseFloat(imgQualitySelect.value) || 0.95;

      for (const f of imgFiles) {
        const bmp = await createImageBitmap(f);
        const cvs = document.createElement('canvas');
        cvs.width = bmp.width; cvs.height = bmp.height;
        const ctx = cvs.getContext('2d');
        if (target === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cvs.width, cvs.height); }
        ctx.drawImage(bmp, 0, 0);

        let mime = 'image/png';
        let ext = target;
        if (target === 'jpg') mime = 'image/jpeg';
        else if (target === 'webp') mime = 'image/webp';
        else if (target === 'heic') mime = 'image/heic';

        let blob = await new Promise(r => cvs.toBlob(r, mime, q));
        if (!blob || blob.type !== mime) {
          blob = await new Promise(r => cvs.toBlob(r, 'image/jpeg', q));
          ext = 'jpg';
        }
        const fname = `${f.name.replace(/\.[^/.]+$/, "")}_converted.${ext}`;
        convertedImageResults.push({ filename: fname, blob, dataUrl: cvs.toDataURL('image/jpeg', 0.8), ext });
      }

      imgResultsSection.style.display = 'block';
      convertedImageResults.forEach(item => {
        const card = document.createElement('div');
        card.className = 'page-card';
        card.innerHTML = `<div class="page-preview-wrapper"><img src="${item.dataUrl}"></div><div class="page-meta"><div class="page-num" style="font-size:0.8rem;">${item.filename}</div><a class="btn-download-single" href="${URL.createObjectURL(item.blob)}" download="${item.filename}">Save</a></div>`;
        imgGrid.appendChild(card);
      });
      imgRunBtn.disabled = false;
      imgResultsSection.scrollIntoView({ behavior: 'smooth' });
    });

    imgDownloadAll.addEventListener('click', async () => {
      const zip = new JSZip();
      convertedImageResults.forEach(item => zip.file(item.filename, item.blob));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, 'converted_images.zip');
    });

    // Images to PDF
    const i2pDropzone = document.getElementById('i2pDropzone');
    const i2pInput = document.getElementById('i2pInput');
    const i2pControls = document.getElementById('i2pControls');
    const i2pSummary = document.getElementById('i2pSummary');
    const i2pReset = document.getElementById('i2pReset');
    const i2pBtn = document.getElementById('i2pBtn');
    var i2pImgs = window.i2pImgs || [];

    i2pDropzone.addEventListener('click', () => i2pInput.click());
    setupDragDrop(i2pDropzone, (files) => {
      i2pImgs = Array.from(files).filter(f => f.type.startsWith('image/'));
      if (i2pImgs.length) {
        i2pDropzone.style.display = 'none'; i2pControls.style.display = 'flex';
        i2pSummary.textContent = `${i2pImgs.length} images selected`;
      }
    });
    i2pInput.addEventListener('change', (e) => {
      i2pImgs = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      if (i2pImgs.length) {
        i2pDropzone.style.display = 'none'; i2pControls.style.display = 'flex';
        i2pSummary.textContent = `${i2pImgs.length} images selected`;
      }
    });
    i2pReset.addEventListener('click', () => {
      i2pImgs = []; i2pDropzone.style.display = 'block'; i2pControls.style.display = 'none';
      i2pInput.value = '';
    });

    i2pBtn.addEventListener('click', async () => {
      if (!i2pImgs.length) return;
      i2pBtn.disabled = true;
      try {
        const doc = await PDFLib.PDFDocument.create();
        for (const f of i2pImgs) {
          const ab = await f.arrayBuffer();
          let emb;
          if (f.type === 'image/png' || f.name.toLowerCase().endsWith('.png')) {
            emb = await doc.embedPng(ab);
          } else {
            emb = await doc.embedJpg(ab);
          }
          const p = doc.addPage([emb.width, emb.height]);
          p.drawImage(emb, { x: 0, y: 0, width: emb.width, height: emb.height });
        }
        const b = await doc.save();
        downloadBlob(new Blob([b], { type: 'application/pdf' }), 'images_combined.pdf');
      } catch (err) {
        alert('Images to PDF error: ' + err.message);
      } finally {
        i2pBtn.disabled = false;
      }
    });

    // ==========================================
    // 5. OCR: IMAGE TO TEXT (Tesseract.js)
    // ==========================================
    const ocrDropzone = document.getElementById('ocrDropzone');
    const ocrInput = document.getElementById('ocrInput');
    const ocrControls = document.getElementById('ocrControls');
    const ocrFileName = document.getElementById('ocrFileName');
    const ocrFileMeta = document.getElementById('ocrFileMeta');
    const ocrResetBtn = document.getElementById('ocrResetBtn');
    const ocrRunBtn = document.getElementById('ocrRunBtn');
    const ocrProgressWrapper = document.getElementById('ocrProgressWrapper');
    const ocrProgressBar = document.getElementById('ocrProgressBar');
    const ocrProgressText = document.getElementById('ocrProgressText');
    const ocrProgressPercent = document.getElementById('ocrProgressPercent');
    const ocrOutputContainer = document.getElementById('ocrOutputContainer');
    const ocrOutputText = document.getElementById('ocrOutputText');
    const ocrCopyBtn = document.getElementById('ocrCopyBtn');
    const ocrDownloadTxtBtn = document.getElementById('ocrDownloadTxtBtn');
    const ocrTranslatePanel = document.getElementById('ocrTranslatePanel');
    const ocrTranslateSource = document.getElementById('ocrTranslateSource');
    const ocrTranslateTarget = document.getElementById('ocrTranslateTarget');
    const ocrTranslateBtn = document.getElementById('ocrTranslateBtn');
    const ocrTranslateStatus = document.getElementById('ocrTranslateStatus');
    const ocrTranslateOutput = document.getElementById('ocrTranslateOutput');
    const ocrTranslateActions = document.getElementById('ocrTranslateActions');
    const ocrTranslateCopyBtn = document.getElementById('ocrTranslateCopyBtn');
    const ocrTranslateDownloadBtn = document.getElementById('ocrTranslateDownloadBtn');

    let currentOcrFile = null;

    ocrDropzone.addEventListener('click', () => ocrInput.click());
    setupDragDrop(ocrDropzone, (files) => { if (files[0]) loadOcrFile(files[0]); });
    ocrInput.addEventListener('change', (e) => { if (e.target.files[0]) loadOcrFile(e.target.files[0]); });

    function loadOcrFile(file) {
      currentOcrFile = file;
      ocrDropzone.style.display = 'none';
      ocrControls.style.display = 'flex';
      ocrFileName.textContent = file.name;
      ocrFileMeta.textContent = formatFileSize(file.size);
      ocrOutputContainer.style.display = 'none';
      if (ocrTranslatePanel) ocrTranslatePanel.style.display = 'none';
      if (ocrTranslateOutput) { ocrTranslateOutput.value = ''; ocrTranslateOutput.style.display = 'none'; }
      if (ocrTranslateActions) ocrTranslateActions.style.display = 'none';
      if (ocrTranslateStatus) ocrTranslateStatus.textContent = 'Run OCR first, then convert the extracted text language in the browser.';
    }

    ocrResetBtn.addEventListener('click', () => {
      currentOcrFile = null;
      ocrDropzone.style.display = 'block';
      ocrControls.style.display = 'none';
      ocrProgressWrapper.style.display = 'none';
      ocrOutputContainer.style.display = 'none';
      if (ocrTranslatePanel) ocrTranslatePanel.style.display = 'none';
      if (ocrTranslateOutput) { ocrTranslateOutput.value = ''; ocrTranslateOutput.style.display = 'none'; }
      if (ocrTranslateActions) ocrTranslateActions.style.display = 'none';
      ocrInput.value = '';
    });

    ocrRunBtn.addEventListener('click', async () => {
      if (!currentOcrFile) return;
      ocrRunBtn.disabled = true;
      ocrProgressWrapper.style.display = 'block';

      try {
        const worker = await Tesseract.createWorker(document.getElementById('ocrLanguage')?.value || 'eng', 1, Object.assign({}, window.OMNI_TESSERACT_OPTIONS || {}, {
          logger: m => {
            if (m.status) ocrProgressText.textContent = m.status;
            if (typeof m.progress === 'number') {
              const pct = Math.round(m.progress * 100);
              ocrProgressBar.style.width = pct + '%';
              ocrProgressPercent.textContent = pct + '%';
            }
          }
        }));
        const ret = await worker.recognize(currentOcrFile);
        await worker.terminate();

        ocrProgressWrapper.style.display = 'none';
        ocrOutputContainer.style.display = 'block';
        ocrOutputText.value = ret.data.text || 'No text recognized.';
        if (ocrTranslatePanel && ocrOutputText.value.trim() && ocrOutputText.value !== 'No text recognized.') {
          ocrTranslatePanel.style.display = 'block';
          const ocrCode = document.getElementById('ocrLanguage')?.value || 'eng';
          const sourceMap = {eng:'en',hin:'hi',deu:'de',fra:'fr',spa:'es',ita:'it',por:'pt',nld:'nl',tur:'tr',rus:'ru',ara:'ar',urd:'ur',jpn:'ja',kor:'ko',chi_sim:'zh',chi_tra:'zh',vie:'vi',ben:'bn',mar:'mr',nep:'ne',tam:'ta',tel:'te',mal:'ml',kan:'kn',guj:'gu',pan:'pa',ori:'or',sin:'si'};
          if (sourceMap[ocrCode]) ocrTranslateSource.value = sourceMap[ocrCode];
          if (ocrTranslateStatus) ocrTranslateStatus.textContent = window.Translator ? 'Browser Translator detected. Choose a target language and convert.' : 'This browser does not expose the built-in Translator API. OCR remains fully browser-based; language conversion is unavailable here.';
        }
      } catch (err) {
        alert('OCR error: ' + err.message);
        ocrProgressWrapper.style.display = 'none';
      } finally {
        ocrRunBtn.disabled = false;
      }
    });

    ocrCopyBtn.addEventListener('click', async () => {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(ocrOutputText.value);
      } else {
        ocrOutputText.focus();
        ocrOutputText.select();
        document.execCommand('copy');
      }
      ocrCopyBtn.textContent = '✅ Copied!';
      setTimeout(() => ocrCopyBtn.textContent = '📋 Copy Text', 2000);
    });

    function splitWebTranslationText(text, maxLen=450) {
      const normalized = String(text || '').replace(/\\r\\n/g, '\\n').trim();
      if (!normalized) return [];
      const parts = normalized.split(/(?<=[.!?।॥！？])\\s+|\\n+/).map(x => x.trim()).filter(Boolean);
      const chunks = [];
      let current = '';
      for (const part of parts) {
        if (part.length > maxLen) {
          if (current) { chunks.push(current); current = ''; }
          for (let i = 0; i < part.length; i += maxLen) chunks.push(part.slice(i, i + maxLen));
        } else if (!current) {
          current = part;
        } else if ((current.length + 1 + part.length) <= maxLen) {
          current += ' ' + part;
        } else {
          chunks.push(current);
          current = part;
        }
      }
      if (current) chunks.push(current);
      return chunks;
    }

    async function translateOcrViaWebFallback(text, source, target) {
      const chunks = splitWebTranslationText(text);
      if (!chunks.length) return '';
      const translated = [];
      for (let i = 0; i < chunks.length; i++) {
        if (ocrTranslateStatus) ocrTranslateStatus.textContent =
          'Using web fallback… translating part ' + (i + 1) + ' of ' + chunks.length + '…';
        const url = 'https://api.mymemory.translated.net/get?q=' +
          encodeURIComponent(chunks[i]) + '&langpair=' + encodeURIComponent(source + '|' + target);
        const response = await fetch(url, {method:'GET', mode:'cors', cache:'no-store'});
        if (!response.ok) throw new Error('Web translation service returned HTTP ' + response.status + '.');
        const data = await response.json();
        const result = data?.responseData?.translatedText ||
          data?.matches?.find(m => m?.translation)?.translation || '';
        if (!result || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(result)) {
          throw new Error(data?.responseDetails || 'The web translation service returned no usable translation.');
        }
        translated.push(result);
      }
      return translated.join('\\n');
    }

    async function translateOcrText() {
      if (!ocrOutputText?.value?.trim()) return;
      if (!window.Translator || typeof window.Translator.create !== 'function') {
        if (ocrTranslateStatus) ocrTranslateStatus.textContent = 'Browser language conversion is not available in this browser. Try a current Chromium-based browser with the built-in Translator API enabled.';
        return;
      }
      const source = ocrTranslateSource?.value || 'en';
      const target = ocrTranslateTarget?.value || 'hi';
      if (source === target) {
        if (ocrTranslateStatus) ocrTranslateStatus.textContent = 'Choose a different target language.';
        return;
      }
      ocrTranslateBtn.disabled = true;
      ocrTranslateOutput.style.display = 'none';
      ocrTranslateActions.style.display = 'none';
      if (ocrTranslateStatus) ocrTranslateStatus.textContent = 'Checking browser translation support…';
      let translator = null;
      try {
        if (typeof window.Translator.availability === 'function') {
          const availability = await window.Translator.availability({sourceLanguage: source, targetLanguage: target});
          if (availability === 'unavailable') {
            const useWebFallback = window.confirm(
              'This browser does not provide a local Translator model for ' +
              source.toUpperCase() + ' → ' + target.toUpperCase() +
              '.\\n\\nUse the optional web translation fallback? Your extracted OCR text will be sent to the translation service.\\n\\nChoose Cancel to keep the text entirely local.'
            );
            if (useWebFallback) {
              const translated = await translateOcrViaWebFallback(ocrOutputText.value.trim(), source, target);
              ocrTranslateOutput.value = translated || 'No translation returned.';
              ocrTranslateOutput.style.display = 'block';
              ocrTranslateActions.style.display = 'flex';
              if (ocrTranslateStatus) ocrTranslateStatus.textContent =
                'Translated using the optional web fallback. The OCR text left this browser for translation.';
            }
            return;
          }
          if (ocrTranslateStatus) ocrTranslateStatus.textContent =
            availability === 'available' ? 'Translation model ready in browser.' : 'Browser is preparing the local translation model…';
        }
        translator = await window.Translator.create({
          sourceLanguage: source,
          targetLanguage: target,
          monitor(monitor) {
            if (!ocrTranslateStatus || !monitor?.addEventListener) return;
            monitor.addEventListener('downloadprogress', e => {
              const pct = Math.round((e.loaded || 0) * 100);
              ocrTranslateStatus.textContent = 'Downloading browser translation model… ' + pct + '%';
            });
          }
        });
        const text = ocrOutputText.value.trim();
        let translated = '';
        if (typeof translator.translateStreaming === 'function' && text.length > 4000) {
          const stream = translator.translateStreaming(text);
          for await (const chunk of stream) translated += chunk;
        } else {
          translated = await translator.translate(text);
        }
        ocrTranslateOutput.value = translated || 'No translation returned.';
        ocrTranslateOutput.style.display = 'block';
        ocrTranslateActions.style.display = 'flex';
        if (ocrTranslateStatus) ocrTranslateStatus.textContent = 'Translated locally by the browser. The OCR text was not sent to a translation server.';
      } catch (err) {
        if (ocrTranslateStatus) ocrTranslateStatus.textContent = 'Browser translation unavailable for this language pair: ' + (err?.message || err);
      } finally {
        try { if (translator?.destroy) translator.destroy(); } catch (e) {}
        ocrTranslateBtn.disabled = false;
      }
    }

    ocrTranslateBtn?.addEventListener('click', translateOcrText);
    ocrTranslateCopyBtn?.addEventListener('click', async () => {
      if (!ocrTranslateOutput?.value) return;
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(ocrTranslateOutput.value);
      else { ocrTranslateOutput.focus(); ocrTranslateOutput.select(); document.execCommand('copy'); }
      ocrTranslateCopyBtn.textContent = '✅ Copied!';
      setTimeout(() => ocrTranslateCopyBtn.textContent = '📋 Copy Translation', 2000);
    });
    ocrTranslateDownloadBtn?.addEventListener('click', () => {
      if (!ocrTranslateOutput?.value || !currentOcrFile) return;
      const target = ocrTranslateTarget?.value || 'translated';
      const blob = new Blob([ocrTranslateOutput.value], {type:'text/plain;charset=utf-8'});
      downloadBlob(blob, `${currentOcrFile.name.replace(/\.[^/.]+$/, "")}_${target}_translated.txt`);
    });

    ocrDownloadTxtBtn.addEventListener('click', () => {
      const blob = new Blob([ocrOutputText.value], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, `${currentOcrFile.name.replace(/\.[^/.]+$/, "")}_extracted.txt`);
    });

    // ==========================================
    // 6. AUDIO STUDIO (CONVERT, CUT, SPEED & WAV ENCODER)
    // ==========================================
    const audioDropzone = document.getElementById('audioDropzone');
    const audioInput = document.getElementById('audioInput');
    const audioControls = document.getElementById('audioControls');
    const audioFileName = document.getElementById('audioFileName');
    const audioFileMeta = document.getElementById('audioFileMeta');
    const audioResetBtn = document.getElementById('audioResetBtn');
    const audioPlayer = document.getElementById('audioPlayer');
    const audioStartSec = document.getElementById('audioStartSec');
    const audioEndSec = document.getElementById('audioEndSec');
    const audioSpeedSelect = document.getElementById('audioSpeedSelect');
    const audioProcessBtn = document.getElementById('audioProcessBtn');

    let currentAudioFile = null;
    let audioBuffer = null;

    audioDropzone.addEventListener('click', () => audioInput.click());
    setupDragDrop(audioDropzone, (files) => { if (files[0]) loadAudioFile(files[0]); });
    audioInput.addEventListener('change', (e) => { if (e.target.files[0]) loadAudioFile(e.target.files[0]); });

    async function loadAudioFile(file) {
      currentAudioFile = file;
      audioDropzone.style.display = 'none';
      audioControls.style.display = 'flex';
      audioFileName.textContent = file.name;
      audioPlayer.pause();
      audioPlayer.removeAttribute('src');
      audioPlayer.load();

      // Always attempt native browser playback first. Do not hide the player just
      // because Web Audio decoding fails: browsers can play formats that
      // AudioContext.decodeAudioData cannot decode reliably.
      const originalUrl = URL.createObjectURL(file);
      audioPlayer.src = originalUrl;
      audioPlayer.playbackRate = parseFloat(audioSpeedSelect.value) || 1;
      audioPlayer.load();

      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const ab = await file.arrayBuffer();
        audioBuffer = await ctx.decodeAudioData(ab.slice(0));
        if (ctx.close) ctx.close();
        const dur = audioBuffer.duration;
        audioFileMeta.textContent = `Duration: ${formatTime(dur)} • ${audioBuffer.sampleRate} Hz • Browser decoded`;
        audioStartSec.value = 0;
        audioEndSec.value = dur.toFixed(1);
        audioEndSec.max = dur.toFixed(1);
      } catch (decodeErr) {
        audioBuffer = null;
        audioFileMeta.textContent = 'Browser preview attempted • full processing may require Local Engine';
        audioPlayer.addEventListener('error', async function onAudioError() {
          audioPlayer.removeEventListener('error', onAudioError);
          try {
            audioFileMeta.textContent = 'Browser codec unavailable • creating WAV preview with Local Engine…';
            const up = await upload(file);
            const result = await process({op:'media', input:up.file_id, format:'wav'});
            const blob = await download(result.file_id);
            const wav = new Blob([blob], {type:'audio/wav'});
            audioPlayer.src = URL.createObjectURL(wav);
            audioPlayer.load();
            const ctx2 = new (window.AudioContext || window.webkitAudioContext)();
            audioBuffer = await ctx2.decodeAudioData(await wav.arrayBuffer());
            if (ctx2.close) ctx2.close();
            const dur = audioBuffer.duration;
            audioFileMeta.textContent = `Duration: ${formatTime(dur)} • ${audioBuffer.sampleRate} Hz • Local Engine WAV preview`;
            audioStartSec.value = 0;
            audioEndSec.value = dur.toFixed(1);
            audioEndSec.max = dur.toFixed(1);
          } catch (fallbackErr) {
            audioFileMeta.textContent = 'Cannot preview this format in this browser. Use Local Audio Format Bridge below.';
            console.warn('Omni audio preview fallback failed', decodeErr, fallbackErr);
          }
        }, {once:true});
        // Give the media element a chance to report its own native playback support.
        audioPlayer.load();
      }
    }

    audioResetBtn.addEventListener('click', () => {
      currentAudioFile = null; audioBuffer = null;
      audioDropzone.style.display = 'block'; audioControls.style.display = 'none';
      audioPlayer.src = ''; audioInput.value = '';
    });

    audioSpeedSelect.addEventListener('change', () => {
      audioPlayer.playbackRate = parseFloat(audioSpeedSelect.value);
    });

    audioProcessBtn.addEventListener('click', async () => {
      if (!audioBuffer) return;
      audioProcessBtn.disabled = true;
      audioProcessBtn.textContent = 'Processing Audio...';

      try {
        const start = Math.max(0, parseFloat(audioStartSec.value) || 0);
        const end = Math.min(audioBuffer.duration, parseFloat(audioEndSec.value) || audioBuffer.duration);
        const speed = parseFloat(audioSpeedSelect.value) || 1.0;
        if (!(end > start)) throw new Error('End time must be greater than start time.');
        if (!(speed > 0)) throw new Error('Playback speed must be greater than zero.');

        const sampleRate = audioBuffer.sampleRate;
        const startSample = Math.floor(start * sampleRate);
        const endSample = Math.floor(end * sampleRate);
        const sliceLength = endSample - startSample;

        const targetLength = Math.floor(sliceLength / speed);
        const offlineCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, targetLength, sampleRate);

        const src = offlineCtx.createBufferSource();
        src.buffer = audioBuffer;
        src.playbackRate.value = speed;
        src.connect(offlineCtx.destination);
        src.start(0, start, end - start);

        const renderedBuffer = await offlineCtx.startRendering();
        const wavBlob = audioBufferToWav(renderedBuffer);

        const base = currentAudioFile.name.replace(/\.[^/.]+$/, "");
        downloadBlob(wavBlob, `${base}_tuned.wav`);

      } catch (err) {
        alert('Audio error: ' + err.message);
      } finally {
        audioProcessBtn.disabled = false;
        audioProcessBtn.textContent = 'Process & Download WAV Audio';
      }
    });

    // Pure 16-bit PCM WAV Encoder
    function audioBufferToWav(abuffer) {
      const numOfChan = abuffer.numberOfChannels;
      const length = abuffer.length * numOfChan * 2 + 44;
      const out = new DataView(new ArrayBuffer(length));
      const channels = [];
      let pos = 0;

      function setUint16(data) { out.setUint16(pos, data, true); pos += 2; }
      function setUint32(data) { out.setUint32(pos, data, true); pos += 4; }

      setUint32(0x46464952); // "RIFF"
      setUint32(length - 8);
      setUint32(0x45564157); // "WAVE"
      setUint32(0x20746d66); // "fmt "
      setUint32(16);
      setUint16(1);          // PCM
      setUint16(numOfChan);
      setUint32(abuffer.sampleRate);
      setUint32(abuffer.sampleRate * 2 * numOfChan);
      setUint16(numOfChan * 2);
      setUint16(16);         // 16-bit
      setUint32(0x61746164); // "data"
      setUint32(length - pos - 4);

      for (let i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));

      let offset = 0;
      while (offset < abuffer.length) {
        for (let i = 0; i < numOfChan; i++) {
          let sample = Math.max(-1, Math.min(1, channels[i][offset]));
          sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
          out.setInt16(pos, sample, true);
          pos += 2;
        }
        offset++;
      }
      return new Blob([out], { type: 'audio/wav' });
    }

    // ==========================================
    // 7. VIDEO STUDIO (CUT, SPEED, EXTRACT AUDIO)
    // ==========================================
    const videoDropzone = document.getElementById('videoDropzone');
    const videoInput = document.getElementById('videoInput');
    const videoControls = document.getElementById('videoControls');
    const videoFileName = document.getElementById('videoFileName');
    const videoFileMeta = document.getElementById('videoFileMeta');
    const videoResetBtn = document.getElementById('videoResetBtn');
    const videoPlayer = document.getElementById('videoPlayer');
    const videoStartSec = document.getElementById('videoStartSec');
    const videoEndSec = document.getElementById('videoEndSec');
    const videoSpeedSelect = document.getElementById('videoSpeedSelect');
    const videoActionSelect = document.getElementById('videoActionSelect');
    const videoProcessBtn = document.getElementById('videoProcessBtn');
    const videoProgressWrapper = document.getElementById('videoProgressWrapper');
    const videoProgressBar = document.getElementById('videoProgressBar');
    const videoProgressText = document.getElementById('videoProgressText');

    let currentVideoFile = null;

    videoDropzone.addEventListener('click', () => videoInput.click());
    setupDragDrop(videoDropzone, (files) => { if (files[0]) loadVideoFile(files[0]); });
    videoInput.addEventListener('change', (e) => { if (e.target.files[0]) loadVideoFile(e.target.files[0]); });

    async function loadVideoFile(file) {
      currentVideoFile = file;
      videoDropzone.style.display = 'none';
      videoControls.style.display = 'flex';
      videoFileName.textContent = file.name;
      videoPlayer.pause();
      videoPlayer.removeAttribute('src');
      videoPlayer.load();

      const originalUrl = URL.createObjectURL(file);
      videoPlayer.src = originalUrl;
      videoPlayer.load();

      const handleVideoError = async () => {
        videoPlayer.removeEventListener('error', handleVideoError);
        try {
          videoFileMeta.textContent = 'Browser codec unavailable • creating MP4 preview with Local Engine…';
          const up = await upload(file);
          const result = await process({op:'media', input:up.file_id, format:'mp4'});
          const blob = await download(result.file_id);
          const mp4 = new Blob([blob], {type:'video/mp4'});
          videoPlayer.src = URL.createObjectURL(mp4);
          videoPlayer.load();
          videoFileMeta.textContent = 'Local Engine MP4 preview ready';
        } catch (fallbackErr) {
          videoFileMeta.textContent = 'Cannot preview this codec in this browser. Use Local Video / Animation Format Bridge below.';
          console.warn('Omni video preview fallback failed', fallbackErr);
        }
      };
      videoPlayer.addEventListener('error', handleVideoError, {once:true});

      videoPlayer.onloadedmetadata = () => {
        const dur = videoPlayer.duration;
        videoFileMeta.textContent = `Duration: ${formatTime(dur)} • ${videoPlayer.videoWidth}x${videoPlayer.videoHeight}`;
        videoStartSec.value = 0;
        videoEndSec.value = Math.min(dur, 10).toFixed(1);
        videoEndSec.max = dur.toFixed(1);
      };
    }

    videoResetBtn.addEventListener('click', () => {
      currentVideoFile = null;
      videoDropzone.style.display = 'block'; videoControls.style.display = 'none';
      videoPlayer.src = ''; videoInput.value = '';
    });

    videoSpeedSelect.addEventListener('change', () => {
      videoPlayer.playbackRate = parseFloat(videoSpeedSelect.value);
    });

    videoProcessBtn.addEventListener('click', async () => {
      if (!currentVideoFile) return;
      const action = videoActionSelect.value;
      const base = currentVideoFile.name.replace(/\.[^/.]+$/, "");

      if (action === 'snapshot') {
        const canvas = document.createElement('canvas');
        canvas.width = videoPlayer.videoWidth || 1280;
        canvas.height = videoPlayer.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoPlayer, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
        if (!blob) throw new Error('Could not capture the current video frame.');
        downloadBlob(blob, `${base}_snapshot.jpg`);

      } else if (action === 'extract_audio') {
        videoProcessBtn.disabled = true;
        videoProcessBtn.textContent = 'Extracting audio...';
        try {
          const ab = await currentVideoFile.arrayBuffer();
          const actx = new (window.AudioContext || window.webkitAudioContext)();
          const decoded = await actx.decodeAudioData(ab);
          const wavBlob = audioBufferToWav(decoded);
          downloadBlob(wavBlob, `${base}_audio.wav`);
        } catch (e) {
          alert('Could not extract audio track: ' + e.message);
        } finally {
          videoProcessBtn.disabled = false;
          videoProcessBtn.textContent = 'Process Video';
        }

      } else {
        videoProcessBtn.disabled = true;
        videoProgressWrapper.style.display = 'block';
        videoProgressText.textContent = 'Recording trimmed segment...';

        const start = Math.max(0, parseFloat(videoStartSec.value) || 0);
        const end = Math.min(videoPlayer.duration, parseFloat(videoEndSec.value) || videoPlayer.duration);
        if (!(end > start)) {
          alert('End time must be greater than start time.');
          videoProgressWrapper.style.display = 'none';
          videoProcessBtn.disabled = false;
          return;
        }
        const stream = videoPlayer.captureStream ? videoPlayer.captureStream() : (videoPlayer.mozCaptureStream ? videoPlayer.mozCaptureStream() : null);
        if (!stream) {
          alert('This browser cannot capture the video stream for trimming.');
          videoProgressWrapper.style.display = 'none';
          videoProcessBtn.disabled = false;
          return;
        }

        const candidates = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm'
        ];
        let mime = candidates.find(x => window.MediaRecorder && MediaRecorder.isTypeSupported(x));
        if (!mime) {
          alert('This browser cannot record a compatible video format. Try Chrome/Edge/Firefox on desktop or use a supported local video engine.');
          stream.getTracks().forEach(t => t.stop());
          videoProgressWrapper.style.display = 'none';
          videoProcessBtn.disabled = false;
          return;
        }
        const recorder = new MediaRecorder(stream, { mimeType: mime });
        const chunks = [];

        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onerror = e => {
          console.error('MediaRecorder error', e);
          try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
        };
        recorder.onstop = () => {
          videoProgressWrapper.style.display = 'none';
          videoProcessBtn.disabled = false;
          stream.getTracks().forEach(t => t.stop());
          const outBlob = new Blob(chunks, { type: mime });
          const ext = mime.includes('mp4') ? 'mp4' : 'webm';
          downloadBlob(outBlob, `${base}_cut.${ext}`);
        };

        videoPlayer.currentTime = start;
        videoPlayer.onseeked = () => {
          videoPlayer.onseeked = null;
          recorder.start();
          videoPlayer.play();

          const checkInterval = setInterval(() => {
            const progress = Math.max(0, Math.min(100, ((videoPlayer.currentTime - start) / Math.max(0.001, end - start)) * 100));
            videoProgressBar.style.width = progress + '%';
            videoProgressText.textContent = 'Recording trimmed segment… ' + Math.round(progress) + '%';
            if (videoPlayer.currentTime >= end || videoPlayer.paused) {
              clearInterval(checkInterval);
              videoPlayer.pause();
              recorder.stop();
            }
          }, 100);
        };
      }
    });
    window.__OMNI_CORE_READY = true;
  