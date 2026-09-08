import { useEffect, useState } from 'react';
import { Building2, Wifi, WifiOff, CheckCircle2, XCircle, MapPin, Users, X, AlertTriangle, Download } from 'lucide-react';
import { API_URL } from '../data/mockData';
import EmployeeMonthlyModal, { type EmployeeRef } from './EmployeeMonthlyModal';
import { getStaffLocation, STAFF_LOCATIONS } from '../data/staffLocations';
import { timeAgoText, fmtPunch } from '../lib/status';

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

interface AllLiveData {
  branches: BranchSummary[];
  present: number;
  absent: number;
  employees: { id: string; name: string; status: string; branch: string; device_id: number }[];
  lastUpdated: string;
}

export default function UnitsPage() {
  const [data, setData] = useState<AllLiveData | null>(null);
  const [sel, setSel] = useState<BranchSummary | null>(null);
  const [locFilter, setLocFilter] = useState('all');
  const [selEmp, setSelEmp] = useState<EmployeeRef | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [repMonth, setRepMonth] = useState<string>('');
  const [repMonths, setRepMonths] = useState<string[]>([]);
  const [repLoading, setRepLoading] = useState(false);
  const [repMsg, setRepMsg] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const offlineCount = data?.branches.filter(b => b.deviceStatus !== 'Online').length ?? 0;

  useEffect(() => {
    setLocFilter('all');
  }, [sel?.device_id]);

  async function fetchData() {
    try {
      const r = await fetch(`${API_URL}/api/live/all`);
      if (r.ok) setData(await r.json());
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, []);

  // Load available months for the selected unit
  async function loadReportMonths(deviceId: number) {
    if (!data) return;
    const unitEmps = data.employees.filter(e => e.device_id === deviceId);
    const months = new Set<string>();
    for (const e of unitEmps) {
      try {
        const r = await fetch(`${API_URL}/api/employee/monthly?device_id=${deviceId}&id=${encodeURIComponent(e.id)}`);
        if (!r.ok) continue;
        const d = await r.json();
        for (const m of d.months) months.add(m.month);
        if (months.size > 0 && e.id === unitEmps[0].id) break;
      } catch { /* ignore */ }
    }
    const sorted = Array.from(months).sort();
    setRepMonths(sorted);
    setRepMonth(sorted.length ? sorted[sorted.length - 1] : '');
  }

  useEffect(() => {
    setLocFilter('all');
    setRepMsg(null);
    if (sel) {
      setRepMonths([]);
      setRepMonth('');
      loadReportMonths(sel.device_id);
    }
  }, [sel?.device_id]);

  // Download a CSV report with all employee details + monthly attendance
  async function downloadReport(branchName: string, deviceId: number) {
    if (!data || !repMonth) return;
    setRepLoading(true);
    setRepMsg(null);
    try {
      const unitEmps = data.employees.filter(e => e.device_id === deviceId)
        .map(e => ({ ...e, unitLoc: getStaffLocation(e.name, deviceId) }));
      const header = [
        'Emp ID', 'Employee Name', 'Branch', 'Location', 'Month',
        'Present', 'Absent', 'Adjusted Absent', 'On-Time', 'Late (Nos)', 'Late (hrs)',
        'Extra (Nos)', 'Extra (hrs)', 'Total (hrs)', 'Permission (Nos)', 'Permission (hrs)',
        'Half-Day Leaves', 'Overtime (Nos)', 'Overtime (hrs)', 'Weekly Off', 'Holiday'
      ];
      const csvLines = [header.join(',')];

      async function fetchSummary(e: { id: string; name: string; unitLoc?: string }) {
        try {
          const r = await fetch(`${API_URL}/api/employee/monthly?device_id=${deviceId}&id=${encodeURIComponent(e.id)}`);
          if (!r.ok) return null;
          const d = await r.json();
          const s = d.months.find((m: { month: string }) => m.month === repMonth) ?? null;
          return { e, s };
        } catch {
          return null;
        }
      }

      const CONCURRENCY = 6;
      const results: ({ e: { id: string; name: string; unitLoc?: string }; s: Record<string, any> | null } | null)[] = [];
      for (let i = 0; i < unitEmps.length; i += CONCURRENCY) {
        const batch = await Promise.all(unitEmps.slice(i, i + CONCURRENCY).map(fetchSummary));
        results.push(...batch);
      }

      for (const res of results) {
        if (!res) continue;
        const s = res.s;
        const row = [
          res.e.id, res.e.name, branchName, res.e.unitLoc ?? '', repMonth,
          s ? s.present : '', s ? s.absent : '', s ? s.adjusted_absent : '', s ? s.on_time : '',
          s ? s.late : '', s ? (+s.late_hours).toFixed(2) : '',
          s ? s.extra_count : '', s ? (+s.extra_hours).toFixed(2) : '', s ? (+s.total_hours).toFixed(2) : '',
          s ? s.permission_count : '', s ? (+s.permission_hours).toFixed(2) : '',
          s ? s.half_day_count : '', s ? s.overtime_count : '', s ? (+s.overtime_hours).toFixed(2) : '',
          s ? (s.off_count ?? 0) : '', s ? (s.holiday_count ?? 0) : '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        csvLines.push(row);
      }
      const blob = new Blob(['\ufeff' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Unit_Report_${(branchName || 'unit').replace(/[^\w]+/g, '_')}_${repMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setRepMsg('Report downloaded');
    } finally {
      setRepLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <Building2 size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900">Units / Branches</h1>
            <p className="text-[11px] text-gray-500">All operational units with live status</p>
          </div>
          {data && <span className="ml-auto text-[11px] text-black">Updated {data.lastUpdated}</span>}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {!data ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <span className="text-sm">Loading units...</span>
          </div>
        ) : (
          <>
            {offlineCount > 0 && (
              <div className="mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-[11px] text-red-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-500" />
                <div>
                  <span className="font-bold">{offlineCount} device{offlineCount > 1 ? 's' : ''} offline.</span>{' '}
                  Punches made on offline devices are buffered on the device and sync here after it reconnects.
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {data.branches.map(branch => (
              <button key={branch.device_id} onClick={() => setSel(branch)} className={`text-left bg-white rounded-xl border p-4 ${branch.deviceStatus === 'Online' ? 'border-gray-200 hover:border-brand-300' : 'border-red-200 bg-red-50/40'} hover:shadow-md transition-shadow cursor-pointer`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">{branch.name}</p>
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    branch.deviceStatus === 'Online' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                  }`}>
                    {branch.deviceStatus === 'Online' ? <Wifi size={11} /> : <WifiOff size={11} />}
                    {branch.deviceStatus}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mb-3 flex items-center gap-1"><MapPin size={11} /> {branch.location}</p>
                <div className="flex items-center gap-4 text-xs mb-3">
                  <span className="flex items-center gap-1 text-emerald-600 font-semibold"><CheckCircle2 size={13} /> {branch.present} IN</span>
                  <span className="flex items-center gap-1 text-red-600 font-semibold"><XCircle size={13} /> {branch.absent} OUT</span>
                </div>
                <p className="text-[10px] text-black truncate">Device #{branch.device_id} &middot; Ping {branch.lastPing === '--' ? '--' : branch.lastPing} &middot; Updated {branch.lastUpdated}</p>
                <p className="mt-1 text-[10px] text-gray-500 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${branch.deviceStatus === 'Online' ? 'bg-emerald-500' : 'bg-red-400 animate-pulse'}`} />
                  Punches: {branch.lastPunch && branch.lastPunch !== '--' ? `${fmtPunch(branch.lastPunch)} (${timeAgoText(branch.lastPunch, now)})` : 'none'}
                </p>
              </button>
            ))}
          </div>
          </>
        )}
      </div>

      {sel && (() => {
        const isSLP = (sel.name || '').toUpperCase().includes('SLP');
        const emps = (data?.employees ?? []).filter(e => e.device_id === sel.device_id)
          .map(e => ({ ...e, unitLoc: getStaffLocation(e.name, e.device_id) }));
        const shown = isSLP && locFilter !== 'all'
          ? emps.filter(e => e.unitLoc === locFilter)
          : emps;
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSel(null)}>
            <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
                  <Users size={15} className="text-white" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-gray-900 truncate">{sel.name}</h2>
                  <p className="text-[11px] text-gray-500">{shown.length} employees &middot; {sel.present} IN / {sel.absent} OUT</p>
                </div>
                <button onClick={() => setSel(null)} className="ml-auto p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                  <X size={16} />
                </button>
              </div>
              {isSLP && (
                <div className="px-5 pt-3 flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => setLocFilter('all')}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                      locFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    All ({emps.length})
                  </button>
                  {STAFF_LOCATIONS.map(loc => {
                    const count = emps.filter(e => e.unitLoc === loc).length;
                    return (
                      <button key={loc} onClick={() => setLocFilter(loc)}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                          locFilter === loc ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}>
                        {loc} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="px-5 pt-3 pb-1 flex flex-wrap items-center gap-2 border-t border-gray-100 mt-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
                  <Download size={13} className="text-brand-500" /> Month:
                </div>
                <select
                  value={repMonth}
                  onChange={e => setRepMonth(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  disabled={repMonths.length === 0}
                >
                  {repMonths.length === 0 && <option value="">—</option>}
                  {repMonths.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <button
                  onClick={() => downloadReport(sel.name, sel.device_id)}
                  disabled={repLoading || !repMonth}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Download report with all employee details (CSV)"
                >
                  <Download size={12} /> {repLoading ? 'Generating…' : 'Download Report'}
                </button>
                {repMsg && <span className="text-[11px] text-emerald-600 font-semibold">{repMsg}</span>}
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-3">
                {shown.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-10">No employees enrolled for this branch</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-100">
                        <th className="px-3 py-2 font-medium">Emp ID</th>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Location</th>
                        <th className="px-3 py-2 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map(e => (
                        <tr key={`${e.device_id}-${e.id}`} className="border-b border-gray-50 last:border-0">
                          <td className="px-3 py-2 font-mono text-gray-700">{e.id}</td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => setSelEmp({ id: e.id, name: e.name, branch: sel.name, device_id: e.device_id })}
                              className="text-xs font-medium text-gray-900 hover:text-brand-600 hover:underline transition-colors"
                            >
                              {e.name}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                              e.unitLoc ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-400'
                            }`}>
                              {e.unitLoc ?? '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${e.status === 'IN' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                              {e.status === 'IN' ? <CheckCircle2 size={10} className="mr-1" /> : <XCircle size={10} className="mr-1" />}
                              {e.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <EmployeeMonthlyModal employee={selEmp} onClose={() => setSelEmp(null)} />
    </div>
  );
}
