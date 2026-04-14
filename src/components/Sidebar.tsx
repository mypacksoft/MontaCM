import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  Monitor,
  Database,
  ClipboardList,
  Settings,
  Cpu,
} from 'lucide-react';

const navItems = [
  { to: '/',         icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/hosts',    icon: Server,          label: 'Physical Hosts' },
  { to: '/vms',      icon: Monitor,         label: 'Virtual Machines' },
  { to: '/clusters', icon: Database,        label: 'YB Clusters' },
  { to: '/jobs',     icon: ClipboardList,   label: 'Jobs' },
  { to: '/settings', icon: Settings,        label: 'Settings' },
];

export default function Sidebar() {
  return (
    <aside className="w-60 flex-shrink-0 flex flex-col bg-slate-900 border-r border-slate-800">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-800">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600">
          <Cpu className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white leading-none">YB Manager</p>
          <p className="text-xs text-slate-500 mt-0.5">Infrastructure Control</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-slate-800">
        <p className="text-xs text-slate-600 text-center">v1.0.0 &middot; Internal</p>
      </div>
    </aside>
  );
}
