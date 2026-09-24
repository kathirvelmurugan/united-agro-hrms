import { useEffect, useMemo, useState } from 'react';
import { Users, Search, Plus, Pencil, Trash2, RefreshCw, CheckCircle2, AlertTriangle, Clock3, Database } from 'lucide-react';
import { API_URL } from '../data/mockData';
import { authFetch } from '../lib/auth';

export const ROSTER_UNITS = [58, 42, 59, 23, 25, 24];

export const UNIT_LABELS: Record<number, string> = {
  58: 'Uai Nkp Unit',
  42: 'SS Slp Unit',
  59: 'Head office',
  23: 'SS TVP Unit',
  25: 'Nsrl Lab',
  24: 'SS Sidco',
};

interface RosterRow {
  id: number;
  device_id: number;
  code: string | null;
  name: string;
  enrolled: boolean;
  in_master: boolean;
  db_name: string | null;
}

interface Unit {
  device_id: number;
  name: string;
  location: string;
}

function unitLabel(u: Unit): string {
  return UNIT_LABELS[u.device_id] ?? u.name;
}

export default function RosterPage({ role }: { role: string }) {
  const canEdit = role === 'superadmin' || role === 'admin';
  const [units, setUnits] = useState<Unit[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selUnit, setSelUnit] = useState<number>(58);
  const [query, setQuery] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formUnit, setFormUnit] = useState<number>(58);
  const [editing, setEditing] = useState<RosterRow | null>(null);

  async function fetchAll() {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([
        authFetch(`${API_URL}/api/locations`).then(x => (x.ok ? x.json() : [])).catch(() => []),
        authFetch(`${API_URL}/api/roster`).then(x => (x.ok ? x.json() : null)).catch(() => null),
      ]);
      if (Array.isArray(u) && u.length) setUnits(u);
      if (r && Array.isArray(r.roster)) {
        setRoster(r.roster);
        if (Array.isArray(r.units) && r.units.length && units.length === 0) setUnits(r.units);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchAll(); }, []);

  const orderedUnits = useMemo(() => {
    const map = new Map(units.map(u => [u.device_id, u]));
    const list: Unit[] = [];
    for (const id of ROSTER_UNITS) {
      list.push(map.get(id) ?? { device_id: id, name: UNIT_LABELS[id] ?? `Device ${id}`, location: '' });
    }
    for (const u of units) {
      if (!ROSTER_UNITS.includes(u.device_id)) list.push(u);
    }
    return list;
  }, [units]);

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of roster) m.set(r.device_id, (m.get(r.device_id) ?? 0) + 1);
    return m;
  }, [roster]);

  const pending = useMemo(() => roster.filter(r => !r.code).length, [roster]);
  const notOnDevice = useMemo(() => roster.filter(r => r.code && !r.enrolled).length, [roster]);

  const shown = useMemo(() => {
    let list = roster.filter(r => r.device_id === selUnit);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(q) || (r.code ?? '').includes(q));
    }
    return list;
  }, [roster, selUnit, query]);

  async function handleSave(e: React.FormEvent, moveTo?: number) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        device_id: moveTo ?? formUnit,
        code: formCode.trim() || null,
        name: formName.trim(),
      };
      if (editing) body.id = editing.id;
      const r = await authFetch(`${API_URL}/api/roster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error || 'Save failed'); return; }
      setFormName(''); setFormCode(''); setEditing(null); setShowAdd(false);
      await fetchAll();
      setMsg(editing ? 'Updated.' : 'Added to roster.');
    } catch { setMsg('Cannot connect to server'); }
    finally { setBusy(false); }
  }

  async function handleMove(row: RosterRow, toDevice: number) {
    if (!canEdit || toDevice === row.device_id) return;
    if (!window.confirm(`Move "${row.name}" to ${UNIT_LABELS[toDevice] ?? toDevice}?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await authFetch(`${API_URL}/api/roster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, device_id: toDevice, code: row.code, name: row.name }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error || 'Move failed'); return; }
      await fetchAll();
      setMsg(`Moved "${row.name}".`);
    } catch { setMsg('Cannot connect to server'); }
    finally { setBusy(false); }
  }

  async function handleDelete(row: RosterRow) {
    if (!canEdit) return;
    if (!window.confirm(`Remove "${row.name}" from the roster? (ESSL device data is untouched)`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await authFetch(`${API_URL}/api/roster`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error || 'Delete failed'); return; }
      await fetchAll();
      setMsg(`Removed "${row.name}".`);
    } catch { setMsg('Cannot connect to server'); }
    finally { setBusy(false); }
  }

  async function handleSeed() {
    if (!canEdit) return;
    if (!window.confirm('Load the authorised 98-name unit list into the roster? Existing rows are skipped.')) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await authFetch(`${API_URL}/api/roster/seed`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error || 'Seed failed'); return; }
      await fetchAll();
      setMsg(`Roster loaded: ${d.inserted} added, ${d.skipped} already present (total ${d.total}).`);
    } catch { setMsg('Cannot connect to server'); }
    finally { setBusy(false); }
  }

  function startEdit(row: RosterRow) {
    setEditing(row);
    setFormName(row.name);
    setFormCode(row.code ?? '');
    setFormUnit(row.device_id);
    setShowAdd(true);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <Users size={14} className="text-white" />
          </div>
          <div className="min-w-0 mr-auto">
            <h1 className="text-sm font-semibold text-gray-900">Unit Roster</h1>
            <p className="text-[11px] text-gray-500">
              Authorised employees per unit — stored in the ESSL server — {roster.length} total
              {pending > 0 && <span className="text-amber-600 font-semibold"> · {pending} pending ID</span>}
              {notOnDevice > 0 && <span className="text-red-500 font-semibold"> · {notOnDevice} not on device</span>}
            </p>
          </div>
          <button onClick={fetchAll}
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {canEdit && (
            <button onClick={handleSeed} disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-50">
              <Database size={13} /> Load 98-name list
            </button>
          )}
          {canEdit && (
            <button onClick={() => { setEditing(null); setFormName(''); setFormCode(''); setFormUnit(selUnit); setShowAdd(s => !s); }}
              className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg bg-brand-600 text-white text-[11px] font-semibold hover:bg-brand-700">
              <Plus size={13} /> Add employee
            </button>
          )}
        </div>
        {msg && (
          <p className="mt-2 text-[11px] px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">{msg}</p>
        )}
        {!canEdit && (
          <p className="mt-2 text-[11px] text-gray-400">View only — roster edits are restricted to admins.</p>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
          {orderedUnits.map(u => (
            <button key={u.device_id} onClick={() => setSelUnit(u.device_id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selUnit === u.device_id
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              {unitLabel(u)} ({counts.get(u.device_id) ?? 0})
            </button>
          ))}
        </div>

        <div className="relative mb-3 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search name or punch ID..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500" />
        </div>

        {canEdit && showAdd && (
          <form onSubmit={handleSave}
            className="mb-3 bg-white border border-brand-200 rounded-xl p-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Unit</label>
              <select value={formUnit} onChange={e => setFormUnit(Number(e.target.value))}
                className="h-9 px-2 rounded-lg border border-gray-200 text-sm text-gray-800 focus:outline-none">
                {orderedUnits.map(u => (
                  <option key={u.device_id} value={u.device_id}>{unitLabel(u)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Punch ID (blank = pending)</label>
              <input value={formCode} onChange={e => setFormCode(e.target.value)}
                placeholder="e.g. 12"
                className="h-9 w-32 px-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Name</label>
              <input value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="Employee name" required
                className="h-9 w-full px-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
            <button type="submit" disabled={busy}
              className="h-9 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
              {editing ? 'Save' : 'Add'}
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setEditing(null); }}
              className="h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </form>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/80">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Punch ID</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">ESSL status</th>
                  {canEdit && <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={canEdit ? 4 : 3} className="px-3 py-8 text-center text-sm text-gray-400">Loading roster...</td></tr>
                ) : shown.length === 0 ? (
                  <tr><td colSpan={canEdit ? 4 : 3} className="px-3 py-8 text-center text-sm text-gray-400">
                    {roster.length === 0 ? 'Roster is empty — click "Load 98-name list" to load your unit list.' : 'No employees match.'}
                  </td></tr>
                ) : shown.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.code
                        ? <span className="text-xs font-mono font-bold text-gray-900">{r.code}</span>
                        : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            <Clock3 size={10} /> Pending ID
                          </span>}
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-xs font-medium text-gray-800">{r.name}</p>
                      {r.db_name && r.code && r.db_name.toLowerCase() !== r.name.toLowerCase() && (
                        <p className="text-[10px] text-amber-600">Device shows “{r.db_name}”</p>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {!r.code ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                          <Clock3 size={10} /> Awaiting punch ID
                        </span>
                      ) : r.enrolled ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          <CheckCircle2 size={10} /> On device
                        </span>
                      ) : r.in_master ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          <AlertTriangle size={10} /> Not on device
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
                          <AlertTriangle size={10} /> Not in ESSL
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        <select value={r.device_id} disabled={busy}
                          onChange={e => handleMove(r, Number(e.target.value))}
                          title="Move to unit"
                          className="h-7 mr-1 px-1 rounded-md border border-gray-200 text-[11px] text-gray-600 focus:outline-none">
                          {orderedUnits.map(u => (
                            <option key={u.device_id} value={u.device_id}>{unitLabel(u)}</option>
                          ))}
                        </select>
                        <button onClick={() => startEdit(r)} title="Edit"
                          className="p-1.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-brand-50">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(r)} title="Remove"
                          className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-gray-400">
          Roster lives in the ESSL server database (UARoster table). “On device” means the punch ID is enrolled on that unit’s device.
          Removing a roster row does not delete device enrolment — use Admin → Manage Employees for that.
        </p>
      </div>
    </div>
  );
}
