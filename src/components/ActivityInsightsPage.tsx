import { useEffect, useState, useMemo } from 'react';
import { Activity, TrendingDown, AlarmClock, Users, Building2 } from 'lucide-react';
import { API_URL } from '../data/mockData';
import { authFetch } from '../lib/auth';
import { parsePunchTime, isLate, lateInfo } from '../lib/status';

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

function formatMin(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

export default function ActivityInsightsPage() {
  const [data, setData] = useState<AllLiveData | null>(null);

  async function fetchData() {
    try {
      const r = await authFetch(`${API_URL}/api/live/all`);
      if (r.ok) setData(await r.json());
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, []);

  const present = useMemo(() => {
    return data ? data.employees.filter(e => e.status === 'IN') : [];
  }, [data]);

  const stats = useMemo(() => {
    const withFirstIn = present
      .map(e => ({ e, first: parsePunchTime(e.punchTimes[0]) }))
      .filter((x): x is { e: CombinedEmployee; first: number } => x.first != null);

    let earliest: { name: string; branch: string; time: number } | null = null;
    let sum = 0;
    for (const { e, first } of withFirstIn) {
      sum += first;
      if (!earliest || first < earliest.time) earliest = { name: e.name, branch: e.branch, time: first };
    }
    const avg = withFirstIn.length ? Math.round(sum / withFirstIn.length) : null;

    const late = withFirstIn.filter(x => isLate(x.e)).map(x => ({ e: x.e, time: x.first, info: lateInfo(x.e) })).sort((a, b) => b.time - a.time);
    const early = withFirstIn.filter(x => !isLate(x.e)).map(x => ({ e: x.e, time: x.first })).sort((a, b) => a.time - b.time);

    return { earliest, avg, late, early, total: withFirstIn.length };
  }, [present]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <Activity size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900">Activity Insights</h1>
            <p className="text-[11px] text-gray-500">Early logins, late arrivals &amp; average check-in &ndash; {data?.lastUpdated ?? 'live'}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {!data ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <span className="text-sm">Loading activity...</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-2 text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">
                  <TrendingDown size={14} className="text-emerald-500" /> Earliest Login
                </div>
                <p className="text-xl font-bold text-gray-900">{stats.earliest ? formatMin(stats.earliest.time) : '--'}</p>
                {stats.earliest && (
                  <p className="text-xs text-gray-500 mt-1 truncate">{stats.earliest.name} <span className="text-gray-400">/ {stats.earliest.branch}</span></p>
                )}
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-2 text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">
                  <Users size={14} className="text-brand-500" /> Average Check-in
                </div>
                <p className="text-xl font-bold text-gray-900">{stats.avg != null ? formatMin(stats.avg) : '--'}</p>
                <p className="text-xs text-gray-500 mt-1">Across {stats.total} present employees</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-2 text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">
                  <AlarmClock size={14} className="text-orange-500" /> Late Arrivals
                </div>
                <p className="text-xl font-bold text-blue-600">{stats.late.length}</p>
                <p className="text-xs text-gray-500 mt-1">After branch shift start</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <AlarmClock size={14} className="text-orange-500" />
                  <h2 className="text-sm font-semibold text-gray-800">Late Arrivals ({stats.late.length})</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/80">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Name</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Branch</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">First Punch</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Late By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {stats.late.map(({ e, time, info }) => (
                        <tr key={`${e.branch}-${e.id}`} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 text-sm font-medium text-gray-800">{e.name}</td>
                          <td className="px-4 py-2.5 text-sm text-gray-500">{e.branch}</td>
                          <td className="px-4 py-2.5 text-sm font-semibold text-orange-600">{formatMin(time)}</td>
                          <td className="px-4 py-2.5 text-sm text-gray-600">
                            {info.isLate ? (
                              <span className="inline-flex items-center gap-1 text-orange-700 font-semibold">
                                {info.minutes}m <span className="text-gray-400 font-normal">Â· {info.shift} shift</span>
                              </span>
                            ) : '--'}
                          </td>
                        </tr>
                      ))}
                      {stats.late.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">No late arrivals today</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <TrendingDown size={14} className="text-emerald-500" />
                  <h2 className="text-sm font-semibold text-gray-800">Early / On-Time Logins ({stats.early.length})</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/80">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Name</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Branch</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">First Punch</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {stats.early.map(({ e, time }) => (
                        <tr key={`${e.branch}-${e.id}`} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 text-sm font-medium text-gray-800 flex items-center gap-1.5">
                            <Building2 size={12} className="text-gray-300" /> {e.name}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-gray-500">{e.branch}</td>
                          <td className="px-4 py-2.5 text-sm font-semibold text-emerald-600">{formatMin(time)}</td>
                        </tr>
                      ))}
                      {stats.early.length === 0 && (
                        <tr><td colSpan={3} className="px-4 py-10 text-center text-sm text-gray-400">No logins yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
