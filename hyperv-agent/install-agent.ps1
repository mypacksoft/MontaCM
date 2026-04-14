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
    [switch]$Uninstall,
    [switch]$Reinstall
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

function Remove-AgentCompletely {
    Write-Step "Removing $ServiceName service"
    $nssm = Join-Path $InstallDir "nssm.exe"
    $nssmScript = Join-Path $ScriptDir "nssm.exe"
    if (-not (Test-Path $nssm)) { $nssm = $nssmScript }
    if (-not (Test-Path $nssm)) {
        $nssmAlt = Join-Path $ScriptDir "nssm-2.24\win64\nssm.exe"
        if (Test-Path $nssmAlt) { $nssm = $nssmAlt }
    }
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        if (Test-Path $nssm) {
            & $nssm stop $ServiceName 2>&1 | Out-Null
            Start-Sleep -Seconds 2
            & $nssm remove $ServiceName confirm 2>&1 | Out-Null
        } else {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            sc.exe delete $ServiceName | Out-Null
        }
        Write-OK "Service removed"
    } else {
        Write-Warn "Service not found, skipping"
    }

    Write-Step "Removing firewall rule"
    Remove-NetFirewallRule -DisplayName "YB Hyper-V Agent" -ErrorAction SilentlyContinue
    Write-OK "Firewall rule removed"

    Write-Step "Removing install directory: $InstallDir"
    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
        Write-OK "Directory removed"
    } else {
        Write-Warn "Directory not found, skipping"
    }
}

# ---------------------------------------------------------------------------
# Uninstall mode
# ---------------------------------------------------------------------------

if ($Uninstall) {
    Remove-AgentCompletely
    Write-OK "Uninstalled successfully"
    exit 0
}

# ---------------------------------------------------------------------------
# Reinstall mode - remove everything first then continue with install
# ---------------------------------------------------------------------------

if ($Reinstall) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host " REINSTALL MODE: removing existing installation first" -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
    Remove-AgentCompletely
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " Proceeding with fresh installation..." -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
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
    "C:\Python314\python.exe",
    "C:\Python313\python.exe",
    "C:\Python312\python.exe",
    "C:\Python311\python.exe",
    "C:\Python310\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe",
    "C:\Program Files\Python314\python.exe",
    "C:\Program Files\Python313\python.exe",
    "C:\Program Files\Python312\python.exe",
    "C:\Program Files\Python311\python.exe"
)

