-- =============================================================================
-- YB Manager - Initial Schema Migration
-- =============================================================================
-- Creates all tables, enums, indexes, triggers, and initial seed data for
-- the YugabyteDB infrastructure management platform.
--
-- Tables:
--   physical_hosts       - Hyper-V host machines with agent endpoints
--   vms                  - Virtual machines across all hosts
--   yugabyte_clusters    - YugabyteDB cluster definitions
--   yugabyte_nodes       - Individual cluster node memberships
--   automation_jobs      - Job queue and execution history
--   job_steps            - Per-step tracking within jobs
--   job_logs             - Structured log lines per job
--   system_config        - Key-value configuration store
--
-- Roles:
--   yb_manager_role      - Application DB user (owner of all tables)
--   authenticator        - PostgREST service role (no privileges, switches to anon)
--   anon                 - Role used by PostgREST for API access
-- =============================================================================

-- Roles -----------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'changeme_postgrest_pw';
  END IF;
END $$;

GRANT anon TO authenticator;

-- Enums -----------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'host_status') THEN
    CREATE TYPE host_status AS ENUM ('online', 'offline', 'unreachable', 'unknown');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vm_status') THEN
    CREATE TYPE vm_status AS ENUM ('running', 'stopped', 'paused', 'starting', 'stopping', 'error', 'unknown');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cluster_status') THEN
    CREATE TYPE cluster_status AS ENUM ('healthy', 'degraded', 'unavailable', 'initializing', 'unknown');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
    CREATE TYPE job_status AS ENUM ('queued', 'running', 'success', 'failed', 'cancelled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_type') THEN
    CREATE TYPE job_type AS ENUM (
      'test_host', 'create_vm', 'provision_os', 'install_yb', 'join_cluster',
      'start_vm', 'stop_vm', 'delete_vm', 'create_cluster', 'remove_node'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'node_role') THEN
    CREATE TYPE node_role AS ENUM ('master', 'tserver', 'master+tserver');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'log_level') THEN
    CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'os_template') THEN
    CREATE TYPE os_template AS ENUM ('ubuntu-22.04', 'ubuntu-20.04', 'rocky-8', 'rocky-9');
  END IF;
END $$;

-- Tables ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS physical_hosts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL UNIQUE,
  ip_address       text NOT NULL,
  agent_port       integer NOT NULL DEFAULT 8765,
  api_key          text,
  status           host_status NOT NULL DEFAULT 'unknown',
  cpu_cores        integer,
  ram_gb           numeric(10,2),
  disk_gb          numeric(10,2),
  cpu_used_pct     numeric(5,2),
  ram_used_gb      numeric(10,2),
  disk_used_gb     numeric(10,2),
  vm_count         integer,
  os_version       text,
  hyperv_version   text,
  last_seen        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vms (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  physical_host_id uuid NOT NULL REFERENCES physical_hosts(id) ON DELETE RESTRICT,
  status           vm_status NOT NULL DEFAULT 'unknown',
  cpu_cores        integer NOT NULL DEFAULT 4,
  ram_gb           integer NOT NULL DEFAULT 8,
  disk_gb          integer NOT NULL DEFAULT 100,
  vswitch_name     text,
  ip_address       text,
  os_template      os_template,
  os_installed     boolean NOT NULL DEFAULT false,
  vhdx_path        text,
  generation       integer NOT NULL DEFAULT 2,
  cluster_id       uuid,
  role             node_role,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(physical_host_id, name)
);

CREATE TABLE IF NOT EXISTS yugabyte_clusters (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL UNIQUE,
  status             cluster_status NOT NULL DEFAULT 'unknown',
  replication_factor integer NOT NULL DEFAULT 3,
  master_count       integer NOT NULL DEFAULT 0,
  tserver_count      integer NOT NULL DEFAULT 0,
  version            text,
  ysql_port          integer NOT NULL DEFAULT 5433,
  ycql_port          integer NOT NULL DEFAULT 9042,
  master_ui_url      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vms ADD CONSTRAINT fk_vms_cluster
  FOREIGN KEY (cluster_id) REFERENCES yugabyte_clusters(id) ON DELETE SET NULL
  NOT VALID;

CREATE TABLE IF NOT EXISTS yugabyte_nodes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id         uuid NOT NULL REFERENCES yugabyte_clusters(id) ON DELETE CASCADE,
  vm_id              uuid NOT NULL REFERENCES vms(id) ON DELETE RESTRICT,
  role               node_role NOT NULL DEFAULT 'master+tserver',
  is_master_leader   boolean NOT NULL DEFAULT false,
  tablet_count       integer,
  yb_master_running  boolean NOT NULL DEFAULT false,
  yb_tserver_running boolean NOT NULL DEFAULT false,
  joined_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cluster_id, vm_id)
);

