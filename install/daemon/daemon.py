#!/usr/bin/env python3
"""
YB Manager - Automation Daemon
Listens for new jobs via PostgreSQL LISTEN/NOTIFY and executes them.
"""

import json
import logging
import os
import select
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone

import paramiko
import psycopg2
import psycopg2.extensions
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DB_DSN = os.environ.get(
    "YB_DB_DSN",
    "postgresql://yb_manager_role:CHANGE_ME@localhost:5432/yb_manager"
)

LOG_LEVEL = os.environ.get("YB_LOG_LEVEL", "INFO").upper()
ANSIBLE_DIR = os.environ.get("YB_ANSIBLE_DIR", "/opt/yb-manager/ansible")
SSH_KEY_PATH = ""  # loaded from system_config at runtime
SSH_CONNECT_TIMEOUT = 300  # seconds to wait for VM SSH to become available
SSH_RETRY_INTERVAL = 10

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("daemon")


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_conn(dsn: str) -> psycopg2.extensions.connection:
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    return conn


def job_log(conn, job_id: str, level: str, message: str, step_id: str = None):
    log.debug("[job %s] [%s] %s", job_id[:8], level, message)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO job_logs (job_id, step_id, level, message) VALUES (%s, %s, %s, %s)",
            (job_id, step_id, level, message),
        )


