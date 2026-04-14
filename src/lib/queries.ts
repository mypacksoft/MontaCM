import { supabase } from './supabase';
import type {
  PhysicalHost,
  VM,
  YugabyteCluster,
  YugabyteNode,
  AutomationJob,
  JobLog,
  SystemConfig,
} from '../types';

async function throwOnError<T>(promise: { data: T | null; error: unknown }): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  return data as T;
}

export const hostsApi = {
  list: () =>
    throwOnError(supabase.from('physical_hosts').select('*').order('name')),

  get: (id: string) =>
    throwOnError(supabase.from('physical_hosts').select('*').eq('id', id).maybeSingle()),

  create: (data: Partial<PhysicalHost> & { api_key?: string }) =>
    throwOnError(
      supabase.from('physical_hosts').insert(data).select().single()
    ) as Promise<PhysicalHost>,

  update: (id: string, data: Partial<PhysicalHost> & { api_key?: string }) =>
    throwOnError(
      supabase.from('physical_hosts').update(data).eq('id', id).select().single()
    ) as Promise<PhysicalHost>,

  testConnection: (hostId: string) =>
    throwOnError(
      supabase.from('automation_jobs').insert({
        type: 'test_host',
        status: 'queued',
        physical_host_id: hostId,
        payload: {},
        triggered_by: 'user',
      }).select().single()
    ) as Promise<AutomationJob>,
};

export const vmsApi = {
  list: (filters?: Record<string, string>) => {
    let q = supabase.from('vms').select('*').order('name');
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        const match = v.match(/^eq\.(.+)$/);
        if (match) q = q.eq(k, match[1]) as typeof q;
      });
    }
    return throwOnError(q) as Promise<VM[]>;
  },

  get: (id: string) =>
    throwOnError(supabase.from('vms').select('*').eq('id', id).maybeSingle()) as Promise<VM>,

  create: (data: Partial<VM>) =>
    throwOnError(supabase.from('vms').insert(data).select().single()) as Promise<VM>,

  update: (id: string, data: Partial<VM>) =>
    throwOnError(supabase.from('vms').update(data).eq('id', id).select().single()) as Promise<VM>,

  requestCreate: (hostId: string, vmConfig: Record<string, unknown>) =>
    throwOnError(
      supabase.from('automation_jobs').insert({
        type: 'create_vm',
        status: 'queued',
        physical_host_id: hostId,
        payload: vmConfig,
        triggered_by: 'user',
      }).select().single()
    ) as Promise<AutomationJob>,

  requestAction: (vmId: string, action: 'start_vm' | 'stop_vm' | 'delete_vm') =>
    throwOnError(
      supabase.from('automation_jobs').insert({
        type: action,
        status: 'queued',
        vm_id: vmId,
        payload: {},
        triggered_by: 'user',
      }).select().single()
    ) as Promise<AutomationJob>,
};

export const clustersApi = {
  list: () =>
    throwOnError(supabase.from('yugabyte_clusters').select('*').order('name')) as Promise<YugabyteCluster[]>,

  get: (id: string) =>
    throwOnError(supabase.from('yugabyte_clusters').select('*').eq('id', id).maybeSingle()) as Promise<YugabyteCluster>,

  create: (data: Partial<YugabyteCluster>) =>
    throwOnError(supabase.from('yugabyte_clusters').insert(data).select().single()) as Promise<YugabyteCluster>,

  nodes: (clusterId: string) =>
    throwOnError(supabase.from('yugabyte_nodes').select('*').eq('cluster_id', clusterId).order('created_at')) as Promise<YugabyteNode[]>,

  addNode: (clusterId: string, vmId: string, role: string) =>
    throwOnError(
      supabase.from('automation_jobs').insert({
        type: 'join_cluster',
        status: 'queued',
        cluster_id: clusterId,
        vm_id: vmId,
        payload: { role },
        triggered_by: 'user',
      }).select().single()
    ) as Promise<AutomationJob>,
};

export const jobsApi = {
  list: (filters?: Record<string, string>) => {
    let q = supabase.from('automation_jobs').select('*').order('created_at', { ascending: false }).limit(100);
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        const match = v.match(/^eq\.(.+)$/);
        if (match) q = q.eq(k, match[1]) as typeof q;
      });
    }
    return throwOnError(q) as Promise<AutomationJob[]>;
  },

  get: (id: string) =>
    throwOnError(supabase.from('automation_jobs').select('*').eq('id', id).maybeSingle()) as Promise<AutomationJob>,

  logs: (jobId: string) =>
    throwOnError(supabase.from('job_logs').select('*').eq('job_id', jobId).order('created_at')) as Promise<JobLog[]>,
};

export const configApi = {
  list: () =>
    throwOnError(supabase.from('system_config').select('*').order('key')) as Promise<SystemConfig[]>,

  update: (key: string, value: string) =>
    throwOnError(supabase.from('system_config').update({ value }).eq('key', key).select().single()) as Promise<SystemConfig>,
};