CREATE TABLE IF NOT EXISTS automation_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             job_type NOT NULL,
  status           job_status NOT NULL DEFAULT 'queued',
  payload          jsonb NOT NULL DEFAULT '{}',
  result           jsonb,
  error_message    text,
  physical_host_id uuid REFERENCES physical_hosts(id) ON DELETE SET NULL,
  vm_id            uuid REFERENCES vms(id) ON DELETE SET NULL,
  cluster_id       uuid REFERENCES yugabyte_clusters(id) ON DELETE SET NULL,
  triggered_by     text NOT NULL DEFAULT 'user',
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  name        text NOT NULL,
  status      job_status NOT NULL DEFAULT 'queued',
  started_at  timestamptz,
  finished_at timestamptz,
  UNIQUE(job_id, step_number)
);

CREATE TABLE IF NOT EXISTS job_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
  step_id    uuid REFERENCES job_steps(id) ON DELETE SET NULL,
  level      log_level NOT NULL DEFAULT 'info',
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_config (
  key         text PRIMARY KEY,
  value       text NOT NULL DEFAULT '',
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_vms_host ON vms(physical_host_id);
CREATE INDEX IF NOT EXISTS idx_vms_cluster ON vms(cluster_id);
CREATE INDEX IF NOT EXISTS idx_yb_nodes_cluster ON yugabyte_nodes(cluster_id);
CREATE INDEX IF NOT EXISTS idx_yb_nodes_vm ON yugabyte_nodes(vm_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON automation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON automation_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_host ON automation_jobs(physical_host_id);
CREATE INDEX IF NOT EXISTS idx_jobs_vm ON automation_jobs(vm_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_created ON job_logs(created_at ASC);

-- Triggers: updated_at --------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hosts_updated_at') THEN
    CREATE TRIGGER trg_hosts_updated_at BEFORE UPDATE ON physical_hosts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_vms_updated_at') THEN
    CREATE TRIGGER trg_vms_updated_at BEFORE UPDATE ON vms
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clusters_updated_at') THEN
    CREATE TRIGGER trg_clusters_updated_at BEFORE UPDATE ON yugabyte_clusters
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_config_updated_at') THEN
    CREATE TRIGGER trg_config_updated_at BEFORE UPDATE ON system_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Triggers: pg_notify for daemon ----------------------------------------

CREATE OR REPLACE FUNCTION notify_new_job()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('new_job', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_new_job') THEN
    CREATE TRIGGER trg_notify_new_job AFTER INSERT ON automation_jobs
      FOR EACH ROW EXECUTE FUNCTION notify_new_job();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION notify_new_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('new_log', json_build_object('job_id', NEW.job_id, 'message', NEW.message, 'level', NEW.level)::text);
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_new_log') THEN
    CREATE TRIGGER trg_notify_new_log AFTER INSERT ON job_logs
      FOR EACH ROW EXECUTE FUNCTION notify_new_log();
  END IF;
END $$;

-- Permissions -----------------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

GRANT USAGE ON SCHEMA public TO yb_manager_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO yb_manager_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO yb_manager_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO yb_manager_role;

-- Seed: system_config ---------------------------------------------------

INSERT INTO system_config (key, value, description) VALUES
  ('yb_version',                    '2.20.1.0',           'YugabyteDB version to install'),
  ('yb_download_url',               '',                   'URL or local path to the YugabyteDB tarball'),
  ('yb_install_dir',                '/opt/yugabyte',      'Directory where YugabyteDB binaries are installed'),
  ('yb_data_dir',                   '/data/yugabyte',     'Directory for YugabyteDB data files'),
  ('default_ssh_user',              'ubuntu',             'Default OS user created on provisioned VMs'),
  ('default_ssh_public_key',        '',                   'SSH public key injected into new VMs via cloud-init'),
  ('dns_server',                    '8.8.8.8',            'DNS server IP for VM cloud-init configuration'),
  ('ntp_server',                    'pool.ntp.org',       'NTP server for VM clock synchronization'),
  ('ansible_user',                  'ubuntu',             'SSH user for Ansible connections to VMs'),
  ('ansible_ssh_private_key_path',  '/opt/yb-manager/keys/id_rsa', 'Path to SSH private key for Ansible'),
  ('ansible_timeout',               '60',                 'Ansible connection timeout in seconds'),
  ('vm_network_prefix',             '192.168.1',          'IP network prefix for auto-assigned VM IPs'),
  ('vm_gateway',                    '192.168.1.1',        'Default gateway for VM network configuration'),
  ('default_vswitch',               'Default Switch',     'Default Hyper-V virtual switch name')
ON CONFLICT (key) DO NOTHING;
