import { useState, useCallback, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Eye, EyeOff, Info } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { configApi } from '../lib/queries';
import type { SystemConfig } from '../types';

const CONFIG_GROUPS: { group: string; keys: string[] }[] = [
  {
    group: 'YugabyteDB',
    keys: [
      'yb_version',
      'yb_download_url',
      'yb_install_dir',
      'yb_data_dir',
    ],
  },
  {
    group: 'Ubuntu Autoinstall',
    keys: [
      'ubuntu_iso_path',
      'default_ssh_user',
      'default_ssh_public_key',
      'default_user_password_hash',
      'dns_server',
      'ntp_server',
    ],
  },
  {
    group: 'Ansible',
    keys: [
      'ansible_user',
      'ansible_ssh_private_key_path',
      'ansible_timeout',
    ],
  },
  {
    group: 'Networking',
    keys: [
      'vm_network_prefix',
      'vm_gateway',
      'default_vswitch',
    ],
  },
];

const SENSITIVE_KEYS = new Set([
  'default_ssh_public_key',
  'ansible_ssh_private_key_path',
  'default_user_password_hash',
]);

function ConfigRow({ config, onSave }: { config: SystemConfig; onSave: (key: string, value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(config.value);
  const [saving, setSaving] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);

  const isSensitive = SENSITIVE_KEYS.has(config.key);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(config.key, value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="py-4 border-b border-slate-100 last:border-0">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-sm font-medium text-slate-900 font-mono">{config.key}</p>
          {config.description && (
            <p className="text-xs text-slate-400 mt-0.5">{config.description}</p>
          )}
        </div>
      </div>
      {editing ? (
        <div className="flex items-center gap-2 mt-2">
          {isSensitive ? (
            <textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              rows={3}
              className="flex-1 px-3 py-2 text-sm font-mono rounded-xl border border-blue-300 bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          ) : (
            <input
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              className="flex-1 px-3.5 py-2 text-sm font-mono rounded-xl border border-blue-300 bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(config.value); }}
            className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex-1 flex items-center gap-2">
            {config.value ? (
              <code className={`text-xs bg-slate-100 px-2 py-1 rounded-lg text-slate-700 ${isSensitive && !showSensitive ? 'blur-sm select-none' : ''}`}>
                {config.value.length > 80 ? config.value.slice(0, 80) + '...' : config.value}
              </code>
            ) : (
              <span className="text-xs text-slate-400 italic">not set</span>
            )}
            {isSensitive && config.value && (
              <button
                onClick={() => setShowSensitive(s => !s)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                {showSensitive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await configApi.list();
      setConfigs(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (key: string, value: string) => {
    await configApi.update(key, value);
    await load();
  };

  const getConfig = (key: string) => configs.find(c => c.key === key);

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="System configuration for automation and deployments"
      />

      <div className="px-8 pb-8 space-y-6">
        <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-blue-700">
            These settings are used by the automation daemon when running jobs. Changes take effect on the next job run.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          CONFIG_GROUPS.map(({ group, keys }) => {
            const groupConfigs = keys.map(k => getConfig(k)).filter(Boolean) as SystemConfig[];
            if (groupConfigs.length === 0) return null;
            return (
              <div key={group} className="bg-white rounded-2xl border border-slate-200">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="text-sm font-semibold text-slate-900">{group}</h2>
                </div>
                <div className="px-5">
                  {groupConfigs.map(cfg => (
                    <ConfigRow key={cfg.key} config={cfg} onSave={handleSave} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
