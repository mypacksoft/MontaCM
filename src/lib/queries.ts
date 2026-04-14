import { get, post, patch } from './api';
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
  list: () => get<PhysicalHost[]>('/physical_hosts', { order: 'name.asc' }),
  get: (id: string) => get<PhysicalHost[]>(`/physical_hosts`, { id: `eq.${id}` }).then(r => r[0]),
  create: (data: Partial<PhysicalHost>) => post<PhysicalHost[]>('/physical_hosts', data).then(r => r[0]),
  update: (id: string, data: Partial<PhysicalHost>) =>
    patch<PhysicalHost[]>('/physical_hosts', data, { id: `eq.${id}` }).then(r => r[0]),
  testConnection: (hostId: string) =>
    post<AutomationJob[]>('/automation_jobs', {
      type: 'test_host',
      status: 'queued',
      physical_host_id: hostId,
      payload: {},
      triggered_by: 'user',
    }).then(r => r[0]),
};

export const vmsApi = {
  list: (filters?: Record<string, string>) =>
    get<VM[]>('/vms', { order: 'name.asc', ...filters }),
  get: (id: string) => get<VM[]>('/vms', { id: `eq.${id}` }).then(r => r[0]),
  create: (data: Partial<VM>) => post<VM[]>('/vms', data).then(r => r[0]),
  update: (id: string, data: Partial<VM>) =>
    patch<VM[]>('/vms', data, { id: `eq.${id}` }).then(r => r[0]),
  requestCreate: (hostId: string, vmConfig: Record<string, unknown>) =>
    post<AutomationJob[]>('/automation_jobs', {
      type: 'create_vm',
      status: 'queued',
      physical_host_id: hostId,
      payload: vmConfig,
      triggered_by: 'user',
    }).then(r => r[0]),
  requestAction: (vmId: string, action: 'start_vm' | 'stop_vm' | 'delete_vm') =>
    post<AutomationJob[]>('/automation_jobs', {
      type: action,
      status: 'queued',
      vm_id: vmId,
      payload: {},
      triggered_by: 'user',
    }).then(r => r[0]),
};

export const clustersApi = {
  list: () => get<YugabyteCluster[]>('/yugabyte_clusters', { order: 'name.asc' }),
  get: (id: string) => get<YugabyteCluster[]>('/yugabyte_clusters', { id: `eq.${id}` }).then(r => r[0]),
  create: (data: Partial<YugabyteCluster>) =>
    post<YugabyteCluster[]>('/yugabyte_clusters', data).then(r => r[0]),
  nodes: (clusterId: string) =>
    get<YugabyteNode[]>('/yugabyte_nodes', { cluster_id: `eq.${clusterId}`, order: 'created_at.asc' }),
  addNode: (clusterId: string, vmId: string, role: string) =>
    post<AutomationJob[]>('/automation_jobs', {
      type: 'join_cluster',
      status: 'queued',
      cluster_id: clusterId,
      vm_id: vmId,
      payload: { role },
      triggered_by: 'user',
    }).then(r => r[0]),
};

export const jobsApi = {
  list: (filters?: Record<string, string>) =>
    get<AutomationJob[]>('/automation_jobs', {
      order: 'created_at.desc',
      limit: '100',
      ...filters,
    }),
  get: (id: string) => get<AutomationJob[]>('/automation_jobs', { id: `eq.${id}` }).then(r => r[0]),
  logs: (jobId: string) =>
    get<JobLog[]>('/job_logs', { job_id: `eq.${jobId}`, order: 'created_at.asc' }),
};

export const configApi = {
  list: () => get<SystemConfig[]>('/system_config', { order: 'key.asc' }),
  update: (key: string, value: string) =>
    patch<SystemConfig[]>('/system_config', { value }, { key: `eq.${key}` }).then(r => r[0]),
};
