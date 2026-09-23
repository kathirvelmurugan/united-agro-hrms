import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { LogOut, ArrowLeft, Shield, Trash2, Plus, RefreshCw, Users, Clock, CalendarPlus, Loader2, AlertCircle, Search, Pencil, X } from 'lucide-react';
import { API_URL } from '../data/mockData';

interface AdminPageProps {
  label: string;
  role: string;
  deviceId: number | null;
  onLogout: () => void;
  onBack: () => void;
}

interface UserEntry {
  username: string;
  role: string;
  label: string;
  device_id: number | null;
  location: string;
}

interface UserForm {
  email: string;
  password: string;
  label: string;
  role: string;
  device_id: number;
}

interface LocationOption {
  device_id: number;
  name: string;
  location: string;
}

interface Emp {
  empid: number;
  name: string;
  badge: string;
  codeInDevice: string;
}

interface ShiftRule {
  id: number;
  device_id: number;
  type: string;
  name: string | null;
  start: string;
  end: string;
  empid: number | null;
  start_date: string | null;
  end_date: string | null;
  weekdays: number[] | null;
}

const SHIFT_PRESETS = [
  { key: 'G', label: 'General', time: '09:00 – 18:00', start: '09:00', end: '18:00', color: 'border-gray-300 bg-gray-50 text-gray-700', active: 'border-gray-500 bg-gray-100 text-gray-800 ring-2 ring-gray-300' },
  { key: '1st', label: '1st Shift', time: '06:00 – 14:00', start: '06:00', end: '14:00', color: 'border-blue-200 bg-blue-50 text-blue-700', active: 'border-blue-500 bg-blue-100 text-blue-800 ring-2 ring-blue-300' },
  { key: '2nd', label: '2nd Shift', time: '14:00 – 22:00', start: '14:00', end: '22:00', color: 'border-purple-200 bg-purple-50 text-purple-700', active: 'border-purple-500 bg-purple-100 text-purple-800 ring-2 ring-purple-300' },
  { key: 'Night', label: 'Night', time: '21:00 – 06:00', start: '21:00', end: '06:00', color: 'border-orange-200 bg-orange-50 text-orange-700', active: 'border-orange-500 bg-orange-100 text-orange-800 ring-2 ring-orange-300' },
  { key: 'Custom', label: 'Custom', time: 'Your times', start: '', end: '', color: 'border-emerald-200 bg-emerald-50 text-emerald-700', active: 'border-emerald-500 bg-emerald-100 text-emerald-800 ring-2 ring-emerald-300' },
];

