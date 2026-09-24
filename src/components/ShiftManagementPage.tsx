import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, Clock, Target, RefreshCw, CalendarPlus, Trash2, Loader2, AlertCircle, ChevronDown, ChevronUp, Pencil, X
} from 'lucide-react';
import { API_URL } from '../data/mockData';
import { authFetch } from '../lib/auth';

interface Loc {
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
  { key: 'Custom', label: 'Custom', time: 'Your own times', start: '', end: '', color: 'border-emerald-200 bg-emerald-50 text-emerald-700', active: 'border-emerald-500 bg-emerald-100 text-emerald-800 ring-2 ring-emerald-300' },
];

export default function ShiftManagementPage() {
  const [locs, setLocs] = useState<Loc[]>([]);
  const [device, setDevice] = useState<number>(0);
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
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    authFetch(`${API_URL}/api/locations`)
      .then(r => r.ok ? r.json() : [])
      .then((l: Loc[]) => { setLocs(l); if (l.length > 0) setDevice(l[0].device_id); })
      .catch(() => setLocs([]));
  }, []);

  useEffect(() => {
    if (!device) return;
    setEmpList([]);
    setSelectedEmps(new Set());
    setEmpSearch('');
    authFetch(`${API_URL}/api/admin/employees`)
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
      })
      .catch(() => setEmpList([]));
    loadRules();
  }, [device]);

  const loadRules = useCallback(() => {
    if (!device) return;
    setLoadingRules(true);
    authFetch(`${API_URL}/api/rules`)
      .then(r => r.ok ? r.json() : { rules: [] })
      .then((d: any) => {
        const shiftRules = (d.rules || []).filter((r: any) => r.type === 'shift' && r.device_id === device);
        setRules(shiftRules);
      })
      .catch(() => setRules([]))
      .finally(() => setLoadingRules(false));
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

  function applyPreset(preset: typeof SHIFT_PRESETS[number]) {
    setActivePreset(preset.key);
    if (preset.start) setStartTime(preset.start);
    if (preset.end) setEndTime(preset.end);
  }

  function startEdit(r: ShiftRule) {
    setEditingId(r.id);
    setDevice(r.device_id);
    setStartTime(r.start);
    setEndTime(r.end);
    const found = SHIFT_PRESETS.find(p => p.start === r.start && p.end === r.end);
    setActivePreset(found ? found.key : 'Custom');
    setStartDate(r.start_date || '');
    setEndDate(r.end_date || '');
    if (r.empid) setSelectedEmps(new Set([r.empid]));
    else setSelectedEmps(new Set());
    setName(r.name || '');
    setMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setStartTime('09:00'); setEndTime('18:00'); setActivePreset('G');
    setStartDate(''); setEndDate(''); setName(''); setSelectedEmps(new Set());
    setMsg(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      // Edit mode: update single rule by id
      if (editingId !== null) {
        const empidForEdit = selectedEmps.size === 1 ? Array.from(selectedEmps)[0] : (selectedEmps.size === 0 ? null : Array.from(selectedEmps)[0]);
        const body: Record<string, unknown> = {
          id: editingId,
          device_id: device, type: 'shift', name: name.trim() || null,
          start_time: startTime, end_time: endTime, empid: empidForEdit,
          start_date: startDate || null, end_date: endDate || null,
        };
        const r = await authFetch(`${API_URL}/api/rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setMsg({ type: 'err', text: d.error || 'Update failed' });
        } else {
          setMsg({ type: 'ok', text: 'Shift rule updated' });
          setEditingId(null);
          setSelectedEmps(new Set());
          setName('');
          loadRules();
        }
        return;
      }

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
          const r = await authFetch(`${API_URL}/api/rules`, {
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
        loadRules();
      } else {
        setMsg({ type: 'err', text: `${okCount} succeeded, ${failCount} failed` });
      }
    } catch {
      setMsg({ type: 'err', text: 'Failed to connect to server' });
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(id: number) {
    setDeletingId(id);
    try {
      const r = await authFetch(`${API_URL}/api/rules/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (r.ok) {
        setRules(prev => prev.filter(r => r.id !== id));
      }
    } catch { /* ignore */ }
    setDeletingId(null);
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 text-gray-800 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Target size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 tracking-tight">Shift Management</h1>
              <p className="text-[11px] text-gray-500">Allocate and manage shift rules for all units</p>
            </div>
          </div>
          <button onClick={loadRules} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Message */}
          {msg && (
            <div className={`text-sm px-4 py-3 rounded-xl flex items-center gap-2 ${msg.type === 'ok' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
              {msg.type === 'err' && <AlertCircle size={15} />}{msg.text}
            </div>
          )}

          {/* Add / Edit Rule Form */}
          <form onSubmit={submit} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${editingId !== null ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-200'}`}>
            <div className={`px-6 py-4 border-b flex items-center justify-between ${editingId !== null ? 'bg-amber-50/70 border-amber-100' : 'bg-gray-50/50 border-gray-100'}`}>
              <div>
                <h2 className="text-sm font-bold text-gray-800">{editingId !== null ? 'Edit Shift Rule' : 'Add Shift Rule'}</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">{editingId !== null ? `Editing rule #${editingId} — update times, dates or employee` : 'Create a shift schedule for employees — From/To dates make it apply only for future dates'}</p>
              </div>
              {editingId !== null && (
                <button type="button" onClick={cancelEdit} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                  <X size={12} /> Cancel edit
                </button>
              )}
            </div>

            <div className="p-6 space-y-5">

              {/* Unit */}
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px]">1</span>
                  Select Unit
                </label>
                <select value={device} onChange={e => setDevice(parseInt(e.target.value))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400">
                  {locs.map(l => <option key={l.device_id} value={l.device_id}>{l.name} — {l.location}</option>)}
                </select>
              </div>

              {/* Shift Presets */}
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px]">2</span>
                  Choose Shift
                </label>
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {SHIFT_PRESETS.map(p => (
                    <button key={p.key} type="button" onClick={() => applyPreset(p)}
                      className={`px-2 py-3 rounded-lg text-center border-2 transition-all ${activePreset === p.key ? p.active : p.color + ' hover:shadow-sm'}`}>
                      <span className="block text-xs font-bold">{p.key}</span>
                      <span className="block text-[10px] mt-0.5">{p.label}</span>
                      <span className="block text-[9px] opacity-60 mt-0.5">{p.time}</span>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium mb-0.5 block">Start</label>
                    <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); setActivePreset('Custom'); }}
                      className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium mb-0.5 block">End</label>
                    <input type="time" value={endTime} onChange={e => { setEndTime(e.target.value); setActivePreset('Custom'); }}
                      className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                  </div>
                </div>
              </div>

              {/* Date Range */}
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px]">3</span>
                  Date Range
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium mb-0.5 block">From (optional)</label>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                      className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium mb-0.5 block">To (optional)</label>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                      className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                  </div>
                </div>
              </div>

              {/* Employees */}
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px]">4</span>
                  Assign Employees
                </label>
                <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                    <Search size={13} className="text-gray-400" />
                    <input type="text" value={empSearch} onChange={e => setEmpSearch(e.target.value)}
                      placeholder="Search name, badge, or ID..." className="flex-1 text-xs bg-transparent outline-none placeholder:text-gray-400" />
                    {empList.length > 0 && (
                      <button type="button" onClick={toggleSelectAll}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-colors ${allSelected ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>
                        {allSelected ? 'Clear' : 'Select All'}
                      </button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {filteredEmps.length === 0 && (
                      <p className="text-xs text-gray-400 py-8 text-center">No employees on this device</p>
                    )}
                    {filteredEmps.map(e => {
                      const checked = selectedEmps.has(e.empid);
                      return (
                        <label key={e.empid}
                          className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-gray-50 last:border-0 transition-colors min-w-0 ${checked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleEmp(e.empid)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-semibold text-gray-800 block truncate">{e.name}</span>
                            <span className="text-[10px] text-gray-500 font-mono">ID {e.codeInDevice}</span>
                          </div>
                          <span className="text-[10px] text-gray-400 font-mono shrink-0">#{e.badge}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">{empList.length} employees</span>
                    {selectedEmps.size > 0 ? (
                      <span className="text-[10px] font-bold text-blue-600">{selectedEmps.size} selected</span>
                    ) : (
                      <span className="text-[10px] text-gray-400 italic">None selected = whole device</span>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* Submit */}
            <div className="px-6 pb-6 space-y-2">
              <button type="submit" disabled={busy}
                className={`w-full px-4 py-3 disabled:opacity-60 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm ${editingId !== null ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : editingId !== null ? <Pencil size={15} /> : <CalendarPlus size={15} />}
                {busy ? (editingId !== null ? 'Updating…' : 'Adding…') : editingId !== null ? 'Update Shift Rule' : selectedEmps.size > 0 ? `Add Shift Rule for ${selectedEmps.size} Employee${selectedEmps.size > 1 ? 's' : ''}` : 'Add Shift Rule for Whole Device'}
              </button>
              {editingId !== null && (
                <p className="text-[11px] text-amber-600 text-center">Editing rule #{editingId} — From/To dates control future applicability. Leave To empty for open-ended.</p>
              )}
            </div>
          </form>

          {/* Existing Rules */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <button onClick={() => setShowRules(!showRules)}
              className="w-full flex items-center justify-between px-6 py-4 bg-gray-50/50 hover:bg-gray-50 transition-colors border-b border-gray-100">
              <div>
                <h2 className="text-sm font-bold text-gray-800 text-left">Existing Shift Rules</h2>
                <p className="text-[11px] text-gray-500 mt-0.5 text-left">{rules.length} shift rule{rules.length !== 1 ? 's' : ''} on this unit</p>
              </div>
              {showRules ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
            </button>

            {showRules && (
              <div className="max-h-96 overflow-y-auto">
                {loadingRules ? (
                  <div className="flex items-center justify-center py-8 text-gray-400">
                    <RefreshCw size={14} className="animate-spin mr-2" /> Loading rules...
                  </div>
                ) : rules.length === 0 ? (
                  <p className="text-xs text-gray-400 py-8 text-center">No shift rules on this device</p>
                ) : (
                  <table className="w-full">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                        <th className="px-4 py-2 text-left">Shift</th>
                        <th className="px-4 py-2 text-left">Employee</th>
                        <th className="px-4 py-2 text-left">Date Range</th>
                        <th className="px-4 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rules.map(r => {
                        const emp = empList.find(e => e.empid === r.empid);
                        return (
                          <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                <Clock size={10} />
                                {r.start} – {r.end}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              {emp ? (
                                <div>
                                  <span className="text-xs font-medium text-gray-800">{emp.name}</span>
                                  <span className="text-[10px] text-gray-400 ml-1.5 font-mono">ID {emp.codeInDevice}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400 italic">Whole device</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-gray-500">
                              {r.start_date || r.end_date ? (
                                <span>{r.start_date || '...'} → {r.end_date || '...'}</span>
                              ) : (
                                <span className="text-gray-400 italic">No limit</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button onClick={() => startEdit(r)} title="Edit shift / dates / employee"
                                  className={`p-1.5 rounded-lg transition-colors ${editingId === r.id ? 'bg-amber-100 text-amber-700' : 'hover:bg-blue-50 text-gray-400 hover:text-blue-600'}`}>
                                  <Pencil size={13} />
                                </button>
                                <button onClick={() => deleteRule(r.id)} disabled={deletingId === r.id}
                                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50">
                                  {deletingId === r.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
