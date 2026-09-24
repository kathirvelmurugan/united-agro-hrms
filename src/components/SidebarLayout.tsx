import { LayoutDashboard, LogOut, Shield, Sparkles, Users, Clock, Building2, Activity, BarChart3, Fingerprint, Radar, Database } from 'lucide-react';

export type MenuKey =
  | 'ai'
  | 'patterns'
  | 'dashboard'
  | 'employees'
  | 'attendance'
  | 'units'
  | 'activity'
  | 'analytics'
  | 'backup';

export const MENU_ITEMS: { key: MenuKey; label: string; icon: React.ReactNode }[] = [
  { key: 'ai', label: 'AI Insights', icon: <Sparkles size={18} /> },
  { key: 'patterns', label: 'Patterns & Insights', icon: <Radar size={18} /> },
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { key: 'employees', label: 'Employees', icon: <Users size={18} /> },
  { key: 'attendance', label: 'Attendance', icon: <Clock size={18} /> },
  { key: 'units', label: 'Units', icon: <Building2 size={18} /> },
  { key: 'activity', label: 'Activity Insights', icon: <Activity size={18} /> },
  { key: 'analytics', label: 'Owner Analytics', icon: <BarChart3 size={18} /> },
  { key: 'backup', label: 'Backup / Export', icon: <Database size={18} /> },
];

interface SidebarLayoutProps {
  label: string;
  role: string;
  active: MenuKey;
  onNavigate: (key: MenuKey) => void;
  onLogout: () => void;
  onAdmin: () => void;
  children: React.ReactNode;
}

export default function SidebarLayout({
  label, role, active, onNavigate, onLogout, onAdmin, children
}: SidebarLayoutProps) {
  const canAdmin = role === 'superadmin' || role === 'admin';

  return (
    <div className="h-screen w-full bg-[#f0f4f8] flex overflow-hidden">
      <aside className="w-56 lg:w-64 bg-[#0f172a] text-white flex flex-col shrink-0 h-full">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <Fingerprint size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-tight">HRMS Portal</p>
              <p className="text-[11px] text-gray-400 truncate">Biometric Attendance</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {MENU_ITEMS.filter(item => {
            if (role === 'superadmin' || role === 'admin') return true;
            return item.key === 'dashboard' || item.key === 'employees';
          }).map(item => {
            const isActive = active === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all shrink-0 ${
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-gray-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className={isActive ? 'text-white' : 'text-gray-400'}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10 space-y-1">
          <p className="px-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
          {canAdmin && (
            <button onClick={onAdmin}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium text-gray-300 hover:bg-white/5 hover:text-white transition-all shrink-0">
              <Shield size={18} className="text-gray-400" />
              Admin Panel
            </button>
          )}
          <button onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium text-gray-300 hover:bg-red-500/10 hover:text-red-400 transition-all shrink-0">
            <LogOut size={18} className="text-gray-400" />
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-full">
        {children}
      </main>
    </div>
  );
}
