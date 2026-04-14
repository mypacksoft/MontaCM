#!/usr/bin/env python3
"""
YB Manager - Hyper-V Slave Agent
REST API agent running on Windows Hyper-V hosts.
Exposes VM lifecycle management endpoints called by the management machine daemon.
"""

import configparser
import json
import logging
import logging.handlers
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, UploadFile, File, Request
from fastapi.responses import JSONResponse
import uvicorn

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_DIR = Path(os.environ.get("YB_AGENT_DIR", r"C:\yb-hyperv-agent"))
CONF_FILE = BASE_DIR / "hyperv-agent.conf"

cfg = configparser.ConfigParser()
cfg.read(str(CONF_FILE))

PORT = int(cfg.get("agent", "port", fallback="8765"))
API_KEY = cfg.get("agent", "api_key", fallback="CHANGE_ME_ON_FIRST_INSTALL")
LOG_FILE = cfg.get("agent", "log_file", fallback=str(BASE_DIR / "agent.log"))
LOG_MAX_BYTES = int(cfg.get("agent", "log_max_bytes", fallback="10485760"))
LOG_BACKUP_COUNT = int(cfg.get("agent", "log_backup_count", fallback="5"))
ALLOWED_IPS_RAW = cfg.get("security", "allowed_ips", fallback="")
ALLOWED_IPS = set(ip.strip() for ip in ALLOWED_IPS_RAW.split(",") if ip.strip())

# ---------------------------------------------------------------------------
# Logging — ensure directory exists before creating handler
# ---------------------------------------------------------------------------

log_path = Path(LOG_FILE)
try:
    log_path.parent.mkdir(parents=True, exist_ok=True)
except Exception:
    log_path = BASE_DIR / "agent.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)

log = logging.getLogger("yb-agent")
log.setLevel(logging.INFO)
try:
    file_handler = logging.handlers.RotatingFileHandler(
        str(log_path), maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUP_COUNT
    )
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    log.addHandler(file_handler)
except Exception as e:
    sys.stderr.write(f"WARNING: Could not open log file {log_path}: {e}\n")
log.addHandler(logging.StreamHandler(sys.stdout))

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="YB Hyper-V Agent", version="1.0.0", docs_url=None, redoc_url=None)

# ---------------------------------------------------------------------------
# Auth + IP middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    method = request.method

    is_health = path == "/health" and method == "GET"

    if not is_health:
        key = request.headers.get("X-API-Key", "")
        if key != API_KEY:
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    if ALLOWED_IPS and not is_health:
        client_ip = request.client.host if request.client else ""
        if client_ip not in ALLOWED_IPS:
            log.warning("Blocked request from %s — not in allowed_ips", client_ip)
            return JSONResponse(status_code=403, content={"error": "Forbidden"})

    return await call_next(request)

# ---------------------------------------------------------------------------
# PowerShell helpers
# ---------------------------------------------------------------------------

def run_ps(command: str, timeout: int = 60) -> dict:
    result = subprocess.run(
        ["powershell.exe", "-NonInteractive", "-NoProfile", "-Command", command],
        capture_output=True, text=True, timeout=timeout,
    )
    log.debug("PS command: %s", command[:200])
    log.debug("PS stdout: %s", result.stdout[:500])
    if result.returncode != 0:
        raise RuntimeError(f"PowerShell error: {result.stderr.strip() or result.stdout.strip()}")
    return {"stdout": result.stdout.strip(), "stderr": result.stderr.strip(), "rc": result.returncode}


