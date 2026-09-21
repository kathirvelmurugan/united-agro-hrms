import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { LogOut, ArrowLeft, Shield, Trash2, Plus, RefreshCw, Users, Clock, ChevronDown, ChevronUp, CalendarPlus, Loader2, AlertCircle, Search, Pencil, X } from 'lucide-react';
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
  const [showShiftSection, setShowShiftSection] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftMsg, setShiftMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null);

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
    if (!showShiftSection || !shiftDevice) return;
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
  }, [shiftDevice, showShiftSection, loadShiftRules]);

  const filteredShiftEmps = useMemo(() => {
    if (!empSearch.trim()) return empList;
    const q = empSearch.toLowerCase();
    return empList.filter(e => e.name.toLowerCase().includes(q) || e.badge.includes(q) || e.codeInDevice.includes(q));
  }, [empList, empSearch]);

  const allShiftEmpsSelected = filteredShiftEmps.length > 0 && filteredShiftEmps.every(e => selectedEmps.has(e.empid));

  function toggleAllShiftEmps() { allShiftEmpsSelected ? setSelectedEmps(new Set()) : setSelectedEmps(new Set(filteredShiftEmps.map(e => e.empid))); }
  function toggleShiftEmp(id: number) { setSelectedEmps(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function applyShiftPreset(p: typeof SHIFT_PRESETS[number]) { setActivePreset(p.key); if (p.start) setStartTime(p.start); if (p.end) setEndTime(p.end); }

  async function handleShiftSubmit(e: React.FormEvent) {
    e.preventDefault(); setShiftMsg(null); setShiftBusy(true);
    try {
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
        {/* LEFT SIDE PANEL – Employee Add / Edit / Delete */}
        <aside className="w-80 shrink-0 bg-white border-r border-indigo-100 flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b border-indigo-100 bg-indigo-50/60 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center"><Users size={12} className="text-white" /></div>
            <div className="min-w-0">
              <h2 className="text-xs font-bold text-indigo-900 leading-none">Employees</h2>
              <p className="text-[10px] text-indigo-500">{adminEmps.length} total</p>
            </div>
            <button onClick={fetchAdminEmps} className="ml-auto p-1 rounded hover:bg-white text-indigo-400 hover:text-indigo-600"><RefreshCw size={12} className={adminEmpLoading ? 'animate-spin' : ''} /></button>
          </div>
          {adminEmpMsg && (
            <div className={`mx-3 mt-2 text-[11px] px-2 py-1 rounded border ${adminEmpMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{adminEmpMsg.text}</div>
          )}
          <form onSubmit={handleAddAdminEmp} className="m-3 p-2.5 bg-gray-50 border border-gray-200 rounded-lg space-y-1.5">
            <p className="text-[11px] font-bold text-gray-700 flex items-center gap-1"><Plus size={11} /> Add Employee</p>
            <input value={addEmpForm.name} onChange={e => setAddEmpForm({ ...addEmpForm, name: e.target.value })} placeholder="Name *" required className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white" />
            <div className="grid grid-cols-2 gap-1.5">
              <input value={addEmpForm.badge} onChange={e => setAddEmpForm({ ...addEmpForm, badge: e.target.value })} placeholder="Badge *" required className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white" />
              <input value={addEmpForm.empid} onChange={e => setAddEmpForm({ ...addEmpForm, empid: e.target.value })} placeholder="EmpID auto" className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white" />
            </div>
            <select value={addEmpForm.device_id} onChange={e => setAddEmpForm({ ...addEmpForm, device_id: parseInt(e.target.value) })} className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white">
              {locations.map(l => <option key={l.device_id} value={l.device_id}>{l.name}</option>)}
            </select>
            <button type="submit" className="w-full py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded">Add</button>
          </form>
          <div className="px-3 pb-2 flex gap-1.5">
            <div className="relative flex-1">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={adminEmpSearch} onChange={e => setAdminEmpSearch(e.target.value)} placeholder="Search..." className="w-full pl-6 pr-2 py-1 border border-gray-200 rounded text-xs bg-white" />
            </div>
            <select value={adminEmpDevice} onChange={e => setAdminEmpDevice(parseInt(e.target.value))} className="w-24 px-1 py-1 border border-gray-200 rounded text-[11px] bg-white">
              <option value={0}>All</option>
              {locations.map(l => <option key={l.device_id} value={l.device_id}>{l.name}</option>)}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto border-t border-gray-100 divide-y divide-gray-100">
            {adminEmpLoading ? <p className="py-6 text-center text-xs text-gray-400"><Loader2 size={12} className="animate-spin inline" /> Loading...</p>
            : filteredAdminEmps.length === 0 ? <p className="py-6 text-center text-xs text-gray-400">No employees</p>
            : filteredAdminEmps.slice(0, 80).map((e: any) => (
              editingEmpId === e.empid ? (
                <form key={e.empid} onSubmit={handleSaveEditEmp} className="p-2 bg-amber-50 flex flex-col gap-1">
                  <input value={editEmpForm.name} onChange={ev => setEditEmpForm({ ...editEmpForm, name: ev.target.value })} className="w-full px-1.5 py-1 border border-amber-200 rounded text-xs bg-white" placeholder="Name" />
                  <div className="flex gap-1">
                    <input value={editEmpForm.badge} onChange={ev => setEditEmpForm({ ...editEmpForm, badge: ev.target.value })} className="flex-1 px-1.5 py-1 border border-amber-200 rounded text-xs bg-white" placeholder="Badge" />
                    <select value={editEmpForm.device_id} onChange={ev => setEditEmpForm({ ...editEmpForm, device_id: parseInt(ev.target.value) })} className="w-24 px-1 py-1 border border-amber-200 rounded text-xs bg-white">
                      {locations.map(l => <option key={l.device_id} value={l.device_id}>{l.name}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setEditingEmpId(null)} className="flex-1 py-1 border border-gray-200 rounded text-xs bg-white"><X size={10} className="inline" /> Cancel</button>
                    <button type="submit" className="flex-1 py-1 bg-indigo-600 text-white rounded text-xs">Save</button>
                  </div>
                </form>
              ) : (
                <div key={`${e.empid}-${e.device_id}`} className="px-3 py-2 flex items-center gap-2 hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 truncate">{e.name} <span className="font-normal text-gray-500">· {String(e.code_in_device || e.badge).padStart(3, '0')}</span></p>
                    <p className="text-[10px] text-gray-500 truncate">ID {e.empid} · {locations.find(l => l.device_id === e.device_id)?.name || e.device_name || '-'}</p>
                  </div>
                  <button onClick={() => startEditEmp(e)} className="p-1 rounded hover:bg-white border border-transparent hover:border-indigo-200 text-indigo-600"><Pencil size={12} /></button>
                  <button onClick={() => handleDeleteAdminEmp(e.empid, e.name)} disabled={deletingEmpId === e.empid} className="p-1 rounded hover:bg-red-50 text-red-600 disabled:opacity-50">{deletingEmpId === e.empid ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}</button>
                </div>
              )
            ))}
          </div>
        </aside>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {msg && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-xs px-3 py-1.5 rounded-lg mb-3 ${msgType === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}
          >
            {msg}
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Add User Form */}
          <div className="bg-white rounded-xl border border-indigo-100 p-4 shadow-sm">
            <h2 className="text-xs font-semibold text-indigo-800 mb-3 flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-indigo-100 flex items-center justify-center">
                <Plus size={12} className="text-indigo-600" />
              </div>
              Add User
            </h2>
            <form onSubmit={handleCreate} className="space-y-2">
              <div>
                <label className="block text-[10px] font-medium text-indigo-700 mb-0.5">Email</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required
                  placeholder="user@example.com"
                  autoComplete="off"
                  className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-indigo-700 mb-0.5">Password</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required
                  autoComplete="new-password"
                  className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-indigo-700 mb-0.5">Label</label>
                <input type="text" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} required placeholder="Manager - Location"
                  className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-medium text-indigo-700 mb-0.5">Role</label>
                  <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white">
                    <option value="manager">Manager</option>
                    {isSuper && <option value="admin">Admin</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-indigo-700 mb-0.5">Unit / Location</label>
                  <select value={form.device_id} onChange={e => setForm({ ...form, device_id: parseInt(e.target.value) })}
                    disabled={!canManageAll}
                    className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white disabled:bg-indigo-50 disabled:text-indigo-400">
                    {(canManageAll ? locations : locations.filter(l => l.device_id === deviceId)).map(loc => (
                      <option key={loc.device_id} value={loc.device_id}>{loc.name} ({loc.location})</option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="submit" className="w-full px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-sm">
                <Plus size={12} /> Create User
              </button>
            </form>
          </div>

          {/* Shift Management Section */}
          {canManageAll && (
            <div className="bg-white rounded-xl border border-indigo-100 overflow-hidden shadow-sm flex flex-col">
              <button onClick={() => setShowShiftSection(!showShiftSection)}
                className="w-full px-4 py-2.5 border-b border-indigo-100 flex items-center justify-between hover:bg-indigo-50/50 transition-colors shrink-0">
                <h2 className="text-xs font-semibold text-indigo-800 flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-indigo-100 flex items-center justify-center">
                    <Clock size={12} className="text-indigo-600" />
                  </div>
                  Shift Management
                </h2>
                {showShiftSection ? <ChevronUp size={14} className="text-indigo-400" /> : <ChevronDown size={14} className="text-indigo-400" />}
              </button>

              {showShiftSection && (
                <div className="p-4 space-y-3 overflow-y-auto flex-1">
                  {shiftMsg && (
                    <div className={`text-[10px] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 ${shiftMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                      {shiftMsg.type === 'err' && <AlertCircle size={11} />}{shiftMsg.text}
                    </div>
                  )}

                  <form onSubmit={handleShiftSubmit} className="space-y-2.5">
                    {/* Unit */}
                    <div>
                      <label className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider mb-0.5 block">1. Select Unit</label>
                      <select value={shiftDevice} onChange={e => setShiftDevice(parseInt(e.target.value))}
                        className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/30 bg-white">
                        {locations.map(l => <option key={l.device_id} value={l.device_id}>{l.name} — {l.location}</option>)}
                      </select>
                    </div>

                    {/* Shift */}
                    <div>
                      <label className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider mb-0.5 block">2. Choose Shift</label>
                      <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                        {SHIFT_PRESETS.map(p => (
                          <button key={p.key} type="button" onClick={() => applyShiftPreset(p)}
                            className={`py-1 rounded-lg text-center border-2 transition-all text-[9px] ${activePreset === p.key ? p.active : p.color}`}>
                            <span className="block font-bold">{p.key}</span>
                            <span className="block opacity-70">{p.time}</span>
                          </button>
                        ))}
                      </div>
                      {/* Time + Date in 4-col grid */}
                      <div className="grid grid-cols-4 gap-1.5">
                        <div>
                          <label className="text-[8px] text-indigo-400 font-medium block mb-0.5">Start</label>
                          <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); setActivePreset('Custom'); }}
                            className="w-full px-1.5 py-1 border border-indigo-200 rounded-lg text-[10px] text-center font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30 bg-white" />
                        </div>
                        <div>
                          <label className="text-[8px] text-indigo-400 font-medium block mb-0.5">End</label>
                          <input type="time" value={endTime} onChange={e => { setEndTime(e.target.value); setActivePreset('Custom'); }}
                            className="w-full px-1.5 py-1 border border-indigo-200 rounded-lg text-[10px] text-center font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30 bg-white" />
                        </div>
                        <div>
                          <label className="text-[8px] text-indigo-400 font-medium block mb-0.5">From</label>
                          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                            className="w-full px-1.5 py-1 border border-indigo-200 rounded-lg text-[10px] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 bg-white" />
                        </div>
                        <div>
                          <label className="text-[8px] text-indigo-400 font-medium block mb-0.5">To</label>
                          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                            className="w-full px-1.5 py-1 border border-indigo-200 rounded-lg text-[10px] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 bg-white" />
                        </div>
                      </div>
                    </div>

                    {/* Employees */}
                    <div>
                      <label className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider mb-0.5 block">3. Assign Employees</label>
                      <div className="border border-indigo-200 rounded-lg overflow-hidden">
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 border-b border-indigo-100">
                          <Search size={10} className="text-indigo-400" />
                          <input type="text" value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="Search name, badge, or ID..." className="flex-1 text-[10px] bg-transparent outline-none" />
                          {empList.length > 0 && (
                            <button type="button" onClick={toggleAllShiftEmps}
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${allShiftEmpsSelected ? 'bg-indigo-200 text-indigo-800' : 'bg-indigo-100 text-indigo-600'}`}>
                              {allShiftEmpsSelected ? 'Clear' : 'All'}
                            </button>
                          )}
                        </div>
                        <div className="max-h-32 overflow-y-auto">
                          {filteredShiftEmps.length === 0 && <p className="text-[10px] text-indigo-400 py-2 text-center">No employees</p>}
                          {filteredShiftEmps.map(e => (
                            <label key={e.empid} className={`flex items-center gap-1.5 px-2.5 py-1 cursor-pointer border-b border-indigo-50 last:border-0 min-w-0 ${selectedEmps.has(e.empid) ? 'bg-indigo-50' : 'hover:bg-indigo-50/50'}`}>
                              <input type="checkbox" checked={selectedEmps.has(e.empid)} onChange={() => toggleShiftEmp(e.empid)} className="w-3 h-3 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 shrink-0" />
                              <span className="text-[10px] font-medium text-indigo-800 flex-1 truncate">{e.name}</span>
                              <span className="text-[8px] text-indigo-500 font-mono shrink-0">ID {e.codeInDevice}</span>
                              <span className="text-[8px] text-indigo-400 font-mono shrink-0">#{e.badge}</span>
                            </label>
                          ))}
                        </div>
                        <div className="px-2.5 py-1 bg-indigo-50 border-t border-indigo-100 flex items-center justify-between">
                          <span className="text-[8px] text-indigo-400">{empList.length} employees</span>
                          {selectedEmps.size > 0 ? <span className="text-[8px] font-bold text-indigo-600">{selectedEmps.size} selected</span> : <span className="text-[8px] text-indigo-400 italic">None = whole device</span>}
                        </div>
                      </div>
                    </div>

                    <button type="submit" disabled={shiftBusy}
                      className="w-full px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 shadow-sm">
                      {shiftBusy ? <Loader2 size={12} className="animate-spin" /> : <CalendarPlus size={12} />}
                      {shiftBusy ? 'Adding…' : selectedEmps.size > 0 ? `Add Rule for ${selectedEmps.size} Employee${selectedEmps.size > 1 ? 's' : ''}` : 'Add Rule for Whole Device'}
                    </button>
                  </form>

                  {/* Existing Rules */}
                  {shiftRules.length > 0 && (
                    <div className="border border-indigo-200 rounded-lg overflow-hidden">
                      <div className="px-2.5 py-1.5 bg-indigo-50 border-b border-indigo-100">
                        <span className="text-[10px] font-bold text-indigo-800">Existing Rules ({shiftRules.length})</span>
                      </div>
                      <div className="max-h-28 overflow-y-auto divide-y divide-indigo-50">
                        {shiftRules.map(r => {
                          const emp = empList.find(e => e.empid === r.empid);
                          return (
                            <div key={r.id} className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-indigo-50/50">
                              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 shrink-0">
                                <Clock size={8} />{r.start}–{r.end}
                              </span>
                              <span className="text-[10px] text-indigo-700 flex-1 truncate">{emp ? `${emp.name} (ID ${emp.codeInDevice})` : <em className="text-indigo-400">Whole device</em>}</span>
                              <span className="text-[8px] text-indigo-400 shrink-0">{r.start_date || ''}{r.start_date && r.end_date ? '→' : ''}{r.end_date || ''}</span>
                              <button onClick={() => deleteShiftRule(r.id)} disabled={deletingRuleId === r.id} className="p-0.5 rounded hover:bg-red-50 text-indigo-400 hover:text-red-500 shrink-0">
                                {deletingRuleId === r.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-xl border border-indigo-100 overflow-hidden shadow-sm">
          <div className="px-4 py-2.5 border-b border-indigo-100 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-indigo-800 flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-indigo-100 flex items-center justify-center">
                <Users size={12} className="text-indigo-600" />
              </div>
              Users
              {canManageAll && (
                <select value={userDeviceFilter} onChange={e => setUserDeviceFilter(parseInt(e.target.value))}
                  className="ml-2 text-[10px] font-normal px-1.5 py-0.5 border border-indigo-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500/30 bg-white">
                  <option value={0}>All Units</option>
                  {locations.map(l => <option key={l.device_id} value={l.device_id}>{l.name}</option>)}
                </select>
              )}
            </h2>
            <button onClick={() => { setLoading(true); fetchUsers(); }} className="text-[10px] text-indigo-400 hover:text-indigo-600 flex items-center gap-1">
              <RefreshCw size={10} /> Refresh
            </button>
          </div>
          {loading ? (
            <div className="text-center py-6 text-indigo-400 text-xs">Loading...</div>
          ) : visibleUsers.length === 0 ? (
            <div className="text-center py-6 text-indigo-400 text-xs">No users yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-indigo-50/80">
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-indigo-600 uppercase">Email</th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-indigo-600 uppercase">Label</th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-indigo-600 uppercase">Role</th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-indigo-600 uppercase">Unit</th>
                    <th className="px-4 py-2 text-right text-[10px] font-semibold text-indigo-600 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-indigo-100">
                  {visibleUsers.map(u => editingUser === u.username ? (
                    <tr key={u.username} className="bg-indigo-50/80">
                      <td className="px-4 py-2 text-xs font-medium text-indigo-800">{u.username}</td>
                      <td className="px-4 py-2">
                        <input type="text" value={editForm.label} onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                          className="w-full px-2 py-1 border border-indigo-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500/30 bg-white" />
                      </td>
                      <td className="px-4 py-2">
                        <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                          className="w-full px-2 py-1 border border-indigo-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500/30 bg-white">
                          <option value="manager">Manager</option>
                          {isSuper && <option value="admin">Admin</option>}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <select value={editForm.device_id} onChange={e => setEditForm({ ...editForm, device_id: parseInt(e.target.value) })}
                          className="w-full px-2 py-1 border border-indigo-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500/30 bg-white">
                          {locations.map(loc => <option key={loc.device_id} value={loc.device_id}>{loc.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => setEditingUser(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                            <X size={12} />
                          </button>
                          <button onClick={handleEdit} className="inline-flex items-center gap-1 text-[10px] text-white bg-indigo-500 hover:bg-indigo-600 px-2 py-0.5 rounded-lg transition-colors">
                            Save
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={u.username} className="hover:bg-indigo-50/50">
                      <td className="px-4 py-2 text-xs font-medium text-indigo-800">{u.username}</td>
                      <td className="px-4 py-2 text-xs text-indigo-600">{u.label}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : u.role === 'superadmin' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-indigo-500">{u.location || '-'}</td>
                      <td className="px-4 py-2 text-right">
                        {u.role !== 'superadmin' && (
                          <div className="inline-flex items-center gap-1">
                            <button onClick={() => startEdit(u)}
                              className="inline-flex items-center gap-0.5 text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-lg transition-colors">
                              <Pencil size={10} /> Edit
                            </button>
                            <button onClick={() => handleDelete(u.username)}
                              className="inline-flex items-center gap-0.5 text-[10px] text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 px-2 py-0.5 rounded-lg transition-colors">
                              <Trash2 size={10} /> Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      </main>
    </div>
  );
}