foreach ($candidate in $candidates) {
    try {
        $ver = & $candidate --version 2>&1
        if ($ver -match "Python 3\.(10|11|12|13|14)") {
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
        $fallbackPaths = @(
            "C:\Program Files\Python314\python.exe",
            "C:\Program Files\Python313\python.exe",
            "C:\Program Files\Python312\python.exe",
            "C:\Program Files\Python311\python.exe",
            "C:\Python314\python.exe",
            "C:\Python313\python.exe",
            "C:\Python312\python.exe",
            "C:\Python311\python.exe"
        )
        foreach ($fp in $fallbackPaths) {
            if (Test-Path $fp) { $pythonExe = $fp; break }
        }
        if (-not $pythonExe) {
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            $pyCmd = Get-Command python.exe -ErrorAction SilentlyContinue
            if ($pyCmd) { $pythonExe = $pyCmd.Source }
        }
        if (-not $pythonExe) {
            Write-Error "Python installed but executable not found. Please restart PowerShell and re-run this script."
        }
        Write-OK "Python installed at $pythonExe"
    } else {
        Write-Error "Python 3.10+ not found and no installer found in script directory. Place python-3.xx-amd64.exe next to this script."
    }
}

# ---------------------------------------------------------------------------
# Install pip packages
# ---------------------------------------------------------------------------

Write-Step "Installing Python packages"
$wheelsDir = Join-Path $ScriptDir "wheels"
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
if (Test-Path $wheelsDir) {
    Write-Host "    Installing from offline wheels: $wheelsDir"
    & $pythonExe -m pip install --no-index --find-links $wheelsDir fastapi "uvicorn[standard]" pywin32 python-multipart 2>&1 | ForEach-Object { Write-Host "    $_" }
} else {
    Write-Warn "No offline wheels folder found. Installing from internet..."
    & $pythonExe -m pip install fastapi "uvicorn[standard]" pywin32 python-multipart 2>&1 | ForEach-Object { Write-Host "    $_" }
}
$pipExit = $LASTEXITCODE
$ErrorActionPreference = $prevEAP

if ($pipExit -ne 0) {
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
    & $nssmDest stop $ServiceName 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    & $nssmDest remove $ServiceName confirm 2>&1 | Out-Null
}

& $nssmDest install $ServiceName $pythonExe "-u `"$InstallDir\agent.py`""
& $nssmDest set $ServiceName AppDirectory $InstallDir
& $nssmDest set $ServiceName AppEnvironmentExtra "YB_AGENT_DIR=$InstallDir" "PYTHONUNBUFFERED=1"
& $nssmDest set $ServiceName DisplayName "YB Manager Hyper-V Agent"
& $nssmDest set $ServiceName Description "REST API agent for YB Manager infrastructure automation"
& $nssmDest set $ServiceName Start SERVICE_AUTO_START
& $nssmDest set $ServiceName AppStdout "$InstallDir\logs\stdout.log"
& $nssmDest set $ServiceName AppStderr "$InstallDir\logs\stderr.log"
& $nssmDest set $ServiceName AppRotateFiles 1
& $nssmDest set $ServiceName AppRotateBytes 10485760
& $nssmDest set $ServiceName AppThrottle 10000
& $nssmDest set $ServiceName AppExit Default Restart
& $nssmDest set $ServiceName AppRestartDelay 3000
& $nssmDest set $ServiceName AppStopMethodSkip 6

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
    Description  = "Allow YB Manager to reach Hyper-V agent"
}
if ($ManagementIP) {
    $ipValid = $false
    try {
        [System.Net.IPAddress]::Parse($ManagementIP) | Out-Null
        $ipValid = $true
    } catch {}
    if ($ipValid) {
        $fwParams["RemoteAddress"] = $ManagementIP
    } else {
        Write-Warn "ManagementIP '$ManagementIP' is not a valid IP address - firewall rule will allow any source."
    }
}
try {
    New-NetFirewallRule @fwParams | Out-Null
    Write-OK "Firewall rule added (port $AgentPort)"
} catch {
    Write-Warn "Could not add firewall rule: $_"
    Write-Warn "You may need to manually allow TCP port $AgentPort in Windows Firewall."
}

# ---------------------------------------------------------------------------
# Start service
# ---------------------------------------------------------------------------

Write-Step "Starting service"

$prevEAP2 = $ErrorActionPreference
$ErrorActionPreference = 'Continue'

$svcCheck = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svcCheck -and ($svcCheck.Status -eq "Paused" -or $svcCheck.Status -eq "Stopped")) {
    & $nssmDest stop $ServiceName confirm 2>&1 | Out-Null
    Start-Sleep -Seconds 3
}

& $nssmDest start $ServiceName 2>&1 | Out-Null
Start-Sleep -Seconds 6

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($svc -and $svc.Status -eq "Paused") {
    Write-Warn "Service reported PAUSED - attempting sc.exe continue"
    sc.exe continue $ServiceName 2>&1 | Out-Null
    Start-Sleep -Seconds 3
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
}

$ErrorActionPreference = $prevEAP2

if ($svc -and $svc.Status -eq "Running") {
    Write-OK "Service is running"
} else {
    $status = if ($svc) { $svc.Status } else { "not found" }
    Write-Warn "Service status: $status"

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host " DIAGNOSTIC: Testing agent.py manually..." -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
    $env:YB_AGENT_DIR = $InstallDir
    $env:PYTHONUNBUFFERED = "1"
    $testResult = & $pythonExe "-c" "import sys; sys.path.insert(0,'$InstallDir'); exec(open('$InstallDir\\agent.py').read().split('if __name__')[0]); print('IMPORT OK')" 2>&1
    Write-Host $testResult -ForegroundColor Yellow

    Write-Host ""
    Write-Host " stderr.log contents:" -ForegroundColor Red
    $stderrLog = "$InstallDir\logs\stderr.log"
    if (Test-Path $stderrLog) {
        Get-Content $stderrLog -Tail 30 | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    } else {
        Write-Host "  (empty or not found)" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host " stdout.log contents:" -ForegroundColor Red
    $stdoutLog = "$InstallDir\logs\stdout.log"
    if (Test-Path $stdoutLog) {
        Get-Content $stdoutLog -Tail 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    } else {
        Write-Host "  (empty or not found)" -ForegroundColor Yellow
    }

    Write-Host "============================================================" -ForegroundColor Red
    Write-Warn "To diagnose further, run manually:"
    Write-Warn "  & '$pythonExe' '$InstallDir\agent.py'"
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
Write-Host " 3. Enter this host IP, port $AgentPort, and the API key above"
Write-Host " 4. Click Test Connection to verify"
Write-Host ""
