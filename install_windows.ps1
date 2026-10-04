$ErrorActionPreference = "Stop"

function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Ensure-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host "[SETUP] Re-launching installer with Administrator privileges..."
        $args = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
        Start-Process powershell.exe -Verb RunAs -ArgumentList $args -Wait
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        exit 0
    }
}

Ensure-Admin
Set-Location $PSScriptRoot

Write-Host "=== OmniConverter COMPLETE Windows Local Setup ==="
Write-Host "[INFO] This installs the full Python + native + offline browser stack."

if (-not (Has "winget")) {
    if (-not (Has "choco")) {
        Write-Host "[SETUP] winget is unavailable; bootstrapping Chocolatey..."
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
        $env:Path = "$env:ALLUSERSPROFILE\chocolatey\bin;$env:Path"
    }
}

$wingetPackages = @(
    "Python.Python.3.13",
    "Gyan.FFmpeg.Shared",
    "QPDF.QPDF",
    "oschwartz10612.Poppler",
    "ImageMagick.ImageMagick",
    "ArtifexSoftware.GhostScript",
    "UB-Mannheim.TesseractOCR",
    "TheDocumentFoundation.LibreOffice",
    "calibre.calibre",
    "Pandoc.Pandoc",
    "7zip.7zip",
    "stedolan.jq",
    "MikeFarah.yq"
)

$chocoPackages = @(
    "python",
    "ffmpeg",
    "qpdf",
    "poppler",
    "imagemagick",
    "ghostscript",
    "tesseract",
    "libreoffice",
    "calibre",
    "pandoc",
    "7zip",
    "jq",
    "yq"
)

if (Has "winget") {
    foreach ($id in $wingetPackages) {
        Write-Host "[NATIVE] Checking/installing $id ..."
        & winget install --id $id --exact --silent --accept-source-agreements --accept-package-agreements --disable-interactivity
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "winget could not install/check $id (exit $LASTEXITCODE). The final verifier will identify missing dependencies."
        }
    }
} elseif (Has "choco") {
    Write-Host "[NATIVE] Installing through Chocolatey..."
    choco install $chocoPackages -y --no-progress
}

$machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
$user = [Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machine;$user;$env:Path"

$pythonCandidates = @(
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:ProgramFiles\Python313\python.exe",
    "$env:ProgramFiles\Python312\python.exe"
)
$python = $null
if (Has "py") { $python = (Get-Command py).Source }
elseif (Has "python") { $python = (Get-Command python).Source }
else {
    foreach ($candidate in $pythonCandidates) {
        if (Test-Path $candidate) { $python = $candidate; break }
    }
}
if (-not $python) { throw "Python 3.11+ was not found after installation." }

Write-Host "[PYTHON] $python"
$venv = Join-Path $PSScriptRoot ".venv"
$venvPython = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $venvPython)) { & $python -m venv $venv }
if (-not (Test-Path $venvPython)) { throw "Failed to create .venv." }

& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip bootstrap failed." }

Write-Host "[PYTHON] Installing COMPLETE Local Engine Python profile..."
& $venvPython -m pip install -r "$PSScriptRoot\requirements-local.txt"
if ($LASTEXITCODE -ne 0) { throw "requirements-local.txt installation failed." }

Write-Host "[OFFLINE] Downloading pinned browser/OCR assets..."
& $venvPython "$PSScriptRoot\prepare_offline.py"
if ($LASTEXITCODE -ne 0) { throw "Offline browser asset preparation failed." }

Write-Host "[VERIFY] Running strict local environment verification..."
& $venvPython "$PSScriptRoot\verify_local_environment.py"
if ($LASTEXITCODE -ne 0) { throw "Local dependency verification failed. Fix the items reported above before using the Local Engine." }

New-Item -ItemType File -Force -Path "$PSScriptRoot\.omni_setup_complete" | Out-Null
Write-Host ""
Write-Host "=========================================="
Write-Host " COMPLETE LOCAL SETUP: READY"
Write-Host "=========================================="
Write-Host "Run start_omni.bat or Omni.bat to launch."
