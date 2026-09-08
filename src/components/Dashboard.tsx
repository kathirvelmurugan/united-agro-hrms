import { useEffect, useState, useMemo } from 'react';
import EmployeeCard from './EmployeeCard';
import EmployeeMonthlyModal, { type EmployeeRef } from './EmployeeMonthlyModal';
import { API_URL, DEVICE_ID } from '../data/mockData';
import type { LiveData } from '../types';
import { getDetailedStatus } from '../data/attendanceUtils';
import { timeAgoText } from '../lib/status';
import { Users, ChevronDown, MapPin, RefreshCw, Download, FileSpreadsheet, Database, Search, AlertTriangle } from 'lucide-react';

interface DashboardProps {
  role: string;
  deviceId: number | null;
  statusFilter?: string;
  onFilterChange?: (filter: string) => void;
}

interface LocationOption {
  device_id: number;
  name: string;
  location: string;
}

const FILTER_OPTIONS = [
  { label: 'All Stages', value: 'all' },
  { label: 'Working', value: 'working' },
  { label: 'Late', value: 'late' },
  { label: 'Break', value: 'break' },
  { label: 'Leave / Early Exit', value: 'leave' },
  { label: 'Absent / Missing Punch', value: 'absent' },
  { label: 'Overtime', value: 'overtime' },
];

