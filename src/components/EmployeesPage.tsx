import { useEffect, useState, useMemo } from 'react';
import { Users, Search, Clock, Building2, ChevronRight } from 'lucide-react';
import { API_URL } from '../data/mockData';
import { deriveStatus, STATUS_META } from '../lib/status';
import EmployeeMonthlyModal, { type EmployeeRef } from './EmployeeMonthlyModal';

interface CombinedEmployee {
  id: string;
  name: string;
  status: 'IN' | 'OUT';
  lastPunch: string;
  lastPunchRaw: string;
  punchTimes: string[];
  punchDirs: string[];
  branch: string;
  location: string;
  device_id: number;
}

interface AllLiveData {
  branches: { device_id: number; name: string; location: string; present: number; absent: number; deviceStatus: string; lastUpdated: string }[];
  present: number;
  absent: number;
  employees: CombinedEmployee[];
  lastUpdated: string;
}

export default function EmployeesPage({ title = 'Employees', deviceId = null }: { title?: string; deviceId?: number | null }) {
  const [data, setData] = useState<AllLiveData | null>(null);
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('all');
  const [selected, setSelected] = useState<EmployeeRef | null>(null);

  async function fetchData() {
    try {
      const url = deviceId ? `${API_URL}/api/live/${deviceId}` : `${API_URL}/api/live/all`;
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        let liveData: AllLiveData;
        if (deviceId) {
          liveData = {
            branches: [{ device_id: deviceId, name: d.deviceName, location: d.deviceLocation, present: d.present, absent: d.absent, deviceStatus: d.deviceStatus, lastUpdated: d.lastUpdated }],
            present: d.present,
            absent: d.absent,
            employees: d.employees.map((e: any) => ({ ...e, branch: d.deviceName, location: d.deviceLocation, device_id: deviceId })),
            lastUpdated: d.lastUpdated,
          };
        } else {
          liveData = d;
        }
        // Merge unenrolled punched employees from export/punches + ensure 5 Uai Nkp Unit always visible
        const NKP_CORRECT_NAMES: Record<string, string> = {
          '3': 'P Arumugam',
          '11': 'C Nadesan',
          '12': 'Mahaboob alli basha',
          '14': 'A Manohar',
          '17': 'Virendhar',
        };
        function nkpName(branch: string, id: string, fallback: string) {
          const raw = String(id).replace(/^0+/, '') || '0';
          if (branch === 'UAI Neikarapatti' && NKP_CORRECT_NAMES[raw]) return NKP_CORRECT_NAMES[raw];
          if (!fallback || /^Employee\s*\d+$/i.test(fallback)) {
            return NKP_CORRECT_NAMES[raw] || fallback || `Employee ${raw}`;
          }
          return fallback;
        }
        // apply correct names and fix lastPunch: don't show first punch as last when still IN (logout)
        liveData.employees = liveData.employees.map(e => {
          const lastDir = e.punchDirs?.[e.punchDirs.length - 1];
          const isStillIn = lastDir === 'IN' || (e.punchTimes.length === 1 && e.status === 'IN');
          // if still IN, lastPunch should be empty (no logout yet), not duplicate of first
          const fixedLast = isStillIn ? '' : (e.lastPunch || '');
          return {
            ...e,
            name: nkpName(e.branch, e.id, e.name),
            lastPunch: fixedLast,
            lastPunchRaw: isStillIn ? '' : e.lastPunchRaw,
          };
        });
        try {
          const today = new Date().toISOString().slice(0, 10);
          const er = await fetch(`${API_URL}/api/export/punches?from=${today}&to=${today}`);
          if (er.ok) {
            const ej = await er.json();
            const existing = new Set(liveData.employees.map(e => `${e.branch}|${e.id}`));
            const existingRaw = new Set(liveData.employees.map(e => `${e.branch}|${String(e.id).replace(/^0+/, '')}`));
            const extras: CombinedEmployee[] = [];
            for (const row of (ej.rows ?? [])) {
              const paddedId = String(row.id).padStart(4, '0');
              const rawId = String(row.id).replace(/^0+/, '');
              const key = `${row.branch}|${paddedId}`;
              const key2 = `${row.branch}|${row.id}`;
              const key3 = `${row.branch}|${rawId}`;
              if (!existing.has(key) && !existing.has(key2) && !existingRaw.has(key3) && (row.punches?.length ?? 0) > 0) {
                const br = liveData.branches.find(b => b.name === row.branch);
                const lastDirRow = row.punchDirs?.[row.punchDirs.length - 1];
                const isStillInRow = lastDirRow === 'IN' || (row.punches.length === 1 && lastDirRow !== 'OUT');
                extras.push({
                  id: paddedId,
                  name: nkpName(row.branch, row.id, row.name),
                  status: (lastDirRow === 'OUT' ? 'OUT' : 'IN') as any,
                  lastPunch: isStillInRow ? '' : (row.punches[row.punches.length - 1] || ''),
                  lastPunchRaw: '',
                  punchTimes: row.punches || [],
                  punchDirs: row.punchDirs || [],
                  branch: row.branch,
                  location: row.branch,
                  device_id: br?.device_id ?? 58,
                });
              }
            }
            // Ensure the 5 Uai Nkp Unit employees always appear even if no punch today (as Absent)
            const missingIds = ['14', '3', '11', '17', '12'];
            for (const mid of missingIds) {
              const padded = mid.padStart(4, '0');
              const key = `UAI Neikarapatti|${padded}`;
              const keyRaw = `UAI Neikarapatti|${mid}`;
              if (!existing.has(key) && !existingRaw.has(keyRaw) && !extras.some(e => e.id === padded)) {
                const br = liveData.branches.find(b => b.name === 'UAI Neikarapatti');
                extras.push({
                  id: padded,
                  name: NKP_CORRECT_NAMES[mid],
                  status: 'OUT',
                  lastPunch: '',
                  lastPunchRaw: '',
                  punchTimes: [],
                  punchDirs: [],
                  branch: 'UAI Neikarapatti',
                  location: 'UAI Neikarapatti',
                  device_id: br?.device_id ?? 58,
                });
              }
            }
            if (extras.length > 0) {
              liveData = { ...liveData, employees: [...liveData.employees, ...extras] };
            }
          }
        } catch { /* ignore merge */ }
        setData(liveData);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, []);

  const branches = useMemo(() => {
    return data?.branches.map(b => b.name) ?? [];
  }, [data]);

  const isHiddenEmp = (branch: string, id: string) => {
    const raw = String(id).replace(/^0+/, '');
    // Hide employee 1 from head office (UAI HEAD OFFICE) as requested
    if (branch === 'UAI HEAD OFFICE' && (raw === '1' || id === '0001')) return true;
    return false;
  };
  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.employees.filter(e => !isHiddenEmp(e.branch, e.id));
    if (branch !== 'all') list = list.filter(e => e.branch === branch);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.id.includes(q));
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [data, query, branch]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <Users size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900">{title}</h1>
            <p className="text-[11px] text-gray-500">All employees across branches &ndash; {data ? data.employees.filter(e => !isHiddenEmp(e.branch, e.id)).length : 0} total</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {!data ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <span className="text-sm">Loading employees...</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search name or ID..."
                  className="pl-9 pr-3 py-2 w-64 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                />
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <button onClick={() => setBranch('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    branch === 'all' ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  All ({data.employees.length})
                </button>
                {branches.map(b => (
                  <button key={b} onClick={() => setBranch(b)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      branch === b ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/80">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">ID</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Branch</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">First Punch</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Last Punch</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase">Monthly</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(e => (
                      <tr
                        key={`${e.branch}-${e.id}`}
                        onClick={() => setSelected({ id: e.id, name: e.name, branch: e.branch, device_id: e.device_id })}
                        className="hover:bg-brand-50/40 cursor-pointer group"
                        title="Click to view monthly attendance"
                      >
                        <td className="px-4 py-2.5 text-sm font-mono text-gray-500">{e.id}</td>
                        <td className="px-4 py-2.5 text-sm font-medium text-gray-800 group-hover:text-brand-700">{e.name}</td>
                        <td className="px-4 py-2.5 text-sm text-gray-600 flex items-center gap-1"><Building2 size={12} className="text-gray-300" /> {e.branch}</td>
                        <td className="px-4 py-2.5">
                          {(() => {
                            const st = deriveStatus(e);
                            return (
                              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_META[st].badge}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[st].dot}`} />
                                {STATUS_META[st].label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-600">{e.punchTimes[0] || '--:--:--'}</td>
                        <td className="px-4 py-2.5 text-sm text-gray-600 flex items-center gap-1"><Clock size={12} className="text-gray-300" /> {e.lastPunch || '--:--:--'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 opacity-0 group-hover:opacity-100 transition-opacity">
                            View <ChevronRight size={12} />
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">No employees found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <EmployeeMonthlyModal employee={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
