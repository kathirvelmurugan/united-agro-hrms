import { useEffect, useState, useMemo } from 'react';
import { Clock, Building2, Search, CheckCircle2, LogIn, LogOut, CalendarDays, Loader2 } from 'lucide-react';
import { API_URL } from '../data/mockData';
import { authFetch } from '../lib/auth';

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
}

interface AllLiveData {
  branches: { device_id: number; name: string; location: string; present: number; absent: number; deviceStatus: string; lastUpdated: string }[];
  present: number;
  absent: number;
  employees: CombinedEmployee[];
  lastUpdated: string;
}

export default function AttendancePage() {
  const [data, setData] = useState<AllLiveData | null>(null);
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [isLoading, setIsLoading] = useState(false);

  const isToday = useMemo(
    () => selectedDate === new Date().toISOString().slice(0, 10),
    [selectedDate]
  );

  async function fetchToday() {
    try {
      const r = await authFetch(`${API_URL}/api/live/all`);
      if (r.ok) setData(await r.json());
    } catch { /* ignore */ }
  }

  async function fetchDay(date: string) {
    try {
      setIsLoading(true);
      const r = await authFetch(`${API_URL}/api/export/punches?from=${date}&to=${date}`);
      if (r.ok) {
        const j = await r.json();
        const rows: { id: string; name: string; branch: string; punches: string[]; punchDirs: string[] }[] = j.rows ?? [];
        const branchMap: Record<string, string> = {};
        const employees: CombinedEmployee[] = rows.map(row => {
          branchMap[row.branch] = row.branch;
          const dirs = row.punchDirs ?? [];
          const lastDir = dirs.length ? dirs[dirs.length - 1] : '---';
          return {
            id: row.id,
            name: row.name,
            status: lastDir === 'IN' ? 'IN' : 'OUT',
            lastPunch: row.punches[row.punches.length - 1] ?? '',
            lastPunchRaw: '',
            punchTimes: row.punches,
            punchDirs: dirs,
            branch: row.branch,
            location: row.branch,
          };
        });
        employees.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
        setData({
          branches: Object.values(branchMap).map(name => ({
            device_id: 0,
            name,
            location: name,
            present: 0,
            absent: 0,
            deviceStatus: 'Online',
            lastUpdated: 'historical',
          })),
          present: employees.filter(e => e.status === 'IN').length,
          absent: employees.filter(e => e.status === 'OUT').length,
          employees,
          lastUpdated: date,
        });
      }
    } catch { /* ignore */ } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (isToday) {
      fetchToday();
      const id = setInterval(fetchToday, 5000);
      return () => clearInterval(id);
    }
    fetchDay(selectedDate);
    return undefined;
  }, [selectedDate, isToday]);

  const branches = useMemo(() => data?.branches.map(b => b.name) ?? [], [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.employees;
    if (branch !== 'all') list = list.filter(e => e.branch === branch);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.id.includes(q));
    }
    return list;
  }, [data, query, branch]);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function punchPairs(punches: string[], dirs: string[]): { in: string | null; out: string | null }[] {
    const pairs: { in: string | null; out: string | null }[] = [];
    let cur: { in: string | null; out: string | null } = { in: null, out: null };
    for (let i = 0; i < punches.length; i++) {
      const inPunch = !dirs[i] || dirs[i] === 'IN';
      if (inPunch) {
        if (cur.in == null) cur.in = punches[i];
      } else if (cur.in != null) {
        cur.out = punches[i];
      } else {
        cur.in = punches[i];
        cur.out = null;
      }
      if (cur.in != null && (cur.out != null || !inPunch || i === punches.length - 1)) {
        if (cur.out != null) {
          pairs.push(cur);
          cur = { in: null, out: null };
        }
      }
    }
    if (cur.in != null) pairs.push(cur);
    return pairs;
  }

  function punchSummary(pairs: { in: string | null; out: string | null }[]): string {
    if (pairs.length === 0) return '';
    return pairs.map(p => p.out ? `${p.in} → ${p.out}` : `${p.in} → --`).join(', ');
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <Clock size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900">Today's Attendance Log</h1>
            <p className="text-[11px] text-gray-500">Punch timeline for each employee &ndash; {selectedDate}{!isToday ? '' : ` · ${data?.lastUpdated ?? 'live'}`}</p>
          </div>
          <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
            <CheckCircle2 size={12} /> {data?.present ?? 0} IN
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {!data ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span className="text-sm">{isLoading ? 'Loading punches for selected day...' : 'Loading attendance...'}</span>
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
              <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg pl-2 pr-1 py-1">
                <CalendarDays size={14} className="text-gray-400" />
                <input
                  type="date"
                  value={selectedDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={e => {
                    if (e.target.value) {
                      setExpanded(new Set());
                      setBranch('all');
                      setSelectedDate(e.target.value);
                    }
                  }}
                  className="text-xs text-gray-700 focus:outline-none"
                />
                {!isToday && (
                  <button
                    onClick={() => { setSelectedDate(new Date().toISOString().slice(0, 10)); setExpanded(new Set()); }}
                    className="px-2 py-1 rounded-md text-[11px] font-semibold bg-brand-50 text-brand-700 hover:bg-brand-100"
                  >
                    Today
                  </button>
                )}
              </div>
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

            <div className="space-y-2">
              {filtered.map(e => {
                const id = `${e.branch}-${e.id}`;
                const isOpen = expanded.has(id);
                const pairs = punchPairs(e.punchTimes, e.punchDirs);
                return (
                  <div key={id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <button onClick={() => toggle(id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 text-left">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        e.status === 'IN' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'
                      }`}>
                        {e.status === 'IN' ? <LogIn size={16} /> : <LogOut size={16} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-800 truncate">{e.name}</p>
                        <p className="text-[11px] text-gray-400 flex items-center gap-1"><Building2 size={11} /> {e.branch} / {e.id}</p>
                        {pairs.length > 0 && (
                          <p className="text-[10px] text-gray-500 mt-0.5 font-mono">{punchSummary(pairs)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs font-semibold ${e.status === 'IN' ? 'text-emerald-600' : 'text-red-500'}`}>
                          {e.punchTimes.length === 0 ? 'No punch' : e.status === 'IN' ? `${pairs.length} in` : `${pairs.length} in / out`}
                        </span>
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                          e.status === 'IN' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                        }`}>
                          {e.status}
                        </span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/40">
                        {e.punchTimes.length === 0 ? (
                          <p className="text-xs text-gray-400">No punches recorded on {selectedDate}</p>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 mb-2">
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                                {e.punchTimes.length} punch{e.punchTimes.length === 1 ? '' : 'es'} · {selectedDate}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {e.punchTimes.map((t, i) => {
                                const dir = e.punchDirs?.[i];
                                const isIn = dir !== 'OUT';
                                return (
                                  <div key={i} className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 ${
                                    isIn ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
                                  }`}>
                                    {isIn ? <LogIn size={12} className="text-emerald-500" /> : <LogOut size={12} className="text-red-400" />}
                                    <span className="font-semibold text-gray-800 text-xs">{t}</span>
                                    <span className={`text-[10px] font-bold ${isIn ? 'text-emerald-600' : 'text-red-500'}`}>
                                      {isIn ? 'IN' : 'OUT'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            {pairs.length > 0 && (
                              <p className="mt-2 text-[11px] text-gray-400">
                                Total {pairs.length} IN&rarr;OUT pair{pairs.length === 1 ? '' : 's'}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 py-14 text-center text-sm text-gray-400">No attendance records found</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