def ps_json(command: str, timeout: int = 60):
    r = run_ps(f"{command} | ConvertTo-Json -Depth 4", timeout)
    out = r["stdout"]
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return out


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    try:
        hv_info = ps_json("Get-VMHost | Select VirtualMachinePath,VirtualHardDiskPath")
    except Exception:
        hv_info = {}

    try:
        vm_count_raw = ps_json("(Get-VM | Measure-Object).Count")
        vm_count = int(vm_count_raw) if isinstance(vm_count_raw, (int, float, str)) else 0
    except Exception:
        vm_count = 0

    try:
        os_info_raw = ps_json("Get-CimInstance Win32_OperatingSystem | Select Caption,Version,FreePhysicalMemory,TotalVisibleMemorySize")
        os_caption = os_info_raw.get("Caption", "") if isinstance(os_info_raw, dict) else ""
        ram_total_kb = int(os_info_raw.get("TotalVisibleMemorySize", 0)) if isinstance(os_info_raw, dict) else 0
        ram_free_kb  = int(os_info_raw.get("FreePhysicalMemory", 0)) if isinstance(os_info_raw, dict) else 0
        ram_total_gb = round(ram_total_kb / 1024 / 1024, 2)
        ram_used_gb  = round((ram_total_kb - ram_free_kb) / 1024 / 1024, 2)
    except Exception:
        os_caption = platform.version()
        ram_total_gb = 0
        ram_used_gb = 0

    try:
        cpu_raw = ps_json("(Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum")
        cpu_cores = int(cpu_raw) if cpu_raw else 0
    except Exception:
        cpu_cores = os.cpu_count() or 0

    try:
        hyperv_ver_raw = ps_json("(Get-WindowsOptionalFeature -FeatureName Microsoft-Hyper-V -Online).Description")
        hyperv_ver = str(hyperv_ver_raw)[:100] if hyperv_ver_raw else "Hyper-V"
    except Exception:
        hyperv_ver = "Hyper-V"

    return {
        "status": "ok",
        "hostname": platform.node(),
        "os_version": os_caption,
        "hyperv_version": hyperv_ver,
        "cpu_cores": cpu_cores,
        "ram_gb": ram_total_gb,
        "ram_used_gb": ram_used_gb,
        "vm_count": vm_count,
        "agent_version": "1.0.0",
    }


@app.get("/resources")
def resources():
    try:
        os_raw = ps_json("Get-CimInstance Win32_OperatingSystem | Select FreePhysicalMemory,TotalVisibleMemorySize")
        ram_total_kb = int(os_raw.get("TotalVisibleMemorySize", 0)) if isinstance(os_raw, dict) else 0
        ram_free_kb  = int(os_raw.get("FreePhysicalMemory", 0)) if isinstance(os_raw, dict) else 0
    except Exception:
        ram_total_kb = ram_free_kb = 0

    try:
        cpu_pct_raw = ps_json("(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average")
        cpu_pct = float(cpu_pct_raw) if cpu_pct_raw else 0.0
    except Exception:
        cpu_pct = 0.0

    try:
        disks_raw = ps_json("Get-PSDrive -PSProvider FileSystem | Select Name,Used,Free")
        if not isinstance(disks_raw, list):
            disks_raw = [disks_raw] if disks_raw else []
        disks = [
            {
                "name": d.get("Name", ""),
                "used_gb": round(int(d.get("Used", 0)) / 1024**3, 2),
                "free_gb": round(int(d.get("Free", 0)) / 1024**3, 2),
                "total_gb": round((int(d.get("Used", 0)) + int(d.get("Free", 0))) / 1024**3, 2),
            }
            for d in disks_raw if d
        ]
    except Exception:
        disks = []

    return {
        "cpu_pct": cpu_pct,
        "ram_total_gb": round(ram_total_kb / 1024 / 1024, 2),
        "ram_used_gb":  round((ram_total_kb - ram_free_kb) / 1024 / 1024, 2),
        "disks": disks,
    }


@app.get("/vswitches")
def list_vswitches():
    data = ps_json("Get-VMSwitch | Select Name,SwitchType | Sort-Object Name")
    if data is None:
        return []
    if isinstance(data, dict):
        data = [data]
    return [{"name": s.get("Name", ""), "type": str(s.get("SwitchType", ""))} for s in data]


@app.get("/vms")
def list_vms():
    data = ps_json(
        "Get-VM | Select Name,State,ProcessorCount,"
        "@{n='MemoryGB';e={[math]::Round($_.MemoryAssigned/1GB,2)}} | Sort-Object Name"
    )
    if data is None:
        return []
    if isinstance(data, dict):
        data = [data]
    state_map = {2: "running", 3: "stopped", 6: "paused", 9: "paused", 0: "unknown"}
    return [
        {
            "name": v.get("Name", ""),
            "state": state_map.get(v.get("State"), "unknown"),
            "cpu_cores": v.get("ProcessorCount", 0),
            "ram_gb": v.get("MemoryGB", 0),
        }
        for v in data
    ]


