export type HostStatus = 'online' | 'offline' | 'unreachable' | 'unknown';
export type VMStatus = 'running' | 'stopped' | 'paused' | 'starting' | 'stopping' | 'error' | 'unknown';
export type ClusterStatus = 'healthy' | 'degraded' | 'unavailable' | 'initializing' | 'unknown';
export type JobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type JobType =
  | 'test_host'
  | 'create_vm'
  | 'provision_os'
  | 'install_yb'
  | 'join_cluster'
  | 'start_vm'
  | 'stop_vm'
  | 'delete_vm'
  | 'create_cluster'
  | 'remove_node';
export type NodeRole = 'master' | 'tserver' | 'master+tserver';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type OSTemplate = 'ubuntu-22.04' | 'ubuntu-20.04' | 'rocky-8' | 'rocky-9';

export interface PhysicalHost {
  id: string;
  name: string;
  ip_address: string;
  agent_port: number;
  status: HostStatus;
  cpu_cores: number | null;
  ram_gb: number | null;
  disk_gb: number | null;
  cpu_used_pct: number | null;
  ram_used_gb: number | null;
  disk_used_gb: number | null;
  vm_count: number | null;
  os_version: string | null;
  hyperv_version: string | null;
  last_seen: string | null;
  created_at: string;
}

export interface VM {
  id: string;
  name: string;
  physical_host_id: string;
  physical_host?: PhysicalHost;
  status: VMStatus;
  cpu_cores: number;
  ram_gb: number;
  disk_gb: number;
  vswitch_name: string | null;
  ip_address: string | null;
  os_template: OSTemplate | null;
  os_installed: boolean;
  vhdx_path: string | null;
  generation: number;
  cluster_id: string | null;
  role: NodeRole | null;
  created_at: string;
  updated_at: string;
}

export interface YugabyteCluster {
  id: string;
  name: string;
  status: ClusterStatus;
  replication_factor: number;
  master_count: number;
  tserver_count: number;
  version: string | null;
  ysql_port: number;
  ycql_port: number;
  master_ui_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface YugabyteNode {
  id: string;
  cluster_id: string;
  cluster?: YugabyteCluster;
  vm_id: string;
  vm?: VM;
  role: NodeRole;
  is_master_leader: boolean;
  tablet_count: number | null;
  yb_master_running: boolean;
  yb_tserver_running: boolean;
  joined_at: string | null;
  created_at: string;
}

export interface AutomationJob {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string | null;
  physical_host_id: string | null;
  vm_id: string | null;
  cluster_id: string | null;
  triggered_by: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  physical_host?: PhysicalHost;
  vm?: VM;
  cluster?: YugabyteCluster;
}

export interface JobStep {
  id: string;
  job_id: string;
  step_number: number;
  name: string;
  status: JobStatus;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobLog {
  id: string;
  job_id: string;
  step_id: string | null;
  level: LogLevel;
  message: string;
  created_at: string;
}

export interface SystemConfig {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export interface DashboardStats {
  totalHosts: number;
  onlineHosts: number;
  totalVMs: number;
  runningVMs: number;
  totalClusters: number;
  healthyClusters: number;
  activeJobs: number;
  recentJobs: AutomationJob[];
}
