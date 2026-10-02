(function(){
  const local = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname);
  window.OMNI_LOCAL_MODE = local;
  window.OMNI_PDF_WORKER = local ? './vendor/pdfjs/pdf.worker.min.js' : 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  window.OMNI_TESSERACT_OPTIONS = local ? {
    workerPath: './vendor/tesseract/worker.min.js',
    langPath: './vendor/tesseract/lang/',
    corePath: './vendor/tesseract/core/',
    workerBlobURL: false
  } : {};
  const scripts = local ? [
    './vendor/pdfjs/pdf.min.js',
    './vendor/jszip/jszip.min.js',
    './vendor/pdf-lib/pdf-lib.min.js',
    './vendor/tesseract/tesseract.min.js'
  ] : [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
  ];
  for (const src of scripts) document.write('<script src="' + src + '"><\\/script>');
})();