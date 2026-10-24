$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this setup from a normal, non-Administrator PowerShell session. The installer does not elevate or install machine-wide software."
}

Write-Host "=== OmniConverter Local Setup (current user) ==="
Write-Host "[INFO] Native utilities must be installed and reviewed by the user. No remote installer is bootstrapped."

$python = $null
$pythonArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($minor in @("3.13", "3.12", "3.11")) {
        & py -$minor -c "import sys; raise SystemExit(0 if sys.version_info[:2] in [(3,13),(3,12),(3,11)] else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) { $python = (Get-Command py).Source; $pythonArgs = @("-$minor"); break }
    }
}
if (-not $python) {
    foreach ($name in @("python3.13", "python3.12", "python3.11", "python")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            $version = & $command.Source -c "import sys; print('.'.join(map(str,sys.version_info[:3])))" 2>$null
            if ($version -match '^3\.(11|12|13)\.') { $python = $command.Source; break }
        }
    }
}
if (-not $python) { throw "Python 3.11, 3.12 or 3.13 is required. Install it for the current user and rerun this setup." }

$venv = Join-Path $PSScriptRoot ".venv"
$venvPython = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $venvPython)) { & $python @pythonArgs -m venv $venv }
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $venvPython)) { throw "Failed to create the current-user virtual environment." }
& $venvPython -m pip install -r (Join-Path $PSScriptRoot "requirements-local.txt")
if ($LASTEXITCODE -ne 0) { throw "requirements-local.txt installation failed." }
& $venvPython (Join-Path $PSScriptRoot "prepare_offline.py")
if ($LASTEXITCODE -ne 0) { throw "Offline browser asset preparation failed." }
& $venvPython (Join-Path $PSScriptRoot "verify_local_environment.py")
if ($LASTEXITCODE -ne 0) { throw "Local environment verification failed." }
New-Item -ItemType File -Path (Join-Path $PSScriptRoot ".omni_setup_complete") -Force | Out-Null
Write-Host "[OK] Current-user OmniConverter Python setup is ready. Install missing native tools separately."
