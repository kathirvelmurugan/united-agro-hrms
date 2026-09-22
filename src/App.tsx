import { useState, useEffect, useRef } from 'react';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import AllBranchesPage from './components/AllBranchesPage';
import EmployeesPage from './components/EmployeesPage';
import AttendancePage from './components/AttendancePage';
import UnitsPage from './components/UnitsPage';
import ActivityInsightsPage from './components/ActivityInsightsPage';
import AnalyticsPage from './components/AnalyticsPage';
import AiInsightsPage from './components/AiInsightsPage';
import PatternsPage from './components/PatternsPage';
import BackupPage from './components/BackupPage';
import AdminPage from './components/AdminPage';
import ServerHealthModal from './components/ServerHealthModal';
import AdminCommandPalette from './components/AdminCommandPalette';
import SidebarLayout, { type MenuKey } from './components/SidebarLayout';
import { AiChatProvider } from './components/AiChat';
import { Construction } from 'lucide-react';

type Page = 'login' | 'admin';

const STORAGE_KEY = 'ua_session_user';
const MENU_KEY = 'ua_menu';
const PAGE_KEY = 'ua_page';

function loadMenu(): MenuKey {
  try {
    const v = sessionStorage.getItem(MENU_KEY);
    const known: MenuKey[] = ['dashboard', 'employees', 'attendance', 'units', 'activity', 'ai', 'patterns', 'analytics', 'backup'];
    return v && known.includes(v as MenuKey) ? (v as MenuKey) : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

function loadPage(): Page {
  try {
    const v = sessionStorage.getItem(PAGE_KEY);
    return v === 'admin' ? 'admin' : 'login';
  } catch {
    return 'login';
  }
}

function loadUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u && u.username ? u : null;
  } catch {
    return null;
  }
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f4f8] text-center p-8">
      <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center mb-3">
        <Construction size={26} className="text-brand-600" />
      </div>
      <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
      <p className="text-sm text-gray-400 mt-1 max-w-sm">
        This module is part of the HRMS Portal layout. It can be built next when needed.
      </p>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>(loadPage);
  const [user, setUser] = useState<{ username: string; role: string; label: string; deviceId: number | null } | null>(loadUser);
  const [statusFilter, setStatusFilter] = useState('all');
  const [menu, setMenu] = useState<MenuKey>(loadMenu);
  const [healthOpen, setHealthOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin';

  // Keep the latest user available to the global key handler without
  // re-binding the listener on every auth change (avoiding a stale closure).
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setHealthOpen(o => !o);
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        const role = userRef.current?.role;
        if (role === 'superadmin' || role === 'admin') {
          e.preventDefault();
          e.stopPropagation();
          setPaletteOpen(o => !o);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleNavigate(next: MenuKey) {
    setMenu(next);
    sessionStorage.setItem(MENU_KEY, next);
  }

  function handleLogin(username: string, role: string, label: string, deviceId: number | null) {
    const next = { username, role, label, deviceId };
    setUser(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setStatusFilter('all');
    setMenu('dashboard');
    setPage('login');
    sessionStorage.setItem(PAGE_KEY, 'login');
  }

  function handleLogout() {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    setPage('login');
    sessionStorage.setItem(PAGE_KEY, 'login');
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (page === 'admin') {
    return (
      <AdminPage
        label={user.label}
        role={user.role}
        deviceId={user.deviceId}
        onLogout={handleLogout}
        onBack={() => { setPage('login'); sessionStorage.setItem(PAGE_KEY, 'login'); }}
      />
    );
  }

  const isManager = user.role !== 'superadmin' && user.role !== 'admin';
  if (isManager && menu !== 'dashboard' && menu !== 'employees') {
    setMenu('dashboard');
    sessionStorage.setItem(MENU_KEY, 'dashboard');
  }

  const canOverview = user.role === 'superadmin' || (user.role === 'admin' && !user.deviceId);

  const pageTitle: Record<string, string> = {
    ai: 'AI Insights', activity: 'Activity Insights',
  };

  let content: React.ReactNode;
  if (menu === 'dashboard') {
    content = canOverview
      ? <AllBranchesPage />
      : <Dashboard role={user.role} deviceId={user.deviceId} statusFilter={statusFilter} onFilterChange={setStatusFilter} />;
  } else if (menu === 'employees') {
    content = <EmployeesPage deviceId={isManager ? user.deviceId : null} />;
  } else if (menu === 'attendance') {
    content = <AttendancePage />;
  } else if (menu === 'units') {
    content = <UnitsPage />;
  } else if (menu === 'activity') {
    content = <ActivityInsightsPage />;
  } else if (menu === 'ai') {
    content = <AiInsightsPage />;
  } else if (menu === 'patterns') {
    content = <PatternsPage />;
  } else if (menu === 'analytics') {
    content = <AnalyticsPage />;
  } else if (menu === 'backup') {
    content = <BackupPage />;
  } else {
    content = <Placeholder title={pageTitle[menu] ?? 'Module'} />;
  }

  return (
    <>
      <AiChatProvider>
        <SidebarLayout
          label={user.label}
          role={user.role}
          active={menu}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
          onAdmin={() => { setPage('admin'); sessionStorage.setItem(PAGE_KEY, 'admin'); }}
        >
          {content}
        </SidebarLayout>
      </AiChatProvider>
      <ServerHealthModal open={healthOpen} onClose={() => setHealthOpen(false)} />
      {isAdmin && (
        <AdminCommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onCheckServer={() => setHealthOpen(true)}
        />
      )}
    </>
  );
}

