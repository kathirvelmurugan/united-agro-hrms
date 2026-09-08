import { useEffect, useState, useMemo } from 'react';
import { BarChart3, Flame, CalendarClock, Clock4, Trophy, TrendingUp, RefreshCw } from 'lucide-react';
import { API_URL } from '../data/mockData';
import EmployeeMonthlyModal, { type EmployeeRef } from './EmployeeMonthlyModal';

interface EmployeeStats {
  id: string;
  name: string;
  branch: string;
  device_id: number;
  present_days: number;
  absent_days: number;
  working_days: number;
  on_time_days: number;
  late_days: number;
  current_on_time_streak: number;
  best_on_time_streak: number;
  current_late_streak: number;
  best_late_streak: number;
  week: { present: number; on_time: number; late: number };
  month: { present_days: number; total_hours: number; avg_hours: number };
}

interface AnalyticsData {
  generated: string;
  range_days: number;
  employees: EmployeeStats[];
  leaders: {
    on_time_streak: EmployeeStats[];
    late_streak: EmployeeStats[];
    week_on_time: EmployeeStats[];
    week_late: EmployeeStats[];
    month_hours: EmployeeStats[];
  };
}

function Medal({ i }: { i: number }) {
  const colors = ['bg-yellow-400', 'bg-gray-300', 'bg-amber-600'];
  return (
    <span className={`w-5 h-5 rounded-full ${colors[i] ?? 'bg-gray-100'} text-white text-[11px] font-bold flex items-center justify-center shrink-0`}>
      {i + 1}
    </span>
  );
}

