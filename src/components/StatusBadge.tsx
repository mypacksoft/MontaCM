import type { HostStatus, VMStatus, ClusterStatus, JobStatus } from '../types';

type Status = HostStatus | VMStatus | ClusterStatus | JobStatus;

const config: Record<string, { dot: string; text: string; label: string }> = {
  online:       { dot: 'bg-emerald-400', text: 'text-emerald-700 bg-emerald-50 ring-emerald-200',   label: 'Online' },
  offline:      { dot: 'bg-slate-400',   text: 'text-slate-600 bg-slate-100 ring-slate-200',        label: 'Offline' },
  unreachable:  { dot: 'bg-red-400',     text: 'text-red-700 bg-red-50 ring-red-200',               label: 'Unreachable' },
  unknown:      { dot: 'bg-slate-300',   text: 'text-slate-500 bg-slate-50 ring-slate-200',         label: 'Unknown' },
  running:      { dot: 'bg-emerald-400', text: 'text-emerald-700 bg-emerald-50 ring-emerald-200',   label: 'Running' },
  stopped:      { dot: 'bg-slate-400',   text: 'text-slate-600 bg-slate-100 ring-slate-200',        label: 'Stopped' },
  paused:       { dot: 'bg-amber-400',   text: 'text-amber-700 bg-amber-50 ring-amber-200',         label: 'Paused' },
  starting:     { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-700 bg-blue-50 ring-blue-200', label: 'Starting' },
  stopping:     { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-700 bg-amber-50 ring-amber-200', label: 'Stopping' },
  error:        { dot: 'bg-red-400',     text: 'text-red-700 bg-red-50 ring-red-200',               label: 'Error' },
  healthy:      { dot: 'bg-emerald-400', text: 'text-emerald-700 bg-emerald-50 ring-emerald-200',   label: 'Healthy' },
  degraded:     { dot: 'bg-amber-400',   text: 'text-amber-700 bg-amber-50 ring-amber-200',         label: 'Degraded' },
  unavailable:  { dot: 'bg-red-400',     text: 'text-red-700 bg-red-50 ring-red-200',               label: 'Unavailable' },
  initializing: { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-700 bg-blue-50 ring-blue-200', label: 'Initializing' },
  queued:       { dot: 'bg-slate-400',   text: 'text-slate-600 bg-slate-100 ring-slate-200',        label: 'Queued' },
  success:      { dot: 'bg-emerald-400', text: 'text-emerald-700 bg-emerald-50 ring-emerald-200',   label: 'Success' },
  failed:       { dot: 'bg-red-400',     text: 'text-red-700 bg-red-50 ring-red-200',               label: 'Failed' },
  cancelled:    { dot: 'bg-slate-300',   text: 'text-slate-500 bg-slate-50 ring-slate-200',         label: 'Cancelled' },
};

interface Props {
  status: Status;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'sm' }: Props) {
  const c = config[status] ?? config['unknown'];
  const px = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset ${px} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
