import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Database, Plus, ExternalLink, Server } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { clustersApi, vmsApi } from '../lib/queries';
import { usePolling } from '../hooks/usePolling';
import type { YugabyteCluster, VM } from '../types';

function CreateClusterModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    name: '',
    replication_factor: '3',
    ysql_port: '5433',
    ycql_port: '9042',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await clustersApi.create({
        name: form.name,
        replication_factor: parseInt(form.replication_factor),
        ysql_port: parseInt(form.ysql_port),
        ycql_port: parseInt(form.ycql_port),
        status: 'initializing',
        master_count: 0,
        tserver_count: 0,
      });
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cluster');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create YugabyteDB Cluster" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Cluster Name</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="production-cluster"
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Replication Factor</label>
          <div className="grid grid-cols-3 gap-2">
            {[1, 3, 5].map(rf => (
              <button
                key={rf}
                type="button"
                onClick={() => setForm(f => ({ ...f, replication_factor: String(rf) }))}
                className={`py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                  form.replication_factor === String(rf)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                RF={rf}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            RF=3 requires at least 3 nodes. RF=1 is for dev/test only.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">YSQL Port</label>
            <input
              type="number"
              required
              value={form.ysql_port}
              onChange={e => setForm(f => ({ ...f, ysql_port: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">YCQL Port</label>
            <input
              type="number"
              required
              value={form.ycql_port}
              onChange={e => setForm(f => ({ ...f, ycql_port: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Cluster'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddNodeModal({
  cluster,
  onClose,
  onSave,
}: {
  cluster: YugabyteCluster;
  onClose: () => void;
  onSave: () => void;
}) {
  const [vms, setVMs] = useState<VM[]>([]);
  const [form, setForm] = useState({ vm_id: '', role: 'master+tserver' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadVMs = useCallback(async () => {
    const data = await vmsApi.list({ status: 'eq.running', os_installed: 'eq.true', cluster_id: 'is.null' });
    setVMs(data);
  }, []);

  usePolling(loadVMs, 999999, true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await clustersApi.addNode(cluster.id, form.vm_id, form.role);
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add node');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Add Node to ${cluster.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Available VM</label>
          {vms.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">No available VMs (need running VMs with OS installed, not yet in a cluster)</p>
          ) : (
            <select
              required
              value={form.vm_id}
              onChange={e => setForm(f => ({ ...f, vm_id: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Select VM...</option>
              {vms.map(vm => (
                <option key={vm.id} value={vm.id}>{vm.name} ({vm.ip_address ?? 'no IP'})</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Node Role</label>
          <div className="grid grid-cols-3 gap-2">
            {(['master+tserver', 'master', 'tserver'] as const).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setForm(f => ({ ...f, role: r }))}
                className={`py-2 text-xs font-medium rounded-xl border transition-colors ${
                  form.role === r
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || vms.length === 0 || !form.vm_id}
            className="px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Queuing...' : 'Add Node'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClusterCard({ cluster, onAddNode }: { cluster: YugabyteCluster; onAddNode: (c: YugabyteCluster) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-50">
            <Database className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{cluster.name}</p>
            {cluster.version && <p className="text-xs text-slate-400">v{cluster.version}</p>}
          </div>
        </div>
        <StatusBadge status={cluster.status} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center p-2 rounded-xl bg-slate-50">
          <p className="text-xl font-bold text-slate-900">{cluster.replication_factor}</p>
          <p className="text-xs text-slate-400">RF</p>
        </div>
        <div className="text-center p-2 rounded-xl bg-slate-50">
          <p className="text-xl font-bold text-slate-900">{cluster.master_count}</p>
          <p className="text-xs text-slate-400">Masters</p>
        </div>
        <div className="text-center p-2 rounded-xl bg-slate-50">
          <p className="text-xl font-bold text-slate-900">{cluster.tserver_count}</p>
          <p className="text-xs text-slate-400">TServers</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
        <span>YSQL :{cluster.ysql_port}</span>
        <span className="text-slate-300">·</span>
        <span>YCQL :{cluster.ycql_port}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onAddNode(cluster)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add Node
        </button>
        {cluster.master_ui_url && (
          <a
            href={cluster.master_ui_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Master UI
          </a>
        )}
      </div>
    </div>
  );
}

export default function Clusters() {
  const [clusters, setClusters] = useState<YugabyteCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [addNodeTarget, setAddNodeTarget] = useState<YugabyteCluster | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await clustersApi.list();
      setClusters(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 15000);

  return (
    <div>
      <PageHeader
        title="YugabyteDB Clusters"
        subtitle="Manage distributed database clusters"
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Cluster
          </button>
        }
      />

      <div className="px-8 pb-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : clusters.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No clusters yet"
            description="Create a YugabyteDB cluster and add VMs as nodes to build a distributed database."
            action={
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Cluster
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {clusters.map(cluster => (
              <ClusterCard
                key={cluster.id}
                cluster={cluster}
                onAddNode={setAddNodeTarget}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateClusterModal onClose={() => setShowCreate(false)} onSave={load} />
      )}
      {addNodeTarget && (
        <AddNodeModal cluster={addNodeTarget} onClose={() => setAddNodeTarget(null)} onSave={load} />
      )}
    </div>
  );
}