@app.post("/vms/create")
async def create_vm(request: Request):
    body = await request.json()
    name = body.get("name")
    cpu = int(body.get("cpu_cores", 4))
    ram_gb = int(body.get("ram_gb", 8))
    disk_gb = int(body.get("disk_gb", 100))
    vswitch = body.get("vswitch_name", "Default Switch")
    generation = int(body.get("generation", 2))

    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    log.info("Creating VM: name=%s cpu=%d ram=%dGB disk=%dGB", name, cpu, ram_gb, disk_gb)

    host_info = ps_json("Get-VMHost | Select VirtualHardDiskPath")
    vhd_dir = host_info.get("VirtualHardDiskPath", r"C:\Hyper-V\Virtual Hard Disks") if isinstance(host_info, dict) else r"C:\Hyper-V\Virtual Hard Disks"
    vhdx_path = os.path.join(vhd_dir, f"{name}.vhdx")

    run_ps(f"New-VHD -Path '{vhdx_path}' -SizeBytes {disk_gb}GB -Dynamic")
    run_ps(
        f"New-VM -Name '{name}' -Generation {generation} -MemoryStartupBytes {ram_gb}GB "
        f"-VHDPath '{vhdx_path}' -SwitchName '{vswitch}'"
    )
    run_ps(f"Set-VMProcessor -VMName '{name}' -Count {cpu}")
    run_ps(f"Set-VMMemory -VMName '{name}' -DynamicMemoryEnabled $false -StartupBytes {ram_gb}GB")
    if generation == 2:
        run_ps(f"Set-VMFirmware -VMName '{name}' -EnableSecureBoot Off")

    log.info("VM %s created", name)
    return {"name": name, "vhdx_path": vhdx_path, "status": "created"}


@app.get("/vms/{name}")
def get_vm(name: str):
    data = ps_json(
        f"Get-VM -Name '{name}' | Select Name,State,ProcessorCount,"
        "@{n='MemoryGB';e={[math]::Round($_.MemoryAssigned/1GB,2)}},"
        "@{n='Uptime';e={{$_.Uptime.TotalSeconds}}}"
    )
    if not data:
        raise HTTPException(status_code=404, detail="VM not found")
    try:
        ip_data = ps_json(f"(Get-VMNetworkAdapter -VMName '{name}').IPAddresses")
        ips = ip_data if isinstance(ip_data, list) else ([ip_data] if ip_data else [])
    except Exception:
        ips = []

    state_map = {2: "running", 3: "stopped", 6: "paused", 9: "paused", 0: "unknown"}
    result = dict(data) if isinstance(data, dict) else {}
    result["state"] = state_map.get(result.get("State"), "unknown")
    result["ip_addresses"] = ips
    return result


@app.post("/vms/{name}/attach-iso")
async def attach_iso(name: str, iso: UploadFile = File(...)):
    iso_dir = BASE_DIR / "isos"
    iso_dir.mkdir(exist_ok=True)
    iso_path = iso_dir / f"{name}-seed.iso"

    with open(iso_path, "wb") as f:
        content = await iso.read()
        f.write(content)

    log.info("Attaching ISO %s to VM %s", iso_path, name)
    run_ps(f"Add-VMDvdDrive -VMName '{name}' -Path '{iso_path}'")
    return {"status": "iso_attached", "path": str(iso_path)}


@app.post("/vms/{name}/start")
def start_vm(name: str):
    log.info("Starting VM %s", name)
    run_ps(f"Start-VM -Name '{name}'")
    return {"status": "starting", "name": name}


@app.post("/vms/{name}/stop")
def stop_vm(name: str):
    log.info("Stopping VM %s", name)
    run_ps(f"Stop-VM -Name '{name}' -Force")
    return {"status": "stopping", "name": name}


@app.post("/vms/{name}/restart")
def restart_vm(name: str):
    log.info("Restarting VM %s", name)
    run_ps(f"Restart-VM -Name '{name}' -Force")
    return {"status": "restarting", "name": name}


@app.delete("/vms/{name}")
def delete_vm(name: str):
    log.info("Deleting VM %s", name)
    try:
        vhd_raw = ps_json(f"(Get-VMHardDiskDrive -VMName '{name}').Path")
        vhd_paths = [vhd_raw] if isinstance(vhd_raw, str) else (vhd_raw if isinstance(vhd_raw, list) else [])
    except Exception:
        vhd_paths = []

    try:
        run_ps(f"Stop-VM -Name '{name}' -Force -ErrorAction SilentlyContinue")
    except Exception:
        pass

    run_ps(f"Remove-VM -Name '{name}' -Force")

    for path in vhd_paths:
        if path and os.path.exists(path):
            try:
                os.remove(path)
                log.info("Deleted VHDX: %s", path)
            except Exception as e:
                log.warning("Failed to delete VHDX %s: %s", path, e)

    return {"status": "deleted", "name": name}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    log.info("Starting YB Hyper-V Agent on port %d", PORT)
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