function LeaderCard({
  title, icon, color, list, renderRight, empty,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  list: EmployeeStats[];
  renderRight: (e: EmployeeStats) => string;
  empty: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <span className={`${color} p-1.5 rounded-lg`}>{icon}</span>
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="flex-1 divide-y divide-gray-50">
        {list.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-gray-400">{empty}</div>
        )}
        {list.map((e, i) => (
          <div key={`${title}-${e.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/60">
            <Medal i={i} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800 truncate">{e.name}</p>
              <p className="text-[11px] text-gray-400 truncate">{e.branch} Â· {e.present_days} present</p>
            </div>
            <span className="text-sm font-bold text-gray-900 shrink-0">{renderRight(e)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState('all');
  const [sortKey, setSortKey] = useState<keyof EmployeeStats>('present_days');
  const [selected, setSelected] = useState<EmployeeRef | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_URL}/api/analytics`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const branches = useMemo(() => {
    if (!data) return [] as string[];
    return Array.from(new Set(data.employees.map(e => e.branch))).sort();
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [] as EmployeeStats[];
    let list = data.employees;
    if (branch !== 'all') list = list.filter(e => e.branch === branch);
    return [...list].sort((a, b) => {
      const ka = sortKey === 'week' ? a.week.on_time : sortKey === 'month' ? a.month.avg_hours : a[sortKey];
      const kb = sortKey === 'week' ? b.week.on_time : sortKey === 'month' ? b.month.avg_hours : b[sortKey];
      return (kb as number) - (ka as number);
    });
  }, [data, branch, sortKey]);

  const sortBtn = (k: keyof EmployeeStats, label: string) => (
    <button
      onClick={() => setSortKey(k)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        sortKey === k ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <BarChart3 size={14} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-gray-900">Owner Analytics</h1>
            <p className="text-[11px] text-gray-500">
              Streaks &amp; leaders (30 days) &middot; working stats for the current month{data ? ` Â· updated ${data.generated}` : ''}
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        {!data && !error && (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <span className="text-sm">Computing analytics...</span>
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
              <LeaderCard
                title="On-Time Streak"
                icon={<Flame size={14} className="text-emerald-500" />}
                color="bg-emerald-50"
                list={data.leaders.on_time_streak}
                renderRight={e => `${e.current_on_time_streak}d`}
                empty="No streaks yet"
              />
              <LeaderCard
                title="Late Streak"
                icon={<Clock4 size={14} className="text-orange-500" />}
                color="bg-orange-50"
                list={data.leaders.late_streak}
                renderRight={e => `${e.current_late_streak}d`}
                empty="Everyone on time!"
              />
              <LeaderCard
                title="This Week On-Time"
                icon={<CalendarClock size={14} className="text-brand-500" />}
                color="bg-brand-50"
                list={data.leaders.week_on_time}
                renderRight={e => `${e.week.on_time}/${e.week.present}`}
                empty="No data this week"
              />
              <LeaderCard
                title="This Week Late"
                icon={<TrendingUp size={14} className="text-red-500" />}
                color="bg-red-50"
                list={data.leaders.week_late}
                renderRight={e => `${e.week.late}`}
                empty="No late days this week"
              />
              <LeaderCard
                title="Avg Hours / Month"
                icon={<Trophy size={14} className="text-yellow-500" />}
                color="bg-yellow-50"
                list={data.leaders.month_hours}
                renderRight={e => `${e.month.avg_hours}h`}
                empty="Not enough data"
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 mr-1">
                  <BarChart3 size={14} className="text-gray-400" />
                  <h2 className="text-sm font-semibold text-gray-800">All Employees ({rows.length})</h2>
                </div>
                <div className="flex-1" />
                <select
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                  className="text-xs font-medium rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-gray-600 outline-none focus:border-brand-500"
                >
                  <option value="all">All branches</option>
                  {branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <div className="flex gap-1.5">
                  {sortBtn('present_days', 'Present')}
                  {sortBtn('working_days', 'Working')}
                  {sortBtn('on_time_days', 'On-Time')}
                  {sortBtn('late_days', 'Late')}
                  {sortBtn('week', 'Week')}
                  {sortBtn('month', 'Hours')}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/80">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Employee</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Branch</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase">Present</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase">Absent</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase">Working Days</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-emerald-600 uppercase">On-Time</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-orange-600 uppercase">Late</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase">Streak</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase">Best Streak</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase">Week O/L</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase">Avg Hrs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(e => (
                      <tr
                        key={`${e.device_id}-${e.id}`}
                        onClick={() => setSelected({ id: e.id, name: e.name, branch: e.branch, device_id: e.device_id })}
                        className="hover:bg-brand-50/40 cursor-pointer group"
                        title="Click to view monthly attendance"
                      >
                        <td className="px-4 py-2.5">
                          <p className="text-sm font-medium text-gray-800 group-hover:text-brand-700">{e.name}</p>
                          <p className="text-[11px] text-gray-400">{e.id}</p>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-500">{e.branch}</td>
                        <td className="px-4 py-2.5 text-center text-sm font-semibold text-gray-800">{e.present_days}</td>
                        <td className="px-4 py-2.5 text-center text-sm text-gray-500">{e.absent_days}</td>
                        <td className="px-4 py-2.5 text-center text-sm font-semibold text-gray-700">{e.working_days}</td>
                        <td className="px-4 py-2.5 text-center text-sm font-semibold text-emerald-600">{e.on_time_days}</td>
                        <td className="px-4 py-2.5 text-center text-sm font-semibold text-blue-600">{e.late_days}</td>
                        <td className="px-4 py-2.5 text-center text-sm font-bold text-gray-900">
                          {e.current_on_time_streak > 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <Flame size={12} /> {e.current_on_time_streak}
                            </span>
                          ) : e.current_late_streak > 0 ? (
                            <span className="inline-flex items-center gap-1 text-orange-600">
                              <Clock4 size={12} /> {e.current_late_streak}
                            </span>
                          ) : (
                            <span className="text-gray-300">0</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center text-sm text-gray-500">{e.best_on_time_streak}d</td>
                        <td className="px-4 py-2.5 text-center text-sm text-gray-700">
                          {e.week.on_time}<span className="text-gray-300">/</span>{e.week.late}
                        </td>
                        <td className="px-4 py-2.5 text-center text-sm font-semibold text-gray-800">{e.month.avg_hours}h</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={11} className="px-4 py-10 text-center text-sm text-gray-400">No employees match this branch</td></tr>
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
