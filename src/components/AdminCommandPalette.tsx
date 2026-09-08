import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Command, UserPlus, Users, Server, Power, CalendarPlus, Search, X, ArrowLeft,
  Loader2, AlertCircle, Trash2, RefreshCw, ChevronDown, ChevronUp, Clock, Target,
  CheckCircle2, ShieldCheck,
} from 'lucide-react';
import { API_URL } from '../data/mockData';

const ADMIN_KEY = 'admin123';

interface Loc {
  device_id: number;
  name: string;
  location: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCheckServer: () => void;
}

type View = 'root' | 'employee' | 'employees' | 'pool' | 'rule' | 'shift_mgmt';

export default function AdminCommandPalette({ open, onClose, onCheckServer }: Props) {
  const [view, setView] = useState<View>('root');
  const [query, setQuery] = useState('');
  const [locs, setLocs] = useState<Loc[]>([]);

  useEffect(() => {
    if (!open) return;
    setView('root');
    setQuery('');
    fetch(`${API_URL}/api/locations`)
      .then(r => r.ok ? r.json() : [])
      .then((l: Loc[]) => setLocs(l))
      .catch(() => setLocs([]));
  }, [open]);

  const commands = [
    { id: 'employee', label: 'Add Employee', desc: 'Enroll a new attendance employee (badge + device)', icon: UserPlus, hint: 'create' },
    { id: 'employees', label: 'Manage / Delete Employees', desc: 'View all units, add or remove employees', icon: Users, hint: 'remove delete' },
    { id: 'shift_mgmt', label: 'Shift Management', desc: 'Allocate and manage shift rules for all units', icon: Target, hint: 'shift allocation' },
    { id: 'server', label: 'Check Server', desc: 'Open live server / SQL / device health', icon: Server, hint: 'health' },
    { id: 'pool', label: 'Restart Pool (status)', desc: 'View IIS app-pool state & manual restart command', icon: Power, hint: 'iis' },
    { id: 'rule', label: 'Add Shift Rule', desc: 'Weekly-off / holiday / permission / shift rule', icon: CalendarPlus, hint: 'rules' },
  ];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c => (c.label + ' ' + c.desc + ' ' + c.hint).toLowerCase().includes(q));
  }, [query]);

  if (!open) return null;

  function run(id: string) {
    if (id === 'server') {
      onCheckServer();
      onClose();
      return;
    }
    setView(id as View);
  }

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 flex items-start justify-center p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-slate-900 text-white">
          <Command size={14} className="text-brand-300" />
          <h2 className="text-sm font-semibold">Admin Commands</h2>
          <span className="text-[10px] text-gray-400 ml-1">Ctrl+Shift+A</span>
          <button onClick={onClose} className="ml-auto p-1 rounded-md hover:bg-white/10 text-gray-400"><X size={14} /></button>
        </div>

        {view === 'root' && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
              <Search size={14} className="text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Type a command…"
                className="w-full bg-transparent text-sm outline-none py-1.5 placeholder:text-gray-400"
              />
            </div>
            <div className="overflow-y-auto">
              {filtered.length === 0 && (
                <p className="text-sm text-gray-400 py-8 text-center">No matching command</p>
              )}
              {filtered.map(c => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    onClick={() => run(c.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-50 last:border-0"
                  >
                    <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-800">{c.label}</span>
                      <span className="block text-[11px] text-gray-400 truncate">{c.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {view === 'employee' && (
          <EmployeeForm locs={locs} onBack={() => setView('root')} />
        )}
        {view === 'employees' && (
          <EmployeeManager onBack={() => setView('root')} onAdd={() => setView('employee')} />
        )}
        {view === 'pool' && (
          <PoolPanel onBack={() => setView('root')} />
        )}
        {view === 'rule' && (
          <RuleForm locs={locs} onBack={() => setView('root')} />
        )}
        {view === 'shift_mgmt' && (
          <ShiftMgmtPanel locs={locs} onBack={() => setView('root')} />
        )}
      </div>
    </div>
  );
}

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
      <button onClick={onBack} className="p-1 rounded-md hover:bg-gray-100 text-gray-500"><ArrowLeft size={15} /></button>
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
    </div>
  );
}

function EmployeeForm({ locs, onBack }: { locs: Loc[]; onBack: () => void }) {
  const [name, setName] = useState('');
  const [badge, setBadge] = useState('');
  const [empid, setEmpid] = useState('');
  const [device, setDevice] = useState<number>(locs[0]?.device_id ?? 25);
  const [gender, setGender] = useState('Male');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim() || !badge.trim()) {
      setMsg({ type: 'err', text: 'Name and badge are required' });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/admin/employee?key=${ADMIN_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), badge: badge.trim(),
          empid: empid.trim() ? parseInt(empid) : undefined,
          device_id: device, gender,
        }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg({ type: 'ok', text: `Employee "${name}" added (badge ${badge}, device ${device})` });
        setName(''); setBadge('');
      } else {
        setMsg({ type: 'err', text: d.error || 'Failed to add employee' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Failed to connect to server' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col">
      <PanelHeader title="Add Employee" onBack={onBack} />
      <form onSubmit={submit} className="p-4 flex flex-col gap-3">
        {msg && (
          <div className={`text-xs px-3 py-2 rounded-lg ${msg.type === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'} flex items-center gap-1.5`}>
            {msg.type === 'err' && <AlertCircle size={13} />}{msg.text}
          </div>
        )}
        <Field label="Full Name">
          <input value={name} onChange={e => setName(e.target.value)} autoFocus required
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" placeholder="e.g. John Doe" />
        </Field>
        <Field label="Badge / Employee Code (punch ID)">
          <input value={badge} onChange={e => setBadge(e.target.value)} required
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" placeholder="e.g. 3030" />
        </Field>
        <Field label="Emp ID (optional — leave blank to auto-generate)">
          <input value={empid} onChange={e => setEmpid(e.target.value)} inputMode="numeric"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" placeholder="e.g. 3030" />
        </Field>
        <Field label="Device / Branch">
          <select value={device} onChange={e => setDevice(parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30">
            {locs.map(l => <option key={l.device_id} value={l.device_id}>{l.name} ({l.location})</option>)}
          </select>
        </Field>
        <Field label="Gender">
          <select value={gender} onChange={e => setGender(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30">
            <option>Male</option><option>Female</option><option>Other</option>
          </select>
        </Field>
        <button type="submit" disabled={busy}
          className="w-full px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-1.5">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          {busy ? 'Adding…' : 'Add Employee'}
        </button>
      </form>
    </div>
  );
}

function EmployeeManager({ onBack, onAdd }: { onBack: () => void; onAdd: () => void }) {
  const [list, setList] = useState<Array<{
    empid: number; name: string; badge: string; code_in_device: string;
    device_id: number | null; device_name: string | null; location: string | null;
  }>>([]);
  const [q, setQ] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const units = useMemo(() => {
    const map = new Map<string, { device_id: number; device_name: string; location: string }>();
    list.forEach(e => {
      if (e.device_id && e.device_name) {
        const key = String(e.device_id);
        if (!map.has(key)) map.set(key, { device_id: e.device_id, device_name: e.device_name, location: e.location || '' });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.device_name.localeCompare(b.device_name));
  }, [list]);

  async function load() {
    try {
      const r = await fetch(`${API_URL}/api/admin/employees?key=${ADMIN_KEY}`);
      const d = await r.json();
      if (r.ok) setList(d.employees || []);
      else setMsg({ type: 'err', text: d.error || 'Failed to load employees' });
    } catch {
      setMsg({ type: 'err', text: 'Failed to connect to server' });
    }
  }
  useEffect(() => { load(); }, []);

  async function remove(empid: number, name: string) {
    if (!window.confirm(`Delete "${name}" (#${empid})? This removes them from all units.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${API_URL}/api/admin/employee?key=${ADMIN_KEY}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empid }),
      });
      const d = await r.json();
      if (r.ok) {
        setList(l => l.filter(x => x.empid !== empid));
        setMsg({ type: 'ok', text: `"${name}" deleted` });
      } else {
        setMsg({ type: 'err', text: d.error || 'Delete failed' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Failed to connect to server' });
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let result = list;
    if (unitFilter !== 'all') {
      const devId = Number(unitFilter);
      result = result.filter(x => x.device_id === devId);
    }
    if (!s) return result;
    return result.filter(x =>
      (x.name + ' ' + x.badge + ' ' + x.empid + ' ' + x.code_in_device + ' ' + (x.device_name || '') + ' ' + (x.location || ''))
        .toLowerCase().includes(s));
  }, [q, list, unitFilter]);

  const unitCounts = useMemo(() => {
    const counts = new Map<number, number>();
    list.forEach(e => { if (e.device_id) counts.set(e.device_id, (counts.get(e.device_id) || 0) + 1); });
    return counts;
  }, [list]);

  return (
    <div className="flex flex-col">
      <PanelHeader title="Manage / Delete Employees" onBack={onBack} />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <Search size={14} className="text-gray-400" />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, badge…"
          className="w-full bg-transparent text-sm outline-none py-1.5 placeholder:text-gray-400" />
        <button onClick={onAdd} disabled={busy}
          className="shrink-0 px-2.5 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 flex items-center gap-1 disabled:opacity-50">
          <UserPlus size={13} /> Add
        </button>
      </div>
      <div className="px-3 py-2 border-b border-gray-100">
        <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 outline-none focus:border-brand-400">
          <option value="all">All Units ({list.length})</option>
          {units.map(u => (
            <option key={u.device_id} value={u.device_id}>
              {u.device_name}{u.location ? ' — ' + u.location : ''} ({unitCounts.get(u.device_id) || 0})
            </option>
          ))}
        </select>
      </div>
      {msg && (
        <div className={`text-xs px-3 py-2 mx-3 mt-2 rounded-lg ${msg.type === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'} flex items-center gap-1.5`}>
          {msg.type === 'err' && <AlertCircle size={13} />}{msg.text}
        </div>
      )}
      <div className="overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No employees found</p>
        ) : filtered.map((x, i) => (
          <div key={x.empid + '-' + i} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
            <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-xs font-bold shrink-0">
              {(x.name || '?')[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800 truncate">
                {x.name || '(no name)'}
                {x.code_in_device && <span className="text-gray-400 font-normal ml-1.5">({x.code_in_device})</span>}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                <span>#{x.empid}</span>
                <span>·</span>
                <span>badge {x.badge || '—'}</span>
                {x.device_name && (<><span>·</span><span className="text-brand-600 font-medium">{x.device_name}</span></>)}
                {x.location && <span className="text-gray-400">({x.location})</span>}
              </div>
            </div>
            <button onClick={() => remove(x.empid, x.name)} disabled={busy}
              className="shrink-0 px-2.5 py-1.5 rounded-lg text-red-600 hover:bg-red-50 text-xs font-medium border border-red-200 disabled:opacity-50">
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}


function RuleForm({ locs, onBack }: { locs: Loc[]; onBack: () => void }) {
  const [device, setDevice] = useState<number>(locs[0]?.device_id ?? 25);
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [selectedEmps, setSelectedEmps] = useState<Set<number>>(new Set());
  const [empList, setEmpList] = useState<Array<{ empid: number; name: string; badge: string; codeInDevice: string }>>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [empSearch, setEmpSearch] = useState('');

  const SHIFT_PRESETS = [
    { key: 'G', label: 'General', time: '09:00 – 18:00', start: '09:00', end: '18:00', color: 'border-gray-300 bg-gray-50 text-gray-700', active: 'border-gray-500 bg-gray-100 text-gray-800 ring-2 ring-gray-300' },
    { key: '1st', label: '1st Shift', time: '06:00 – 14:00', start: '06:00', end: '14:00', color: 'border-blue-200 bg-blue-50 text-blue-700', active: 'border-blue-500 bg-blue-100 text-blue-800 ring-2 ring-blue-300' },
    { key: '2nd', label: '2nd Shift', time: '14:00 – 22:00', start: '14:00', end: '22:00', color: 'border-purple-200 bg-purple-50 text-purple-700', active: 'border-purple-500 bg-purple-100 text-purple-800 ring-2 ring-purple-300' },
    { key: 'Night', label: 'Night', time: '21:00 – 06:00', start: '21:00', end: '06:00', color: 'border-orange-200 bg-orange-50 text-orange-700', active: 'border-orange-500 bg-orange-100 text-orange-800 ring-2 ring-orange-300' },
    { key: 'Custom', label: 'Custom', time: 'Your own times', start: '', end: '', color: 'border-emerald-200 bg-emerald-50 text-emerald-700', active: 'border-emerald-500 bg-emerald-100 text-emerald-800 ring-2 ring-emerald-300' },
  ];

  const [activePreset, setActivePreset] = useState('G');

  function applyPreset(preset: typeof SHIFT_PRESETS[number]) {
    setActivePreset(preset.key);
    if (preset.start) setStartTime(preset.start);
    if (preset.end) setEndTime(preset.end);
  }

  useEffect(() => {
    fetch(`${API_URL}/api/admin/employees?key=${ADMIN_KEY}`)
      .then(r => r.ok ? r.json() : { employees: [] })
      .then((d: any) => {
        const devEmps = (d.employees || []).filter((e: any) => e.device_id === device && e.name && !/^\d+$/.test(e.name.trim()));
        const unique = new Map<number, any>();
        devEmps.forEach((e: any) => {
          if (!unique.has(e.empid)) {
            unique.set(e.empid, {
              empid: e.empid,
              name: e.name,
              badge: e.badge,
              codeInDevice: String(e.code_in_device || e.badge || '').padStart(4, '0'),
            });
          }
        });
        setEmpList(Array.from(unique.values()));
        setSelectedEmps(new Set());
      })
      .catch(() => setEmpList([]));
  }, [device]);

  const filteredEmps = useMemo(() => {
    if (!empSearch.trim()) return empList;
    const q = empSearch.toLowerCase();
    return empList.filter(e => e.name.toLowerCase().includes(q) || e.badge.includes(q) || e.codeInDevice.includes(q) || String(e.empid).includes(q));
  }, [empList, empSearch]);

  const allSelected = filteredEmps.length > 0 && filteredEmps.every(e => selectedEmps.has(e.empid));

  function toggleSelectAll() {
    if (allSelected) setSelectedEmps(new Set());
    else setSelectedEmps(new Set(filteredEmps.map(e => e.empid)));
  }

  function toggleEmp(empid: number) {
    setSelectedEmps(prev => {
      const next = new Set(prev);
      if (next.has(empid)) next.delete(empid); else next.add(empid);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const empsToSubmit = selectedEmps.size > 0 ? Array.from(selectedEmps) : [];
      const bodies = empsToSubmit.length > 0
        ? empsToSubmit.map(empid => ({
            device_id: device, type: 'shift', name: name.trim() || null,
            start_time: startTime, end_time: endTime, empid,
            start_date: startDate || null, end_date: endDate || null,
          }))
        : [{ device_id: device, type: 'shift', name: name.trim() || null, start_time: startTime, end_time: endTime, start_date: startDate || null, end_date: endDate || null }];

      let okCount = 0;
      let failCount = 0;
      for (const body of bodies) {
        try {
          const r = await fetch(`${API_URL}/api/rules?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (r.ok) okCount++; else failCount++;
        } catch { failCount++; }
      }

      if (failCount === 0) {
        setMsg({ type: 'ok', text: `Shift rule added for ${okCount} employee${okCount > 1 ? 's' : ''}` });
        setSelectedEmps(new Set());
        setName('');
      } else {
        setMsg({ type: 'err', text: `${okCount} succeeded, ${failCount} failed` });
      }
    } catch {
      setMsg({ type: 'err', text: 'Failed to connect to server' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col max-h-[70vh]">
      <PanelHeader title="Add Shift Rule" onBack={onBack} />
      <form onSubmit={submit} className="overflow-y-auto flex-1">
        {msg && (
          <div className={`mx-4 mt-3 text-xs px-3 py-2 rounded-lg ${msg.type === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'} flex items-center gap-1.5`}>
            {msg.type === 'err' && <AlertCircle size={13} />}{msg.text}
          </div>
        )}

        <div className="p-4 flex flex-col gap-5">

          {/* Section 1: Unit */}
          <div>
            <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px]">1</span>
              Select Unit
            </label>
            <select value={device} onChange={e => setDevice(parseInt(e.target.value))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400">
              {locs.map(l => <option key={l.device_id} value={l.device_id}>{l.name} — {l.location}</option>)}
            </select>
          </div>

          {/* Section 2: Shift Type */}
          <div>
            <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px]">2</span>
              Choose Shift
            </label>
            <div className="grid grid-cols-5 gap-2">
              {SHIFT_PRESETS.map(p => (
                <button key={p.key} type="button" onClick={() => applyPreset(p)}
                  className={`px-2 py-2.5 rounded-lg text-center border-2 transition-all ${activePreset === p.key ? p.active : p.color + ' hover:shadow-sm'}`}>
                  <span className="block text-xs font-bold">{p.key}</span>
                  <span className="block text-[10px] mt-0.5">{p.label}</span>
                  <span className="block text-[9px] opacity-60 mt-0.5">{p.time}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="text-[10px] text-gray-400 font-medium mb-0.5 block">Start</label>
                <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); setActivePreset('Custom'); }}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 font-medium mb-0.5 block">End</label>
                <input type="time" value={endTime} onChange={e => { setEndTime(e.target.value); setActivePreset('Custom'); }}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
            </div>
          </div>

          {/* Section 3: Schedule */}
          <div>
            <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px]">3</span>
              When
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-400 font-medium mb-0.5 block">From</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 font-medium mb-0.5 block">To</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
            </div>
          </div>

          {/* Section 4: Employees */}
          <div>
            <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px]">4</span>
              Assign Employees
            </label>
            <div className="border border-gray-200 rounded-lg bg-white">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
                <input type="text" value={empSearch} onChange={e => setEmpSearch(e.target.value)}
                  placeholder="Search name or badge..." className="flex-1 text-xs bg-transparent outline-none placeholder:text-gray-400" />
                {empList.length > 0 && (
                  <button type="button" onClick={toggleSelectAll}
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-colors ${allSelected ? 'bg-brand-100 text-brand-700' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>
                    {allSelected ? 'Clear' : 'All'}
                  </button>
                )}
              </div>
              <div className="max-h-44 overflow-y-auto">
                {filteredEmps.length === 0 && (
                  <p className="text-xs text-gray-400 py-6 text-center">No employees on this device</p>
                )}
                {filteredEmps.map(e => {
                  const checked = selectedEmps.has(e.empid);
                  return (
                    <label key={e.empid}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer border-b border-gray-50 last:border-0 transition-colors min-w-0 ${checked ? 'bg-brand-50' : 'hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleEmp(e.empid)}
                        className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-semibold text-gray-800 block truncate">{e.name}</span>
                        <span className="text-[10px] text-gray-500 font-mono">ID {e.codeInDevice}</span>
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono shrink-0">#{e.badge}</span>
                    </label>
                  );
                })}
              </div>
              <div className="px-3 py-1.5 bg-gray-50 rounded-b-lg border-t border-gray-100 flex items-center justify-between">
                <span className="text-[10px] text-gray-400">
                  {empList.length} employees
                </span>
                {selectedEmps.size > 0 && (
                  <span className="text-[10px] font-bold text-brand-600">{selectedEmps.size} selected</span>
                )}
                {selectedEmps.size === 0 && (
                  <span className="text-[10px] text-gray-400 italic">None = whole device</span>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Submit */}
        <div className="px-4 pb-4 pt-1">
          <button type="submit" disabled={busy}
            className="w-full px-4 py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-2 shadow-sm">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CalendarPlus size={15} />}
            {busy ? 'Adding…' : selectedEmps.size > 0 ? `Add Rule for ${selectedEmps.size} Employee${selectedEmps.size > 1 ? 's' : ''}` : 'Add Rule for Whole Device'}
          </button>
        </div>
      </form>
    </div>
  );
}

function PoolPanel({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<{ pool_name: string; state: string; restart_command: string; note: string; detail: string } | null>(null);
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'restarting' | 'recovering' | 'recovered' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [lastCheck, setLastCheck] = useState<string>('—');
  const [countdown, setCountdown] = useState(20);
  const [checking, setChecking] = useState(false);

  function refresh() {
    setChecking(true);
    fetch(`${API_URL}/api/admin/pool`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: any) => {
        if (d) {
          setData(d);
          setLastCheck(new Date().toLocaleTimeString());
          // If we were recovering and the pool is back responding, mark recovered.
          setPhase(p => (p === 'recovering' && d.state === 'Started' ? 'recovered' : p));
        }
      })
      .catch(() => setData(null))
      .finally(() => setChecking(false));
  }

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      // Keep the status fresh, and ping health to detect when a recycling pool is back.
      if (phase === 'recovering') {
        fetch(`${API_URL}/api/server/health`, { cache: 'no-store' })
          .then(r => {
            if (r.ok) {
              setPhase('recovered');
              refresh();
            }
          })
          .catch(() => { /* still offline */ });
      }
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== 'recovering') return;
    setCountdown(20);
    const id = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  function restart() {
    setBusy(true);
    setResult(null);
    fetch(`${API_URL}/api/admin/pool/restart?key=${ADMIN_KEY}`, { method: 'POST' })
      .then(r => r.json().catch(() => ({})))
      .then((d: any) => {
        if (d && d.success) {
          setPhase('recovering');
        } else {
          setResult({ type: 'err', text: (d && d.error) || 'Restart failed' });
        }
      })
      .catch(() => {
        // The request itself may drop if the pool recycles immediately — assume it worked.
        setPhase('recovering');
      })
      .finally(() => setBusy(false));
  }

  const started = (data?.state ?? '').toLowerCase().includes('started');
  const dotClass = started ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <div className="flex flex-col">
      <PanelHeader title="Restart App Pool" onBack={onBack} />
      <div className="p-4 flex flex-col gap-4">

        {/* Status card */}
        <div className={`rounded-xl border-2 p-4 ${started ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
          <div className="flex items-center gap-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${started ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
              {started ? <ShieldCheck size={20} /> : <AlertCircle size={20} />}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">App Pool Status</p>
              <div className="flex items-center gap-2">
                <p className="text-base font-bold text-gray-900">
                  {started ? 'Running' : (data?.state ?? 'Checking…')}
                </p>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 ring-black/5 mt-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${started && phase !== 'recovering' ? 'animate-pulse ' + dotClass : dotClass}`} />
                  {phase === 'recovering' ? 'Recycling…' : started ? 'Healthy' : 'Stopped'}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {data?.pool_name ?? 'DefaultAppPool'} · Last checked {lastCheck}
              </p>
            </div>
            <button
              onClick={refresh}
              disabled={checking || phase === 'recovering'}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 shrink-0"
            >
              <RefreshCw size={12} className={checking ? 'animate-spin' : ''} /> Check
            </button>
          </div>
        </div>

        {/* Recovering / recovered banner */}
        {phase === 'recovering' && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-amber-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-amber-800">Dashboard is restarting…</p>
              <p className="text-[11px] text-amber-700">
                App pool is recycling. Expected back online in ~{countdown}s. This panel will detect when it recovers.
              </p>
              <div className="w-full h-1.5 bg-amber-200 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${Math.round((1 - countdown / 20) * 100)}%` }} />
              </div>
            </div>
          </div>
        )}

        {phase === 'recovered' && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 flex items-center gap-3">
            <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-emerald-800">Back online</p>
              <p className="text-[11px] text-emerald-700">The app pool restarted successfully and the dashboard is responding again.</p>
            </div>
            <button
              onClick={() => { setPhase('idle'); setResult(null); }}
              className="ml-auto px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-700 border border-emerald-300 bg-white hover:bg-emerald-50"
            >
              Dismiss
            </button>
          </div>
        )}

        {result && (
          <div className={`text-xs px-3 py-2 rounded-lg ${result.type === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'} flex items-center gap-1.5`}>
            {result.type === 'err' && <AlertCircle size={13} />}{result.text}
          </div>
        )}

        {/* Restart action */}
        {phase !== 'recovering' && (
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
              <Power size={14} className="text-rose-500" /> Restart App Pool
            </p>
            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
              {data?.note ?? 'Recycling reloads the backend (picks up recompiled code). The dashboard goes offline ~10–20s, then comes back with fresh data.'}
            </p>

            {phase === 'confirm' ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="text-xs font-semibold text-rose-700 flex items-center gap-1.5">
                  <AlertCircle size={13} /> Confirm restart — dashboard will go offline ~10–20s.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={restart} disabled={busy}
                    className="flex-1 px-3 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                    {busy ? 'Restarting…' : 'Yes, restart now'}
                  </button>
                  <button onClick={() => setPhase('idle')} disabled={busy}
                    className="px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setResult(null); setPhase('confirm'); }}
                className="mt-3 w-full px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Power size={14} /> Restart Pool
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
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

interface Emp {
  empid: number;
  name: string;
  badge: string;
  codeInDevice: string;
}

const SHIFT_PRESETS = [
  { key: 'G', label: 'General', time: '09:00 – 18:00', start: '09:00', end: '18:00', color: 'border-gray-300 bg-gray-50 text-gray-700', active: 'border-gray-500 bg-gray-100 text-gray-800 ring-2 ring-gray-300' },
  { key: '1st', label: '1st Shift', time: '06:00 – 14:00', start: '06:00', end: '14:00', color: 'border-blue-200 bg-blue-50 text-blue-700', active: 'border-blue-500 bg-blue-100 text-blue-800 ring-2 ring-blue-300' },
  { key: '2nd', label: '2nd Shift', time: '14:00 – 22:00', start: '14:00', end: '22:00', color: 'border-purple-200 bg-purple-50 text-purple-700', active: 'border-purple-500 bg-purple-100 text-purple-800 ring-2 ring-purple-300' },
  { key: 'Night', label: 'Night', time: '21:00 – 06:00', start: '21:00', end: '06:00', color: 'border-orange-200 bg-orange-50 text-orange-700', active: 'border-orange-500 bg-orange-100 text-orange-800 ring-2 ring-orange-300' },
  { key: 'Custom', label: 'Custom', time: 'Your times', start: '', end: '', color: 'border-emerald-200 bg-emerald-50 text-emerald-700', active: 'border-emerald-500 bg-emerald-100 text-emerald-800 ring-2 ring-emerald-300' },
];

function ShiftMgmtPanel({ locs, onBack }: { locs: Loc[]; onBack: () => void }) {
  const [device, setDevice] = useState<number>(locs[0]?.device_id ?? 25);
  const [empList, setEmpList] = useState<Emp[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmps, setSelectedEmps] = useState<Set<number>>(new Set());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [activePreset, setActivePreset] = useState('G');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [rules, setRules] = useState<ShiftRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [showRules, setShowRules] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadRules = useCallback(() => {
    setLoadingRules(true);
    fetch(`${API_URL}/api/rules?key=${ADMIN_KEY}`)
      .then(r => r.ok ? r.json() : { rules: [] })
      .then((d: any) => {
        setRules((d.rules || []).filter((r: any) => r.type === 'shift' && r.device_id === device));
      })
      .catch(() => setRules([]))
      .finally(() => setLoadingRules(false));
  }, [device]);

  useEffect(() => {
    setEmpList([]); setSelectedEmps(new Set()); setEmpSearch('');
    fetch(`${API_URL}/api/admin/employees?key=${ADMIN_KEY}`)
      .then(r => r.ok ? r.json() : { employees: [] })
      .then((d: any) => {
        const unique = new Map<number, any>();
        (d.employees || []).filter((e: any) => e.device_id === device && e.name && !/^\d+$/.test(e.name.trim()))
          .forEach((e: any) => { if (!unique.has(e.empid)) unique.set(e.empid, { empid: e.empid, name: e.name, badge: e.badge, codeInDevice: String(e.code_in_device || e.badge || '').padStart(4, '0') }); });
        setEmpList(Array.from(unique.values()));
      }).catch(() => setEmpList([]));
    loadRules();
  }, [device, loadRules]);

  const filteredEmps = useMemo(() => {
    if (!empSearch.trim()) return empList;
    const q = empSearch.toLowerCase();
    return empList.filter(e => e.name.toLowerCase().includes(q) || e.badge.includes(q) || e.codeInDevice.includes(q));
  }, [empList, empSearch]);

  const allSelected = filteredEmps.length > 0 && filteredEmps.every(e => selectedEmps.has(e.empid));

  function toggleSelectAll() { allSelected ? setSelectedEmps(new Set()) : setSelectedEmps(new Set(filteredEmps.map(e => e.empid))); }
  function toggleEmp(id: number) { setSelectedEmps(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function applyPreset(p: typeof SHIFT_PRESETS[number]) { setActivePreset(p.key); if (p.start) setStartTime(p.start); if (p.end) setEndTime(p.end); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const ids = selectedEmps.size > 0 ? Array.from(selectedEmps) : [];
      const bodies = ids.length > 0
        ? ids.map(empid => ({ device_id: device, type: 'shift', name: name.trim() || null, start_time: startTime, end_time: endTime, empid, start_date: startDate || null, end_date: endDate || null }))
        : [{ device_id: device, type: 'shift', name: name.trim() || null, start_time: startTime, end_time: endTime, start_date: startDate || null, end_date: endDate || null }];
      let ok = 0, fail = 0;
      for (const b of bodies) { try { const r = await fetch(`${API_URL}/api/rules?key=${ADMIN_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); r.ok ? ok++ : fail++; } catch { fail++; } }
      setMsg(ok > 0 && fail === 0 ? { type: 'ok', text: `Rule added for ${ok} employee${ok > 1 ? 's' : ''}` } : { type: 'err', text: `${ok} succeeded, ${fail} failed` });
      if (ok > 0) { setSelectedEmps(new Set()); setName(''); loadRules(); }
    } catch { setMsg({ type: 'err', text: 'Failed to connect' }); } finally { setBusy(false); }
  }

  async function deleteRule(id: number) {
    setDeletingId(id);
    try { const r = await fetch(`${API_URL}/api/rules/delete?key=${ADMIN_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (r.ok) setRules(p => p.filter(r => r.id !== id)); } catch {}
    setDeletingId(null);
  }

  return (
    <div className="flex flex-col max-h-[85vh]">
      <PanelHeader title="Shift Management" onBack={onBack} />
      <div className="overflow-y-auto flex-1 p-4 space-y-4">
        {msg && (
          <div className={`text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 ${msg.type === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {msg.type === 'err' && <AlertCircle size={13} />}{msg.text}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {/* Unit */}
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 block">1. Select Unit</label>
            <select value={device} onChange={e => setDevice(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30">
              {locs.map(l => <option key={l.device_id} value={l.device_id}>{l.name} — {l.location}</option>)}
            </select>
          </div>

          {/* Shift */}
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 block">2. Choose Shift</label>
            <div className="grid grid-cols-5 gap-1.5 mb-2">
              {SHIFT_PRESETS.map(p => (
                <button key={p.key} type="button" onClick={() => applyPreset(p)}
                  className={`py-2 rounded-lg text-center border-2 transition-all text-[10px] ${activePreset === p.key ? p.active : p.color}`}>
                  <span className="block font-bold">{p.key}</span>
                  <span className="block opacity-70">{p.time}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-gray-400 font-medium block mb-0.5">Start</label>
                <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); setActivePreset('Custom'); }}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <label className="text-[9px] text-gray-400 font-medium block mb-0.5">End</label>
                <input type="time" value={endTime} onChange={e => { setEndTime(e.target.value); setActivePreset('Custom'); }}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-gray-400 font-medium block mb-0.5">From (optional)</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="text-[9px] text-gray-400 font-medium block mb-0.5">To (optional)</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>

          {/* Employees */}
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 block">3. Assign Employees</label>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
                <input type="text" value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="Search..." className="flex-1 text-xs bg-transparent outline-none" />
                {empList.length > 0 && (
                  <button type="button" onClick={toggleSelectAll}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${allSelected ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'}`}>
                    {allSelected ? 'Clear' : 'All'}
                  </button>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto">
                {filteredEmps.length === 0 && <p className="text-[11px] text-gray-400 py-4 text-center">No employees</p>}
                {filteredEmps.map(e => (
                  <label key={e.empid} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-gray-50 last:border-0 min-w-0 ${selectedEmps.has(e.empid) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={selectedEmps.has(e.empid)} onChange={() => toggleEmp(e.empid)} className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0" />
                    <span className="text-[11px] font-medium text-gray-800 flex-1 truncate">{e.name}</span>
                    <span className="text-[9px] text-gray-500 font-mono shrink-0">ID {e.codeInDevice}</span>
                    <span className="text-[9px] text-gray-400 font-mono shrink-0">#{e.badge}</span>
                  </label>
                ))}
              </div>
              <div className="px-3 py-1 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                <span className="text-[9px] text-gray-400">{empList.length} employees</span>
                {selectedEmps.size > 0 ? <span className="text-[9px] font-bold text-blue-600">{selectedEmps.size} selected</span> : <span className="text-[9px] text-gray-400 italic">None = whole device</span>}
              </div>
            </div>
          </div>

          <button type="submit" disabled={busy}
            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />}
            {busy ? 'Adding…' : selectedEmps.size > 0 ? `Add Rule for ${selectedEmps.size} Employee${selectedEmps.size > 1 ? 's' : ''}` : 'Add Rule for Whole Device'}
          </button>
        </form>

        {/* Rules List */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={() => setShowRules(!showRules)} className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors">
            <div className="text-left">
              <span className="text-xs font-bold text-gray-800 block">Existing Rules</span>
              <span className="text-[10px] text-gray-500">{rules.length} shift rule{rules.length !== 1 ? 's' : ''}</span>
            </div>
            {showRules ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
          </button>
          {showRules && (
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
              {loadingRules ? (
                <div className="flex items-center justify-center py-6 text-gray-400 text-xs"><RefreshCw size={12} className="animate-spin mr-1.5" /> Loading...</div>
              ) : rules.length === 0 ? (
                <p className="text-[11px] text-gray-400 py-6 text-center">No rules</p>
              ) : rules.map(r => {
                const emp = empList.find(e => e.empid === r.empid);
                return (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                      <Clock size={9} />{r.start}–{r.end}
                    </span>
                    <span className="text-[11px] text-gray-700 flex-1 truncate">{emp ? `${emp.name} (ID ${emp.codeInDevice})` : <em className="text-gray-400">Whole device</em>}</span>
                    <span className="text-[9px] text-gray-400 shrink-0">{r.start_date || ''}{r.start_date && r.end_date ? '→' : ''}{r.end_date || ''}</span>
                    <button onClick={() => deleteRule(r.id)} disabled={deletingId === r.id} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 shrink-0">
                      {deletingId === r.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
