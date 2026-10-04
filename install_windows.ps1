$ErrorActionPreference = "Stop"

function Has($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "=== OmniConverter native engine installer ==="
Write-Host ""

if (Has "winget") {
    $packages = @(
        "Gyan.FFmpeg.Shared",
        "QPDF.QPDF",
        "ImageMagick.ImageMagick",
        "UB-Mannheim.TesseractOCR",
        "TheDocumentFoundation.LibreOffice",
        "calibre.calibre",
        "Python.Python.3.13"
    )

    foreach ($id in $packages) {
        Write-Host "[SETUP] Installing/checking $id ..."
        try {
            winget install --id $id --exact --accept-source-agreements --accept-package-agreements --silent
        } catch {
            Write-Warning "Could not install $id automatically. The Local Engine will still start; that feature may remain unavailable."
        }
    }
} elseif (Has "choco") {
    Write-Host "[SETUP] Using Chocolatey..."
    choco install ffmpeg qpdf imagemagick tesseract python -y
} else {
    Write-Host "[ERROR] Neither winget nor Chocolatey was found."
    Write-Host "Install Python 3.11+ and a supported package manager, then rerun this script."
    exit 1
}

Write-Host ""
Write-Host "[SETUP] Locating Python..."

$python = $null
if (Has "py") {
    $python = "py"
} elseif (Has "python") {
    $python = "python"
}

if (-not $python) {
    $candidates = @(
        "$env:LOCALAPPDATAProgramsPythonPython313python.exe",
        "$env:LOCALAPPDATAProgramsPythonPython312python.exe",
        "$env:ProgramFilesPython313python.exe",
        "$env:ProgramFilesPython312python.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            $python = $candidate
            break
        }
    }
}

if (-not $python) {
    Write-Host "[ERROR] Python was not found after installation."
    Write-Host "Restart Windows or open a new terminal, then run setup_and_start.bat again."
    exit 1
}

Write-Host "[OK] Python: $python"
Write-Host "[SETUP] Installing OmniConverter Data Studio Python packages..."
& $python -m pip install -r "$PSScriptRoot\requirements-data.txt"
if ($LASTEXITCODE -ne 0) { Write-Warning "Data Studio packages could not be installed; native media/document features will still work." }
Write-Host "[SETUP] Downloading pinned browser assets for offline mode..."
& $python prepare_offline.py

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] prepare_offline.py failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "[OK] Setup complete."
Write-Host "Run start_omni.bat to launch the Local Engine."