def job_set_status(conn, job_id: str, status: str, error: str = None, result: dict = None):
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE automation_jobs
               SET status = %s,
                   error_message = %s,
                   result = %s,
                   started_at  = CASE WHEN %s = 'running'  AND started_at  IS NULL THEN now() ELSE started_at  END,
                   finished_at = CASE WHEN %s IN ('success','failed','cancelled') THEN now() ELSE finished_at END
             WHERE id = %s""",
            (status, error, json.dumps(result) if result else None,
             status, status, job_id),
        )


def load_system_config(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT key, value FROM system_config")
        return {row[0]: row[1] for row in cur.fetchall()}


# ---------------------------------------------------------------------------
# Agent HTTP helpers
# ---------------------------------------------------------------------------

def agent_url(host_ip: str, agent_port: int, path: str) -> str:
    return f"http://{host_ip}:{agent_port}{path}"


def agent_get(host_ip: str, port: int, path: str, api_key: str) -> dict:
    resp = requests.get(agent_url(host_ip, port, path),
                        headers={"X-API-Key": api_key}, timeout=15)
    resp.raise_for_status()
    return resp.json()


def agent_post(host_ip: str, port: int, path: str, api_key: str, data: dict = None) -> dict:
    resp = requests.post(agent_url(host_ip, port, path),
                         headers={"X-API-Key": api_key, "Content-Type": "application/json"},
                         json=data or {}, timeout=60)
    resp.raise_for_status()
    return resp.json()


def agent_delete(host_ip: str, port: int, path: str, api_key: str) -> dict:
    resp = requests.delete(agent_url(host_ip, port, path),
                           headers={"X-API-Key": api_key}, timeout=30)
    resp.raise_for_status()
    return resp.json() if resp.content else {}


# ---------------------------------------------------------------------------
# SSH helpers
# ---------------------------------------------------------------------------

def wait_for_ssh(ip: str, user: str, key_path: str, timeout: int = SSH_CONNECT_TIMEOUT) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(ip, username=user, key_filename=key_path,
                           timeout=10, auth_timeout=10, banner_timeout=10)
            client.close()
            return True
        except Exception:
            time.sleep(SSH_RETRY_INTERVAL)
    return False


# ---------------------------------------------------------------------------
# Job handlers
# ---------------------------------------------------------------------------

def handle_test_host(conn, job: dict, cfg: dict):
    job_id = job["id"]
    with conn.cursor() as cur:
        cur.execute("SELECT ip_address, agent_port, api_key FROM physical_hosts WHERE id = %s",
                    (job["physical_host_id"],))
        row = cur.fetchone()
    if not row:
        raise RuntimeError("Host not found")
    ip, port, api_key = row
    job_log(conn, job_id, "info", f"Testing connection to agent at {ip}:{port}")
    data = agent_get(ip, port, "/health", api_key or "")
    job_log(conn, job_id, "info", f"Agent responded: {json.dumps(data)}")

    try:
        res = agent_get(ip, port, "/resources", api_key or "")
        job_log(conn, job_id, "info", f"Resources: {json.dumps(res)}")
        cpu_used_pct = res.get("cpu_pct")
        ram_used_gb = res.get("ram_used_gb")
        disks = res.get("disks", [])
        disk_gb = sum(d.get("total_gb", 0) for d in disks) if disks else None
        disk_used_gb = sum(d.get("used_gb", 0) for d in disks) if disks else None
    except Exception as exc:
        job_log(conn, job_id, "warn", f"Could not fetch resources: {exc}")
        cpu_used_pct = None
        ram_used_gb = None
        disk_gb = None
        disk_used_gb = None

    with conn.cursor() as cur:
        cur.execute(
            """UPDATE physical_hosts
               SET status = 'online', last_seen = now(),
                   os_version = %s, hyperv_version = %s,
                   cpu_cores = %s, ram_gb = %s, vm_count = %s,
                   cpu_used_pct = %s, ram_used_gb = %s,
                   disk_gb = %s, disk_used_gb = %s
             WHERE id = %s""",
            (data.get("os_version"), data.get("hyperv_version"),
             data.get("cpu_cores"), data.get("ram_gb"), data.get("vm_count"),
             cpu_used_pct, ram_used_gb, disk_gb, disk_used_gb,
             job["physical_host_id"]),
        )
    return {"status": "ok", "agent": data}


def handle_create_vm(conn, job: dict, cfg: dict):
    job_id = job["id"]
    payload = job["payload"]

    with conn.cursor() as cur:
        cur.execute("SELECT ip_address, agent_port, api_key FROM physical_hosts WHERE id = %s",
                    (job["physical_host_id"],))
        row = cur.fetchone()
    if not row:
        raise RuntimeError("Host not found")
    ip, port, api_key = row

    job_log(conn, job_id, "info", f"Creating VM '{payload['name']}' on host {ip}")
    result = agent_post(ip, port, "/vms/create", api_key or "", payload)
    job_log(conn, job_id, "info", f"VM created: {json.dumps(result)}")

    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO vms (name, physical_host_id, status, cpu_cores, ram_gb, disk_gb,
                                vswitch_name, os_template, generation, vhdx_path)
               VALUES (%s, %s, 'stopped', %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (physical_host_id, name) DO UPDATE
               SET status = 'stopped', vhdx_path = EXCLUDED.vhdx_path""",
            (payload["name"], job["physical_host_id"],
             payload.get("cpu_cores", 4), payload.get("ram_gb", 8), payload.get("disk_gb", 100),
             payload.get("vswitch_name"), payload.get("os_template"), payload.get("generation", 2),
             result.get("vhdx_path")),
        )

    if payload.get("os_template"):
        job_log(conn, job_id, "info", "Queuing provision_os job")
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO automation_jobs (type, status, physical_host_id, payload, triggered_by)
                   SELECT 'provision_os', 'queued', %s, %s::jsonb, 'daemon'
                   WHERE NOT EXISTS (
                     SELECT 1 FROM automation_jobs WHERE type='provision_os'
                       AND physical_host_id = %s
                       AND payload->>'name' = %s
                       AND status IN ('queued','running')
                   )""",
                (job["physical_host_id"], json.dumps(payload),
                 job["physical_host_id"], payload["name"]),
            )
    return result


def handle_provision_os(conn, job: dict, cfg: dict):
    job_id = job["id"]
    payload = job["payload"]
    vm_name = payload["name"]

    with conn.cursor() as cur:
        cur.execute("SELECT ip_address, agent_port, api_key FROM physical_hosts WHERE id = %s",
                    (job["physical_host_id"],))
        row = cur.fetchone()
    if not row:
        raise RuntimeError("Host not found")
    ip, port, api_key = row

    job_log(conn, job_id, "info", "Generating cloud-init seed ISO")
    ssh_key = cfg.get("default_ssh_public_key", "")
    user = cfg.get("default_ssh_user", "ubuntu")
    dns = cfg.get("dns_server", "8.8.8.8")

    user_data = f"""#cloud-config
