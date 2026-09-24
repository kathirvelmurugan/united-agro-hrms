import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, Clock, X, Target, RefreshCw
} from 'lucide-react';
import { API_URL } from '../data/mockData';
import { authFetch } from '../lib/auth';

const UNITS = [
  { id: 0, name: 'All Units', short: 'ALL' },
  { id: 25, name: 'NSRL Lab', short: 'NSRL' },
  { id: 58, name: 'UAI NKP', short: 'NKP' },
  { id: 24, name: 'SS Sidco', short: 'SIDCO' },
  { id: 23, name: 'SS Theevattipatti', short: 'TVP' },
  { id: 42, name: 'SS SLP', short: 'SLP' },
  { id: 59, name: 'UAI HEAD OFFICE', short: 'HO' },
];

const SHIFT_META: Record<string, { color: string; bg: string; border: string }> = {
  'G':     { color: 'text-gray-700',  bg: 'bg-gray-100',  border: 'border-gray-300' },
  '1st':   { color: 'text-blue-700',  bg: 'bg-blue-50',   border: 'border-blue-300' },
  '2nd':   { color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-300' },
  'Night': { color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-300' },
  'W.Off': { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300' },
  'Holiday': { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300' },
};

const PRIORITY_META: Record<string, { label: string; color: string; bg: string }> = {
  urgent:   { label: 'Urgent',   color: 'text-rose-700',   bg: 'bg-rose-50 border-rose-200' },
  important:{ label: 'Important', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  normal:   { label: 'On Track', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
};

interface MonthlyStats {
  present: number;
  absent: number;
  late: number;
  totalHours: number;
  offCount: number;
  holidayCount: number;
  shift: string;
  first: string | null;
  last: string | null;
}

interface ShiftEmployee {
  id: string;
  name: string;
  branch: string;
  device_id: number;
  badge: string;
  todayShift: string;
  status: string;
  hours: number;
  punchTimes: string[];
  punchDirs: string[];
  monthlyStats: MonthlyStats;
  priority: 'urgent' | 'important' | 'normal';
}

type SortKey = 'name' | 'shift' | 'status' | 'hours' | 'late';
type FilterStatus = 'all' | 'present' | 'absent' | 'late' | 'off';

function inferShiftFromPunches(punchTimes: string[]): { shift: string; first: string | null; last: string | null; hours: number } {
  if (!punchTimes || punchTimes.length === 0) return { shift: 'G', first: null, last: null, hours: 0 };

  const parseTime = (t: string): number => {
    const match = t.match(/(\d+):(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return 0;
    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const s = parseInt(match[3]);
    const ap = match[4].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 3600 + m * 60 + s;
  };

  const first = punchTimes[0];
  const last = punchTimes[punchTimes.length - 1];
  const firstSec = parseTime(first);
  const lastSec = parseTime(last);

  let shift = 'G';
  if (firstSec <= 3 * 3600 || firstSec >= 22 * 3600) shift = 'Night';
  else if (firstSec <= 7 * 3600) shift = '1st';
  else if (firstSec >= 12 * 3600 && firstSec <= 15 * 3600) shift = '2nd';

  let totalSec = lastSec - firstSec;
  if (totalSec < 0) totalSec += 24 * 3600;
  let hours = totalSec / 3600;

  // Deduct lunch if >5h
  if (hours > 5) {
    let hasLunchPunch = false;
    const lunchStart = 13 * 3600;
    const lunchEnd = 14 * 3600;
    for (const pt of punchTimes) {
      const s = parseTime(pt);
      if (s >= lunchStart && s <= lunchEnd) { hasLunchPunch = true; break; }
    }
    if (!hasLunchPunch && hours > 5) hours -= 1;
  }

  return { shift, first, last, hours: Math.round(hours * 10) / 10 };
}

export default function ShiftPipelinePage() {
  const [selectedUnit, setSelectedUnit] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [employees, setEmployees] = useState<ShiftEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmp, setSelectedEmp] = useState<ShiftEmployee | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const liveRes = await authFetch(`${API_URL}/api/live/all`);
      const liveData = await liveRes.json();

      const empList: ShiftEmployee[] = [];

      for (const emp of liveData.employees || []) {
        if (!emp.device_id || !emp.id) continue;

        const { shift: todayShift, first, last, hours } = inferShiftFromPunches(emp.punchTimes || []);

        let empStatus: string;
        if (emp.punchTimes && emp.punchTimes.length > 0) {
          empStatus = 'on_time';
        } else {
          empStatus = 'absent';
        }

        let priority: 'urgent' | 'important' | 'normal' = 'normal';

        empList.push({
          id: emp.id,
          name: emp.name || `Employee ${emp.id}`,
          branch: emp.branch || 'Unknown',
          device_id: emp.device_id,
          badge: emp.id,
          todayShift,
          status: empStatus,
          hours,
          punchTimes: emp.punchTimes || [],
          punchDirs: emp.punchDirs || [],
          monthlyStats: { present: 0, absent: 0, late: 0, totalHours: 0, offCount: 0, holidayCount: 0, shift: todayShift, first, last },
          priority,
        });
      }

      // Fetch monthly stats for each employee in background
      const month = new Date().toISOString().slice(0, 7);
      const batchSize = 10;
      for (let i = 0; i < empList.length; i += batchSize) {
        const batch = empList.slice(i, i + batchSize);
        await Promise.all(batch.map(async (emp) => {
          try {
            const r = await authFetch(`${API_URL}/api/employee/monthly?device_id=${emp.device_id}&id=${encodeURIComponent(emp.id)}&days=31&month=${month}`);
            const d = await r.json();
            const latest = d.months?.[d.months.length - 1];
            const today = new Date().toISOString().slice(0, 10);
            const todayRow = (d.days || []).find((x: any) => x.date === today);

            emp.monthlyStats = {
              present: latest?.present || 0,
              absent: latest?.absent || 0,
              late: latest?.late || 0,
              totalHours: latest?.total_hours || 0,
              offCount: latest?.off_count || 0,
              holidayCount: latest?.holiday_count || 0,
              shift: todayRow?.shift || emp.todayShift,
              first: todayRow?.first || null,
              last: todayRow?.last || null,
            };

            if (latest && (latest.late || 0) >= 8 || (latest.absent || 0) >= 5) emp.priority = 'urgent';
            else if (latest && (latest.late || 0) >= 4 || (latest.absent || 0) >= 3) emp.priority = 'important';

            if (todayRow) {
              emp.todayShift = todayRow.shift || emp.todayShift;
              emp.status = todayRow.status || emp.status;
            }
          } catch { /* skip */ }
        }));
      }

      setEmployees(empList);
    } catch (err) {
      console.error('Failed to load shift data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData, refreshKey]);

  const filtered = useMemo(() => {
    let list = employees;
    if (selectedUnit !== 0) list = list.filter(e => e.device_id === selectedUnit);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.badge.includes(q) ||
        e.branch.toLowerCase().includes(q) ||
        e.todayShift.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      list = list.filter(e => {
        if (statusFilter === 'present') return e.status === 'on_time' || e.status === 'late';
        if (statusFilter === 'absent') return e.status === 'absent' || e.status === 'no_data';
        if (statusFilter === 'late') return e.status === 'late';
        if (statusFilter === 'off') return e.status === 'weekly_off' || e.status === 'holiday';
        return true;
      });
    }
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'shift') cmp = a.todayShift.localeCompare(b.todayShift);
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortKey === 'hours') cmp = a.hours - b.hours;
      else if (sortKey === 'late') cmp = a.monthlyStats.late - b.monthlyStats.late;
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [employees, selectedUnit, searchQuery, statusFilter, sortKey, sortAsc]);

  const stats = useMemo(() => ({
    total: filtered.length,
    present: filtered.filter(e => e.status === 'on_time' || e.status === 'late').length,
    late: filtered.filter(e => e.status === 'late').length,
    absent: filtered.filter(e => e.status === 'absent' || e.status === 'no_data').length,
    off: filtered.filter(e => e.status === 'weekly_off' || e.status === 'holiday').length,
  }), [filtered]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortAsc(a => !a);
    else { setSortKey(k); setSortAsc(true); }
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
              <p className="text-[11px] text-gray-500">Real-time shift allocation across all units</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-mono">{stats.total} employees</span>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Unit Tabs */}
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
          {UNITS.map(u => (
            <button
              key={u.id}
              onClick={() => setSelectedUnit(u.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedUnit === u.id
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
              }`}
            >
              {u.short}
            </button>
          ))}
        </div>

        {/* Search + Filters */}
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, badge, unit, shift..."
              className="w-full pl-9 pr-20 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            />
            {searchQuery && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-blue-600 font-semibold">
                {filtered.length} matches found
              </span>
            )}
          </div>
          <div className="flex gap-1">
            {(['all', 'present', 'late', 'absent', 'off'] as FilterStatus[]).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-all ${
                  statusFilter === f
                    ? f === 'all' ? 'bg-gray-600 text-white'
                    : f === 'present' ? 'bg-emerald-600 text-white'
                    : f === 'late' ? 'bg-amber-500 text-white'
                    : f === 'absent' ? 'bg-rose-500 text-white'
                    : 'bg-indigo-500 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Bar */}
        <div className="flex gap-4 mt-3 text-[10px] font-semibold uppercase tracking-wider">
          <span className="text-gray-500">Total <span className="text-gray-800 ml-1">{stats.total}</span></span>
          <span className="text-emerald-600">Present <span className="text-emerald-700 ml-1">{stats.present}</span></span>
          <span className="text-amber-600">Late <span className="text-amber-700 ml-1">{stats.late}</span></span>
          <span className="text-rose-600">Absent <span className="text-rose-700 ml-1">{stats.absent}</span></span>
          <span className="text-indigo-600">Off <span className="text-indigo-700 ml-1">{stats.off}</span></span>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-gray-400">
              <RefreshCw size={16} className="animate-spin" />
              <span className="text-sm">Loading shift data...</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Search size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-medium">No employees match your filters</p>
            <p className="text-xs text-gray-400 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            {/* Sort Controls */}
            <div className="flex items-center gap-2 mb-3 text-[10px] text-gray-500">
              <span className="uppercase tracking-wider font-semibold">Sort by:</span>
              {(['name', 'shift', 'status', 'hours', 'late'] as SortKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => toggleSort(k)}
                  className={`px-2 py-1 rounded-md font-semibold uppercase tracking-wider transition-colors ${
                    sortKey === k ? 'bg-gray-200 text-gray-800' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {k} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
                </button>
              ))}
            </div>

            {/* Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
              {filtered.map((emp, idx) => (
                <EmployeeCard
                  key={`${emp.device_id}-${emp.id}`}
                  employee={emp}
                  rank={idx + 1}
                  onClick={() => setSelectedEmp(emp)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Detail Panel */}
      {selectedEmp && (
        <DetailPanel employee={selectedEmp} onClose={() => setSelectedEmp(null)} />
      )}
    </div>
  );
}

function EmployeeCard({ employee: emp, rank, onClick }: {
  employee: ShiftEmployee;
  rank: number;
  onClick: () => void;
}) {
  const shift = SHIFT_META[emp.todayShift] || SHIFT_META['G'];
  const prio = PRIORITY_META[emp.priority];
  const statusColor =
    emp.status === 'on_time' ? 'text-emerald-600' :
    emp.status === 'late' ? 'text-amber-600' :
    emp.status === 'weekly_off' ? 'text-indigo-600' :
    emp.status === 'holiday' ? 'text-purple-600' :
    'text-rose-600';
  const initials = emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div
      onClick={onClick}
      className="group bg-white border border-gray-200 rounded-xl p-3.5 cursor-pointer hover:border-blue-300 hover:shadow-md transition-all duration-200"
    >
      {/* Header: Rank + Priority + Shift Badge */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-gray-400">#{rank}</span>
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${shift.bg} ${shift.color} ${shift.border}`}>
            {emp.todayShift}
          </span>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${prio.bg} ${prio.color}`}>
          {prio.label}
        </span>
      </div>

      {/* Avatar + Name */}
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-gray-900 truncate leading-tight">{emp.name}</h3>
          <p className="text-[10px] text-gray-500 truncate">Badge {emp.badge}</p>
        </div>
      </div>

      {/* Unit Tag */}
      <div className="flex items-center gap-1.5 mb-3">
        <span className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded-md text-[10px] font-semibold text-gray-600">
          {emp.branch}
        </span>
      </div>

      {/* Punch Info */}
      <div className="flex items-center gap-3 text-[10px] text-gray-500 mb-2.5">
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {emp.monthlyStats.first || emp.punchTimes?.[0] || '--:--'}
        </span>
        <span className="text-gray-300">→</span>
        <span>{emp.monthlyStats.last || emp.punchTimes?.[emp.punchTimes.length - 1] || '--:--'}</span>
        <span className={`ml-auto font-semibold ${statusColor}`}>
          {emp.hours > 0 ? `${emp.hours.toFixed(1)}h` : '--'}
        </span>
      </div>

      {/* Monthly Summary Mini */}
      <div className="flex items-center gap-2 text-[9px] font-semibold pt-2.5 border-t border-gray-100">
        <span className="text-emerald-600">{emp.monthlyStats.present}P</span>
        <span className="text-amber-600">{emp.monthlyStats.late}L</span>
        <span className="text-rose-600">{emp.monthlyStats.absent}A</span>
        <span className="text-indigo-600">{emp.monthlyStats.offCount}W</span>
        <span className="text-purple-600">{emp.monthlyStats.holidayCount}H</span>
        <span className="ml-auto text-gray-400">{emp.monthlyStats.totalHours.toFixed(0)}h</span>
      </div>
    </div>
  );
}

function DetailPanel({ employee: emp, onClose }: {
  employee: ShiftEmployee;
  onClose: () => void;
}) {
  const shift = SHIFT_META[emp.todayShift] || SHIFT_META['G'];
  const prio = PRIORITY_META[emp.priority];
  const initials = emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-md bg-white border-l border-gray-200 shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold text-white shadow-lg shadow-blue-500/20">
                {initials}
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900">{emp.name}</h2>
                <p className="text-[11px] text-gray-500">{emp.branch} · Badge {emp.badge}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Task Header Card */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono text-gray-400">#1</span>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${shift.bg} ${shift.color} ${shift.border}`}>
                {emp.todayShift}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${prio.bg} ${prio.color}`}>
                {prio.label}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">
              #{emp.badge}: {emp.name} - {emp.todayShift} Shift
            </h3>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-[10px] font-semibold text-gray-600">
                {emp.branch}
              </span>
            </div>
          </div>

          {/* Shift Info */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Current Shift</h4>
            <div className="flex items-center gap-3">
              <div className={`px-4 py-2 rounded-lg border ${shift.bg} ${shift.color} ${shift.border} text-sm font-bold`}>
                {emp.todayShift}
              </div>
              <div>
                <p className="text-sm text-gray-800 font-semibold">
                  {emp.monthlyStats.first || emp.punchTimes?.[0] || '--:--'} → {emp.monthlyStats.last || emp.punchTimes?.[emp.punchTimes.length - 1] || '--:--'}
                </p>
                <p className="text-[10px] text-gray-500">{emp.hours.toFixed(1)}h worked today</p>
              </div>
            </div>
          </div>

          {/* Monthly Stats */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Monthly Summary</h4>
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: 'Present', value: emp.monthlyStats.present, color: 'text-emerald-600' },
                { label: 'Late', value: emp.monthlyStats.late, color: 'text-amber-600' },
                { label: 'Absent', value: emp.monthlyStats.absent, color: 'text-rose-600' },
                { label: 'W.Off', value: emp.monthlyStats.offCount, color: 'text-indigo-600' },
                { label: 'Holiday', value: emp.monthlyStats.holidayCount, color: 'text-purple-600' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-lg p-2 text-center border border-gray-200">
                  <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-[9px] text-gray-500 uppercase">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between text-[10px]">
              <span className="text-gray-500">Total Hours</span>
              <span className="font-bold text-gray-800">{emp.monthlyStats.totalHours.toFixed(1)}h</span>
            </div>
          </div>

          {/* Punch Log */}
          {emp.punchTimes && emp.punchTimes.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Today's Punches</h4>
              <div className="space-y-1.5">
                {emp.punchTimes.map((pt, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-white border border-gray-100">
                    <span className="text-[10px] text-gray-500 font-mono w-20">{pt}</span>
                    <span className={`text-[10px] font-semibold ${
                      emp.punchDirs?.[i]?.toUpperCase() === 'IN' ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {emp.punchDirs?.[i]?.toUpperCase() || 'IN'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Accountable Owner */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Accountable Owner</h4>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shadow-md">
                A
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-800">Admin</p>
                <p className="text-[10px] text-gray-500">Unit Manager</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
