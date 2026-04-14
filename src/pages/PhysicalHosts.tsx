import { useState, useCallback } from 'react';
import { Server, Plus, RefreshCw, Wifi, WifiOff, Cpu, MemoryStick, HardDrive } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import ResourceBar from '../components/ResourceBar';
import { hostsApi } from '../lib/queries';
import { usePolling } from '../hooks/usePolling';
import type { PhysicalHost } from '../types';

function AddHostModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    name: '',
    ip_address: '',
    agent_port: '8765',
    api_key: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await hostsApi.create({
        name: form.name,
        ip_address: form.ip_address,
        agent_port: parseInt(form.agent_port),
        api_key: form.api_key || undefined,
        status: 'unknown',
      });
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add host');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add Physical Host" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Host Name</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="hyperv-host-01"
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">IP Address</label>
          <input
            type="text"
            required
            value={form.ip_address}
            onChange={e => setForm(f => ({ ...f, ip_address: e.target.value }))}
            placeholder="192.168.1.10"
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Agent Port</label>
            <input
              type="number"
              required
              value={form.agent_port}
              onChange={e => setForm(f => ({ ...f, agent_port: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">API Key</label>
            <input
              type="password"
              value={form.api_key}
              onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
              placeholder="from install script"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
          <p className="text-xs text-blue-700 font-medium mb-1">Agent Setup</p>
          <p className="text-xs text-blue-600">
            Run <code className="font-mono bg-blue-100 px-1 py-0.5 rounded">install-agent.ps1</code> on
            the Hyper-V host. The script will print the API key and configure port 8765.
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Adding...' : 'Add Host'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function HostCard({ host, onTestConnection }: { host: PhysicalHost; onTestConnection: (id: string) => void }) {
  const cpuPct = host.cpu_used_pct ?? 0;
  const ramUsed = host.ram_used_gb ?? 0;
  const ramTotal = host.ram_gb ?? 0;
  const diskUsed = host.disk_used_gb ?? 0;
  const diskTotal = host.disk_gb ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-100">
            <Server className="w-5 h-5 text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{host.name}</p>
            <p className="text-xs text-slate-400 font-mono">{host.ip_address}:{host.agent_port}</p>
          </div>
        </div>
        <StatusBadge status={host.status} />
      </div>

      {host.os_version && (
        <p className="text-xs text-slate-500 mb-3">{host.os_version}</p>
      )}

      <div className="space-y-2.5 mb-4">
        <ResourceBar label="CPU" used={cpuPct} total={100} unit="%" showValues={host.cpu_used_pct !== null} />
        <ResourceBar label="RAM" used={ramUsed} total={ramTotal} unit=" GB" showValues={ramTotal > 0} />
        <ResourceBar label="Disk" used={diskUsed} total={diskTotal} unit=" GB" showValues={diskTotal > 0} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {host.cpu_cores && (
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              {host.cpu_cores} cores
            </span>
          )}
          {host.vm_count !== null && (
            <span className="flex items-center gap-1">
              <Server className="w-3 h-3" />
              {host.vm_count} VMs
            </span>
          )}
        </div>
        <button
          onClick={() => onTestConnection(host.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
        >
          <Wifi className="w-3 h-3" />
          Test
        </button>
      </div>

      {host.last_seen && (
        <p className="text-xs text-slate-400 mt-2">
          Last seen {new Date(host.last_seen).toLocaleString()}
        </p>
      )}
    </div>
  );
}

export default function PhysicalHosts() {
  const [hosts, setHosts] = useState<PhysicalHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await hostsApi.list();
      setHosts(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 15000);

  const handleTestConnection = async (hostId: string) => {
    setTesting(hostId);
    try {
      await hostsApi.testConnection(hostId);
    } catch {
    } finally {
      setTesting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Physical Hosts"
        subtitle="Hyper-V hosts registered as compute nodes"
        action={
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Host
          </button>
        }
      />

      <div className="px-8 pb-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : hosts.length === 0 ? (
          <EmptyState
            icon={Server}
            title="No hosts registered"
            description="Add your first Hyper-V host to start managing virtual machines and deploying YugabyteDB clusters."
            action={
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Host
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {hosts.map(host => (
              <HostCard
                key={host.id}
                host={host}
                onTestConnection={handleTestConnection}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddHostModal onClose={() => setShowAdd(false)} onSave={load} />
      )}
    </div>
  );
}
