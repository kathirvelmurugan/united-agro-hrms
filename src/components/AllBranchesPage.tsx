import { useEffect, useState, useMemo, useRef } from 'react';
import { Users, Wifi, WifiOff, Clock4, RefreshCw, Moon, Sun, CalendarDays, Table2, AlertTriangle, X, Trash2, ChevronLeft, ChevronRight, Building2 } from 'lucide-react';
import { API_URL } from '../data/mockData';
import EmployeeMonthlyModal, { type EmployeeRef } from './EmployeeMonthlyModal';
import { deriveStatus, workingSeconds, formatDuration, parsePunchTime, STATUS_META, STATUS_ORDER, shiftForBranch, timeAgoText, fmtPunch, type EmpStatus } from '../lib/status';

interface BranchSummary {
  device_id: number;
  name: string;
  location: string;
  present: number;
  absent: number;
  deviceStatus: string;
  lastPing: string;
  lastPunch: string;
  lastUpdated: string;
}

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
  branches: BranchSummary[];
  present: number;
  absent: number;
  employees: CombinedEmployee[];
  lastUpdated: string;
}

function parseDT(ts: string): Date | null {
  if (!ts) return null;
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/);
  const t = ts.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/);
  if (m) {
    let h = +m[4];
    if (m[7] === 'PM' && h < 12) h += 12;
    if (m[7] === 'AM' && h === 12) h = 0;
    return new Date(+m[1], +m[2] - 1, +m[3], h, +m[5], +m[6]);
  }
  if (t) {
    const d = new Date();
    let h = +t[1];
    if (t[4] === 'PM' && h < 12) h += 12;
    if (t[4] === 'AM' && h === 12) h = 0;
    d.setHours(h, +t[2], +t[3], 0);
    return d;
  }
  return null;
}

