$ErrorActionPreference = "Stop"
function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
Write-Host "=== OmniConverter native engine installer ==="
if (Has "winget") {
  winget install --id Gyan.FFmpeg.Shared --exact --accept-source-agreements --accept-package-agreements
  winget install --id QPDF.QPDF --exact --accept-source-agreements --accept-package-agreements
  winget install --id ImageMagick.ImageMagick --exact --accept-source-agreements --accept-package-agreements
  winget install --id UB-Mannheim.TesseractOCR --exact --accept-source-agreements --accept-package-agreements
  winget install --id TheDocumentFoundation.LibreOffice --exact --accept-source-agreements --accept-package-agreements
  winget install --id KovidGoyal.Calibre --exact --accept-source-agreements --accept-package-agreements
  winget install --id Python.Python.3.13 --exact --accept-source-agreements --accept-package-agreements
} elseif (Has "choco") {
  choco install ffmpeg qpdf imagemagick tesseract python -y
} else {
  Write-Host "Install winget or Chocolatey, then rerun this script."
  exit 1
}
Write-Host "Downloading browser assets for offline mode..."\npython prepare_offline.py\nWrite-Host "Restart your terminal, then run start_omni.bat."
