import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Server, Monitor, Database, ClipboardList, TrendingUp, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import { hostsApi } from '../lib/queries';
import { vmsApi } from '../lib/queries';
import { clustersApi } from '../lib/queries';
import { jobsApi } from '../lib/queries';
import { usePolling } from '../hooks/usePolling';
import type { PhysicalHost, VM, YugabyteCluster, AutomationJob } from '../types';

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  to,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub: string;
  color: string;
  to: string;
}) {
  return (
    <Link to={to} className="block bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-3xl font-bold text-slate-900 tabular-nums">{value}</p>
      <p className="text-sm font-medium text-slate-600 mt-0.5">{label}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </Link>
  );
}

function JobRow({ job }: { job: AutomationJob }) {
  const typeLabel: Record<string, string> = {
    test_host: 'Test Host',
    create_vm: 'Create VM',
    provision_os: 'Provision OS',
    install_yb: 'Install YugabyteDB',
    join_cluster: 'Join Cluster',
    start_vm: 'Start VM',
    stop_vm: 'Stop VM',
    delete_vm: 'Delete VM',
    create_cluster: 'Create Cluster',
    remove_node: 'Remove Node',
  };

  const elapsed = job.started_at && job.finished_at
    ? Math.round((new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000)
    : null;

  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-3">
        <StatusBadge status={job.status} />
        <div>
          <p className="text-sm font-medium text-slate-900">{typeLabel[job.type] ?? job.type}</p>
          <p className="text-xs text-slate-400">{new Date(job.created_at).toLocaleString()}</p>
        </div>
      </div>
      <div className="text-right">
        {elapsed !== null && (
          <p className="text-xs text-slate-400">{elapsed}s</p>
        )}
        <Link to={`/jobs/${job.id}`} className="text-xs text-blue-600 hover:underline">Details</Link>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [hosts, setHosts] = useState<PhysicalHost[]>([]);
  const [vms, setVMs] = useState<VM[]>([]);
  const [clusters, setClusters] = useState<YugabyteCluster[]>([]);
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [h, v, c, j] = await Promise.all([
        hostsApi.list(),
        vmsApi.list(),
        clustersApi.list(),
        jobsApi.list({ limit: '8' }),
      ]);
      setHosts(h);
      setVMs(v);
      setClusters(c);
      setJobs(j);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 15000);

  const onlineHosts = hosts.filter(h => h.status === 'online').length;
  const runningVMs = vms.filter(v => v.status === 'running').length;
  const healthyClusters = clusters.filter(c => c.status === 'healthy').length;
  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'queued').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Infrastructure overview and recent activity"
      />

      <div className="px-8 pb-8 space-y-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Server}
            label="Physical Hosts"
            value={hosts.length}
            sub={`${onlineHosts} online`}
            color="bg-blue-50 text-blue-600"
            to="/hosts"
          />
          <StatCard
            icon={Monitor}
            label="Virtual Machines"
            value={vms.length}
            sub={`${runningVMs} running`}
            color="bg-emerald-50 text-emerald-600"
            to="/vms"
          />
          <StatCard
            icon={Database}
            label="YB Clusters"
            value={clusters.length}
            sub={`${healthyClusters} healthy`}
            color="bg-amber-50 text-amber-600"
            to="/clusters"
          />
          <StatCard
            icon={ClipboardList}
            label="Active Jobs"
            value={activeJobs}
            sub="queued or running"
            color="bg-slate-100 text-slate-600"
            to="/jobs"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Host Health</h2>
              <Link to="/hosts" className="text-xs text-blue-600 hover:underline">View all</Link>
            </div>
            {hosts.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Server className="w-8 h-8 text-slate-200 mb-2" />
                <p className="text-sm text-slate-400">No hosts registered yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {hosts.slice(0, 6).map(host => (
                  <div key={host.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{host.name}</p>
                      <p className="text-xs text-slate-400">{host.ip_address}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {host.vm_count !== null && (
                        <span className="text-xs text-slate-400">{host.vm_count} VMs</span>
                      )}
                      <StatusBadge status={host.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Recent Jobs</h2>
              <Link to="/jobs" className="text-xs text-blue-600 hover:underline">View all</Link>
            </div>
            {jobs.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <ClipboardList className="w-8 h-8 text-slate-200 mb-2" />
                <p className="text-sm text-slate-400">No jobs yet</p>
              </div>
            ) : (
              <div>
                {jobs.map(job => (
                  <JobRow key={job.id} job={job} />
                ))}
              </div>
            )}
          </div>
        </div>

        {clusters.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Cluster Status</h2>
              <Link to="/clusters" className="text-xs text-blue-600 hover:underline">View all</Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clusters.map(cluster => (
                <Link
                  key={cluster.id}
                  to={`/clusters/${cluster.id}`}
                  className="block p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-sm font-semibold text-slate-900">{cluster.name}</p>
                    <StatusBadge status={cluster.status} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-bold text-slate-900">{cluster.replication_factor}</p>
                      <p className="text-xs text-slate-400">RF</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900">{cluster.master_count}</p>
                      <p className="text-xs text-slate-400">Masters</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900">{cluster.tserver_count}</p>
                      <p className="text-xs text-slate-400">TServers</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
