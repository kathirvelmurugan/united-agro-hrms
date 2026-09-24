import { useEffect, useState, useRef } from 'react';
import { Sparkles, RefreshCw, Clock4, LogOut, ClipboardX, FastForward, UtensilsCrossed, AlertTriangle, ShieldAlert, Bot, X, Activity, CalendarX, AlarmClock, Hourglass, Building2, Users, ChevronDown } from 'lucide-react';
import { API_URL } from '../data/mockData';
import { authFetch } from '../lib/auth';
import { useChat } from './AiChat';

interface Anomaly {
  severity: 'High' | 'Medium' | 'Low';
  type: string;
  message: string;
  employee: string;
  id: string;
  branch: string;
  time: string;
}

interface RiskRow {
  id: string;
  name: string;
  branch: string;
  device_id: number;
  score: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  early_days: number;
  reasons: string[];
}

interface BranchEmpStat {
  id: string;
  name: string;
  absent: number;
  late: number;
}

interface BranchStat {
  branch: string;
  records: number;
  present: number;
  absent: number;
  late: number;
  hours: number;
  active: number;
  absent_emps: BranchEmpStat[];
  late_emps: BranchEmpStat[];
}

interface Overview {
  total_employees: number;
  active_employees: number;
  units: number;
  total_records: number;
  present_records: number;
  absent_records: number;
  late_records: number;
  attendance_rate: number;
  late_rate: number;
  avg_hours: number;
  worst_unit: { branch: string; absent: number } | null;
  by_branch: BranchStat[];
}

interface MonthStat {
  month: string;
  label: string;
  overview: Overview;
}

interface AiData {
  generated: string;
  range_days: number;
  months: MonthStat[];
  anomalies: Anomaly[];
  risk: RiskRow[];
}

const ANOMALY_ICONS: Record<string, React.ReactNode> = {
  'Late Arrival': <Clock4 size={14} />,
  'Unusual Punch Time': <Clock4 size={14} />,
  'Left Early': <LogOut size={14} />,
  'No Punch-Out': <ClipboardX size={14} />,
  'Rapid Punches': <FastForward size={14} />,
  'No Lunch Break': <UtensilsCrossed size={14} />,
};

