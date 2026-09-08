import { useEffect, useState } from 'react';
import { Sparkles, TrendingUp, AlertTriangle, Building2, RefreshCw, ChevronDown, ShieldAlert, Radar, BrainCircuit } from 'lucide-react';

const API_URL = '/ua';

interface MlProfiles {
  version: number;
  trained_at: string;
  span: { start: string; end: string; days: number };
  n_employees: number;
  n_modeled: number;
  cluster_meta: { cluster: number; name: string; count: number; late_rate: number; first_median: number; anomalies: number }[];
  risk: {
    version: number;
    label_window_days: number;
    positives: number;
    negatives: number;
    metrics: { auc?: number; precision?: number; recall?: number; f1?: number; n_splits?: number; error?: string } | null;
  };
  drift: { recent_days: number; flagged_count: number; employees: MlEmp[] };
  employees: MlEmp[];
}

interface MlEmp {
  id: string;
  name: string;
  branch: string;
  device_id: number;
  cluster: number | null;
  cluster_name: string;
  anomaly: boolean;
  anomaly_score: number | null;
  risk_score?: number;
  label?: number;
  drift?: {
    baseline_median: number;
    recent_median: number;
    shift_min: number;
    z: number;
    direction: 'later' | 'earlier';
    flagged: boolean;
  };
  features: {
    days?: number;
    first_median?: number;
    first_mad?: number;
    late_rate?: number;
    avg_late_min?: number;
    max_late_min?: number;
    absent_rate?: number;
    hours_median?: number;
    max_late_streak?: number;
    early_margin_median?: number;
    late_trend?: number;
  };
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

interface BranchStat {
  branch: string;
  records: number;
  present: number;
  absent: number;
  late: number;
  hours: number;
  active: number;
}

interface MonthStat {
  month: string;
  label: string;
  overview: Overview;
}

interface Anomaly {
  severity: 'High' | 'Medium' | 'Low';
  employee: string;
  branch: string;
  type: string;
  message: string;
}

interface RiskRow {
  name: string;
  branch: string;
  score: number;
  reasons: string[];
}

interface AiData {
  generated: string;
  range_days: number;
  months: MonthStat[];
  anomalies: Anomaly[];
  risk: RiskRow[];
}

interface LiveEmp {
  id: string;
  name: string;
  status: 'IN' | 'OUT';
  branch: string;
  device_id: number;
}

interface LiveAll {
  branches: { device_id: number; name: string; present: number; absent: number; deviceStatus: string }[];
  employees: LiveEmp[];
}

const SEV_STYLE: Record<string, string> = {
  High: 'bg-red-100 text-red-700',
  Medium: 'bg-amber-100 text-amber-700',
  Low: 'bg-blue-100 text-blue-700',
};

const BADGE: Record<string, string> = {
  'Early bird': 'bg-blue-100 text-blue-700',
  'On-time': 'bg-emerald-100 text-emerald-700',
  Borderline: 'bg-amber-100 text-amber-700',
  'Chronic late': 'bg-blue-100 text-blue-700',
  Severe: 'bg-red-100 text-red-700',
  'Insufficient data': 'bg-gray-100 text-gray-500',
};

const CHIP: Record<string, string> = {
  'Early bird': 'border-blue-200 bg-blue-50',
  'On-time': 'border-emerald-200 bg-emerald-50',
  Borderline: 'border-amber-200 bg-amber-50',
  'Chronic late': 'border-blue-200 bg-blue-50',
  Severe: 'border-red-200 bg-red-50',
  'Insufficient data': 'border-gray-200 bg-gray-50',
};

function fmtClock12(sec: number): string {
  const h24 = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  const ap = h24 >= 12 ? 'PM' : 'AM';
  const hh = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

function riskLevel(score: number): { label: string; cls: string } {
  if (score >= 80) return { label: 'Critical', cls: 'bg-red-100 text-red-700' };
  if (score >= 60) return { label: 'High', cls: 'bg-orange-100 text-orange-700' };
  if (score >= 40) return { label: 'Medium', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Low', cls: 'bg-emerald-100 text-emerald-700' };
}

export default function PatternsPage() {
  const [facts, setFacts] = useState<string[]>([]);
  const [factsNarr, setFactsNarr] = useState<string | null>(null);
  const [factsShow, setFactsShow] = useState(false);
  const [factsErr, setFactsErr] = useState(false);
  const [data, setData] = useState<AiData | null>(null);
  const [live, setLive] = useState<LiveAll | null>(null);
  const [ml, setMl] = useState<MlProfiles | null>(null);
  const [profOpen, setProfOpen] = useState(true);
  const [riskOpen, setRiskOpen] = useState(true);
  const [driftOpen, setDriftOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState('');
  const [profSel, setProfSel] = useState<string | null>('Severe');

  function clickProf(name: string) {
    setProfSel(prev => (prev === name ? null : name));
  }

  async function load() {
    setRefreshing(true);
    fetch(`${API_URL}/api/ai/facts`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j && !j.fallback) {
          setFacts(j.facts ?? []);
          setFactsNarr(j.narrative ?? null);
          setFactsErr(false);
        } else {
          setFactsErr(true);
        }
      })
      .catch(() => setFactsErr(true));
    try {
      const [ar, lr, mr] = await Promise.all([
        fetch(`${API_URL}/api/ai-insights`),
        fetch(`${API_URL}/api/live/all`),
        fetch(`${API_URL}/api/ml/profiles`),
      ]);
      if (ar.ok) setData(await ar.json());
      if (lr.ok) setLive(await lr.json());
      if (mr.ok) setMl(await mr.json());
    } catch { /* ignore */ }
    setUpdated(new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }));
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  const m0 = data?.months?.[0];
  const m1 = data?.months?.[1];
  const months = data?.months ?? [];

  const statusByBranch: Record<string, { working: number; late: number; logout: number; absent: number }> = {};
  for (const e of live?.employees ?? []) {
    const b = statusByBranch[e.branch] ?? { working: 0, late: 0, logout: 0, absent: 0 };
    if (e.status === 'IN') b.working += 1;
    else b.absent += 1;
    statusByBranch[e.branch] = b;
  }

  const rateDiff = m0 && m1 ? Math.round((m0.overview.attendance_rate - m1.overview.attendance_rate) * 10) / 10 : null;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f0f4f8]">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Patterns &amp; Insights</h1>
            <p className="text-xs text-gray-400 mt-0.5">AI analysis of the full attendance dataset · Updated {updated || '...'}</p>
          </div>
          <button
            onClick={() => { setRefreshing(true); window.location.reload(); }}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {factsNarr && (
          <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-brand-100">
              <Sparkles size={14} className="text-brand-600" />
              <h2 className="text-sm font-semibold text-brand-800">What the data says today</h2>
            </div>
            <div className="px-4 py-3 space-y-2">
              {factsNarr.split('\n').filter(Boolean).map((l, i) => (
                <p key={i} className="text-sm text-gray-700 leading-relaxed flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0" />
                  {l}
                </p>
              ))}
            </div>
            <div className="px-4 pb-3">
              <button
                onClick={() => setFactsShow(s => !s)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                <ChevronDown size={13} className={`transition-transform ${factsShow ? 'rotate-180' : ''}`} />
                {factsShow ? 'Hide' : 'Show'} all detected facts ({facts.length})
              </button>
              {factsShow && (
                <div className="mt-2 space-y-1.5">
                  {facts.map((f, i) => (
                    <p key={i} className="text-xs text-gray-500 leading-relaxed">• {f}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {!factsNarr && facts.length > 0 && (
          <div className="rounded-xl border border-brand-200 bg-white overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-100">
              <Sparkles size={14} className="text-brand-600" />
              <h2 className="text-sm font-semibold text-gray-800">Today's detected patterns</h2>
            </div>
            <div className="px-4 py-3 space-y-1.5">
              {facts.map((f, i) => (
                <p key={i} className="text-sm text-gray-600 leading-relaxed">• {f}</p>
              ))}
            </div>
          </div>
        )}
        {factsErr && !facts.length && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
            Could not compute today's patterns right now. Try refreshing.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <TrendingUp size={14} className="text-brand-500" />
              <h2 className="text-sm font-semibold text-gray-800">Monthly attendance trend</h2>
              {rateDiff != null && (
                <span className={`ml-auto text-xs font-bold ${rateDiff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {rateDiff >= 0 ? '+' : ''}{rateDiff}% vs last month
                </span>
              )}
            </div>
            <div className="px-4 py-3 space-y-2">
              {months.map(m => (
                <div key={m.month}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-gray-600">{m.label}</span>
                    <span className="text-gray-400">{m.overview.attendance_rate}% · {m.overview.absent_records} absent · {m.overview.late_records} late</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.min(100, m.overview.attendance_rate)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Building2 size={14} className="text-brand-500" />
              <h2 className="text-sm font-semibold text-gray-800">Branches today</h2>
              <span className="ml-auto text-[10px] text-gray-400">live punch status</span>
            </div>
            <div className="px-4 py-3 space-y-2">
              {(live?.branches ?? []).map(b => {
                const st = statusByBranch[b.name] ?? { working: 0, late: 0, logout: 0, absent: 0 };
                return (
                  <div key={b.device_id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${b.deviceStatus === 'Online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span className="font-medium text-gray-700 truncate">{b.name}</span>
                    </div>
                    <span className="text-gray-600 shrink-0">
                      {st.working} present · {st.late} late · {st.absent} absent
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <AlertTriangle size={14} className="text-brand-500" />
            <h2 className="text-sm font-semibold text-gray-800">Branch summary — {m0?.label ?? 'this month'}</h2>
            <span className="ml-auto text-[10px] text-gray-400">sorted by absent records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-4 py-2 font-medium text-right">Records</th>
                  <th className="px-4 py-2 font-medium text-right">Present</th>
                  <th className="px-4 py-2 font-medium text-right">Absent</th>
                  <th className="px-4 py-2 font-medium text-right">Late</th>
                  <th className="px-4 py-2 font-medium text-right">Avg hrs</th>
                  <th className="px-4 py-2 font-medium text-right">Active</th>
                </tr>
              </thead>
              <tbody>
                {(m0?.overview.by_branch ?? []).map(b => (
                  <tr key={b.branch} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2 font-semibold text-gray-900">{b.branch}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900">{b.records}</td>
                    <td className="px-4 py-2 text-right font-semibold text-emerald-700">{b.present}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-600">{b.absent}</td>
                    <td className="px-4 py-2 text-right font-semibold text-blue-700">{b.late}</td>
                    <td className="px-4 py-2 text-right text-gray-500">{b.hours}h</td>
                    <td className="px-4 py-2 text-right text-gray-500">{b.active}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setProfOpen(o => !o)}
              title={profOpen ? 'Hide behavioral profiles' : 'Show behavioral profiles'}
              className="group flex items-center gap-1.5 cursor-pointer"
            >
              <BrainCircuit size={14} className="text-brand-500" />
              <span className="text-sm font-semibold text-gray-800 group-hover:text-brand-600 transition-colors">Behavioral profiles</span>
              {ml && <span className="text-xs font-normal text-gray-400">({profSel ? '1' : 'all'} of {ml.cluster_meta.length} profiles shown)</span>}
              <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${profOpen ? '' : 'rotate-90'}`} />
            </button>
            {ml && profOpen && (
              <span className="ml-auto text-[10px] text-gray-400">
                Synced {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
          {!ml && (
            <p className="px-4 py-6 text-xs text-gray-400 text-center">Model not trained yet — run train_ml.py on the server.</p>
          )}
          {ml && profOpen && (
            <>
              <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 border-b border-gray-100">
                {ml.cluster_meta.map(c => {
                  const active = profSel === c.name;
                  return (
                    <button
                      key={c.cluster}
                      onClick={() => clickProf(c.name)}
                      title={active ? 'Deselect' : `Show only ${c.name}`}
                      className={`rounded-lg px-3 py-2 border text-left transition-all cursor-pointer ${
                        active
                          ? `${CHIP[c.name] ?? 'border-gray-200'} ring-2 ring-brand-500 ring-offset-1`
                          : 'border-gray-200 bg-white opacity-50 hover:opacity-100'
                      }`}
                    >
                      <p className="text-[11px] font-bold">{c.name}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {c.count} emp · {Math.round(c.late_rate * 100)}% late · {c.anomalies} flagged
                      </p>
                    </button>
                  );
                })}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="px-4 py-2 font-medium">Employee</th>
                      <th className="px-4 py-2 font-medium">Branch</th>
                      <th className="px-4 py-2 font-medium">Profile</th>
                      <th className="px-4 py-2 font-medium">Late rate</th>
                      <th className="px-4 py-2 font-medium">Median arrival</th>
                      <th className="px-4 py-2 font-medium">Avg late</th>
                      <th className="px-4 py-2 font-medium">Median hrs/day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...ml.employees]
                      .filter(e => !profSel || e.cluster_name === profSel)
                      .sort((a, b) => Number(b.anomaly) - Number(a.anomaly) || (b.features.late_rate ?? 0) - (a.features.late_rate ?? 0))
                      .map(e => (
                        <tr key={`${e.device_id}-${e.id}`} className={`border-b border-gray-50 last:border-0 ${e.anomaly ? 'bg-red-50/50' : ''}`}>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-700">{e.name}</span>
                              {e.anomaly && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold">
                                  <Radar size={10} /> unusual
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-gray-700">{e.branch}</td>
                          <td className="px-4 py-2">
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${BADGE[e.cluster_name] ?? 'bg-gray-100 text-gray-700'}`}>
                              {e.cluster_name}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-gray-700">{e.features.late_rate != null ? `${Math.round(e.features.late_rate * 100)}%` : '—'}</td>
                          <td className="px-4 py-2 text-gray-700">{e.features.first_median != null ? fmtClock12(e.features.first_median) : '—'}</td>
                          <td className="px-4 py-2 text-gray-700">{e.features.avg_late_min != null ? `${Math.round(e.features.avg_late_min)}m` : '—'}</td>
                          <td className="px-4 py-2 text-gray-700">{e.features.hours_median != null ? `${e.features.hours_median.toFixed(1)}h` : '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setRiskOpen(o => !o)}
              title={riskOpen ? 'Hide attendance risk' : 'Show attendance risk'}
              className="group flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldAlert size={14} className="text-brand-500" />
              <span className="text-sm font-semibold text-gray-800 group-hover:text-brand-600 transition-colors">Attendance risk</span>
              {ml?.risk && <span className="text-xs font-normal text-gray-400">({ml.risk.positives} inactive / {ml.risk.negatives} active)</span>}
              <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${riskOpen ? '' : 'rotate-90'}`} />
            </button>
            {ml?.risk && riskOpen && (
              <span className="ml-auto text-[10px] text-gray-400">
                Synced {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
          {ml?.risk?.metrics && riskOpen && (
            <div className="px-4 py-4 border-b border-gray-100">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-xl">
                {typeof ml.risk.metrics.auc === 'number' && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Model AUC</p>
                    <p className="text-2xl font-bold text-brand-700 mt-1">{ml.risk.metrics.auc}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">5-fold cross-validation</p>
                  </div>
                )}
                {typeof ml.risk.metrics.precision === 'number' && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Precision</p>
                    <p className="text-2xl font-bold text-emerald-700 mt-1">{ml.risk.metrics.precision}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">of flagged, how many true</p>
                  </div>
                )}
                {typeof ml.risk.metrics.recall === 'number' && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Recall</p>
                    <p className="text-2xl font-bold text-amber-600 mt-1">{ml.risk.metrics.recall}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">of inactive, how many caught</p>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-3 leading-relaxed max-w-2xl">
                Risk scores come from a supervised model trained on behavioral features with a proxy label — an employee is "inactive" when they have no punches in the last {ml?.risk?.label_window_days} days while their device stayed active. Small sample — treat as a pilot and confirm manually before acting.
              </p>
            </div>
          )}
          {ml?.risk?.metrics?.error && riskOpen && (
            <p className="px-4 py-3 text-xs text-red-500">{ml.risk.metrics.error}</p>
          )}
          {riskOpen && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2 font-medium">Employee</th>
                    <th className="px-4 py-2 font-medium">Branch</th>
                    <th className="px-4 py-2 font-medium">Risk score</th>
                    <th className="px-4 py-2 font-medium">Profile</th>
                    <th className="px-4 py-2 font-medium">Late rate</th>
                    <th className="px-4 py-2 font-medium">Trend</th>
                    <th className="px-4 py-2 font-medium">Label</th>
                  </tr>
                </thead>
              <tbody>
                {[...(ml?.employees ?? [])]
                  .filter(e => typeof e.risk_score === 'number')
                  .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
                  .map(e => {
                    const lvl = riskLevel(e.risk_score ?? 0);
                    return (
                      <tr key={`risk-${e.device_id}-${e.id}`} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2 font-medium text-gray-700">{e.name}</td>
                        <td className="px-4 py-2 text-gray-500">{e.branch}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full rounded-full bg-red-500" style={{ width: `${e.risk_score}%` }} />
                            </div>
                            <span className="font-bold text-gray-700">{e.risk_score}</span>
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${lvl.cls}`}>{lvl.label}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${BADGE[e.cluster_name] ?? 'bg-gray-100 text-gray-500'}`}>
                            {e.cluster_name}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-600">{Math.round((e.features.late_rate ?? 0) * 100)}%</td>
                        <td className="px-4 py-2 text-gray-600">
                          <span className={e.features.late_trend != null && e.features.late_trend > 0 ? 'text-red-600' : 'text-emerald-600'}>
                            {e.features.late_trend != null ? `${e.features.late_trend > 0 ? '+' : ''}${Math.round(e.features.late_trend * 100)}%` : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          {e.label === 1 ? (
                            <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold">inactive</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">active</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setDriftOpen(o => !o)}
              title={driftOpen ? 'Hide arrival drift' : 'Show arrival drift'}
              className="group flex items-center gap-1.5 cursor-pointer"
            >
              <TrendingUp size={14} className="text-brand-500" />
              <span className="text-sm font-semibold text-gray-800 group-hover:text-brand-600 transition-colors">Arrival-habit drift</span>
              {ml?.drift && <span className="text-xs font-normal text-gray-400">({ml.drift.flagged_count} flagged)</span>}
              <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${driftOpen ? '' : 'rotate-90'}`} />
            </button>
            {ml?.drift && driftOpen && (
              <span className="ml-auto text-[10px] text-gray-400">baseline vs last {ml.drift.recent_days} days</span>
            )}
          </div>
          {driftOpen && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-4 py-2 font-medium">Baseline arrival</th>
                  <th className="px-4 py-2 font-medium">Recent arrival</th>
                  <th className="px-4 py-2 font-medium">Shift</th>
                  <th className="px-4 py-2 font-medium">Z-score</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...(ml?.drift?.employees ?? [])]
                  .sort((a, b) => {
                    const fa = a.drift?.flagged ? 1 : 0;
                    const fb = b.drift?.flagged ? 1 : 0;
                    return fb - fa || Math.abs(b.drift?.shift_min ?? 0) - Math.abs(a.drift?.shift_min ?? 0);
                  })
                  .slice(0, 25)
                  .map(e => {
                    const d = e.drift;
                    if (!d) return null;
                    return (
                      <tr key={`drift-${e.device_id}-${e.id}`} className={`border-b border-gray-50 last:border-0 ${d.flagged ? 'bg-amber-50/60' : ''}`}>
                        <td className="px-4 py-2 font-medium text-gray-700">{e.name}</td>
                        <td className="px-4 py-2 text-gray-500">{e.branch}</td>
                        <td className="px-4 py-2 text-gray-600">{fmtClock12(d.baseline_median)}</td>
                        <td className="px-4 py-2 text-gray-600">{fmtClock12(d.recent_median)}</td>
                        <td className={`px-4 py-2 font-semibold ${d.direction === 'later' ? 'text-red-600' : 'text-emerald-600'}`}>
                          {d.shift_min > 0 ? '+' : ''}{d.shift_min} min {d.direction}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{d.z}</td>
                        <td className="px-4 py-2">
                          {d.flagged ? (
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">shift detected</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-semibold">stable</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <ShieldAlert size={14} className="text-brand-500" />
              <h2 className="text-sm font-semibold text-gray-800">Top at-risk employees (30 days)</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {(data?.risk ?? []).slice(0, 8).map((r, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-400 w-5">#{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-700 truncate">{r.name} <span className="text-gray-400 font-normal">({r.branch})</span></p>
                    <p className="text-[11px] text-gray-400 truncate">{r.reasons.join('; ') || 'consistent'}</p>
                  </div>
                  <span className="text-xs font-bold text-red-600">{r.score}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <AlertTriangle size={14} className="text-brand-500" />
              <h2 className="text-sm font-semibold text-gray-800">Anomalies today</h2>
              <span className="ml-auto text-[10px] text-gray-400">{data?.anomalies?.length ?? 0} detected</span>
            </div>
            <div className="divide-y divide-gray-50 max-h-[320px] overflow-y-auto">
              {(data?.anomalies ?? []).slice(0, 15).map((a, i) => (
                <div key={i} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${SEV_STYLE[a.severity]}`}>{a.severity}</span>
                    <p className="text-xs font-medium text-gray-700 truncate">{a.employee} <span className="text-gray-400 font-normal">({a.branch})</span></p>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5">{a.type} — {a.message}</p>
                </div>
              ))}
              {!data?.anomalies?.length && (
                <p className="px-4 py-6 text-xs text-gray-400 text-center">No anomalies today — all clear.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
