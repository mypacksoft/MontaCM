import { db } from './supabase';
import type {
  PhysicalHost,
  VM,
  YugabyteCluster,
  YugabyteNode,
  AutomationJob,
  JobLog,
  SystemConfig,
} from '../types';

export const hostsApi = {
  list: (): Promise<PhysicalHost[]> =>
    db.select<PhysicalHost>('physical_hosts', { order: { column: 'name' } }),

  get: (id: string): Promise<PhysicalHost | null> =>
    db.selectOne<PhysicalHost>('physical_hosts', id),

  create: (data: Partial<PhysicalHost> & { api_key?: string }): Promise<PhysicalHost> =>
    db.insert<PhysicalHost>('physical_hosts', data),

  update: (id: string, data: Partial<PhysicalHost> & { api_key?: string }): Promise<PhysicalHost> =>
    db.update<PhysicalHost>('physical_hosts', id, data),

  testConnection: (hostId: string): Promise<AutomationJob> =>
    db.insert<AutomationJob>('automation_jobs', {
      type: 'test_host',
      status: 'queued',
      physical_host_id: hostId,
      payload: {},
      triggered_by: 'user',
    }),
};

export const vmsApi = {
  list: (filters?: Record<string, string>): Promise<VM[]> =>
    db.select<VM>('vms', { order: { column: 'name' }, filters }),

  get: (id: string): Promise<VM | null> =>
    db.selectOne<VM>('vms', id),

  create: (data: Partial<VM>): Promise<VM> =>
    db.insert<VM>('vms', data),

  update: (id: string, data: Partial<VM>): Promise<VM> =>
    db.update<VM>('vms', id, data),

  requestCreate: (hostId: string, vmConfig: Record<string, unknown>): Promise<AutomationJob> =>
    db.insert<AutomationJob>('automation_jobs', {
      type: 'create_vm',
      status: 'queued',
      physical_host_id: hostId,
      payload: vmConfig,
      triggered_by: 'user',
    }),

  requestAction: (vmId: string, action: 'start_vm' | 'stop_vm' | 'delete_vm'): Promise<AutomationJob> =>
    db.insert<AutomationJob>('automation_jobs', {
      type: action,
      status: 'queued',
      vm_id: vmId,
      payload: {},
      triggered_by: 'user',
    }),
};

export const clustersApi = {
  list: (): Promise<YugabyteCluster[]> =>
    db.select<YugabyteCluster>('yugabyte_clusters', { order: { column: 'name' } }),

  get: (id: string): Promise<YugabyteCluster | null> =>
    db.selectOne<YugabyteCluster>('yugabyte_clusters', id),

  create: (data: Partial<YugabyteCluster>): Promise<YugabyteCluster> =>
    db.insert<YugabyteCluster>('yugabyte_clusters', data),

  nodes: (clusterId: string): Promise<YugabyteNode[]> =>
    db.select<YugabyteNode>('yugabyte_nodes', {
      filters: { cluster_id: `eq.${clusterId}` },
      order: { column: 'created_at' },
    }),

  addNode: (clusterId: string, vmId: string, role: string): Promise<AutomationJob> =>
    db.insert<AutomationJob>('automation_jobs', {
      type: 'join_cluster',
      status: 'queued',
      cluster_id: clusterId,
      vm_id: vmId,
      payload: { role },
      triggered_by: 'user',
    }),
};

export const jobsApi = {
  list: (filters?: Record<string, string>): Promise<AutomationJob[]> =>
    db.select<AutomationJob>('automation_jobs', {
      order: { column: 'created_at', dir: 'desc' },
      limit: 100,
      filters,
    }),

  get: (id: string): Promise<AutomationJob | null> =>
    db.selectOne<AutomationJob>('automation_jobs', id),

  logs: (jobId: string): Promise<JobLog[]> =>
    db.select<JobLog>('job_logs', {
      filters: { job_id: `eq.${jobId}` },
      order: { column: 'created_at' },
    }),
};

export const configApi = {
  list: (): Promise<SystemConfig[]> =>
    db.select<SystemConfig>('system_config', { order: { column: 'key' } }),

  update: (key: string, value: string): Promise<SystemConfig> =>
    db.updateWhere<SystemConfig>('system_config', { key: `eq.${key}` }, { value }),
};