function fmtClock(ts: string): string {
  const d = parseDT(ts);
  if (!d) return '--';
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} ${ap}`;
}

function timeAgo(ts: string, nowMs: number): string {
  const d = parseDT(ts);
  if (!d) return ts || '--';
  const s = Math.max(0, Math.floor((nowMs - d.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface MonthlyRow {
  id: string;
  name: string;
  branch: string;
  device_id: number;
  present: number;
  absent: number;
  adjusted_absent?: number;
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
  schedule?: string | null;
  schedule_pattern?: string | null;
}

export default function AllBranchesPage() {
  const [data, setData] = useState<AllLiveData | null>(null);
  const [tab, setTab] = useState<'all' | EmpStatus>('all');
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [shiftOpen, setShiftOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('ua-theme') === 'dark');
  const [mode, setMode] = useState<'live' | 'monthly'>('live');
  const [summaryMonth, setSummaryMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [summaryData, setSummaryData] = useState<MonthlyRow[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeRef | null>(null);
  const [schedEditKey, setSchedEditKey] = useState<string | null>(null);
  const [schedEditPattern, setSchedEditPattern] = useState('');
  const [schedEditStart, setSchedEditStart] = useState('');
  const [schedSaving, setSchedSaving] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const dataRef = useRef<AllLiveData | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => {
    if (mode !== 'monthly') return;
    let cancelled = false;
    setSummaryLoading(true);
    const devId = dataRef.current?.branches.find(b => b.name === selectedBranch)?.device_id ?? '';
    const url = `${API_URL}/api/monthly/summary?month=${summaryMonth}${devId ? `&device_id=${devId}` : ''}`;
    fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setSummaryData(d ? d.rows : null); })
      .catch(() => { if (!cancelled) setSummaryData(null); })
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [mode, summaryMonth, selectedBranch]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('ua-theme', dark ? 'dark' : 'light');
  }, [dark]);

  async function fetchData() {
    try {
      const r = await fetch(`${API_URL}/api/live/all`);
      if (r.ok) setData(await r.json());
    } catch { /* ignore */ }
  }

  async function refreshNow() {
    setRefreshing(true);
    window.location.reload();
  }

  function openSchedEditor(r: MonthlyRow) {
    setSchedEditKey(`${r.branch}|${r.id}`);
    setSchedEditPattern(r.schedule_pattern ?? '');
    setSchedEditStart('');
    if (r.schedule_pattern) {
      fetch(`${API_URL}/api/schedule?device_id=${r.device_id}&id=${encodeURIComponent(r.id)}`)
        .then(res => (res.ok ? res.json() : null))
        .then(d => { if (d?.start) setSchedEditStart(d.start); })
        .catch(() => {});
    }
  }

  async function saveSchedule(r: MonthlyRow) {
    setSchedSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/schedule?device_id=${r.device_id}&id=${encodeURIComponent(r.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: schedEditPattern.trim(), start: schedEditStart.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || 'Failed to save schedule');
      }
      setSchedEditKey(null);
      await fetchSummary();
    } catch {
      alert('Failed to save schedule');
    } finally {
      setSchedSaving(false);
    }
  }

  async function fetchSummary() {
    const devId = dataRef.current?.branches.find(b => b.name === selectedBranch)?.device_id ?? '';
    const url = `${API_URL}/api/monthly/summary?month=${summaryMonth}${devId ? `&device_id=${devId}` : ''}`;
    try {
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        setSummaryData(d.rows);
      }
    } catch { /* ignore */ }
  }

  function fmtSchedule(r: MonthlyRow): string {
    if (r.schedule) return r.schedule;
    return '—';
  }

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sec = (() => { const d = new Date(now); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); })();

  const NKP_MAP: Record<string, string> = { '3': 'P Arumugam', '11': 'C Nadesan', '12': 'Mahaboob alli basha', '14': 'A Manohar', '17': 'Virendhar' };
  function nkpAllBranchName(branch: string, id: string, fallback: string) {
    const raw = String(id).replace(/^0+/, '') || '0';
    if (branch === 'UAI Neikarapatti' && NKP_MAP[raw]) return NKP_MAP[raw];
    if (!fallback || /^Employee\s*\d+$/i.test(fallback)) return NKP_MAP[raw] || fallback || `Employee ${raw}`;
    return fallback;
  }
  const isHiddenBranchEmp = (branch: string, id: string) => {
    const raw = String(id).replace(/^0+/, '');
    if (branch === 'UAI HEAD OFFICE' && (raw === '1' || id === '0001')) return true;
    return false;
  };
  const employees = useMemo(() => {
    if (!data) return [];
    const list = [...data.employees].filter(e => !isHiddenBranchEmp(e.branch, e.id)).map(e => ({ ...e, name: nkpAllBranchName(e.branch, e.id, e.name) }));
    list.sort((a, b) => {
      const ta = parsePunchTime(a.punchTimes[0]) ?? 999999;
      const tb = parsePunchTime(b.punchTimes[0]) ?? 999999;
      return ta - tb;
    });
    return list;
  }, [data]);

  const shown = useMemo(() => {
    let list = selectedBranch ? employees.filter(e => e.branch === selectedBranch) : employees;
    if (tab !== 'all') {
      list = list.filter(e => deriveStatus(e) === tab);
    }
    return list;
  }, [employees, tab, selectedBranch]);

  const onlineBranches = data?.branches.filter(b => b.deviceStatus === 'Online').length ?? 0;

  const offlineBranches = data?.branches.filter(b => b.deviceStatus !== 'Online') ?? [];

  const branchStats = useMemo(() => {
    const m = new Map<string, { working: number; late: number; absent: number }>();
    for (const e of employees) {
      const st = deriveStatus(e);
      const s = m.get(e.branch) ?? { working: 0, late: 0, absent: 0 };
      if (st === 'working') s.working++;
      if (st === 'late') s.late++;
      if (st === 'absent') s.absent++;
      m.set(e.branch, s);
    }
    return m;
  }, [employees]);

  const statusCounts = useMemo(() => {
    const c: Record<EmpStatus, number> = { working: 0, late: 0, absent: 0, logout: 0 };
    for (const e of employees) {
      c[deriveStatus(e)]++;
    }
    return c;
  }, [employees]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="relative bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <Users size={14} className="text-white" />
          </div>
          <h1 className="text-sm font-semibold text-gray-900 leading-tight shrink-0">All Branches Overview</h1>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button
              onClick={() => { setMode(m => (m === 'live' ? 'monthly' : 'live')); setTab('all'); }}
              className={`shrink-0 inline-flex items-center gap-1 px-2 h-7 rounded-lg border text-[10px] font-medium transition-colors ${
                mode === 'monthly' ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {mode === 'monthly' ? <Table2 size={13} /> : <CalendarDays size={13} />}
              {mode === 'monthly' ? 'Live View' : 'Monthly Summary'}
            </button>
            {mode === 'monthly' && (
              <button
                onClick={() => setRulesOpen(true)}
                title="Holiday & weekly-off rules"
                className="shrink-0 inline-flex items-center gap-1 px-2 h-7 rounded-lg border border-gray-200 text-gray-600 text-[10px] font-medium hover:bg-gray-50 transition-colors"
              >
                <CalendarDays size={12} /> Rules
              </button>
            )}
            {mode === 'monthly' && (
              <button
                onClick={() => setCalOpen(true)}
                title="Holiday & weekly-off calendar for all units"
                className="shrink-0 inline-flex items-center gap-1 px-2 h-7 rounded-lg border border-gray-200 text-gray-600 text-[10px] font-medium hover:bg-gray-50 transition-colors"
              >
                <CalendarDays size={12} /> Calendar
              </button>
            )}
            {mode === 'monthly' && (
              <input
                type="month"
                value={summaryMonth}
                onChange={e => { if (e.target.value) setSummaryMonth(e.target.value); }}
                className="shrink-0 h-7 px-2 rounded-lg border border-gray-200 text-[10px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            )}
            <button
              onClick={() => setDark(d => !d)}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {dark ? <Sun size={13} /> : <Moon size={13} />}
            </button>
            <button
              onClick={refreshNow}
              title="Refresh"
              className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
              <Wifi size={12} /> {onlineBranches}/{data?.branches.length ?? 0} branches online
            </span>
            {data && (
              <span className="text-[10px] text-black shrink-0">
                Updated {timeAgo(data.lastUpdated, now)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">
        {!data ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <span className="text-sm">Loading live data...</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
              {data.branches.map(branch => {
                const active = selectedBranch === branch.name;
                return (
                <button
                  key={branch.device_id}
                  onClick={() => {
                    setSelectedBranch(active ? null : branch.name);
                    setTab('all');
                  }}
                   className={`relative text-left bg-white rounded-lg border p-2 cursor-pointer transition-all hover:shadow-md ${
                    branch.deviceStatus === 'Online' ? 'border-gray-200' : 'border-red-200 bg-red-50/40'
                  } ${active ? 'ring-2 ring-brand-500 border-brand-500' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold text-gray-900 truncate">
                      {branch.name}
                      <span className="ml-0.5 text-[9px] font-semibold text-gray-400">
                        ({(() => { const s = branchStats.get(branch.name); return s ? s.working + s.absent : 0; })()})
                      </span>
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold ${
                        branch.deviceStatus === 'Online' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                      }`}>
                        {branch.deviceStatus === 'Online' ? <Wifi size={9} /> : <WifiOff size={9} />}
                        {branch.deviceStatus}
                      </span>
                      <span
                        title="Shift timings"
                        onClick={e => {
                          e.stopPropagation();
                          setShiftOpen(shiftOpen === branch.name ? null : branch.name);
                        }}
                        className={`inline-flex items-center justify-center w-4 h-4 rounded-md border transition-colors shrink-0 ${
                          shiftOpen === branch.name
                            ? 'bg-brand-50 border-brand-300 text-brand-600'
                            : 'border-gray-200 text-gray-400 hover:text-brand-600 hover:bg-gray-50'
                        }`}
                      >
                        <Clock4 size={9} />
                      </span>
                    </div>
                  </div>
                  {(() => {
                    const c = branchStats.get(branch.name) ?? { working: 0, late: 0, absent: 0 };
                    return (
                      <div className="grid grid-cols-3 gap-1">
                        <span className="flex items-center gap-1 text-[9px] text-emerald-600 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {c.working} Working</span>
                        <span className="flex items-center gap-1 text-[9px] text-blue-800 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-blue-800" /> {c.late} Late</span>
                        <span className="flex items-center gap-1 text-[9px] text-red-600 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /> {c.absent} Absent</span>
                      </div>
                    );
                  })()}
                  {shiftOpen === branch.name && (() => {
                    const shift = shiftForBranch(branch.name);
                    return (
                      <div
                        className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-xl p-2 space-y-0.5"
                        onClick={e => e.stopPropagation()}
                      >
                        <p className="text-[9px] font-bold text-gray-800 flex items-center gap-1">
                           <Clock4 size={9} className="text-brand-500" /> Shift Timings
                         </p>
                         <p className="text-[9px] text-gray-700">
                          General: {shift.generalStart} &ndash; {shift.generalEnd}
                          {shift.lunchStart ? <> &middot; Lunch: {shift.lunchStart} &ndash; {shift.lunchEnd}</> : null}
                        </p>
                        {shift.extraShifts && shift.extraShifts.length > 0 ? (
                          <div className="space-y-0.5">
                            {shift.extraShifts.map(s => (
                              <p key={s.label} className="text-[9px] text-gray-600">
                                {s.label}: {s.start}&ndash;{s.end}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[9px] text-gray-400">No additional shifts</p>
                        )}
                      </div>
                    );
                  })()}
                  <p className="mt-1 text-[9px] text-gray-600 truncate">Last ping {fmtClock(branch.lastPing)} &middot; Updated {timeAgo(branch.lastUpdated, now)}</p>
                  <p className="mt-0.5 text-[9px] text-gray-500 truncate flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${branch.deviceStatus === 'Online' ? 'bg-emerald-500' : 'bg-red-400 animate-pulse'}`} />
                    Punches: {branch.lastPunch && branch.lastPunch !== '--' ? `${fmtPunch(branch.lastPunch)} (${timeAgoText(branch.lastPunch, now)})` : 'none'}
                  </p>
                </button>
                );
              })}
            </div>

            {offlineBranches.length > 0 && (
              <div className="mb-3 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-[10px] text-red-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-500" />
                <div>
                  <span className="font-bold">{offlineBranches.map(b => b.name).join(', ')} offline.</span>{' '}
                  Punches made on offline devices are buffered on the device and sync here after it reconnects.
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-3">
              {STATUS_ORDER.map(s => (
                <button
                  key={s}
                  onClick={() => setTab(s)}
                  className={`bg-white rounded-lg border px-2 py-1 text-center transition-colors ${
                    tab === s ? 'ring-2 ring-brand-500 border-brand-500' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wide flex items-center justify-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[s].dot}`} /> {STATUS_META[s].label}
                  </p>
                  <p className={`text-lg font-bold leading-tight ${s === 'working' ? 'text-emerald-600' : s === 'late' ? 'text-blue-600' : s === 'absent' ? 'text-red-500' : s === 'logout' ? 'text-purple-600' : 'text-blue-600'}`}>
                    {statusCounts[s]}
                  </p>
                </button>
              ))}
            </div>

            {mode === 'monthly' && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                  <h2 className="text-[11px] font-semibold text-gray-800">
                    Monthly Summary <span className="text-[10px] text-gray-500">&mdash; {summaryMonth}</span>
                    <span className="text-[10px] font-normal text-gray-400 ml-1">({summaryData?.length ?? 0} employees)</span>
                  </h2>
                  <span className="ml-auto text-[9px] text-gray-400">
                    Leaves = half-day + absent &middot; Permission &lt;35% shift, half-day 35&ndash;75% &middot; Lunch 13:00&ndash;14:00 deducted (general shift)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/80 whitespace-nowrap">
                        <th className="px-2 py-1.5 text-left text-[9px] font-semibold text-gray-500 uppercase">Name</th>
                        <th className="px-2 py-1.5 text-left text-[9px] font-semibold text-gray-500 uppercase">Branch</th>
                        <th className="px-2 py-1.5 text-left text-[9px] font-semibold text-gray-500 uppercase">Schedule</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Present</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">On Time</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Late</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Late Hrs</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Extra Nos</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Extra Hrs</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Permission Nos</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Perm Hrs</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Half-Day</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Absent (Full Leave)</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Off</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Holiday</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Overtime Nos</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">OT Hrs</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-semibold text-gray-500 uppercase">Worked Hrs</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {summaryLoading ? (
                        <tr><td colSpan={17} className="px-3 py-6 text-center text-[10px] text-gray-400">Loading monthly summary...</td></tr>
                      ) : !summaryData || summaryData.length === 0 ? (
                        <tr><td colSpan={17} className="px-3 py-6 text-center text-[10px] text-gray-400">No data for this month</td></tr>
                      ) : summaryData.map(r => (
                        <tr key={`${r.branch}-${r.id}`} className="hover:bg-gray-50/50">
                          <td className="px-2 py-1 whitespace-nowrap">
                            <button
                              onClick={() => setSelectedEmp({ id: r.id, name: r.name, branch: r.branch, device_id: r.device_id })}
                              className="text-left hover:text-brand-600 transition-colors"
                            >
                              <p className="text-[10px] font-medium text-gray-800 hover:underline">{r.name}</p>
                              <p className="text-[8px] font-mono text-gray-600">ID {r.id}</p>
                            </button>
                          </td>
                          <td className="px-2 py-1 text-[10px] text-gray-600 whitespace-nowrap">{r.branch}</td>
                          <td className="px-2 py-1 text-[10px] whitespace-nowrap relative">
                            {schedEditKey === `${r.branch}|${r.id}` ? (
                              <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                <input
                                  value={schedEditPattern}
                                  onChange={e => setSchedEditPattern(e.target.value)}
                                  placeholder="42:10,24:10"
                                  className="w-28 px-1.5 py-0.5 rounded-md border border-gray-200 text-[10px] font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                                />
                                <input
                                  type="date"
                                  value={schedEditStart}
                                  onChange={e => setSchedEditStart(e.target.value)}
                                  className="w-28 px-1.5 py-0.5 rounded-md border border-gray-200 text-[10px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                                />
                                <button
                                  onClick={() => saveSchedule(r)}
                                  disabled={schedSaving}
                                  className="px-1.5 py-0.5 rounded-md bg-brand-600 text-white text-[10px] font-semibold hover:bg-brand-700 disabled:opacity-50"
                                >
                                  {schedSaving ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  onClick={() => setSchedEditKey(null)}
                                  className="px-1.5 py-0.5 rounded-md border border-gray-200 text-gray-600 text-[10px] font-semibold hover:bg-gray-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => openSchedEditor(r)}
                                title={r.schedule ? 'Edit schedule' : 'Add schedule'}
                                className="group inline-flex items-center gap-1 text-left max-w-[180px]"
                              >
                                <span className={`truncate ${r.schedule ? 'text-amber-700' : 'text-gray-300 group-hover:text-gray-500'}`}>
                                  {r.schedule ? '🔄 ' + fmtSchedule(r) : '＋ Set'}
                                </span>
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1 text-center text-[10px] font-bold text-emerald-600">{r.present}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-gray-700">{r.on_time}</td>
                          <td className="px-2 py-1 text-center text-[10px] font-semibold text-blue-600">{r.late}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-blue-600">{r.late_hours.toFixed(1)}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-sky-600">{r.extra_count}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-sky-600">{r.extra_hours.toFixed(1)}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-amber-600">{r.permission_count}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-amber-600">{r.permission_hours.toFixed(1)}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-purple-600">{r.half_day_count}</td>
                          <td className="px-2 py-1 text-center text-[10px] font-semibold text-red-600">{r.adjusted_absent ?? r.absent}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-emerald-600">{r.off_count ?? 0}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-indigo-600">{r.holiday_count ?? 0}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-yellow-600">{r.overtime_count}</td>
                          <td className="px-2 py-1 text-center text-[10px] text-yellow-600">{r.overtime_hours.toFixed(1)}</td>
                          <td className="px-2 py-1 text-center text-[10px] font-semibold text-gray-800">{r.total_hours.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {mode === 'live' && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[11px] font-semibold text-gray-800">
                    {selectedBranch ? selectedBranch : 'All Employees'}
                    <span className="text-[10px] font-normal text-gray-400 ml-1">({shown.length})</span>
                  </h2>
                  {selectedBranch && (
                    <button
                      onClick={() => setSelectedBranch(null)}
                      className="text-[10px] text-brand-600 hover:text-brand-700 font-medium bg-brand-50 hover:bg-brand-100 px-2 py-0.5 rounded-lg transition-colors"
                    >
                      Show All Branches
                    </button>
                  )}
                </div>
                {selectedBranch && (() => {
                  const shift = shiftForBranch(selectedBranch);
                  return (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-700">
                        <Clock4 size={12} className="text-brand-500" /> Shift Timings
                      </span>
                      <span className="text-[11px] text-gray-700">
                        General {shift.generalStart} &ndash; {shift.generalEnd}
                      </span>
                      {shift.lunchStart && (
                        <span className="text-[11px] text-gray-500">
                          Lunch {shift.lunchStart} &ndash; {shift.lunchEnd}
                        </span>
                      )}
                      {shift.extraShifts && shift.extraShifts.length > 0 && (
                        <span className="flex flex-wrap items-center gap-1">
                          {shift.extraShifts.map(s => (
                            <span key={s.label} className="inline-flex items-center px-1.5 py-0.5 rounded bg-white border border-gray-200 text-[10px] font-semibold text-gray-600">
                              {s.label} {s.start}&ndash;{s.end}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/80">
                      <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Name</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Branch</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Status</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 uppercase">First Punch</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Working Time</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Last Punch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shown.map(e => {
                      const work = workingSeconds(e, sec);
                      const lastDir = e.punchDirs?.[e.punchDirs.length - 1];
                      const isIn = lastDir ? lastDir === 'IN' : e.punchTimes.length % 2 === 1;
                      return (
                      <tr key={`${e.branch}-${e.id}`} className="hover:bg-gray-50/50">
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <button
                            onClick={() => setSelectedEmp({ id: e.id, name: e.name, branch: e.branch, device_id: e.device_id })}
                            className="text-left hover:text-brand-600 transition-colors"
                          >
                            <p className="text-[10px] font-medium text-gray-800 hover:underline">{e.name}</p>
                            <p className="text-[9px] font-mono text-gray-600 tracking-wide">ID {e.id}</p>
                          </button>
                        </td>
                        <td className="px-3 py-1.5 text-[10px] text-gray-600">{e.branch}</td>
                        <td className="px-3 py-1.5">
                          {(() => {
                            const st = deriveStatus(e);
                            return (
                              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_META[st].badge}`}>
                                <span className={`w-1 h-1 rounded-full ${STATUS_META[st].dot}`} />
                                {STATUS_META[st].label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-1.5 text-[10px] text-gray-600 whitespace-nowrap">{e.punchTimes[0] || '--:--:--'}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {work == null ? (
                            <span className="text-[10px] text-gray-300">--</span>
                          ) : isIn ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-700 font-mono">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-500" />
                              </span>
                              {formatDuration(work)}
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold text-gray-500 font-mono">{formatDuration(work)}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-[10px] text-gray-600 whitespace-nowrap">{isIn ? '--:--:--' : (e.lastPunch || '--:--:--')}</td>
                      </tr>
                      );
                    })}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-[10px] text-gray-400">No employees</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            )}
          </>
        )}
      </div>

      <EmployeeMonthlyModal employee={selectedEmp} onClose={() => setSelectedEmp(null)} />
      {rulesOpen && <RulesModal branches={data?.branches ?? []} device_id={data?.branches.some(b => b.name === selectedBranch) ? data.branches.find(b => b.name === selectedBranch)!.device_id : undefined} onClose={() => setRulesOpen(false)} onSaved={() => fetchSummary()} />}
      {calOpen && <CalendarModal branches={data?.branches ?? []} month={summaryMonth} onClose={() => setCalOpen(false)} />}
    </div>
  );
}

interface Rule {
  id: number;
  device_id: number;
  type: string;
  date: string | null;
  day_of_week: number | null;
  name: string | null;
  hours: number | null;
}

interface RulesModalProps {
  branches: { device_id: number; name: string }[];
  device_id?: number;
  onClose: () => void;
  onSaved: () => void;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function RulesModal({ branches, device_id, onClose, onSaved }: RulesModalProps) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [type, setType] = useState<'weekly_off' | 'holiday' | 'permission'>('holiday');
  const [date, setDate] = useState('');
  const [dow, setDow] = useState(6);
  const [name, setName] = useState('');
  const [hours, setHours] = useState('2');
  const [saving, setSaving] = useState(false);
  const [loadDev, setLoadDev] = useState<number | undefined>(device_id);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/rules${loadDev ? `?device_id=${loadDev}` : ''}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setRules(d.rules ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [loadDev]);

  async function addRule() {
    setSaving(true);
    try {
      const body: any = { type, name: name.trim() || null };
      if (loadDev) body.device_id = loadDev;
      if (type === 'weekly_off') body.day_of_week = dow;
      else body.date = date;
      if (type === 'permission') body.hours = parseFloat(hours) || 2;
      const r = await fetch(`${API_URL}/api/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error || 'Failed to save rule'); return; }
      setName(''); setHours('2'); setDate('');
      const resp = await fetch(`${API_URL}/api/rules${loadDev ? `?device_id=${loadDev}` : ''}`);
      const dj = await resp.json().catch(() => ({ rules: [] }));
      setRules(dj.rules ?? []);
      onSaved();
    } catch {
      alert('Failed to save rule');
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(id: number) {
    try {
      await fetch(`${API_URL}/api/rules/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setRules(rules.filter(r => r.id !== id));
      onSaved();
    } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-[#f0f4f8] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-white border-b border-gray-200 px-5 py-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
            <CalendarDays size={16} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-900">Holiday & Weekly-Off Rules</h2>
            <p className="text-[11px] text-gray-500">
              {loadDev ? `Applied to device ${loadDev}` : 'All branches'} &middot; used in monthly absence calculation
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded-xl p-3">
            <select
              value={loadDev ?? ''}
              onChange={e => setLoadDev(e.target.value ? Number(e.target.value) : undefined)}
              className="h-8 px-2 rounded-lg border border-gray-200 text-[11px] text-gray-700 focus:outline-none"
            >
              <option value="">All branches</option>
              {branches.map(b => (
                <option key={b.device_id} value={b.device_id}>{b.name}</option>
              ))}
            </select>

            <select
              value={type}
              onChange={e => setType(e.target.value as any)}
              className="h-8 px-2 rounded-lg border border-gray-200 text-[11px] text-gray-700 focus:outline-none"
            >
              <option value="holiday">Holiday</option>
              <option value="weekly_off">Weekly Off</option>
              <option value="permission">Permission (hrs granted)</option>
            </select>

            {type === 'weekly_off' ? (
              <select
                value={dow}
                onChange={e => setDow(Number(e.target.value))}
                className="h-8 px-2 rounded-lg border border-gray-200 text-[11px] text-gray-700 focus:outline-none"
              >
                {WEEKDAYS.map((wd, i) => <option key={wd} value={i}>{wd}</option>)}
              </select>
            ) : (
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="h-8 px-2 rounded-lg border border-gray-200 text-[11px] text-gray-700 focus:outline-none"
              />
            )}

            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Reason (e.g. Adi Perukku)"
              className="h-8 px-2 rounded-lg border border-gray-200 text-[11px] text-gray-700 focus:outline-none w-40"
            />

            {type === 'permission' && (
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={hours}
                onChange={e => setHours(e.target.value)}
                className="h-8 px-2 w-16 rounded-lg border border-gray-200 text-[11px] text-gray-700 focus:outline-none"
                title="Hours granted"
              />
            )}

            <button
              onClick={addRule}
              disabled={saving || (type !== 'weekly_off' && !date)}
              className="h-8 px-3 rounded-lg bg-brand-600 text-white text-[11px] font-semibold hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">{rules.length} rule{rules.length === 1 ? '' : 's'}</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {rules.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-400">No rules configured</p>
              ) : rules.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                    r.type === 'weekly_off' ? 'bg-emerald-50 text-emerald-700' : r.type === 'holiday' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {r.type === 'weekly_off' ? 'Off' : r.type === 'holiday' ? 'Holiday' : 'Permission'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {r.type === 'weekly_off' ? `Every ${WEEKDAYS[r.day_of_week ?? 6]}` : r.date}
                      {r.name ? <span className="text-gray-500 font-normal"> — {r.name}</span> : null}
                    </p>
                  </div>
                  {r.hours != null && <span className="text-[11px] font-semibold text-amber-700">{r.hours}h</span>}
                  <button onClick={() => deleteRule(r.id)} className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-gray-100 text-[10px] text-gray-400 bg-gray-50/60">
              Weekly-off &amp; holiday days are excluded from absence. Permission days grant hours to every employee.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface CalendarModalProps {
  branches: { device_id: number; name: string }[];
  month: string;
  onClose: () => void;
}

const CAL_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function CalendarModal({ branches, month, onClose }: CalendarModalProps) {
  const [rules, setRules] = useState<Record<number, Rule[]>>({});
  const [m, setM] = useState(month);
  const [selDev, setSelDev] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/rules`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return;
        const grouped: Record<number, Rule[]> = {};
        for (const r of (d.rules ?? [])) {
          (grouped[r.device_id] = grouped[r.device_id] ?? []).push(r);
        }
        setRules(grouped);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selDev != null) return;
    const withRules = branches.find(b => (rules[b.device_id] ?? []).length > 0);
    setSelDev(withRules ? withRules.device_id : (branches[0]?.device_id ?? null));
  }, [branches, rules, selDev]);

  const grid = useMemo(() => {
    const [y, mo] = m.split('-').map(Number);
    const first = new Date(y, mo - 1, 1);
    const daysInMonth = new Date(y, mo, 0).getDate();
    const lead = first.getDay();
    const cells: (number | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return { cells, y, mo, daysInMonth };
  }, [m]);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  function dayInfo(dev: number, d: number | null) {
    if (d == null) return null;
    const iso = `${m}-${String(d).padStart(2, '0')}`;
    const drules = rules[dev] ?? [];
    const dow = new Date(grid.y, grid.mo - 1, d).getDay();
    const dowPy = (dow + 6) % 7;
    for (const r of drules) {
      if (r.type === 'weekly_off' && r.day_of_week != null && dowPy === r.day_of_week) {
        return { kind: 'off' as const, name: r.name, hours: null };
      }
      if (r.type !== 'weekly_off' && r.date === iso) {
        return { kind: r.type as 'holiday' | 'permission', name: r.name, hours: r.type === 'permission' ? (r.hours ?? 2) : null };
      }
    }
    return { kind: 'plain' as const, name: null, hours: null };
  }

  const selBranch = branches.find(b => b.device_id === selDev);
  const drules = selDev != null ? rules[selDev] ?? [] : [];
  const hol = drules.filter(r => r.type === 'holiday');
  const off = drules.filter(r => r.type === 'weekly_off');
  const perm = drules.filter(r => r.type === 'permission');
  const hasRules = hol.length + off.length + perm.length > 0;

  const [yNum, moNum] = m.split('-').map(Number);

  function shiftMonth(delta: number) {
    const dt = new Date(yNum, moNum - 1 + delta, 1);
    setM(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
            <CalendarDays size={16} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-900">Attendance Calendar</h2>
            <p className="text-[11px] text-gray-500">Holidays, weekly offs & permission days per unit</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Unit + month controls */}
        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Building2 size={14} className="text-gray-400" />
            <select
              value={selDev ?? ''}
              onChange={e => setSelDev(e.target.value ? Number(e.target.value) : null)}
              className="h-8 min-w-[180px] px-2.5 rounded-lg border border-gray-200 bg-white text-[12px] font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              {branches.map(b => (
                <option key={b.device_id} value={b.device_id}>{b.name} ({b.device_id})</option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => shiftMonth(-1)}
              className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="px-3 h-8 flex items-center rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-800 min-w-[110px] justify-center">
              {MONTH_NAMES[moNum - 1]} {yNum}
            </div>
            <button
              onClick={() => shiftMonth(1)}
              className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors"
            >
              <ChevronRight size={15} />
            </button>
            <input
              type="month"
              value={m}
              onChange={e => { if (e.target.value) setM(e.target.value); }}
              className="h-8 px-2 rounded-lg border border-gray-200 text-[11px] text-gray-700 focus:outline-none w-[110px]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="grid lg:grid-cols-3 gap-5">
            {/* Calendar grid */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900">{selBranch?.name ?? 'Unit'}</h3>
                {hasRules && (
                  <div className="flex items-center gap-2.5 text-[10px] font-medium">
                    <span className="inline-flex items-center gap-1 text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Off ({off.length})</span>
                    <span className="inline-flex items-center gap-1 text-indigo-600"><span className="w-2 h-2 rounded-full bg-indigo-500" /> Holiday ({hol.length})</span>
                    <span className="inline-flex items-center gap-1 text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-500" /> Permission ({perm.length})</span>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
                  {CAL_WEEKDAYS.map((w, i) => (
                    <div key={w} className={`py-2 text-center text-[10px] font-bold uppercase tracking-wide ${i === 0 ? 'text-red-400' : 'text-gray-400'}`}>{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 divide-x divide-y divide-gray-100">
                  {grid.cells.map((d, i) => {
                    if (d == null) return <div key={i} className="h-16 sm:h-[88px] bg-gray-50/40" />;
                    const iso = `${m}-${String(d).padStart(2, '0')}`;
                    const info = selDev != null ? dayInfo(selDev, d) : null;
                    const isToday = iso === todayStr;
                    const kind = info?.kind ?? 'plain';
                    const cellCls = kind === 'off' ? 'bg-emerald-50' : kind === 'holiday' ? 'bg-indigo-50' : kind === 'permission' ? 'bg-amber-50' : 'bg-white';
                    const numCls = kind === 'off' ? 'text-emerald-700' : kind === 'holiday' ? 'text-indigo-700' : kind === 'permission' ? 'text-amber-700' : isToday ? 'text-white' : 'text-gray-700';
                    return (
                      <div
                        key={i}
                        title={info?.name ? `${kind === 'off' ? 'Weekly Off' : kind === 'holiday' ? 'Holiday' : 'Permission'} - ${info.name}` : undefined}
                        className={`relative h-16 sm:h-[88px] flex items-start justify-start p-1.5 transition-colors ${cellCls} ${isToday ? 'ring-2 ring-inset ring-brand-500' : ''}`}
                      >
                        <span
                          className={`w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-semibold ${isToday ? 'bg-brand-600 text-white shadow-sm' : numCls}`}
                        >
                          {d}
                        </span>
                        {kind === 'off' && (
                          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-md bg-emerald-500 text-white text-[8px] font-bold uppercase tracking-wide">Off</span>
                        )}
                        {kind === 'holiday' && (
                          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-md bg-indigo-500 text-white text-[8px] font-bold uppercase tracking-wide">Holiday</span>
                        )}
                        {kind === 'permission' && (
                          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-md bg-amber-500 text-white text-[8px] font-bold uppercase tracking-wide">Pr: {info?.hours ?? 2}h</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Side panel */}
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Legend</p>
                <div className="space-y-1.5 text-[11px] text-gray-600">
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-emerald-500" /> Weekly Off</div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-indigo-500" /> Holiday</div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-amber-500" /> Permission</div>
                  <div className="flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-brand-600 ring-1 ring-brand-600" /> Today</div>
                </div>
              </div>

              {hasRules ? (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
                    <h3 className="text-xs font-bold text-gray-700">Declared for {selBranch?.name}</h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {off.map(r => (
                      <div key={`o-${r.id}`} className="flex items-center gap-2 px-4 py-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-[11px] font-medium text-gray-700">Every {WEEKDAYS[r.day_of_week ?? 6]}</span>
                        {r.name ? <span className="text-[11px] text-gray-400 ml-auto text-right">{r.name}</span> : null}
                      </div>
                    ))}
                    {hol.map(r => (
                      <div key={`h-${r.id}`} className="flex items-center gap-2 px-4 py-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                        <span className="text-[11px] font-medium text-gray-700">{r.date}</span>
                        {r.name ? <span className="text-[11px] text-gray-400 ml-auto text-right">{r.name}</span> : null}
                      </div>
                    ))}
                    {perm.map(r => (
                      <div key={`p-${r.id}`} className="flex items-center gap-2 px-4 py-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                        <span className="text-[11px] font-medium text-gray-700">{r.date}</span>
                        <span className="text-[11px] font-semibold text-amber-600 ml-auto">{r.hours ?? 2}h</span>
                        {r.name ? <span className="text-[11px] text-gray-400">{r.name}</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                  <CalendarDays size={20} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-xs font-medium text-gray-700">No rules declared yet</p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Once holiday, weekly-off or permission rules are added for {selBranch?.name ?? 'this unit'}, they will appear here automatically.
                  </p>
                </div>
              )}

              <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3 text-[11px] text-brand-700 leading-relaxed">
                Weekly-off and holiday days are excluded from absence. Permission days grant hours to every employee on that date.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
