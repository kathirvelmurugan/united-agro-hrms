import { useEffect, useState } from 'react';
import { Database, FileSpreadsheet, Download, ShieldCheck, Loader2, HardDriveDownload } from 'lucide-react';
import { API_URL } from '../data/mockData';
import { authFetch } from '../lib/auth';

function fmt(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}
function todayISO(): string {
  return fmt(new Date());
}
function startOfWeekISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fmt(d);
}
function startOfMonthISO(): string {
  const d = new Date();
  return fmt(new Date(d.getFullYear(), d.getMonth(), 1));
}

type RangeKey = 'today' | 'week' | 'month' | 'custom';
const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom Dates' },
];

interface PunchRow {
  date: string;
  id: string;
  name: string;
  branch: string;
  punchCount: number;
  first: string;
  last: string;
  punches: string[];
  hours: number;
  status: string;
}

interface AllLiveData {
  branches: { device_id: number; name: string; location: string; present: number; absent: number }[];
  present: number;
  absent: number;
  employees: {
    id: string; name: string; status: string; branch: string; location: string;
    punchTimes: string[]; lastPunch: string;
  }[];
  lastUpdated: string;
}

interface SqlBackupItem {
  name: string;
  size: number;
  size_mb: number;
  mtime: string;
  valid?: boolean;
  database?: string;
  damaged?: boolean;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvSanitize(value: unknown): string {
  const s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}
function csvEscape(value: unknown): string {
  const s = csvSanitize(value).replace(/"/g, '""');
  return `"${s}"`;
}

export default function BackupPage() {
  const [data, setData] = useState<AllLiveData | null>(null);
  const [backups, setBackups] = useState<SqlBackupItem[]>([]);
  const [busy, setBusy] = useState<'csv' | 'json' | 'sql' | null>(null);
  const [range, setRange] = useState<RangeKey>('today');
  const [fromDate, setFromDate] = useState(todayISO);
  const [toDate, setToDate] = useState(todayISO);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);

  // Verify superadmin via server truth (not localStorage) for SQL backup section
  useEffect(() => {
    authFetch(`${API_URL}/api/me`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setIsSuperAdmin(d?.role === 'superadmin'))
      .catch(() => setIsSuperAdmin(false));
  }, []);

  function applyRange(key: RangeKey) {
    setRange(key);
    setFromDate(key === 'week' ? startOfWeekISO() : key === 'month' ? startOfMonthISO() : todayISO());
    setToDate(todayISO());
  }

  async function fetchAll(): Promise<AllLiveData> {
    const r = await authFetch(`${API_URL}/api/live/all`);
    if (!r.ok) throw new Error('Failed to fetch data');
    return r.json();
  }

  async function fetchBackups() {
    try {
      const r = await authFetch(`${API_URL}/api/backup`);
      if (r.ok) setBackups((await r.json()).backups ?? []);
    } catch { /* ignore */ }
  }

  async function exportCSV() {
    setBusy('csv');
    try {
      const from = range === 'custom' ? fromDate : range === 'week' ? startOfWeekISO() : range === 'month' ? startOfMonthISO() : todayISO();
      const to = toDate || todayISO();
      const r = await authFetch(`${API_URL}/api/export/punches?from=${from}&to=${to}`);
      if (!r.ok) throw new Error('Failed to fetch range data');
      const d = await r.json();
      const header = 'Date,EmpID,Name,Branch,Status,FirstPunch,LastPunch,Hours,PunchCount,Punches';
      const rows = (d.rows as PunchRow[]).map(e =>
        [csvEscape(e.date), csvEscape(e.id), csvEscape(e.name), csvEscape(e.branch), csvEscape(e.status), csvEscape(e.first), csvEscape(e.last), csvEscape(e.hours), csvEscape(e.punchCount), csvEscape(e.punches.join('; '))].join(',')
      );
      const csv = '\uFEFF' + [header, ...rows].join('\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `attendance-${from}-to-${to}.csv`);
    } catch {
      alert('Export failed - could not fetch data for the selected date range');
    }
    setBusy(null);
  }

  async function exportJSON() {
    setBusy('json');
    try {
      const all = await fetchAll();
      downloadBlob(new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }), `attendance-backup-${new Date().toISOString().slice(0, 10)}.json`);
    } catch {
      alert('Backup failed - could not fetch data');
    }
    setBusy(null);
  }

  async function downloadSql(name: string) {
    if (isSuperAdmin !== true) {
      alert('Access denied: superadmin only');
      return;
    }
    const r = await authFetch(`${API_URL}/api/backup/download/${encodeURIComponent(name)}`);
    if (r.status === 403) {
      alert('Access denied: superadmin only');
      throw new Error('Forbidden');
    }
    if (!r.ok) throw new Error('Failed to download backup');
    downloadBlob(await r.blob(), name);
  }

  async function createSQLBackup() {
    if (isSuperAdmin !== true) {
      alert('Access denied: superadmin only');
      return;
    }
    setBusy('sql');
    try {
      const r = await authFetch(`${API_URL}/api/backup/create`, { method: 'POST' });
      if (r.status === 403) {
        alert('Access denied: superadmin only');
        setBusy(null);
        return;
      }
      const d = await r.json();
      if (!d.success) {
        alert(`SQL backup failed: ${d.error || 'unknown error'}`);
        setBusy(null);
        return;
      }
      fetchBackups();
      await downloadSql(d.name);
    } catch {
      alert('SQL backup failed - could not connect');
    }
    setBusy(null);
  }