hostname: {vm_name}
manage_etc_hosts: true
users:
  - name: {user}
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - {ssh_key}
package_update: true
packages: [openssh-server, python3, qemu-guest-agent]
runcmd:
  - systemctl enable qemu-guest-agent
  - systemctl start qemu-guest-agent
"""
    meta_data = f"instance-id: {vm_name}\nlocal-hostname: {vm_name}\n"

    with tempfile.TemporaryDirectory() as tmpdir:
        ud_file = os.path.join(tmpdir, "user-data")
        md_file = os.path.join(tmpdir, "meta-data")
        iso_file = os.path.join(tmpdir, f"{vm_name}-seed.iso")
        with open(ud_file, "w") as f:
            f.write(user_data)
        with open(md_file, "w") as f:
            f.write(meta_data)

        result = subprocess.run(
            ["genisoimage", "-output", iso_file, "-volid", "cidata",
             "-joliet", "-rock", ud_file, md_file],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"genisoimage failed: {result.stderr}")

        job_log(conn, job_id, "info", "Uploading seed ISO to agent")
        with open(iso_file, "rb") as f:
            resp = requests.post(
                agent_url(ip, port, f"/vms/{vm_name}/attach-iso"),
                headers={"X-API-Key": api_key or ""},
                files={"iso": (f"{vm_name}-seed.iso", f, "application/octet-stream")},
                timeout=120,
            )
            resp.raise_for_status()

    job_log(conn, job_id, "info", "Starting VM for OS installation")
    agent_post(ip, port, f"/vms/{vm_name}/start", api_key or "")

    with conn.cursor() as cur:
        cur.execute("UPDATE vms SET status = 'starting' WHERE physical_host_id = %s AND name = %s",
                    (job["physical_host_id"], vm_name))
    return {"status": "provisioning_started"}


def handle_install_yb(conn, job: dict, cfg: dict):
    job_id = job["id"]

    with conn.cursor() as cur:
        cur.execute("SELECT name, ip_address FROM vms WHERE id = %s", (job["vm_id"],))
        row = cur.fetchone()
    if not row:
        raise RuntimeError("VM not found")
    vm_name, vm_ip = row

    user = cfg.get("ansible_user", "ubuntu")
    key_path = cfg.get("ansible_ssh_private_key_path", "/opt/yb-manager/keys/id_rsa")
    timeout = int(cfg.get("ansible_timeout", "60"))

    job_log(conn, job_id, "info", f"Waiting for SSH on {vm_ip}")
    if not wait_for_ssh(vm_ip, user, key_path, timeout=SSH_CONNECT_TIMEOUT):
        raise RuntimeError(f"SSH not available on {vm_ip} after {SSH_CONNECT_TIMEOUT}s")

    job_log(conn, job_id, "info", f"Running install-yugabyte playbook on {vm_ip}")
    result = subprocess.run(
        ["ansible-playbook",
         os.path.join(ANSIBLE_DIR, "playbooks/install-yugabyte.yml"),
         "-i", f"{vm_ip},",
         "-u", user,
         "--private-key", key_path,
         "--timeout", str(timeout),
         "-e", f"yb_version={cfg.get('yb_version','2.20.1.0')}",
         "-e", f"yb_download_url={cfg.get('yb_download_url','')}",
         "-e", f"yb_install_dir={cfg.get('yb_install_dir','/opt/yugabyte')}",
         "-e", f"yb_data_dir={cfg.get('yb_data_dir','/data/yugabyte')}",
         ],
        capture_output=True, text=True, timeout=1800,
    )
    for line in result.stdout.splitlines():
        job_log(conn, job_id, "info", line)
    if result.returncode != 0:
        for line in result.stderr.splitlines():
            job_log(conn, job_id, "error", line)
        raise RuntimeError(f"Ansible playbook failed (rc={result.returncode})")

    with conn.cursor() as cur:
        cur.execute("UPDATE vms SET os_installed = true WHERE id = %s", (job["vm_id"],))
    return {"status": "yb_installed"}


def handle_join_cluster(conn, job: dict, cfg: dict):
    job_id = job["id"]
    payload = job["payload"]

    with conn.cursor() as cur:
        cur.execute("SELECT name, ip_address FROM vms WHERE id = %s", (job["vm_id"],))
        vm_row = cur.fetchone()
        cur.execute(
            "SELECT ip_address FROM vms WHERE cluster_id = %s AND role IN ('master','master+tserver') AND status = 'running'",
            (job["cluster_id"],),
        )
        master_rows = cur.fetchall()
        cur.execute("SELECT name FROM yugabyte_clusters WHERE id = %s", (job["cluster_id"],))
        cluster_row = cur.fetchone()

    if not vm_row:
        raise RuntimeError("VM not found")
    vm_name, vm_ip = vm_row
    master_ips = ",".join(r[0] for r in master_rows) if master_rows else vm_ip
    cluster_name = cluster_row[0] if cluster_row else "unknown"

    user = cfg.get("ansible_user", "ubuntu")
    key_path = cfg.get("ansible_ssh_private_key_path", "/opt/yb-manager/keys/id_rsa")
    timeout = int(cfg.get("ansible_timeout", "60"))
    role = payload.get("role", "master+tserver")

    job_log(conn, job_id, "info", f"Joining {vm_name} ({vm_ip}) to cluster {cluster_name} as {role}")
    result = subprocess.run(
        ["ansible-playbook",
         os.path.join(ANSIBLE_DIR, "playbooks/join-cluster.yml"),
         "-i", f"{vm_ip},",
         "-u", user,
         "--private-key", key_path,
         "--timeout", str(timeout),
         "-e", f"master_addresses={master_ips}",
         "-e", f"node_role={role}",
         "-e", f"cluster_id={job['cluster_id']}",
         "-e", f"yb_install_dir={cfg.get('yb_install_dir','/opt/yugabyte')}",
         "-e", f"yb_data_dir={cfg.get('yb_data_dir','/data/yugabyte')}",
         ],
        capture_output=True, text=True, timeout=600,
    )
    for line in result.stdout.splitlines():
        job_log(conn, job_id, "info", line)
    if result.returncode != 0:
        for line in result.stderr.splitlines():
            job_log(conn, job_id, "error", line)
        raise RuntimeError(f"Ansible join-cluster failed (rc={result.returncode})")

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE vms SET cluster_id = %s, role = %s WHERE id = %s",
            (job["cluster_id"], role, job["vm_id"]),
        )
        cur.execute(
            """INSERT INTO yugabyte_nodes (cluster_id, vm_id, role, joined_at)
               VALUES (%s, %s, %s, now())
               ON CONFLICT (cluster_id, vm_id) DO UPDATE SET role = EXCLUDED.role, joined_at = now()""",
            (job["cluster_id"], job["vm_id"], role),
        )
        cur.execute(
            """UPDATE yugabyte_clusters
               SET master_count  = (SELECT COUNT(*) FROM yugabyte_nodes WHERE cluster_id = %s AND role IN ('master','master+tserver')),
                   tserver_count = (SELECT COUNT(*) FROM yugabyte_nodes WHERE cluster_id = %s AND role IN ('tserver','master+tserver')),
                   status = 'healthy',
                   updated_at = now()
             WHERE id = %s""",
            (job["cluster_id"], job["cluster_id"], job["cluster_id"]),
        )
    return {"status": "node_joined"}


def handle_vm_action(conn, job: dict, cfg: dict):
    job_id = job["id"]
    action = job["type"]

    with conn.cursor() as cur:
        cur.execute(
            "SELECT v.name, v.status, h.ip_address, h.agent_port, h.api_key "
            "FROM vms v JOIN physical_hosts h ON h.id = v.physical_host_id WHERE v.id = %s",
            (job["vm_id"],),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError("VM not found")
    vm_name, vm_status, host_ip, agent_port, api_key = row

    if action == "start_vm":
        job_log(conn, job_id, "info", f"Starting VM {vm_name}")
        agent_post(host_ip, agent_port, f"/vms/{vm_name}/start", api_key or "")
        with conn.cursor() as cur:
            cur.execute("UPDATE vms SET status = 'starting' WHERE id = %s", (job["vm_id"],))

    elif action == "stop_vm":
        job_log(conn, job_id, "info", f"Stopping VM {vm_name}")
        agent_post(host_ip, agent_port, f"/vms/{vm_name}/stop", api_key or "")
        with conn.cursor() as cur:
            cur.execute("UPDATE vms SET status = 'stopping' WHERE id = %s", (job["vm_id"],))

    elif action == "delete_vm":
        job_log(conn, job_id, "info", f"Deleting VM {vm_name}")
        agent_delete(host_ip, agent_port, f"/vms/{vm_name}", api_key or "")
        with conn.cursor() as cur:
            cur.execute("DELETE FROM vms WHERE id = %s", (job["vm_id"],))

    return {"action": action, "vm": vm_name}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

HANDLERS = {
    "test_host":    handle_test_host,
    "create_vm":    handle_create_vm,
    "provision_os": handle_provision_os,
    "install_yb":   handle_install_yb,
    "join_cluster": handle_join_cluster,
    "start_vm":     handle_vm_action,
    "stop_vm":      handle_vm_action,
    "delete_vm":    handle_vm_action,
}


def process_job(conn, job: dict):
    job_id = job["id"]
    job_type = job["type"]
    log.info("Processing job %s type=%s", job_id[:8], job_type)

    cfg = load_system_config(conn)

    job_set_status(conn, job_id, "running")
    job_log(conn, job_id, "info", f"Job {job_id} started: {job_type}")

    handler = HANDLERS.get(job_type)
    if not handler:
        job_set_status(conn, job_id, "failed", error=f"Unknown job type: {job_type}")
        return

    try:
        result = handler(conn, job, cfg)
        job_set_status(conn, job_id, "success", result=result)
        job_log(conn, job_id, "info", "Job completed successfully")
    except Exception as exc:
        log.exception("Job %s failed", job_id[:8])
        job_set_status(conn, job_id, "failed", error=str(exc))
        job_log(conn, job_id, "error", f"Job failed: {exc}")


def fetch_pending_jobs(conn) -> list:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, type, status, payload, physical_host_id, vm_id, cluster_id, triggered_by "
            "FROM automation_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 5"
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    log.info("YB Manager Daemon starting")
    conn = get_conn(DB_DSN)
    log.info("Connected to database")

    conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
    with conn.cursor() as cur:
        cur.execute("LISTEN new_job")
    log.info("Listening for new_job notifications")

    for job in fetch_pending_jobs(conn):
        process_job(conn, job)

    while True:
        try:
            if select.select([conn], [], [], 30)[0]:
                conn.poll()
                while conn.notifies:
                    notify = conn.notifies.pop(0)
                    try:
                        job_data = json.loads(notify.payload)
                        if job_data.get("status") == "queued":
                            process_job(conn, job_data)
                    except Exception:
                        log.exception("Error handling notification")
            else:
                for job in fetch_pending_jobs(conn):
                    process_job(conn, job)
        except psycopg2.OperationalError:
            log.error("Lost DB connection, reconnecting in 5s")
            time.sleep(5)
            try:
                conn = get_conn(DB_DSN)
                conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
                with conn.cursor() as cur:
                    cur.execute("LISTEN new_job")
                log.info("Reconnected")
            except Exception:
                log.exception("Reconnect failed")
        except Exception:
            log.exception("Unexpected error in main loop")
            time.sleep(5)


if __name__ == "__main__":
    main()
