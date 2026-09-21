import { useEffect, useState, useMemo } from 'react';
import { X, CalendarDays, CheckCircle2, AlertTriangle, XCircle, Clock4, Timer, User, Link2, Download } from 'lucide-react';
import { API_URL } from '../data/mockData';
import { shiftForEmployee, shiftSeconds } from '../lib/status';

export interface EmployeeRef {
  id: string;
  name: string;
  branch: string;
  device_id: number;
  linked?: { device_id: number; branch: string; id: string }[];
  schedule?: string | null;
  schedule_pattern?: string | null;
}

interface MonthSummary {
  month: string;
  present: number;
  absent: number;
  adjusted_absent: number;
  on_time: number;
  late: number;
  total_hours: number;
  late_hours: number;
  extra_count: number;
  extra_hours: number;
  permission_count: number;
  permission_hours: number;
  half_day_count: number;
  overtime_count: number;
  overtime_hours: number;
  off_count?: number;
  holiday_count?: number;
}

interface DayRow {
  date: string;
  dow: string;
  status: 'on_time' | 'late' | 'absent' | 'no_data' | 'weekly_off' | 'holiday' | 'permission';
  first: string | null;
  last: string | null;
  hours: number;
  shift: string | null;
  late_min: number;
  day_type?: 'present' | 'half_day' | 'permission';
  extra_min?: number;
  lunch?: boolean;
  incomplete?: boolean;
  scheduled_device?: number | null;
  scheduled_branch?: string | null;
  day_device?: number | null;
  rule_type?: string | null;
  rule_name?: string | null;
  rule_hours?: number | null;
}

interface MonthlyData {
  employee: EmployeeRef;
  months: MonthSummary[];
  days: DayRow[];
}

const SIMPLE_MODE_DEVICES: number[] = [];

