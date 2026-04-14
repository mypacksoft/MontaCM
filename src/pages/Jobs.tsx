import { useState, useCallback, useEffect } from 'react';
import { ClipboardList, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { jobsApi } from '../lib/queries';
import { usePolling } from '../hooks/usePolling';
import type { AutomationJob, JobLog } from '../types';

const JOB_TYPE_LABELS: Record<string, string> = {
  test_host:    'Test Host Connection',
  create_vm:    'Create VM',
  provision_os: 'Provision OS',
  install_yb:   'Install YugabyteDB',
  join_cluster: 'Join Cluster',
  start_vm:     'Start VM',
  stop_vm:      'Stop VM',
  delete_vm:    'Delete VM',
  create_cluster: 'Create Cluster',
  remove_node:  'Remove Node',
};

const LOG_COLORS: Record<string, string> = {
  debug: 'text-slate-400',
  info:  'text-slate-700',
  warn:  'text-amber-600',
  error: 'text-red-600',
};

function JobDetails({ job }: { job: AutomationJob }) {
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    try {
      const data = await jobsApi.logs(job.id);
      setLogs(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [job.id]);

  const isActive = job.status === 'running' || job.status === 'queued';
  usePolling(loadLogs, 3000, isActive);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const elapsed = job.started_at && job.finished_at
    ? Math.round((new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000)
    : job.started_at && !job.finished_at
    ? Math.round((Date.now() - new Date(job.started_at).getTime()) / 1000)
    : null;

  return (
    <div className="bg-slate-950 rounded-b-xl px-4 py-4 border-x border-b border-slate-200">
      <div className="flex items-center gap-4 mb-3 text-xs text-slate-400">
        {job.triggered_by && <span>By: {job.triggered_by}</span>}
        {job.started_at && <span>Started: {new Date(job.started_at).toLocaleTimeString()}</span>}
        {elapsed !== null && <span>Duration: {elapsed}s{isActive ? '...' : ''}</span>}
        {job.error_message && (
          <span className="text-red-400 ml-auto">{job.error_message}</span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <div className="h-4 w-4 border border-slate-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <p className="text-xs text-slate-500 py-2">No log output yet</p>
      ) : (
        <div className="space-y-0.5 font-mono max-h-64 overflow-y-auto">
          {logs.map(log => (
            <div key={log.id} className="flex gap-3 text-xs leading-relaxed">
              <span className="text-slate-600 flex-shrink-0 tabular-nums">
                {new Date(log.created_at).toLocaleTimeString('en', { hour12: false })}
              </span>
              <span className={`uppercase flex-shrink-0 w-9 ${LOG_COLORS[log.level] ?? 'text-slate-400'}`}>
                [{log.level.slice(0, 4).toUpperCase()}]
              </span>
              <span className={LOG_COLORS[log.level] ?? 'text-slate-400'}>{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: AutomationJob }) {
  const [expanded, setExpanded] = useState(job.status === 'running' || job.status === 'failed');

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden mb-2">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 transition-colors text-left"
      >
        <StatusBadge status={job.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900">{JOB_TYPE_LABELS[job.type] ?? job.type}</p>
          <p className="text-xs text-slate-400 mt-0.5">{new Date(job.created_at).toLocaleString()}</p>
        </div>
        <div className="flex-shrink-0 text-slate-300">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>
      {expanded && <JobDetails job={job} />}
    </div>
  );
}

export default function Jobs() {
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: '100' };
      if (filterStatus) params.status = `eq.${filterStatus}`;
      const data = await jobsApi.list(params);
      setJobs(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  usePolling(load, 5000);

  const hasActive = jobs.some(j => j.status === 'running' || j.status === 'queued');

  return (
    <div>
      <PageHeader
        title="Automation Jobs"
        subtitle="History and status of all automation tasks"
        action={
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        }
      />

      <div className="px-8 pb-8">
        <div className="flex items-center gap-3 mb-4">
          {[
            { value: '',          label: 'All' },
            { value: 'running',   label: 'Running' },
            { value: 'queued',    label: 'Queued' },
            { value: 'success',   label: 'Success' },
            { value: 'failed',    label: 'Failed' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilterStatus(value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                filterStatus === value
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
          {hasActive && (
            <span className="ml-2 flex items-center gap-1.5 text-xs text-blue-600">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
              Live updates active
            </span>
          )}
          <span className="ml-auto text-xs text-slate-400">{jobs.length} jobs</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No jobs"
            description="Automation jobs will appear here when you create VMs, add cluster nodes, or perform other operations."
          />
        ) : (
          <div>
            {jobs.map(job => (
              <JobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