  useEffect(() => {
    fetchAll().then(setData).catch(() => undefined);
    fetchBackups();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <Database size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900">Backup / Export</h1>
            <p className="text-[11px] text-gray-500">Download a snapshot of the attendance data &ndash; {data?.employees.length ?? 0} employees</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {!data ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="animate-spin h-5 w-5 mr-2" />
            <span className="text-sm">Loading data...</span>
          </div>
        ) : (
          <div className="max-w-4xl space-y-3">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-2">
                <ShieldCheck size={16} className="text-emerald-600" /> Quick exports
              </h2>
              <p className="text-[11px] text-gray-500 mb-3">
                Snapshot of <b>{data.employees.length}</b> employees across <b>{data.branches.length}</b> branches
                ({data.present} IN / {data.absent} OUT) as of <b>{data.lastUpdated}</b>.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-200 bg-emerald-50/50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0">
                      {busy === 'csv' ? <Loader2 className="animate-spin" size={16} /> : <FileSpreadsheet size={16} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-800">Export Excel / CSV</p>
                      <p className="text-[11px] text-gray-500">Attendance by date range (ID, Name, Branch, punches)</p>
                      <div className="mt-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {RANGE_OPTIONS.map(o => (
                            <button
                              key={o.key}
                              onClick={() => applyRange(o.key)}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                                range === o.key ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-emerald-50'
                              }`}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                        {range === 'custom' && (
                          <div className="flex items-center gap-2 text-xs">
                            <label className="flex items-center gap-1 text-gray-500">
                              From
                              <input type="date" value={fromDate} max={toDate}
                                onChange={e => setFromDate(e.target.value)}
                                className="px-2 py-1 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                            </label>
                            <label className="flex items-center gap-1 text-gray-500">
                              To
                              <input type="date" value={toDate} min={fromDate}
                                onChange={e => setToDate(e.target.value)}
                                className="px-2 py-1 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                    <button onClick={exportCSV} disabled={busy !== null}
                      className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors shrink-0">
                      <Download size={13} /> Export
                    </button>
                  </div>
                </div>
                <button
                  onClick={exportJSON}
                  disabled={busy !== null}
                  className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-brand-50/50 hover:bg-brand-50 hover:border-brand-300 transition-colors text-left disabled:opacity-50"
                >
                  <div className="w-9 h-9 rounded-lg bg-brand-600 text-white flex items-center justify-center shrink-0">
                    {busy === 'json' ? <Loader2 className="animate-spin" size={16} /> : <Database size={16} />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Full Backup (JSON)</p>
                    <p className="text-[11px] text-gray-500">Complete live data payload for restore / archive</p>
                  </div>
                  <Download size={15} className="ml-auto text-brand-600 shrink-0" />
                </button>
              </div>
            </div>

            {isSuperAdmin === null ? (
              <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-center py-8 text-gray-400">
                <Loader2 className="animate-spin h-4 w-4 mr-2" /> Checking permissions…
              </div>
            ) : !isSuperAdmin ? (
              <div className="bg-white rounded-xl border border-amber-200 p-5">
                <div className="flex items-center gap-2 mb-1">
                  <HardDriveDownload size={16} className="text-amber-600" />
                  <h2 className="text-sm font-semibold text-gray-800">SQL Database Backup (.bak)</h2>
                  <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Superadmin only</span>
                </div>
                <p className="text-[11px] text-gray-500">This action is restricted to <b>superadmin</b> only. Your current role does not have permission to create or download database backups. Please contact an administrator.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-2 mb-1">
                  <HardDriveDownload size={16} className="text-blue-600" />
                  <h2 className="text-sm font-semibold text-gray-800">SQL Database Backup (.bak)</h2>
                  <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Superadmin</span>
                </div>
                <p className="text-[11px] text-gray-500 mb-3">
                  Runs a full backup of the SQL database <b>eTimetracklite1</b> on the server (saved to the server, verified, then downloaded). Restorable with any SQL Server.
                </p>
                <button
                  onClick={createSQLBackup}
                  disabled={busy !== null}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {busy === 'sql' ? <Loader2 className="animate-spin" size={15} /> : <HardDriveDownload size={15} />}
                  Create & Download SQL Backup
                </button>

                {backups.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent backups on server (C:\Backups)</p>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50/80 text-left text-gray-500">
                            <th className="px-3 py-2 font-semibold">File</th>
                            <th className="px-3 py-2 font-semibold">Size</th>
                            <th className="px-3 py-2 font-semibold">Created</th>
                            <th className="px-3 py-2 font-semibold">Status</th>
                            <th className="px-3 py-2 font-semibold text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {backups.slice(0, 8).map(b => (
                            <tr key={b.name}>
                              <td className="px-3 py-2 font-mono text-gray-700">{b.name}</td>
                              <td className="px-3 py-2 text-gray-600">{b.size_mb} MB</td>
                              <td className="px-3 py-2 text-gray-600">{b.mtime}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${b.damaged ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>
                                  {b.damaged ? 'Damaged' : b.valid === false ? 'Invalid' : 'Valid'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <button onClick={() => { void downloadSql(b.name).catch(() => alert('SQL download failed')); }}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800">
                                  <Download size={11} /> Download
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-gray-400">
              CSV / JSON files are generated from the live data you are viewing. The SQL .bak is a full server-side database backup.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}