export default function AdminPage({ label, role, deviceId, onLogout, onBack }: AdminPageProps) {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<UserForm>({ email: '', password: '', label: '', role: 'manager', device_id: 24 });
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ password: '', label: '', role: 'manager', device_id: 24 });

  // Shift management state
  const [shiftDevice, setShiftDevice] = useState<number>(deviceId ?? 24);
  const [userDeviceFilter, setUserDeviceFilter] = useState<number>(0);
  const [empList, setEmpList] = useState<Emp[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmps, setSelectedEmps] = useState<Set<number>>(new Set());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [activePreset, setActivePreset] = useState('G');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [shiftRules, setShiftRules] = useState<ShiftRule[]>([]);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftMsg, setShiftMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null);
  const [editingShiftId, setEditingShiftId] = useState<number | null>(null);
  const [adminTab, setAdminTab] = useState<'employees' | 'users' | 'shifts'>('employees');

  const canManageAll = role === 'superadmin' || role === 'admin';
  const isSuper = role === 'superadmin';
  const defaultDeviceId = canManageAll ? 24 : (deviceId ?? 24);

  // Left panel – Employee edit/delete/add
  const [adminEmps, setAdminEmps] = useState<any[]>([]);
  const [adminEmpSearch, setAdminEmpSearch] = useState('');
  const [adminEmpDevice, setAdminEmpDevice] = useState<number>(0);
  const [adminEmpLoading, setAdminEmpLoading] = useState(false);
  const [editingEmpId, setEditingEmpId] = useState<number | null>(null);
  const [editEmpForm, setEditEmpForm] = useState({ name: '', badge: '', device_id: 24 });
  const [addEmpForm, setAddEmpForm] = useState({ name: '', badge: '', device_id: 24, empid: '' });
  const [adminEmpMsg, setAdminEmpMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [deletingEmpId, setDeletingEmpId] = useState<number | null>(null);

  const fetchAdminEmps = useCallback(async () => {
    setAdminEmpLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/admin/employees?key=admin123`);
      if (r.ok) {
        const d = await r.json();
        setAdminEmps(d.employees || []);
      }
    } catch {}
    setAdminEmpLoading(false);
  }, []);
  useEffect(() => { fetchAdminEmps(); }, [fetchAdminEmps]);
  const filteredAdminEmps = useMemo(() => {
    let list = adminEmps;
    if (adminEmpDevice) list = list.filter(e => e.device_id === adminEmpDevice);
    if (adminEmpSearch.trim()) {
      const q = adminEmpSearch.trim().toLowerCase();
      list = list.filter(e => (e.name || '').toLowerCase().includes(q) || String(e.badge || '').includes(q) || String(e.empid || '').includes(q) || String(e.code_in_device || '').includes(q));
    }
    const seen = new Set<number>();
    const unique: typeof list = [];
    for (const e of list) { if (!seen.has(e.empid)) { seen.add(e.empid); unique.push(e); } }
    return unique;
  }, [adminEmps, adminEmpSearch, adminEmpDevice]);
  async function handleDeleteAdminEmp(empid: number, name: string) {
    if (!confirm(`Delete employee "${name}" (#${empid})?`)) return;
    setDeletingEmpId(empid);
    try {
      const r = await fetch(`${API_URL}/api/admin/employee?key=admin123`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empid }) });
      const d = await r.json().catch(() => ({} as any));
      if (r.ok) { setAdminEmpMsg({ type: 'ok', text: `"${name}" deleted` }); fetchAdminEmps(); }
      else setAdminEmpMsg({ type: 'err', text: (d as any).error || 'Delete failed' });
    } catch { setAdminEmpMsg({ type: 'err', text: 'Failed to connect' }); }
    finally { setDeletingEmpId(null); }
  }
  function startEditEmp(e: any) { setEditingEmpId(e.empid); setEditEmpForm({ name: e.name || '', badge: String(e.badge || ''), device_id: e.device_id || 24 }); }
  async function handleSaveEditEmp(e: React.FormEvent) {
    e.preventDefault();
    if (editingEmpId == null) return;
    try {
      const del = await fetch(`${API_URL}/api/admin/employee?key=admin123`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empid: editingEmpId }) });
      if (!del.ok) { const dj = await del.json().catch(() => ({} as any)); setAdminEmpMsg({ type: 'err', text: (dj as any).error || 'Delete failed' }); return; }
      const add = await fetch(`${API_URL}/api/admin/employee?key=admin123`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editEmpForm.name.trim(), badge: editEmpForm.badge.trim(), empid: editingEmpId, device_id: editEmpForm.device_id }) });
      const aj = await add.json().catch(() => ({} as any));
      if (add.ok) { setAdminEmpMsg({ type: 'ok', text: `Updated "${editEmpForm.name}"` }); setEditingEmpId(null); fetchAdminEmps(); }
      else { setAdminEmpMsg({ type: 'err', text: (aj as any).error || 'Re-create failed' }); fetchAdminEmps(); }
    } catch { setAdminEmpMsg({ type: 'err', text: 'Failed to connect' }); }
  }
  async function handleAddAdminEmp(e: React.FormEvent) {
    e.preventDefault();
    if (!addEmpForm.name.trim() || !addEmpForm.badge.trim()) { setAdminEmpMsg({ type: 'err', text: 'Name and Badge required' }); return; }
    try {
      const body: any = { name: addEmpForm.name.trim(), badge: addEmpForm.badge.trim(), device_id: addEmpForm.device_id };
      if (addEmpForm.empid.trim()) body.empid = parseInt(addEmpForm.empid.trim());
      const r = await fetch(`${API_URL}/api/admin/employee?key=admin123`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({} as any));
      if (r.ok) { setAdminEmpMsg({ type: 'ok', text: `Added "${addEmpForm.name}"` }); setAddEmpForm({ name: '', badge: '', device_id: addEmpForm.device_id, empid: '' }); fetchAdminEmps(); }
      else setAdminEmpMsg({ type: 'err', text: (d as any).error || 'Failed to add' });
    } catch { setAdminEmpMsg({ type: 'err', text: 'Failed to connect' }); }
  }

  async function fetchUsers() {
    try {
      const r = await fetch(`${API_URL}/api/users?key=admin123`);
      if (r.ok) setUsers(await r.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function fetchLocations() {
    try {
      const r = await fetch(`${API_URL}/api/locations`);
      if (r.ok) {
        const list: LocationOption[] = await r.json();
        setLocations(list);
        setForm(f => ({ ...f, device_id: canManageAll ? f.device_id : (deviceId ?? list[0]?.device_id ?? 24) }));
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchUsers();
    fetchLocations();
  }, []);

  // Shift management functions
  const loadShiftRules = useCallback(() => {
    fetch(`${API_URL}/api/rules?key=admin123`)
      .then(r => r.ok ? r.json() : { rules: [] })
      .then((d: any) => setShiftRules((d.rules || []).filter((r: any) => r.type === 'shift' && r.device_id === shiftDevice)))
      .catch(() => setShiftRules([]));
  }, [shiftDevice]);

  useEffect(() => {
    if (adminTab !== 'shifts' || !shiftDevice) return;
    setEmpList([]); setSelectedEmps(new Set()); setEmpSearch('');
    fetch(`${API_URL}/api/admin/employees?key=admin123`)
      .then(r => r.ok ? r.json() : { employees: [] })
      .then((d: any) => {
        const unique = new Map<number, any>();
        (d.employees || []).filter((e: any) => e.device_id === shiftDevice && e.name && !/^\d+$/.test(e.name.trim()))
          .forEach((e: any) => { if (!unique.has(e.empid)) unique.set(e.empid, { empid: e.empid, name: e.name, badge: e.badge, codeInDevice: String(e.code_in_device || e.badge || '').padStart(4, '0') }); });
        setEmpList(Array.from(unique.values()));
      }).catch(() => setEmpList([]));
    loadShiftRules();
  }, [shiftDevice, adminTab, loadShiftRules]);

  const filteredShiftEmps = useMemo(() => {
    if (!empSearch.trim()) return empList;
    const q = empSearch.toLowerCase();
    return empList.filter(e => e.name.toLowerCase().includes(q) || e.badge.includes(q) || e.codeInDevice.includes(q));
  }, [empList, empSearch]);

  const allShiftEmpsSelected = filteredShiftEmps.length > 0 && filteredShiftEmps.every(e => selectedEmps.has(e.empid));

  function toggleAllShiftEmps() { allShiftEmpsSelected ? setSelectedEmps(new Set()) : setSelectedEmps(new Set(filteredShiftEmps.map(e => e.empid))); }
  function toggleShiftEmp(id: number) { setSelectedEmps(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function applyShiftPreset(p: typeof SHIFT_PRESETS[number]) { setActivePreset(p.key); if (p.start) setStartTime(p.start); if (p.end) setEndTime(p.end); }
  function startEditShift(r: ShiftRule) {
    setEditingShiftId(r.id);
    setShiftDevice(r.device_id);
    setStartTime(r.start);
    setEndTime(r.end);
    const found = SHIFT_PRESETS.find(pp => pp.start === r.start && pp.end === r.end);
    setActivePreset(found ? found.key : 'Custom');
    setStartDate(r.start_date || '');
    setEndDate(r.end_date || '');
    if (r.empid) setSelectedEmps(new Set([r.empid]));
    else setSelectedEmps(new Set());
    setShiftMsg(null);
  }
  function cancelEditShift() {
    setEditingShiftId(null);
    setStartTime('09:00'); setEndTime('18:00'); setActivePreset('G');
    setStartDate(''); setEndDate(''); setSelectedEmps(new Set());
    setShiftMsg(null);
  }

  async function handleShiftSubmit(e: React.FormEvent) {
    e.preventDefault(); setShiftMsg(null); setShiftBusy(true);
    try {
      // Edit mode: update single rule
      if (editingShiftId !== null) {
        const empidForEdit = selectedEmps.size === 1 ? Array.from(selectedEmps)[0] : (selectedEmps.size === 0 ? null : Array.from(selectedEmps)[0]);
        const body: any = { id: editingShiftId, device_id: shiftDevice, type: 'shift', name: null, start_time: startTime, end_time: endTime, empid: empidForEdit, start_date: startDate || null, end_date: endDate || null };
        const r = await fetch(`${API_URL}/api/rules?key=admin123`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({} as any));
        if (r.ok) {
          setShiftMsg({ type: 'ok', text: 'Rule updated' });
          setEditingShiftId(null); setSelectedEmps(new Set()); loadShiftRules();
        } else setShiftMsg({ type: 'err', text: (d as any).error || 'Update failed' });
        return;
      }
      const ids = selectedEmps.size > 0 ? Array.from(selectedEmps) : [];
      const bodies = ids.length > 0
        ? ids.map(empid => ({ device_id: shiftDevice, type: 'shift', name: null, start_time: startTime, end_time: endTime, empid, start_date: startDate || null, end_date: endDate || null }))
        : [{ device_id: shiftDevice, type: 'shift', name: null, start_time: startTime, end_time: endTime, start_date: startDate || null, end_date: endDate || null }];
      let ok = 0, fail = 0;
      for (const b of bodies) { try { const r = await fetch(`${API_URL}/api/rules?key=admin123`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); r.ok ? ok++ : fail++; } catch { fail++; } }
      setShiftMsg(ok > 0 && fail === 0 ? { type: 'ok', text: `Rule added for ${ok} employee${ok > 1 ? 's' : ''}` } : { type: 'err', text: `${ok} succeeded, ${fail} failed` });
      if (ok > 0) { setSelectedEmps(new Set()); loadShiftRules(); }
    } catch { setShiftMsg({ type: 'err', text: 'Failed' }); } finally { setShiftBusy(false); }
  }

  async function deleteShiftRule(id: number) {
    setDeletingRuleId(id);
    try { const r = await fetch(`${API_URL}/api/rules/delete?key=admin123`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (r.ok) setShiftRules(p => p.filter(r => r.id !== id)); } catch {}
    setDeletingRuleId(null);
  }

  const visibleUsers = canManageAll
    ? (userDeviceFilter ? users.filter(u => u.device_id === userDeviceFilter) : users)
    : users.filter(u => u.device_id === deviceId);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      const r = await fetch(`${API_URL}/api/users?key=admin123`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.email, password: form.password, label: form.label, role: form.role, device_id: form.device_id }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg(d.success);
        setMsgType('success');
        setForm({ email: '', password: '', label: '', role: 'manager', device_id: defaultDeviceId });
        fetchUsers();
      } else {
        setMsg(d.error);
        setMsgType('error');
      }
    } catch {
      setMsg('Failed to connect');
      setMsgType('error');
    }
  }

  async function handleDelete(username: string) {
    if (!confirm(`Delete user "${username}"?`)) return;
    try {
      const r = await fetch(`${API_URL}/api/users/${encodeURIComponent(username)}?key=admin123`, { method: 'DELETE' });
      const d = await r.json();
      if (r.ok) {
        setMsg(d.success);
        setMsgType('success');
        fetchUsers();
      } else {
        setMsg(d.error);
        setMsgType('error');
      }
    } catch {
      setMsg('Failed to delete');
      setMsgType('error');
    }
  }

  function startEdit(u: UserEntry) {
    setEditingUser(u.username);
    setEditForm({ password: '', label: u.label, role: u.role, device_id: u.device_id ?? 24 });
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    try {
      const body: any = { label: editForm.label, role: editForm.role, device_id: editForm.device_id };
      if (editForm.password.trim()) body.password = editForm.password;
      const r = await fetch(`${API_URL}/api/users/${encodeURIComponent(editingUser)}?key=admin123`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg(d.success);
        setMsgType('success');
        setEditingUser(null);
        fetchUsers();
      } else {
        setMsg(d.error);
        setMsgType('error');
      }
    } catch {
      setMsg('Failed to update');
      setMsgType('error');
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-blue-50 via-indigo-50 to-violet-50 flex flex-col">
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-white border-b border-indigo-100 px-4 sm:px-6 py-2 shrink-0"
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <Shield size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-indigo-900">Admin Panel</h1>
              <p className="text-[10px] text-indigo-500">{canManageAll ? 'Manage all locations & users' : 'Manage your location users'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="flex items-center gap-1.5 text-[11px] text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors">
              <ArrowLeft size={12} /> Dashboard
            </button>
            <span className="text-[11px] text-indigo-500 bg-indigo-50 px-2 py-1 rounded-lg">{label}</span>
            <button onClick={onLogout} className="flex items-center gap-1.5 text-[11px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors">
              <LogOut size={12} /> Logout
            </button>
          </div>
        </div>
      </motion.header>

      <main className="flex-1 overflow-hidden flex max-w-7xl mx-auto w-full">
        {/* Left Nav - All options on left */}
        <aside className="w-56 shrink-0 bg-white border-r border-indigo-100 flex flex-col">
          <div className="p-3 border-b border-indigo-100">
            <p className="text-[11px] font-bold text-indigo-900">Admin Options</p>
            <p className="text-[10px] text-indigo-500"></p>
          </div>
          <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
            <button onClick={() => setAdminTab('employees')} className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition-colors ${adminTab==='employees' ? 'bg-brand-600 text-white' : 'hover:bg-indigo-50 text-indigo-700'}`}>
              <Users size={14}/> Employees <span className="ml-auto text-[10px] opacity-70">{adminEmps.length}</span>
            </button>
            <button onClick={() => setAdminTab('users')} className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition-colors ${adminTab==='users' ? 'bg-brand-600 text-white' : 'hover:bg-indigo-50 text-indigo-700'}`}>
              <Shield size={14}/> Users <span className="ml-auto text-[10px] opacity-70">{users.length}</span>
            </button>
            <button onClick={() => setAdminTab('shifts')} className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition-colors ${adminTab==='shifts' ? 'bg-brand-600 text-white' : 'hover:bg-indigo-50 text-indigo-700'}`}>
              <Clock size={14}/> Shift Management <span className="ml-auto text-[10px] opacity-70">{shiftRules.length}</span>
            </button>
          </nav>
          <div className="p-3 border-t border-indigo-100">
            <p className="text-[9px] text-indigo-400 leading-tight"></p>
          </div>
        </aside>

        <div className="flex-1 overflow-y-auto bg-gradient-to-br from-blue-50/20 via-indigo-50/10 to-violet-50/10 p-4">
          {adminTab === 'employees' && (
            <div className="max-w-3xl mx-auto space-y-3">
              <div className="bg-white rounded-xl border border-indigo-100 p-3">
                <h2 className="text-xs font-bold text-indigo-800 mb-2 flex items-center gap-2"><Users size={12} className="text-indigo-600"/> Employees — {adminEmps.length} total</h2>
                {adminEmpMsg && (<div className={`text-[11px] px-2 py-1 rounded border mb-2 ${adminEmpMsg.type==='ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{adminEmpMsg.text}</div>)}
                <form onSubmit={handleAddAdminEmp} className="p-2.5 bg-gray-50 border border-gray-200 rounded-lg space-y-1.5">
                  <p className="text-[11px] font-bold text-gray-700 flex items-center gap-1"><Plus size={11}/> Add Employee</p>
                  <input value={addEmpForm.name} onChange={e=>setAddEmpForm({...addEmpForm,name:e.target.value})} placeholder="Name *" required className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white"/>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input value={addEmpForm.badge} onChange={e=>setAddEmpForm({...addEmpForm,badge:e.target.value})} placeholder="Badge *" required className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white"/>
                    <input value={addEmpForm.empid} onChange={e=>setAddEmpForm({...addEmpForm,empid:e.target.value})} placeholder="EmpID auto" className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white"/>
                  </div>
                  <select value={addEmpForm.device_id} onChange={e=>setAddEmpForm({...addEmpForm,device_id:parseInt(e.target.value)})} className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white">
                    {locations.map(l=> <option key={l.device_id} value={l.device_id}>{l.name}</option>)}
                  </select>
                  <button type="submit" className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg">Add</button>
                </form>
                <div className="flex gap-1.5 mt-3">
                  <div className="relative flex-1">
                    <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <input value={adminEmpSearch} onChange={e=>setAdminEmpSearch(e.target.value)} placeholder="Search name, badge, ID..." className="w-full pl-6 pr-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"/>
                  </div>
                  <select value={adminEmpDevice} onChange={e=>setAdminEmpDevice(parseInt(e.target.value))} className="w-28 px-1 py-1 border border-gray-200 rounded-lg text-xs bg-white">
                    <option value={0}>All Units</option>
                    {locations.map(l=> <option key={l.device_id} value={l.device_id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden max-h-[420px] overflow-y-auto divide-y divide-gray-100">
                  {adminEmpLoading ? <p className="py-6 text-center text-xs text-gray-400"><Loader2 size={12} className="animate-spin inline"/> Loading...</p>
                  : filteredAdminEmps.length===0 ? <p className="py-6 text-center text-xs text-gray-400">No employees</p>
                  : filteredAdminEmps.slice(0,120).map((e:any)=> (
                    editingEmpId===e.empid ? (
                      <form key={e.empid} onSubmit={handleSaveEditEmp} className="p-2 bg-amber-50 flex flex-col gap-1">
                        <input value={editEmpForm.name} onChange={ev=>setEditEmpForm({...editEmpForm,name:ev.target.value})} className="w-full px-1.5 py-1 border border-amber-200 rounded text-xs bg-white" placeholder="Name"/>
                        <div className="flex gap-1">
                          <input value={editEmpForm.badge} onChange={ev=>setEditEmpForm({...editEmpForm,badge:ev.target.value})} className="flex-1 px-1.5 py-1 border border-amber-200 rounded text-xs bg-white" placeholder="Badge"/>
                          <select value={editEmpForm.device_id} onChange={ev=>setEditEmpForm({...editEmpForm,device_id:parseInt(ev.target.value)})} className="w-28 px-1 py-1 border border-amber-200 rounded text-xs bg-white">
                            {locations.map(l=> <option key={l.device_id} value={l.device_id}>{l.name}</option>)}
                          </select>
                        </div>
                        <div className="flex gap-1">
                          <button type="button" onClick={()=>setEditingEmpId(null)} className="flex-1 py-1 border border-gray-200 rounded text-xs bg-white"><X size={10} className="inline"/> Cancel</button>
                          <button type="submit" className="flex-1 py-1 bg-indigo-600 text-white rounded text-xs">Save</button>
                        </div>
                      </form>
                    ) : (
                      <div key={`${e.empid}-${e.device_id}`} className="px-3 py-2 flex items-center gap-2 hover:bg-gray-50">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-800 truncate">{e.name} <span className="font-normal text-gray-500">· {String(e.code_in_device || e.badge).padStart(3,'0')}</span></p>
                          <p className="text-[10px] text-gray-500 truncate">ID {e.empid} · {locations.find(l=>l.device_id===e.device_id)?.name || e.device_name || '-'}</p>
                        </div>
                        <button onClick={()=>startEditEmp(e)} className="p-1 rounded hover:bg-white border border-transparent hover:border-indigo-200 text-indigo-600"><Pencil size={12}/></button>
                        <button onClick={()=>handleDeleteAdminEmp(e.empid,e.name)} disabled={deletingEmpId===e.empid} className="p-1 rounded hover:bg-red-50 text-red-600 disabled:opacity-50">{deletingEmpId===e.empid ? <Loader2 size={12} className="animate-spin"/> : <Trash2 size={12}/>}</button>
                      </div>
                    )
                  ))}
                </div>
              </div>
            </div>
          )}

          {adminTab === 'users' && (
            <div className="max-w-4xl mx-auto space-y-4">
              {msg && (<motion.div initial={{opacity:0,y:-5}} animate={{opacity:1,y:0}} className={`text-xs px-3 py-1.5 rounded-lg ${msgType==='success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg}</motion.div>)}
              <div className="bg-white rounded-xl border border-indigo-100 p-4 shadow-sm">
                <h2 className="text-xs font-semibold text-indigo-800 mb-3 flex items-center gap-2"><div className="w-5 h-5 rounded-md bg-indigo-100 flex items-center justify-center"><Plus size={12} className="text-indigo-600"/></div>Add User</h2>
                <form onSubmit={handleCreate} className="space-y-2">
                  <div><label className="block text-[10px] font-medium text-indigo-700 mb-0.5">Email</label><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required placeholder="user@example.com" autoComplete="off" className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs bg-white"/></div>
                  <div><label className="block text-[10px] font-medium text-indigo-700 mb-0.5">Password</label><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required autoComplete="new-password" className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs bg-white"/></div>
                  <div><label className="block text-[10px] font-medium text-indigo-700 mb-0.5">Label</label><input type="text" value={form.label} onChange={e=>setForm({...form,label:e.target.value})} required placeholder="Manager - Location" className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs bg-white"/></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="block text-[10px] font-medium text-indigo-700 mb-0.5">Role</label><select value={form.role} onChange={e=>setForm({...form,role:e.target.value})} className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs bg-white"><option value="manager">Manager</option>{isSuper && <option value="admin">Admin</option>}</select></div>
                    <div><label className="block text-[10px] font-medium text-indigo-700 mb-0.5">Unit / Location</label><select value={form.device_id} onChange={e=>setForm({...form,device_id:parseInt(e.target.value)})} disabled={!canManageAll} className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs bg-white disabled:bg-indigo-50"><option value={0}>Select</option>{(canManageAll ? locations : locations.filter(l=>l.device_id===deviceId)).map(loc=> <option key={loc.device_id} value={loc.device_id}>{loc.name} ({loc.location})</option>)}</select></div>
                  </div>
                  <button type="submit" className="w-full px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-1.5"><Plus size={12}/> Create User</button>
                </form>
              </div>
              <div className="bg-white rounded-xl border border-indigo-100 overflow-hidden shadow-sm">
                <div className="px-4 py-2.5 border-b border-indigo-100 flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-indigo-800 flex items-center gap-2"><div className="w-5 h-5 rounded-md bg-indigo-100 flex items-center justify-center"><Users size={12} className="text-indigo-600"/></div>Users {canManageAll && (<select value={userDeviceFilter} onChange={e=>setUserDeviceFilter(parseInt(e.target.value))} className="ml-2 text-[10px] px-1.5 py-0.5 border border-indigo-200 rounded-lg bg-white"><option value={0}>All Units</option>{locations.map(l=> <option key={l.device_id} value={l.device_id}>{l.name}</option>)}</select>)}</h2>
                  <button onClick={()=>{setLoading(true);fetchUsers();}} className="text-[10px] text-indigo-400 hover:text-indigo-600 flex items-center gap-1"><RefreshCw size={10}/> Refresh</button>
                </div>
                {loading ? <div className="text-center py-6 text-xs text-indigo-400">Loading...</div> : visibleUsers.length===0 ? <div className="text-center py-6 text-xs text-indigo-400">No users yet</div> : (
                  <div className="overflow-x-auto"><table className="w-full"><thead><tr className="bg-indigo-50/80"><th className="px-4 py-2 text-left text-[10px] font-semibold text-indigo-600 uppercase">Email</th><th className="px-4 py-2 text-left text-[10px] font-semibold text-indigo-600 uppercase">Label</th><th className="px-4 py-2 text-left text-[10px] font-semibold text-indigo-600 uppercase">Role</th><th className="px-4 py-2 text-left text-[10px] font-semibold text-indigo-600 uppercase">Unit</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-indigo-600 uppercase">Action</th></tr></thead><tbody className="divide-y divide-indigo-100">{visibleUsers.map(u=> editingUser===u.username ? (
                    <tr key={u.username} className="bg-indigo-50/80"><td className="px-4 py-2 text-xs">{u.username}</td><td className="px-4 py-2"><input value={editForm.label} onChange={e=>setEditForm({...editForm,label:e.target.value})} className="w-full px-2 py-1 border border-indigo-200 rounded text-xs bg-white"/></td><td className="px-4 py-2"><select value={editForm.role} onChange={e=>setEditForm({...editForm,role:e.target.value})} className="w-full px-2 py-1 border border-indigo-200 rounded text-xs bg-white"><option value="manager">Manager</option>{isSuper && <option value="admin">Admin</option>}</select></td><td className="px-4 py-2"><select value={editForm.device_id} onChange={e=>setEditForm({...editForm,device_id:parseInt(e.target.value)})} className="w-full px-2 py-1 border border-indigo-200 rounded text-xs bg-white">{locations.map(loc=> <option key={loc.device_id} value={loc.device_id}>{loc.name}</option>)}</select></td><td className="px-4 py-2"><div className="flex items-center gap-1 justify-end"><button onClick={()=>setEditingUser(null)} className="p-1 rounded hover:bg-gray-100"><X size={12}/></button><button onClick={handleEdit} className="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded">Save</button></div></td></tr>
                  ) : (
                    <tr key={u.username} className="hover:bg-indigo-50/50"><td className="px-4 py-2 text-xs">{u.username}</td><td className="px-4 py-2 text-xs">{u.label}</td><td className="px-4 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${u.role==='admin' ? 'bg-indigo-100 text-indigo-700' : u.role==='superadmin' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}>{u.role}</span></td><td className="px-4 py-2 text-xs">{u.location || '-'}</td><td className="px-4 py-2 text-right"><div className="inline-flex gap-1">{u.role!=='superadmin' && <><button onClick={()=>startEdit(u)} className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100"><Pencil size={10} className="inline"/> Edit</button><button onClick={()=>handleDelete(u.username)} className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded hover:bg-red-100"><Trash2 size={10} className="inline"/> Delete</button></>}</div></td></tr>
                  ))}</tbody></table></div>
                )}
              </div>
            </div>
          )}

          {adminTab === 'shifts' && (
            <div className="max-w-3xl mx-auto space-y-3">
              <div className="bg-white rounded-xl border border-indigo-100 p-4 shadow-sm">
                <h2 className="text-xs font-bold text-indigo-800 mb-1 flex items-center gap-2"><Clock size={14} className="text-indigo-600"/> Shift Management — Edit & Delete</h2>
                <p className="text-[10px] text-indigo-500 mb-3">Create for all units. Use From/To for future dates. Edit (pencil) or Delete (trash) per rule below.</p>
                {shiftMsg && (<div className={`text-[10px] px-2.5 py-1.5 rounded-lg mb-2 flex items-center gap-1 ${shiftMsg.type==='ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{shiftMsg.type==='err' && <AlertCircle size={11}/>}{shiftMsg.text}</div>)}
                <form onSubmit={handleShiftSubmit} className="space-y-2.5">
                  <div><label className="text-[9px] font-bold text-indigo-600 uppercase">1. Select Unit</label><select value={shiftDevice} onChange={e=>setShiftDevice(parseInt(e.target.value))} className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs bg-white">{locations.map(l=> <option key={l.device_id} value={l.device_id}>{l.name} — {l.location}</option>)}</select></div>
                  <div><label className="text-[9px] font-bold text-indigo-600 uppercase">2. Choose Shift</label><div className="grid grid-cols-5 gap-1.5 mb-1.5">{SHIFT_PRESETS.map(p=> (<button key={p.key} type="button" onClick={()=>applyShiftPreset(p)} className={`py-1 rounded-lg text-center border-2 text-[9px] ${activePreset===p.key ? p.active : p.color}`}><span className="block font-bold">{p.key}</span><span className="block opacity-70">{p.time}</span></button>))}</div><div className="grid grid-cols-4 gap-1.5"><div><label className="text-[8px] text-indigo-400">Start</label><input type="time" value={startTime} onChange={e=>{setStartTime(e.target.value);setActivePreset('Custom');}} className="w-full px-1.5 py-1 border border-indigo-200 rounded-lg text-[10px] text-center font-mono bg-white"/></div><div><label className="text-[8px] text-indigo-400">End</label><input type="time" value={endTime} onChange={e=>{setEndTime(e.target.value);setActivePreset('Custom');}} className="w-full px-1.5 py-1 border border-indigo-200 rounded-lg text-[10px] text-center font-mono bg-white"/></div><div><label className="text-[8px] text-indigo-400">From</label><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="w-full px-1.5 py-1 border border-indigo-200 rounded-lg text-[10px] bg-white"/></div><div><label className="text-[8px] text-indigo-400">To</label><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="w-full px-1.5 py-1 border border-indigo-200 rounded-lg text-[10px] bg-white"/></div></div></div>
                  <div><label className="text-[9px] font-bold text-indigo-600 uppercase">3. Assign Employees</label><div className="border border-indigo-200 rounded-lg overflow-hidden"><div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 border-b border-indigo-100"><Search size={10} className="text-indigo-400"/><input value={empSearch} onChange={e=>setEmpSearch(e.target.value)} placeholder="Search name, badge, or ID..." className="flex-1 text-[10px] bg-transparent outline-none"/><button type="button" onClick={toggleAllShiftEmps} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${allShiftEmpsSelected ? 'bg-indigo-200 text-indigo-800' : 'bg-indigo-100 text-indigo-600'}`}>{allShiftEmpsSelected ? 'Clear':'All'}</button></div><div className="max-h-36 overflow-y-auto">{filteredShiftEmps.length===0 ? <p className="text-[10px] text-indigo-400 py-2 text-center">No employees on this unit</p> : filteredShiftEmps.map(e=> (<label key={e.empid} className={`flex items-center gap-1.5 px-2.5 py-1 border-b border-indigo-50 last:border-0 ${selectedEmps.has(e.empid) ? 'bg-indigo-50' : 'hover:bg-indigo-50/50'}`}><input type="checkbox" checked={selectedEmps.has(e.empid)} onChange={()=>toggleShiftEmp(e.empid)} className="w-3 h-3"/><span className="text-[10px] flex-1 truncate">{e.name}</span><span className="text-[8px] font-mono">ID {e.codeInDevice}</span></label>))}</div><div className="px-2.5 py-1 bg-indigo-50 border-t border-indigo-100 flex justify-between text-[8px]"><span className="text-indigo-400">{empList.length} employees</span>{selectedEmps.size>0 ? <span className="font-bold text-indigo-600">{selectedEmps.size} selected</span> : <span className="italic text-indigo-400">None = whole device</span>}</div></div></div>
                  {editingShiftId!==null && (<div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700"><span className="text-[10px] font-bold">Editing #{editingShiftId}</span><button type="button" onClick={cancelEditShift} className="px-2 py-0.5 bg-white border border-amber-200 rounded text-[10px]"><X size={10} className="inline"/> Cancel</button></div>)}
                  <button type="submit" disabled={shiftBusy} className={`w-full py-1.5 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5 ${editingShiftId!==null ? 'bg-gradient-to-r from-amber-500 to-amber-600' : 'bg-gradient-to-r from-indigo-500 to-indigo-600'}`}>{shiftBusy ? <Loader2 size={12} className="animate-spin"/> : editingShiftId!==null ? <Pencil size={12}/> : <CalendarPlus size={12}/>}{shiftBusy ? (editingShiftId!==null ? 'Updating…' : 'Adding…') : editingShiftId!==null ? 'Update Rule' : selectedEmps.size>0 ? `Add for ${selectedEmps.size} employee(s)` : 'Add for Whole Device'}</button>
                </form>
                {shiftRules.length>0 && (<div className="mt-3 border border-indigo-200 rounded-lg overflow-hidden"><div className="px-2.5 py-1.5 bg-indigo-50 border-b border-indigo-100 text-[10px] font-bold text-indigo-800">Existing Rules — Edit / Delete ({shiftRules.length})</div><div className="max-h-40 overflow-y-auto divide-y divide-indigo-50">{shiftRules.map(r=> {const emp=empList.find(e=>e.empid===r.empid); return (<div key={r.id} className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-indigo-50/50"><span className="text-[8px] font-bold px-1 py-0.5 rounded bg-indigo-100 border border-indigo-200"><Clock size={8} className="inline"/> {r.start}–{r.end}</span><span className="text-[10px] flex-1 truncate">{emp ? `${emp.name} (ID ${emp.codeInDevice})` : <em className="text-indigo-400">Whole device</em>}</span><span className="text-[8px] text-indigo-400">{r.start_date || ''}{r.start_date && r.end_date ? '→' : ''}{r.end_date || ''}{!r.start_date && !r.end_date ? 'no limit':''}</span><button onClick={()=>startEditShift(r)} className={`p-1 rounded ${editingShiftId===r.id ? 'bg-amber-100 text-amber-700' : 'hover:bg-indigo-100 text-indigo-600'}`}><Pencil size={12}/></button><button onClick={()=>deleteShiftRule(r.id)} disabled={deletingRuleId===r.id} className="p-1 rounded hover:bg-red-50 text-red-500">{deletingRuleId===r.id ? <Loader2 size={10} className="animate-spin"/> : <Trash2 size={10}/>}</button></div>)})}</div></div>)}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}