const SEVERITY_META: Record<string, { badge: string; bar: string; dot: string }> = {
  High: { badge: 'bg-red-100 text-red-700', bar: 'bg-red-500', dot: 'bg-red-500' },
  Medium: { badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  Low: { badge: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500', dot: 'bg-sky-500' },
};

type StatKey = 'attendance' | 'absent' | 'late' | 'hours' | 'unit' | 'active';

export default function AiInsightsPage() {
  const chat = useChat();
  const [data, setData] = useState<AiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sev, setSev] = useState<'All' | 'High' | 'Medium' | 'Low'>('All');
  const [detail, setDetail] = useState<StatKey | null>(null);
  const [drill, setDrill] = useState<{ branch: string; kind: 'absent' | 'late' } | null>(null);
  const [monthIdx, setMonthIdx] = useState(0);
  const anomRef = useRef<HTMLDivElement | null>(null);
  const riskRef = useRef<HTMLDivElement | null>(null);
  const [anomOpen, setAnomOpen] = useState(true);

  const toggleAnomalies = () => {
    setAnomOpen(prev => {
      if (prev) setTimeout(() => riskRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      else setTimeout(() => anomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      return !prev;
    });
  };

  async function fetchData() {
    try {
      const r = await authFetch(`${API_URL}/api/ai-insights`);
      if (r.ok) setData(await r.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, []);

  const months = data?.months ?? [];
  const selIdx = Math.min(monthIdx, Math.max(0, months.length - 1));
  const monthStat = months[selIdx];
  const ov = monthStat?.overview;
  const sevCounts = { High: 0, Medium: 0, Low: 0 };
  for (const a of data?.anomalies ?? []) sevCounts[a.severity as 'High' | 'Medium' | 'Low']++;
  const shown = data ? data.anomalies.filter(a => sev === 'All' || a.severity === sev) : [];
  const showSev = (s: 'All' | 'High' | 'Medium' | 'Low') => setSev(prev => (prev === s ? 'All' : s));

  const stats: { key: StatKey; label: string; value: string; sub: string; icon: React.ReactNode; color: string }[] = ov ? [
    { key: 'attendance', label: 'Attendance Rate', value: `${ov.attendance_rate}%`, sub: `${ov.present_records} present out of ${ov.total_records} records`, icon: <Activity size={16} />, color: 'text-emerald-600' },
    { key: 'absent', label: 'Absent Records', value: `${ov.absent_records}`, sub: 'Across all units and dates', icon: <CalendarX size={16} />, color: 'text-red-500' },
    { key: 'late', label: 'Late Arrivals', value: `${ov.late_rate}%`, sub: `${ov.late_records} late records total`, icon: <AlarmClock size={16} />, color: 'text-blue-500' },
    { key: 'hours', label: 'Avg Working Hours', value: `${ov.avg_hours}h`, sub: 'Per employee per day', icon: <Hourglass size={16} />, color: 'text-brand-600' },
    { key: 'unit', label: 'Highest Absenteeism Unit', value: ov.worst_unit?.branch ?? '--', sub: `${ov.worst_unit?.absent ?? 0} absent records`, icon: <Building2 size={16} />, color: 'text-purple-600' },
    { key: 'active', label: 'Active Employees', value: `${ov.active_employees}`, sub: `Out of ${ov.total_employees} total registered`, icon: <Users size={16} />, color: 'text-sky-600' },
  ] : [];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <Sparkles size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 leading-tight">AI Insights</h1>
            <p className="text-[11px] text-gray-500">Live analysis, anomaly feed &amp; at-risk employees</p>
          </div>
          <button
            onClick={() => chat.setOpen(!chat.open)}
            title={chat.open ? 'Close AI chat' : 'Ask AI'}
            className={`ml-auto shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
              chat.open ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-brand-600'
            }`}
          >
            <Bot size={15} />
          </button>
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {data && null}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {!data ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <span className="text-sm">Analyzing attendance patterns...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {months.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {months.map((m, i) => (
                  <button
                    key={m.month}
                    onClick={() => { setMonthIdx(i); setDrill(null); }}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                      i === selIdx ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
              {stats.map(s => (
                <button
                  key={s.key}
                  onClick={() => setDetail(detail === s.key ? null : s.key)}
                  className={`bg-white rounded-xl border p-3 text-left transition-all hover:shadow-md ${
                    detail === s.key ? 'ring-2 ring-brand-500 border-brand-500' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={s.color}>{s.icon}</span>
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{s.label}</p>
                  </div>
                  <p className={`text-xl font-bold leading-tight ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{s.sub}</p>
                </button>
              ))}
            </div>

            {detail && ov && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-800">
                    {stats.find(s => s.key === detail)?.label}
                  </h3>
                  <span className="text-[11px] text-gray-400">{monthStat?.label}</span>
                  <button onClick={() => { setDetail(null); setDrill(null); }} className="ml-auto p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                    <X size={13} />
                  </button>
                </div>
                <div className="p-4">
                  {detail === 'attendance' && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase">
                            <th className="px-3 py-2">Branch</th>
                            <th className="px-3 py-2 text-center">Records</th>
                            <th className="px-3 py-2 text-center">Present</th>
                            <th className="px-3 py-2 text-center">Rate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {ov.by_branch.map(b => (
                            <tr key={b.branch}>
                              <td className="px-3 py-2 text-gray-800">{b.branch}</td>
                              <td className="px-3 py-2 text-center text-gray-600 font-mono">{b.records}</td>
                              <td className="px-3 py-2 text-center text-emerald-600 font-semibold font-mono">{b.present}</td>
                              <td className="px-3 py-2 text-center font-semibold font-mono">{b.records ? Math.round(100 * b.present / b.records) : 0}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {detail === 'absent' && (
                    <div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {ov.by_branch.map(b => (
                          <button
                            key={b.branch}
                            onClick={() => setDrill(drill?.branch === b.branch && drill.kind === 'absent' ? null : { branch: b.branch, kind: 'absent' })}
                            className={`rounded-lg border p-3 text-left transition-colors ${
                              drill?.branch === b.branch && drill.kind === 'absent' ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50/40' : 'border-gray-100 bg-gray-50/50 hover:bg-gray-100/70'
                            }`}
                          >
                            <p className="text-xs font-semibold text-gray-700 truncate">{b.branch}</p>
                            <p className="text-lg font-bold text-brand-700">{b.absent} <span className="text-[10px] font-medium text-gray-400">absent records</span></p>
                            <p className="text-[10px] text-brand-600 font-semibold mt-0.5">{drill?.branch === b.branch && drill.kind === 'absent' ? 'Click to close' : 'Click to view employees'}</p>
                          </button>
                        ))}
                      </div>
                      {drill && drill.kind === 'absent' && (() => {
                        const b = ov.by_branch.find(x => x.branch === drill.branch);
                        const emps = b?.absent_emps ?? [];
                        return (
                          <div className="mt-3 rounded-lg border border-gray-200 overflow-hidden">
                            <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                              <h4 className="text-xs font-semibold text-gray-700">Absent Employees &mdash; {drill.branch} ({monthStat?.label})</h4>
                              <span className="text-[10px] text-gray-400">({emps.length})</span>
                              <button onClick={() => setDrill(null)} className="ml-auto p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={12} /></button>
                            </div>
                            {emps.length === 0 ? (
                              <div className="px-3 py-6 text-center text-xs text-gray-400">No absent employees found</div>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase">
                                    <th className="px-3 py-2">Employee</th>
                                    <th className="px-3 py-2 text-center">Absent Days</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {emps.map(e => (
                                    <tr key={e.id}>
                                      <td className="px-3 py-2">
                                        <p className="text-sm font-medium text-gray-800">{e.name}</p>
                                        <p className="text-[10px] font-mono text-sky-500">ID {e.id}</p>
                                      </td>
                                      <td className="px-3 py-2 text-center font-semibold text-brand-700 font-mono">{e.absent}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {detail === 'late' && (
                    <div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {ov.by_branch.map(b => (
                          <button
                            key={b.branch}
                            onClick={() => setDrill(drill?.branch === b.branch && drill.kind === 'late' ? null : { branch: b.branch, kind: 'late' })}
                            className={`rounded-lg border p-3 text-left transition-colors ${
                              drill?.branch === b.branch && drill.kind === 'late' ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50/40' : 'border-gray-100 bg-gray-50/50 hover:bg-gray-100/70'
                            }`}
                          >
                            <p className="text-xs font-semibold text-gray-700 truncate">{b.branch}</p>
                            <p className="text-lg font-bold text-brand-700">{b.late} <span className="text-[10px] font-medium text-gray-400">late records</span></p>
                            <p className="text-[10px] text-brand-600 font-semibold mt-0.5">{drill?.branch === b.branch && drill.kind === 'late' ? 'Click to close' : 'Click to view employees'}</p>
                          </button>
                        ))}
                      </div>
                      {drill && drill.kind === 'late' && (() => {
                        const b = ov.by_branch.find(x => x.branch === drill.branch);
                        const emps = b?.late_emps ?? [];
                        return (
                          <div className="mt-3 rounded-lg border border-gray-200 overflow-hidden">
                            <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                              <h4 className="text-xs font-semibold text-gray-700">Late Employees &mdash; {drill.branch} ({monthStat?.label})</h4>
                              <span className="text-[10px] text-gray-400">({emps.length})</span>
                              <button onClick={() => setDrill(null)} className="ml-auto p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={12} /></button>
                            </div>
                            {emps.length === 0 ? (
                              <div className="px-3 py-6 text-center text-xs text-gray-400">No late employees found</div>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase">
                                    <th className="px-3 py-2">Employee</th>
                                    <th className="px-3 py-2 text-center">Late Days</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {emps.map(e => (
                                    <tr key={e.id}>
                                      <td className="px-3 py-2">
                                        <p className="text-sm font-medium text-gray-800">{e.name}</p>
                                        <p className="text-[10px] font-mono text-sky-500">ID {e.id}</p>
                                      </td>
                                      <td className="px-3 py-2 text-center font-semibold text-brand-700 font-mono">{e.late}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {detail === 'hours' && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {ov.by_branch.map(b => (
                        <div key={b.branch} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                          <p className="text-xs font-semibold text-gray-700 truncate">{b.branch}</p>
                          <p className="text-lg font-bold text-brand-600">{b.hours}h <span className="text-[10px] font-medium text-gray-400">avg / day</span></p>
                        </div>
                      ))}
                    </div>
                  )}
                  {detail === 'unit' && ov.worst_unit && (() => {
                    const worst = ov.worst_unit;
                    return (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-600">
                        <span className="font-bold text-gray-900">{worst.branch}</span> has the most absent records ({worst.absent}) in {monthStat?.label ?? 'this month'}.
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {(() => {
                          const b = ov.by_branch.find(x => x.branch === worst.branch);
                          if (!b) return null;
                          const items = [
                            ['Records', b.records, 'text-gray-700'],
                            ['Present', b.present, 'text-emerald-600'],
                            ['Absent', b.absent, 'text-red-500'],
                            ['Late', b.late, 'text-blue-500'],
                            ['Avg Hours', `${b.hours}h`, 'text-brand-600'],
                            ['Active', b.active, 'text-sky-600'],
                          ] as const;
                          return items.map(([l, v, c]) => (
                            <div key={l} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                              <p className="text-[10px] font-semibold text-gray-400 uppercase">{l}</p>
                              <p className={`text-lg font-bold ${c}`}>{v}</p>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                    );
                  })()}
                  {detail === 'active' && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase">
                            <th className="px-3 py-2">Branch</th>
                            <th className="px-3 py-2 text-center">Active</th>
                            <th className="px-3 py-2 text-center">Records</th>
                            <th className="px-3 py-2 text-center">Absent Records</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {ov.by_branch.map(b => (
                            <tr key={b.branch}>
                              <td className="px-3 py-2 text-gray-800">{b.branch}</td>
                              <td className="px-3 py-2 text-center text-sky-600 font-semibold font-mono">{b.active}</td>
                              <td className="px-3 py-2 text-center text-gray-600 font-mono">{b.records}</td>
                              <td className="px-3 py-2 text-center text-red-500 font-mono">{b.absent}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-[11px] text-gray-400 mt-2">
                        Active = employees with at least one punch day in {monthStat?.label ?? 'this month'} ({ov.active_employees} of {ov.total_employees} registered).
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={anomRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                <button
                  onClick={toggleAnomalies}
                  title={anomOpen ? 'Hide anomalies' : 'Show anomalies'}
                  className="group flex items-center gap-1.5 cursor-pointer"
                >
                  <AlertTriangle size={14} className="text-amber-500" />
                  <span className="text-sm font-semibold text-gray-800 group-hover:text-brand-600 transition-colors">Today's Anomalies</span>
                  <span className="text-xs font-normal text-gray-400">({data.anomalies.length})</span>
                  <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${anomOpen ? '' : 'rotate-90'}`} />
                </button>
                {anomOpen && (
                  <div className="ml-auto flex items-center gap-1">
                    {(['All', 'High', 'Medium', 'Low'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => showSev(s)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                          sev === s ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {s === 'All' ? null : <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_META[s].dot}`} />}
                        {s}
                        {s !== 'All' && <span className="opacity-70">({sevCounts[s as 'High' | 'Medium' | 'Low']})</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {anomOpen ? (
                shown.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-gray-400">
                    {data.anomalies.length === 0 ? 'No anomalies detected today — all clear.' : 'No anomalies at this severity.'}
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {shown.map((a, i) => {
                      const m = SEVERITY_META[a.severity];
                      return (
                        <div key={i} className="px-4 py-3 flex items-start gap-3">
                          <span className={`mt-0.5 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg ${m.badge}`}>
                            {ANOMALY_ICONS[a.type] ?? <AlertTriangle size={14} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-gray-800">{a.type}</p>
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${m.badge}`}>
                                {a.severity}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-500 mt-0.5">{a.message}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {a.employee} <span className="font-mono text-gray-400">ID {a.id}</span> &middot; {a.branch}
                              {a.time !== '--' ? <span className="font-mono"> &middot; {a.time}</span> : null}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                <button
                  onClick={toggleAnomalies}
                  className="w-full px-4 py-6 text-center text-sm text-gray-400 hover:text-brand-600 hover:bg-gray-50/50 transition-colors"
                >
                  Anomalies hidden — click to show ({data.anomalies.length})
                </button>
              )}
            </div>

            <div ref={riskRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <ShieldAlert size={14} className="text-brand-500" /> At-Risk Employees
                  <span className="text-xs font-normal text-gray-400">({data.risk.length}) &middot; last {data.range_days} days</span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/80">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">#</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Employee</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Branch</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Risk Score</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase">Reasons</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.risk.map((r, i) => (
                      <tr key={`${r.id}-${r.branch}`} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 text-sm text-gray-400 font-mono">{i + 1}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <p className="text-sm font-medium text-gray-800">{r.name}</p>
                          <p className="text-[10px] font-mono text-gray-600 tracking-wide">ID {r.id}</p>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-600">{r.branch}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${r.score >= 60 ? 'bg-red-500' : r.score >= 30 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                style={{ width: `${r.score}%` }}
                              />
                            </div>
                            <span className={`text-sm font-bold font-mono ${r.score >= 60 ? 'text-red-600' : r.score >= 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                              {r.score}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {r.reasons.length === 0 ? (
                            <span className="text-xs text-gray-400">Consistent attendance</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {r.reasons.map((reason, j) => (
                                <span key={j} className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-[10px] font-semibold text-gray-600">
                                  {reason}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <Bot size={14} className="text-brand-500" /> Ask AI
                  <span className="text-xs font-normal text-gray-400">Chat stays open across all pages</span>
                </h2>
              </div>
              <div className="px-4 py-10 text-center text-sm text-gray-400">
                Open the chat from the top-right corner — it stays open while you browse other pages.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