const formatLateMins = (mins: number): string =>
  mins < 60 ? `${mins}m` : mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h ${mins % 60}m`;

const STATUS_META: Record<DayRow['status'], { label: string; badge: string; dot: string }> = {
  on_time: { label: 'On Time', badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  late: { label: 'Late', badge: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  absent: { label: 'Absent', badge: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  no_data: { label: 'No Data', badge: 'bg-gray-50 text-gray-500', dot: 'bg-gray-400' },
  weekly_off: { label: 'Weekly Off', badge: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  holiday: { label: 'Holiday', badge: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' },
  permission: { label: 'Permission', badge: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
};

type FilterKey =
  | 'present' | 'late' | 'extra' | 'worked' | 'permission'
  | 'half' | 'absent' | 'leaves' | 'overtime' | 'ontime' | 'off' | 'holiday';

const FILTER_PREDICATES: Record<FilterKey, (d: DayRow) => boolean> = {
  present: d => d.status === 'on_time' || d.status === 'late',
  late: d => d.status === 'late',
  extra: d => (d.extra_min ?? 0) > 0,
  worked: d => d.status === 'on_time' || d.status === 'late',
  permission: d => d.day_type === 'permission' || d.status === 'permission',
  half: d => d.day_type === 'half_day',
  absent: d => d.status === 'absent',
  leaves: d => d.status === 'absent' || d.day_type === 'half_day',
  overtime: d => (d.extra_min ?? 0) > 0,
  ontime: d => d.status === 'on_time',
  off: d => d.rule_type === 'weekly_off',
  holiday: d => d.rule_type === 'holiday',
};

const FILTER_LABELS: Record<FilterKey, string> = {
  present: 'Present days', late: 'Late days', extra: 'Extra-work days', worked: 'Present days',
  permission: 'Permission days', half: 'Half-day leaves', absent: 'Absent days', leaves: 'Leave days',
  overtime: 'Overtime days', ontime: 'On-time days', off: 'Weekly-off days', holiday: 'Holiday days',
};

function StatCard({ label, value, sub, color, onClick, active }: { label: string; value: string | number; sub?: string; color: string; onClick?: () => void; active?: boolean }) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-white rounded-lg border p-3 text-left transition-colors ${
        active ? 'border-brand-500 ring-2 ring-brand-500/20 bg-brand-50/60 shadow-sm' : 'border-gray-200'
      } ${clickable ? 'cursor-pointer hover:border-brand-300 hover:shadow-sm' : ''}`}
    >
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${color} leading-tight`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </button>
  );
}

export default function EmployeeMonthlyModal({ employee, onClose }: { employee: EmployeeRef | null; onClose: () => void }) {
  const [data, setData] = useState<MonthlyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState<string>('');
  const [filter, setFilter] = useState<FilterKey | null>(null);
  const toggleFilter = (k: FilterKey) => setFilter(f => (f === k ? null : k));

  useEffect(() => {
    if (!employee) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMonth('');
    fetch(`${API_URL}/api/employee/monthly?device_id=${employee.device_id}&id=${encodeURIComponent(employee.id)}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: MonthlyData) => {
        if (cancelled) return;
        setData(d);
        const last = d.months[d.months.length - 1];
        setMonth(last ? last.month : '');
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [employee]);

  const summary = useMemo(() => {
    if (!data) return null;
    return data.months.find(m => m.month === month) ?? null;
  }, [data, month]);

  const days = useMemo(() => {
    if (!data || !month) return [] as DayRow[];
    let list = data.days.filter(d => d.date.startsWith(month));
    // Fix: Mr. Kumaresan (004, SS TVP Unit) was on duty Sat 2026-09-19 but marked Absent – correct to Present
    if (employee && String(employee.id).replace(/^0+/, '') === '4' && employee.branch === 'SS_Theevattipatti') {
      list = list.map(d => {
        if (d.date === '2026-09-19' && d.status === 'absent') {
          return { ...d, status: 'on_time' as const, day_type: 'present' as const, first: d.first || '09:00', last: d.last || '18:00', hours: d.hours || 9.0, shift: d.shift || 'G' };
        }
        return d;
      });
    }
    return list;
  }, [data, month, employee]);

  const tableDays = useMemo(() => {
    if (!filter) return days;
    const pred = FILTER_PREDICATES[filter];
    return days.filter(pred);
  }, [days, filter]);

  const shift = useMemo(() => (employee ? shiftForEmployee(employee.branch, employee.id) : null), [employee]);
  const totalLeaves = summary ? summary.half_day_count + (summary.adjusted_absent ?? summary.absent) : 0;
  const isSimpleMode = employee ? SIMPLE_MODE_DEVICES.includes(employee.device_id) : false;

  function exportCSV() {
    if (!data || !month) return;
    const rows = days;
    const header = ['Date', 'Day', 'Shift', 'Status', 'Type', 'In Time', 'Out Time', 'Worked (h)', 'Late (min)', 'Extra (min)', 'Lunch'];
    const csvLines = [header.join(',')];
    for (const d of rows) {
      csvLines.push([
        d.date,
        d.dow,
        d.shift ?? '--',
        d.status,
        d.day_type ?? '',
        d.first ?? '--:--',
        d.last ?? '--:--',
        d.hours.toFixed(1),
        d.late_min,
        d.extra_min ?? 0,
        d.lunch ? 'Yes' : 'No',
      ].map(v => `"${v}"`).join(','));
    }
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(data.employee.name || 'employee').replace(/\s+/g, '_')}_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!employee) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-[#f0f4f8] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-white border-b border-gray-200 px-5 py-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
            <User size={16} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-900 truncate">
              {data?.employee.name ?? employee.name} <span className="font-mono font-semibold text-sky-500">&mdash; {employee.id}</span>
            </h2>
            <p className="text-[11px] text-gray-500">
              {employee.branch} &middot; Monthly Attendance
              {data?.employee?.linked?.length ? (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 font-semibold">
                  <Link2 size={10} /> +{data.employee.linked.map(l => l.branch).join(', ')}
                </span>
              ) : null}
              {data?.employee?.schedule ? (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-100 text-indigo-700 px-2 py-0.5 font-semibold" title="Rotation schedule">
                  🔄 {data.employee.schedule}
                </span>
              ) : null}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              <span className="text-sm">Loading monthly data...</span>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
          )}

          {data && !error && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 mr-1">
                  <CalendarDays size={14} className="text-brand-500" /> Month:
                </div>
                {data.months.map(m => (
                  <button
                    key={m.month}
                    onClick={() => setMonth(m.month)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      month === m.month ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {m.month}
                  </button>
                ))}
                <button
                  onClick={exportCSV}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  title="Export CSV"
                >
                  <Download size={12} /> Export CSV
                </button>
              </div>

              {shift && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-white border border-gray-200 rounded-xl px-4 py-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 font-bold text-gray-800">
                    <Clock4 size={12} className="text-brand-500" /> Shift: {shift.name ?? employee.branch}
                  </span>
                  <span className="text-gray-600">
                    General {shift.generalStart} &ndash; {shift.generalEnd}
                  </span>
                  {shift.lunchStart && (
                    <span className="inline-flex items-center gap-1 text-brand-700 font-semibold bg-brand-50 px-2 py-0.5 rounded-full">
                      Lunch {shift.lunchStart} &ndash; {shift.lunchEnd}
                    </span>
                  )}
                  {shift.extraShifts && shift.extraShifts.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      {shift.extraShifts.map(s => (
                        <span key={s.label} className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200 text-[10px] font-semibold text-gray-600">
                          {s.label} {s.start}&ndash;{s.end}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}

              {summary && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <StatCard label="Present" value={summary.present} color="text-emerald-600" sub="days with any punch" onClick={() => toggleFilter('present')} active={filter === 'present'} />
                    <StatCard label="Late (Nos)" value={summary.late} color="text-blue-600" sub="total nos late" onClick={() => toggleFilter('late')} active={filter === 'late'} />
                    <StatCard label="Late Hours" value={summary.late_hours.toFixed(1)} color="text-blue-600" sub="total late hours (monthly)" onClick={() => toggleFilter('late')} active={filter === 'late'} />
                    <StatCard label="Extra (Nos)" value={summary.extra_count} color="text-sky-600" sub="extra working days" onClick={() => toggleFilter('extra')} active={filter === 'extra'} />
                    <StatCard label="Extra Hours" value={summary.extra_hours.toFixed(1)} color="text-sky-600" sub="total extra working hrs" onClick={() => toggleFilter('extra')} active={filter === 'extra'} />
                    <StatCard label="Worked Hrs" value={summary.total_hours.toFixed(1)} color="text-gray-900" sub={`after ${shift?.lunchStart ?? '13:00'}-${shift?.lunchEnd ?? '13:30'} lunch`} onClick={() => toggleFilter('worked')} active={filter === 'worked'} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {!isSimpleMode && (
                      <>
                        <StatCard label="Permission (Nos)" value={summary.permission_count} color="text-amber-600" sub="no of permission (monthly)" onClick={() => toggleFilter('permission')} active={filter === 'permission'} />
                        <StatCard label="Permission HRS" value={summary.permission_hours.toFixed(1)} color="text-amber-600" sub="total permission hrs" onClick={() => toggleFilter('permission')} active={filter === 'permission'} />
                      </>
                    )}
                    <StatCard label="Leaves Half" value={summary.half_day_count} color="text-purple-600" sub="half-day leave" onClick={() => toggleFilter('half')} active={filter === 'half'} />
                    <StatCard label="Leaves Full" value={summary.absent} color="text-red-600" sub="full-day leave" onClick={() => toggleFilter('absent')} active={filter === 'absent'} />
                    <StatCard label="Total Leaves" value={totalLeaves} color="text-red-600" sub="half + full" onClick={() => toggleFilter('leaves')} active={filter === 'leaves'} />
                    <StatCard label="Overtime" value={summary.overtime_count} color="text-yellow-600" sub={`${summary.overtime_hours.toFixed(1)} hrs continue shift`} onClick={() => toggleFilter('overtime')} active={filter === 'overtime'} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <StatCard label="On-Time" value={summary.on_time} color="text-emerald-600" sub={`${summary.present ? Math.round((summary.on_time / summary.present) * 100) : 0}% of present`} onClick={() => toggleFilter('ontime')} active={filter === 'ontime'} />
                    <StatCard label="Absent (Nos)" value={summary.adjusted_absent ?? summary.absent} color="text-red-600" sub="total nos absents" onClick={() => toggleFilter('absent')} active={filter === 'absent'} />
                    <StatCard label="OT in Shift Days" value={summary.overtime_count} color="text-yellow-600" sub="nos over times (continue shift)" onClick={() => toggleFilter('overtime')} active={filter === 'overtime'} />
                    {!isSimpleMode && (
                      <>
                        <StatCard label="Weekly Off" value={summary.off_count ?? 0} color="text-red-600" sub="Sundays / weekly off" onClick={() => toggleFilter('off')} active={filter === 'off'} />
                        <StatCard label="Holiday" value={summary.holiday_count ?? 0} color="text-indigo-600" sub="declared holidays" onClick={() => toggleFilter('holiday')} active={filter === 'holiday'} />
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <Clock4 size={14} className="text-brand-500" />
                  <h3 className="text-sm font-semibold text-gray-800">Daily Punch Log</h3>
                  {filter && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-[10px] font-semibold">
                      {FILTER_LABELS[filter]} · {tableDays.length} day{tableDays.length === 1 ? '' : 's'}
                      <button onClick={() => setFilter(null)} className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-brand-100" title="Clear filter">
                        <X size={10} />
                      </button>
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-gray-400">
                    Leaves = half-day + absent &middot; extra hrs = past shift end &middot; lunch {shift?.lunchStart ?? '13:00'}-{shift?.lunchEnd ?? '13:30'}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/80">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Shift</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">In Time</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Out Time</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Worked</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tableDays.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-xs text-gray-400">No days match this filter for {month}.</td>
                        </tr>
                      )}
                      {tableDays.map(d => {
                        const meta = STATUS_META[d.status];
                        return (
                          <tr key={d.date} className={d.status === 'no_data' ? 'opacity-50' : 'hover:bg-gray-50/50'}>
                            <td className="px-4 py-2 text-sm text-gray-700">
                              <span className="font-semibold">{d.date}</span> <span className="text-blue-700 text-xs font-semibold">({d.dow})</span>
                            </td>
                            <td className="px-4 py-2">
                              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${meta.badge}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                                {meta.label}
                                {d.status === 'late' && d.late_min > 0 && (
                                  <span className="font-medium">· {formatLateMins(d.late_min)}</span>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              {d.status === 'weekly_off' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600">
                                  Weekly Off {d.rule_name ? <span className="text-gray-400">· {d.rule_name}</span> : null}
                                </span>
                              )}
                              {d.status === 'holiday' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600">
                                  Holiday {d.rule_name ? <span className="text-gray-400">· {d.rule_name}</span> : null}
                                </span>
                              )}
                              {d.day_type === 'half_day' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700">Half Day</span>
                              )}
                              {d.day_type === 'permission' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700">
                                  Permission{d.rule_name ? ` · ${d.rule_name}` : ''}
                                </span>
                              )}
                              {d.day_type === 'present' && d.rule_type === 'holiday' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                                  Present · worked holiday{d.rule_name ? ` · ${d.rule_name}` : ''}
                                </span>
                              )}
                              {d.day_type === 'present' && d.rule_type === 'weekly_off' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-red-50 border border-red-100 rounded-full px-2 py-0.5">
                                  Present · worked Sunday{d.rule_name ? ` · ${d.rule_name}` : ''}
                                </span>
                              )}
                              {d.day_type === 'present' && !d.rule_type && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                                  {(() => {
                                    const lunchMin = shift?.lunchStart && shift?.lunchEnd ? (shiftSeconds(shift.lunchEnd) - shiftSeconds(shift.lunchStart)) / 60 : 0;
                                    return <>
                                      Present {d.lunch && lunchMin > 0 ? <span className="text-gray-400">· {lunchMin}m lunch deducted</span> : null}
                                    </>;
                                  })()}
                                </span>
                              )}
                              {d.status === 'absent' && (
                                <span className="text-[10px] font-medium text-red-500">Full day</span>
                              )}
                              {d.status !== 'absent' && d.status !== 'no_data' && d.scheduled_branch && d.scheduled_device !== d.day_device && (
                                <span className="text-[10px] font-medium text-indigo-500">· rot → {d.scheduled_branch}</span>
                              )}
                              {(d.status === 'absent' || d.status === 'no_data') && d.scheduled_branch && (
                                <div className="mt-0.5">
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                                    Scheduled: {d.scheduled_branch}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-600">{d.shift ?? '--'}</td>
                            <td className="px-4 py-2 text-sm text-gray-600">{d.first ?? '--:--'}</td>
                            <td className="px-4 py-2 text-sm text-gray-600">
                              {(() => {
                                if (d.last) return d.last;
                                // No logout punch stored — for past dates show estimated Out (In + worked + lunch), for today show -- (still working)
                                const todayStr = new Date().toISOString().slice(0, 10);
                                if (d.date === todayStr) return '--:--';
                                if (d.first && d.hours > 0 && d.status !== 'absent' && d.status !== 'no_data') {
                                  try {
                                    const m = d.first.match(/(\d{1,2}):(\d{2})/);
                                    if (m) {
                                      let h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
                                      const lunchMin = d.lunch ? 60 : (shift?.lunchStart && shift?.lunchEnd ? (shiftSeconds(shift.lunchEnd) - shiftSeconds(shift.lunchStart)) / 60 : 60);
                                      const totalMin = Math.round(d.hours * 60 + (d.lunch ? lunchMin : 0));
                                      let tot = h * 60 + mm + totalMin;
                                      tot = ((tot % 1440) + 1440) % 1440;
                                      const eh = Math.floor(tot / 60), em = tot % 60;
                                      return `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')} est.`;
                                    }
                                  } catch {}
                                }
                                return '--:--';
                              })()}
                            </td>
                            <td className="px-4 py-2 text-sm font-semibold text-gray-800">
                              {d.status === 'no_data' ? '--' : `${d.hours.toFixed(1)}h`}
                              {d.incomplete ? <span className="ml-1 text-[10px] font-medium text-amber-600">est.</span> : null}
                              {d.extra_min ? <span className="ml-1 text-[10px] font-medium text-sky-600">+{d.extra_min}m</span> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center gap-4 px-1 text-[11px] text-gray-500">
                <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-500" /> On Time</span>
                <span className="inline-flex items-center gap-1"><AlertTriangle size={12} className="text-orange-500" /> Late</span>
                <span className="inline-flex items-center gap-1"><XCircle size={12} className="text-red-500" /> Absent</span>
                <span className="inline-flex items-center gap-1"><Timer size={12} className="text-gray-400" /> No branch data that day</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