export default function Dashboard({ role, deviceId, statusFilter = 'all', onFilterChange }: DashboardProps) {
  const [data, setData] = useState<LiveData | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [showLocationSwitcher, setShowLocationSwitcher] = useState(false);
  const [activeDevice, setActiveDevice] = useState<number | null>(deviceId);
  const [refreshing, setRefreshing] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [empSearchOpen, setEmpSearchOpen] = useState(false);
  const [empQuery, setEmpQuery] = useState('');
  const [selectedEmp, setSelectedEmp] = useState<EmployeeRef | null>(null);

  const canSwitchLocation = role === 'superadmin' || role === 'admin';

  const empMatches = useMemo(() => {
    if (!data) return [];
    const q = empQuery.trim().toLowerCase();
    const list = q ? data.employees.filter(e => e.name.toLowerCase().includes(q) || e.id.includes(q)) : data.employees;
    return list.slice(0, 50);
  }, [data, empQuery]);

  async function refreshNow() {
    setRefreshing(true);
    window.location.reload();
  }

  async function fetchAllData() {
    const r = await fetch(`${API_URL}/api/live/all`);
    if (!r.ok) throw new Error('Failed to fetch data');
    return r.json();
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportCSV() {
    try {
      const all = await fetchAllData();
      const header = 'EmpID,Name,Branch,Location,Status,FirstPunch,LastPunch';
      const rows = (all.employees as any[]).map(e =>
        [e.id, `"${e.name}"`, `"${e.branch}"`, `"${e.location}"`, e.status, e.punchTimes?.[0] || '', e.lastPunch || ''].join(',')
      );
      const csv = '\uFEFF' + [header, ...rows].join('\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `attendance-backup-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch { /* ignore */ }
    setShowBackup(false);
  }

  async function exportJSON() {
    try {
      const all = await fetchAllData();
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `attendance-backup-${new Date().toISOString().slice(0, 10)}.json`);
    } catch { /* ignore */ }
    setShowBackup(false);
  }

  async function fetchLocations() {
    try {
      const r = await fetch(`${API_URL}/api/locations`);
      if (r.ok) {
        const list: LocationOption[] = await r.json();
        setLocations(list);
      }
    } catch { /* ignore */ }
  }

  async function fetchData() {
    const dev = activeDevice ?? DEVICE_ID;
    try {
      const r = await fetch(`${API_URL}/api/live/${dev}`);
      if (r.ok) setData(await r.json());
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchLocations();
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 2000);
    return () => clearInterval(id);
  }, [activeDevice]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const employees = data.employees;
    function punchVal(e: (typeof employees)[0]) {
      if (!e.punchTimes.length) return 999999;
      const m = e.punchTimes[0].match(/(\d{2}):(\d{2}):(\d{2}) (AM|PM)/);
      if (!m) return 999999;
      let h = +m[1];
      if (m[4] === 'PM' && h !== 12) h += 12;
      if (m[4] === 'AM' && h === 12) h = 0;
      return h * 3600 + +m[2] * 60 + +m[3];
    }
    return [...employees].sort((a, b) => punchVal(a) - punchVal(b));
  }, [data]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return sorted;
    return sorted.filter(e => getDetailedStatus(e) === statusFilter);
  }, [sorted, statusFilter]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <Users size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 leading-tight truncate">
              {data ? data.deviceName : 'UA Attendance'}
            </h1>
            <p className="text-[11px] text-gray-500">{data ? data.deviceLocation : ''}</p>
          </div>
          {canSwitchLocation && locations.length > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={() => setShowLocationSwitcher(!showLocationSwitcher)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-medium rounded-lg transition-colors border border-blue-100"
              >
                <MapPin size={12} />
                <span className="truncate max-w-[120px]">{data ? data.deviceName : 'Select Location'}</span>
                <ChevronDown size={12} className="text-blue-400" />
              </button>
              {showLocationSwitcher && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 max-h-72 overflow-auto">
                  {locations.map(loc => (
                    <button
                      key={loc.device_id}
                      onClick={() => {
                        setActiveDevice(loc.device_id);
                        setShowLocationSwitcher(false);
                        onFilterChange?.('all');
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between ${
                        (activeDevice ?? DEVICE_ID) === loc.device_id ? 'text-blue-600 font-semibold' : 'text-gray-700'
                      }`}
                    >
                      <span>{loc.name}</span>
                      <span className="text-[10px] text-gray-400">{loc.location}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {data && (
            <>
              <span className={`ml-auto shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                data.deviceStatus === 'Online' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${data.deviceStatus === 'Online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {data.deviceStatus === 'Online' ? 'ONLINE' : 'OFFLINE'}
              </span>
              <span className="text-[11px] text-gray-500 shrink-0">
                {data.present} IN / {data.absent} OUT
              </span>
              <div className="relative shrink-0">
                <button
                  onClick={() => setEmpSearchOpen(!empSearchOpen)}
                  title="Select employee to see details"
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 h-8 rounded-lg border border-gray-200 text-[11px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Search size={13} /> Employee
                </button>
                {empSearchOpen && (
                  <div className="absolute top-full right-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-xl z-30 py-1">
                    <div className="px-3 py-2 border-b border-gray-100">
                      <input
                        autoFocus
                        value={empQuery}
                        onChange={e => setEmpQuery(e.target.value)}
                        placeholder="Search employee name or ID..."
                        className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                      />
                    </div>
                    <div className="max-h-64 overflow-auto py-1">
                      {empMatches.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-gray-400">No matching employees</p>
                      ) : empMatches.map(e => (
                        <button
                          key={`${e.id}-${e.name}`}
                          onClick={() => {
                            setSelectedEmp({ id: e.id, name: e.name, branch: data?.deviceName ?? 'Branch', device_id: activeDevice ?? DEVICE_ID });
                            setEmpSearchOpen(false);
                            setEmpQuery('');
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between gap-2"
                        >
                          <span className="truncate font-medium text-gray-800">{e.name}</span>
                          <span className="font-mono text-[10px] text-gray-400">{e.id}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="relative shrink-0">
                <button
                  onClick={() => setShowBackup(!showBackup)}
                  title="Backup / Export"
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 h-8 rounded-lg border border-gray-200 text-[11px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Download size={13} /> Backup
                </button>
                {showBackup && (
                  <div className="absolute top-full right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                    <button
                      onClick={exportCSV}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700"
                    >
                      <FileSpreadsheet size={14} className="text-emerald-500" /> Export attendance (CSV)
                    </button>
                    <button
                      onClick={exportJSON}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700"
                    >
                      <Database size={14} className="text-brand-600" /> Full data backup (JSON)
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={refreshNow}
                title="Refresh"
                className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </>
          )}
        </div>
      </div>

      {data && data.deviceStatus !== 'Online' && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 flex items-start gap-2 text-[11px] text-red-700">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-500" />
          <div>
            <span className="font-bold">{data.deviceName} is OFFLINE.</span>{' '}
            Punches made now are stored on the device and will appear here after it reconnects.
            <span className="text-red-500 font-medium">
              {' '}Last punch received: {data.lastPunch && data.lastPunch !== '--' ? `${data.lastPunch} (${timeAgoText(data.lastPunch, Date.now())})` : 'none'}
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 py-4">
        {!data ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <span className="text-sm">Loading live data...</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4 max-w-xl">
              <button onClick={() => onFilterChange?.(statusFilter === 'working' ? 'all' : 'working')}
                className={`bg-white rounded-lg border p-3 text-center transition-all hover:shadow-sm ${
                  statusFilter === 'working' ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-gray-200 hover:border-emerald-300'
                }`}>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Present</p>
                <p className="text-2xl font-bold text-emerald-600">{data.present}</p>
              </button>
              <button onClick={() => onFilterChange?.(statusFilter === 'absent' ? 'all' : 'absent')}
                className={`bg-white rounded-lg border p-3 text-center transition-all hover:shadow-sm ${
                  statusFilter === 'absent' ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-200 hover:border-red-300'
                }`}>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Absent</p>
                <p className="text-2xl font-bold text-red-500">{data.absent}</p>
              </button>
              <button onClick={() => onFilterChange?.('all')}
                className={`bg-white rounded-lg border p-3 text-center transition-all hover:shadow-sm ${
                  statusFilter === 'all' ? 'border-gray-400 ring-2 ring-gray-100' : 'border-gray-200 hover:border-gray-300'
                }`}>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Total</p>
                <p className="text-2xl font-bold text-gray-800">{data.employees.length}</p>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative">
                <button
                  onClick={() => setShowFilter(!showFilter)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:border-gray-300"
                >
                  {FILTER_OPTIONS.find(f => f.value === statusFilter)?.label || 'All Stages'}
                  <ChevronDown size={12} className="text-gray-400" />
                </button>
                {showFilter && (
                  <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                    {FILTER_OPTIONS.map(f => (
                      <button
                        key={f.value}
                        onClick={() => { onFilterChange?.(f.value); setShowFilter(false); }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${
                          statusFilter === f.value ? 'text-blue-600 font-semibold' : 'text-gray-700'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-[11px] text-gray-400">{filtered.length} employees{statusFilter !== 'all' ? ` (${statusFilter})` : ''}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
              {filtered.map((emp, i) => (
                <EmployeeCard
                  key={`${emp.id}-${emp.name}-${i}`}
                  employee={emp}
                  index={i}
                  onSelect={(e) => setSelectedEmp({ id: e.id, name: e.name, branch: data?.deviceName ?? 'Branch', device_id: activeDevice ?? DEVICE_ID })}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <EmployeeMonthlyModal employee={selectedEmp} onClose={() => setSelectedEmp(null)} />
    </div>
  );
}
