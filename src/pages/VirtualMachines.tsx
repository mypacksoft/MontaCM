import { useState, useCallback } from 'react';
import { Monitor, Plus, Play, Square, Trash2, Filter } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { vmsApi, hostsApi } from '../lib/queries';
import { usePolling } from '../hooks/usePolling';
import type { VM, PhysicalHost, OSTemplate } from '../types';

const OS_TEMPLATES: { value: OSTemplate; label: string }[] = [
  { value: 'ubuntu-22.04', label: 'Ubuntu 22.04 LTS' },
  { value: 'ubuntu-20.04', label: 'Ubuntu 20.04 LTS' },
  { value: 'rocky-8',      label: 'Rocky Linux 8' },
  { value: 'rocky-9',      label: 'Rocky Linux 9' },
];

function CreateVMModal({
  hosts,
  onClose,
  onSave,
}: {
  hosts: PhysicalHost[];
  onClose: () => void;
  onSave: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    physical_host_id: hosts[0]?.id ?? '',
    cpu_cores: '4',
    ram_gb: '8',
    disk_gb: '100',
    vswitch_name: '',
    os_template: 'ubuntu-22.04' as OSTemplate,
    generation: '2',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await vmsApi.requestCreate(form.physical_host_id, {
        name: form.name,
        cpu_cores: parseInt(form.cpu_cores),
        ram_gb: parseInt(form.ram_gb),
        disk_gb: parseInt(form.disk_gb),
        vswitch_name: form.vswitch_name,
        os_template: form.os_template,
        generation: parseInt(form.generation),
      });
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create VM');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create Virtual Machine" onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">VM Name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="yb-node-01"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Physical Host</label>
            <select
              required
              value={form.physical_host_id}
              onChange={e => setForm(f => ({ ...f, physical_host_id: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {hosts.map(h => (
                <option key={h.id} value={h.id}>{h.name} ({h.ip_address})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">CPU Cores</label>
            <input
              type="number"
              min="1"
              max="64"
              required
              value={form.cpu_cores}
              onChange={e => setForm(f => ({ ...f, cpu_cores: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">RAM (GB)</label>
            <input
              type="number"
              min="1"
              required
              value={form.ram_gb}
              onChange={e => setForm(f => ({ ...f, ram_gb: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Disk (GB)</label>
            <input
              type="number"
              min="20"
              required
              value={form.disk_gb}
              onChange={e => setForm(f => ({ ...f, disk_gb: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Generation</label>
            <select
              value={form.generation}
              onChange={e => setForm(f => ({ ...f, generation: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="2">Gen 2 (UEFI)</option>
              <option value="1">Gen 1 (BIOS)</option>
            </select>
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">OS Template</label>
            <select
              value={form.os_template}
              onChange={e => setForm(f => ({ ...f, os_template: e.target.value as OSTemplate }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {OS_TEMPLATES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">vSwitch Name</label>
            <input
              type="text"
              value={form.vswitch_name}
              onChange={e => setForm(f => ({ ...f, vswitch_name: e.target.value }))}
              placeholder="Default Switch"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
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
            {saving ? 'Queuing...' : 'Create VM'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function VMRow({ vm, onAction }: { vm: VM; onAction: (vmId: string, action: 'start_vm' | 'stop_vm' | 'delete_vm') => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100">
            <Monitor className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">{vm.name}</p>
            {vm.ip_address && <p className="text-xs text-slate-400 font-mono">{vm.ip_address}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={vm.status} />
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">
        {vm.cpu_cores}c / {vm.ram_gb}GB / {vm.disk_gb}GB
      </td>
      <td className="px-4 py-3">
        {vm.os_template ? (
          <span className="text-xs text-slate-500">{vm.os_template}</span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {vm.os_installed ? (
          <span className="text-xs font-medium text-emerald-600">Installed</span>
        ) : (
          <span className="text-xs text-slate-400">Pending</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {vm.status === 'stopped' && (
            <button
              onClick={() => onAction(vm.id, 'start_vm')}
              title="Start VM"
              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {vm.status === 'running' && (
            <button
              onClick={() => onAction(vm.id, 'stop_vm')}
              title="Stop VM"
              className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => { onAction(vm.id, 'delete_vm'); setConfirming(false); }}
                className="px-2 py-1 text-xs font-medium text-white bg-red-500 rounded-lg"
              >
                Confirm
              </button>
              <button onClick={() => setConfirming(false)} className="px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-700">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              title="Delete VM"
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function VirtualMachines() {
  const [vms, setVMs] = useState<VM[]>([]);
  const [hosts, setHosts] = useState<PhysicalHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const [v, h] = await Promise.all([vmsApi.list(), hostsApi.list()]);
      setVMs(v);
      setHosts(h);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 10000);

  const handleAction = async (vmId: string, action: 'start_vm' | 'stop_vm' | 'delete_vm') => {
    try {
      await vmsApi.requestAction(vmId, action);
      await load();
    } catch {
    }
  };

  const filtered = filterStatus ? vms.filter(v => v.status === filterStatus) : vms;

  return (
    <div>
      <PageHeader
        title="Virtual Machines"
        subtitle="All VMs across registered Hyper-V hosts"
        action={
          <button
            onClick={() => setShowCreate(true)}
            disabled={hosts.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create VM
          </button>
        }
      />

      <div className="px-8 pb-8">
        <div className="flex items-center gap-3 mb-4">
          <Filter className="w-4 h-4 text-slate-400" />
          {['', 'running', 'stopped', 'error'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                filterStatus === s
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-400">{filtered.length} VMs</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Monitor}
            title="No virtual machines"
            description="Create your first VM by clicking the button above. Make sure you have at least one Hyper-V host registered."
            action={
              hosts.length > 0 ? (
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Create VM
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">VM</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Resources</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">OS</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">OS Install</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(vm => (
                  <VMRow key={vm.id} vm={vm} onAction={handleAction} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateVMModal hosts={hosts} onClose={() => setShowCreate(false)} onSave={load} />
      )}
    </div>
  );
}
