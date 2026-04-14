#Requires -RunAsAdministrator
<#
.SYNOPSIS
    YB Manager - Hyper-V Agent Installer
    Run this script once on each Hyper-V host as Administrator.

.DESCRIPTION
    Installs Python 3, pip packages, creates the yb-hyperv-agent Windows Service,
    opens the firewall port, and prints the generated API key for you to enter
    in the management web UI.

    Place this script in the same folder as:
      - agent.py
      - hyperv-agent.conf
      - wheels\       (offline pip wheels, see README)
      - python-3.11.x-amd64.exe  (Python installer, if not already installed)
      - nssm.exe      (https://nssm.cc/download)
#>

param (
    [string]$InstallDir    = "C:\yb-hyperv-agent",
    [string]$ServiceName   = "YbHypervAgent",
    [int]$AgentPort        = 8765,
    [string]$ManagementIP  = "",
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step([string]$msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Write-OK([string]$msg) {
    Write-Host "    [OK] $msg" -ForegroundColor Green
}

function Write-Warn([string]$msg) {
    Write-Host "    [WARN] $msg" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Uninstall mode
# ---------------------------------------------------------------------------

if ($Uninstall) {
    Write-Step "Uninstalling $ServiceName"
    $nssm = Join-Path $InstallDir "nssm.exe"
    if (Test-Path $nssm) {
        & $nssm stop $ServiceName 2>$null
        & $nssm remove $ServiceName confirm 2>$null
    }
    Remove-NetFirewallRule -DisplayName "YB Hyper-V Agent" -ErrorAction SilentlyContinue
    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir
    }
    Write-OK "Uninstalled"
    exit 0
}

# ---------------------------------------------------------------------------
# Prerequisites check
# ---------------------------------------------------------------------------

Write-Step "Checking prerequisites"

$osVersion = [System.Environment]::OSVersion.Version
if ($osVersion.Major -lt 10) {
    Write-Error "Requires Windows Server 2016 / Windows 10 or later"
}

$hvFeature = Get-WindowsOptionalFeature -FeatureName Microsoft-Hyper-V -Online -ErrorAction SilentlyContinue
if ($null -eq $hvFeature -or $hvFeature.State -ne "Enabled") {
    Write-Warn "Hyper-V feature not detected. Make sure Hyper-V is enabled."
} else {
    Write-OK "Hyper-V is enabled"
}

# ---------------------------------------------------------------------------
# Create install directory
# ---------------------------------------------------------------------------

Write-Step "Creating install directory: $InstallDir"
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}
New-Item -ItemType Directory -Path "$InstallDir\isos" -Force | Out-Null
New-Item -ItemType Directory -Path "$InstallDir\logs" -Force | Out-Null
Write-OK "Directory created"

# ---------------------------------------------------------------------------
# Python
# ---------------------------------------------------------------------------

Write-Step "Checking Python installation"
$pythonExe = $null

$candidates = @(
    "python.exe",
    "C:\Python311\python.exe",
    "C:\Python310\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe"
)

foreach ($candidate in $candidates) {
    try {
        $ver = & $candidate --version 2>&1
        if ($ver -match "Python 3\.(10|11|12)") {
            $pythonExe = $candidate
            Write-OK "Found Python: $ver at $candidate"
            break
        }
    } catch {}
}

if (-not $pythonExe) {
    $installerPattern = Join-Path $ScriptDir "python-3.*.exe"
    $installer = Get-Item $installerPattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($installer) {
        Write-Step "Installing Python from $($installer.FullName)"
        Start-Process -FilePath $installer.FullName `
            -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0" `
            -Wait
        $pythonExe = "C:\Program Files\Python311\python.exe"
        if (-not (Test-Path $pythonExe)) {
            $pythonExe = "C:\Python311\python.exe"
        }
        Write-OK "Python installed"
    } else {
        Write-Error "Python 3.10+ not found and no installer found in script directory. Place python-3.xx-amd64.exe next to this script."
    }
}

# ---------------------------------------------------------------------------
# Install pip packages
# ---------------------------------------------------------------------------

Write-Step "Installing Python packages"
$wheelsDir = Join-Path $ScriptDir "wheels"
if (Test-Path $wheelsDir) {
    Write-Host "    Installing from offline wheels: $wheelsDir"
    & $pythonExe -m pip install --no-index --find-links $wheelsDir fastapi "uvicorn[standard]" pywin32 2>&1 | ForEach-Object { Write-Host "    $_" }
} else {
    Write-Warn "No offline wheels folder found. Installing from internet..."
    & $pythonExe -m pip install fastapi "uvicorn[standard]" pywin32 2>&1 | ForEach-Object { Write-Host "    $_" }
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "pip install failed. If offline install, ensure wheels folder contains fastapi, uvicorn, pywin32 wheels."
}
Write-OK "Packages installed"

# ---------------------------------------------------------------------------
# Generate API key (only on first install)
# ---------------------------------------------------------------------------

$confDest = Join-Path $InstallDir "hyperv-agent.conf"
$generatedKey = $null

if (-not (Test-Path $confDest)) {
    Write-Step "Generating API key"
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $generatedKey = [System.Convert]::ToBase64String($bytes) -replace "[/+=]", ""
    $generatedKey = $generatedKey.Substring(0, [Math]::Min(40, $generatedKey.Length))

    $sourceCfg = Join-Path $ScriptDir "hyperv-agent.conf"
    if (Test-Path $sourceCfg) {
        $cfgContent = Get-Content $sourceCfg -Raw
        $cfgContent = $cfgContent -replace "CHANGE_ME_ON_FIRST_INSTALL", $generatedKey
        $cfgContent = $cfgContent -replace "log_file = .*", "log_file = $InstallDir\agent.log"
        if ($ManagementIP) {
            $cfgContent = $cfgContent -replace "allowed_ips =", "allowed_ips = $ManagementIP"
        }
        Set-Content -Path $confDest -Value $cfgContent
    } else {
        @"
[agent]
port = $AgentPort
api_key = $generatedKey
log_file = $InstallDir\agent.log
log_max_bytes = 10485760
log_backup_count = 5

[security]
allowed_ips = $ManagementIP
"@ | Set-Content -Path $confDest
    }
    Write-OK "API key generated and written to config"
} else {
    Write-Warn "Config already exists, preserving existing API key"
    $cfgContent = Get-Content $confDest -Raw
    if ($cfgContent -match "api_key\s*=\s*(.+)") {
        $generatedKey = $matches[1].Trim()
    }
}

# ---------------------------------------------------------------------------
# Copy agent script
# ---------------------------------------------------------------------------

Write-Step "Copying agent files"
$agentSrc = Join-Path $ScriptDir "agent.py"
if (-not (Test-Path $agentSrc)) {
    Write-Error "agent.py not found in script directory: $ScriptDir"
}
Copy-Item -Force $agentSrc (Join-Path $InstallDir "agent.py")
Write-OK "agent.py copied"

# ---------------------------------------------------------------------------
# Install NSSM and register Windows Service
# ---------------------------------------------------------------------------

Write-Step "Configuring Windows Service: $ServiceName"

$nssmSrc = Join-Path $ScriptDir "nssm.exe"
$nssmDest = Join-Path $InstallDir "nssm.exe"

if (-not (Test-Path $nssmSrc)) {
    $nssmSrc = Join-Path $ScriptDir "nssm-2.24\win64\nssm.exe"
}

if (Test-Path $nssmSrc) {
    Copy-Item -Force $nssmSrc $nssmDest
    Write-OK "NSSM copied"
} else {
    Write-Error "nssm.exe not found. Download from https://nssm.cc/download and place next to this script."
}

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Warn "Service $ServiceName already exists, stopping and reconfiguring"
    & $nssmDest stop $ServiceName 2>$null
    Start-Sleep -Seconds 2
    & $nssmDest remove $ServiceName confirm 2>$null
}

& $nssmDest install $ServiceName $pythonExe "`"$InstallDir\agent.py`""
& $nssmDest set $ServiceName AppDirectory $InstallDir
& $nssmDest set $ServiceName AppEnvironmentExtra "YB_AGENT_DIR=$InstallDir"
& $nssmDest set $ServiceName DisplayName "YB Manager Hyper-V Agent"
& $nssmDest set $ServiceName Description "REST API agent for YB Manager infrastructure automation"
& $nssmDest set $ServiceName Start SERVICE_AUTO_START
& $nssmDest set $ServiceName AppStdout "$InstallDir\logs\stdout.log"
& $nssmDest set $ServiceName AppStderr "$InstallDir\logs\stderr.log"
& $nssmDest set $ServiceName AppRotateFiles 1
& $nssmDest set $ServiceName AppRotateBytes 10485760

Write-OK "Service registered"

# ---------------------------------------------------------------------------
# Firewall rule
# ---------------------------------------------------------------------------

Write-Step "Configuring Windows Firewall"
Remove-NetFirewallRule -DisplayName "YB Hyper-V Agent" -ErrorAction SilentlyContinue
$fwParams = @{
    DisplayName  = "YB Hyper-V Agent"
    Direction    = "Inbound"
    Protocol     = "TCP"
    LocalPort    = $AgentPort
    Action       = "Allow"
    Profile      = "Any"
    Description  = "Allow YB Manager management machine to reach Hyper-V agent"
}
if ($ManagementIP) {
    $fwParams["RemoteAddress"] = $ManagementIP
}
New-NetFirewallRule @fwParams | Out-Null
Write-OK "Firewall rule added (port $AgentPort)"

# ---------------------------------------------------------------------------
# Start service
# ---------------------------------------------------------------------------

Write-Step "Starting service"
& $nssmDest start $ServiceName
Start-Sleep -Seconds 3
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-OK "Service is running"
} else {
    Write-Warn "Service may not have started. Check logs at $InstallDir\logs\"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " YB Hyper-V Agent installed successfully!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host " Agent URL  : http://$(hostname):$AgentPort"
Write-Host " Install dir: $InstallDir"
Write-Host " Service    : $ServiceName"
Write-Host ""
if ($generatedKey) {
    Write-Host " API KEY (copy this into the management web UI):" -ForegroundColor Yellow
    Write-Host " $generatedKey" -ForegroundColor Yellow
}
Write-Host ""
Write-Host " Next steps:"
Write-Host " 1. Open the YB Manager web UI"
Write-Host " 2. Go to Physical Hosts > Add Host"
Write-Host " 3. Enter this host's IP, port $AgentPort, and the API key above"
Write-Host " 4. Click Test Connection to verify"
Write-Host ""
