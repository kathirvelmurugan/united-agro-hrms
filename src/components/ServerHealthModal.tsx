import { useEffect, useState } from 'react';
import { X, Activity, Cpu, MemoryStick, Database, RefreshCw, Server, ChevronDown, ChevronUp } from 'lucide-react';
import { API_URL } from '../data/mockData';

interface HealthData {
  server_time: string;
  uptime: number | null;
  cpu_percent: number | null;
  memory: { total: number; available: number; used: number; percent: number } | null;
  psutil: boolean;
  sql: { connected: boolean; max_memory_mb: number | null; table: string | null; last_punch: string; error: string | null };
  sync: { last_sync: string; table: string; per_device_logs: Record<string, number>; error: string | null; manual: boolean; status?: string };
  devices: { device_id: number; name: string; status: string; present: number; absent: number; last_punch: string; last_ping: string; cache_updated: string }[];
  processes: { name: string; count: number; mem_mb: number; cpu: number }[];
  cpu_cores: number[] | null;
  online_count: number;
  device_count: number;
}

function fmtUptime(s: number | null): string {
  if (!s) return '--';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function mbStr(mb: number): string {
  if (mb >= 2147483647) return 'unlimited';
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

export default function ServerHealthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [showProcs, setShowProcs] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`${API_URL}/api/server/health`);
        if (r.ok) {
          const j = await r.json();
          if (alive) { setData(j); setError(null); setLastFetch(Date.now()); }
        } else {
          if (alive) setError(`HTTP ${r.status} — server may be unreachable`);
        }
      } catch (e) {
        if (alive) setError(`Failed to reach server: ${(e as Error).message}`);
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [open]);

  if (!open) return null;

  const sqlOk = data?.sql?.connected;
  const memPercent = data?.memory?.percent ?? 0;

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-slate-900 text-white">
          <Server size={14} className="text-emerald-400" />
          <h2 className="text-sm font-semibold">Server Health</h2>
          <span className="text-[10px] text-gray-400 ml-1">updated {data ? new Date(lastFetch).toLocaleTimeString() : '...'} · auto-refresh 5s</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
            <Activity size={10} /> {data?.online_count ?? 0}/{data?.device_count ?? 0} online
          </span>
          <button onClick={onClose} className="ml-2 p-1 rounded-md hover:bg-white/10 text-gray-400"><X size={14} /></button>
        </div>

        <div className="p-4 overflow-y-auto flex flex-col gap-3">
          {!data && !error && <p className="text-sm text-gray-400 py-10 text-center">Loading health…</p>}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-xs">
              <p className="font-semibold mb-1">Server unreachable</p>
              <p>{error}</p>
              <p className="mt-1 text-red-500/70">This panel cannot refresh — check the server immediately.</p>
            </div>
          )}

          {data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
<div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 cursor-pointer hover:border-brand-300" onClick={() => setShowProcs(v => (v === 'server' ? null : 'server'))}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase"><Server size={11} /> Server</div>
                    {showProcs === 'server' ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
                  </div>
                  <p className="text-sm font-bold text-gray-800 mt-1">{data.server_time}</p>
                  <p className="text-[11px] text-gray-500">Uptime {fmtUptime(data.uptime)} <span className="text-brand-500 font-semibold">· click for details</span></p>
                </div>
                <div className={`rounded-xl border border-gray-100 bg-gray-50/60 p-3 ${data.psutil ? 'cursor-pointer hover:border-brand-300' : ''}`} onClick={() => data.psutil && setShowProcs(v => (v === 'cpu' ? null : 'cpu'))}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase"><Cpu size={11} /> CPU</div>
                    {data.psutil && (showProcs === 'cpu' ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />)}
                  </div>
                  <p className={`text-sm font-bold mt-1 ${(data.cpu_percent ?? 0) > 85 ? 'text-red-600' : 'text-gray-800'}`}>{data.psutil ? `${data.cpu_percent}%` : 'n/a'}</p>
                  <p className="text-[11px] text-gray-500">psutil {data.psutil ? 'ok' : 'not installed'}{data.psutil && <span className="text-brand-500 font-semibold"> · click for details</span>}</p>
                </div>
                <div className={`rounded-xl border border-gray-100 bg-gray-50/60 p-3 ${data.memory ? 'cursor-pointer hover:border-brand-300' : ''}`} onClick={() => data.memory && setShowProcs(v => (v === 'ram' ? null : 'ram'))}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase"><MemoryStick size={11} /> RAM</div>
                    {data.memory && (showProcs === 'ram' ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />)}
                  </div>
                  {data.memory ? (
                    <>
                      <p className={`text-sm font-bold mt-1 ${memPercent > 85 ? 'text-red-600' : memPercent > 70 ? 'text-amber-600' : 'text-gray-800'}`}>
                        {data.memory.used} / {data.memory.total} GB
                      </p>
                      <div className="mt-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                        <div className={`h-full ${memPercent > 85 ? 'bg-red-500' : memPercent > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, memPercent)}%` }} />
                      </div>
                      <p className="text-[11px] text-gray-500">{memPercent}% · {data.memory.available} GB free <span className="text-brand-500 font-semibold">· click for details</span></p>
                    </>
                  ) : <p className="text-sm font-bold text-gray-800 mt-1">n/a</p>}
                </div>
              </div>

                {showProcs && (() => {
                  if (showProcs === 'cpu') {
                    return (
                      <div className="rounded-xl border border-gray-100 overflow-hidden">
                        <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50/60 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase">
                          <Cpu size={11} /> CPU usage by core
                        </div>
                        <div className="px-3 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {(data.cpu_cores ?? []).length > 0 ? data.cpu_cores!.map((c, i) => (
                            <div key={i} className="rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-2">
                              <p className="text-[10px] text-gray-400 font-semibold">Core {i}</p>
                              <p className={`text-sm font-bold ${c > 85 ? 'text-red-600' : c > 60 ? 'text-amber-600' : 'text-gray-700'}`}>{c}%</p>
                              <div className="mt-1 h-1 rounded-full bg-gray-200 overflow-hidden">
                                <div className={`h-full ${c > 85 ? 'bg-red-500' : c > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, c)}%` }} />
                              </div>
                            </div>
                          )) : <p className="text-[11px] text-gray-400 py-1">Per-core data unavailable (psutil not installed).</p>}
                        </div>
                        <p className="px-3 pb-2.5 text-[10px] text-gray-400">Overall CPU {data.cpu_percent}% · updated every 5s</p>
                      </div>
                    );
                  }
                  if (showProcs === 'ram') {
                    return (
                      <div className="rounded-xl border border-gray-100 overflow-hidden">
                        <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50/60 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase">
                          <MemoryStick size={11} /> Memory breakdown
                        </div>
                        <div className="px-3 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                          <div><span className="text-gray-400">used</span><p className="font-bold text-gray-700 text-sm">{data.memory!.used} GB</p></div>
                          <div><span className="text-gray-400">total</span><p className="font-bold text-gray-700 text-sm">{data.memory!.total} GB</p></div>
                          <div><span className="text-gray-400">free</span><p className="font-bold text-gray-700 text-sm">{data.memory!.available} GB</p></div>
                          <div><span className="text-gray-400">percent</span><p className={`font-bold text-sm ${memPercent > 85 ? 'text-red-600' : memPercent > 70 ? 'text-amber-600' : 'text-gray-700'}`}>{memPercent}%</p></div>
                        </div>
                        <div className="px-3 pb-2.5 text-[10px] text-gray-400">Watch free space — if it nears 0 GB, memory-hungry processes (like SQL) can stall the punch receiver.</div>
                      </div>
                    );
                  }
                  return (
                    <div className="rounded-xl border border-gray-100 overflow-hidden">
                      <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50/60 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase">
                        <Cpu size={11} /> Top process memory usage
                      </div>
                      <table className="w-full text-[11px]">
                        <thead className="text-left text-gray-400 border-b border-gray-100">
                          <tr>
                            <th className="px-3 py-1.5 font-semibold">Process</th>
                            <th className="px-3 py-1.5 font-semibold text-right">Count</th>
                            <th className="px-3 py-1.5 font-semibold text-right">CPU %</th>
                            <th className="px-3 py-1.5 font-semibold text-right">Memory (MB)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(data.processes ?? []).map(p => (
                            <tr key={p.name} className="border-b border-gray-50">
                              <td className="px-3 py-1.5 font-medium text-gray-700">{p.name}</td>
                              <td className="px-3 py-1.5 text-right text-gray-500">{p.count}</td>
                              <td className="px-3 py-1.5 text-right text-gray-500">{p.cpu.toFixed(1)}%</td>
                              <td className={`px-3 py-1.5 text-right font-semibold ${p.mem_mb > 1024 ? 'text-red-600' : p.mem_mb > 400 ? 'text-amber-600' : 'text-gray-700'}`}>{p.mem_mb.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                <div className="rounded-xl border border-gray-100 overflow-hidden">
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50/60 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase">
                    <Database size={11} /> SQL Server · eTimetracklite1
                  </div>
                <div className="px-3 py-2.5 flex items-center gap-3">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${sqlOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sqlOk ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    {sqlOk ? 'Connected' : 'DISCONNECTED'}
                  </span>
                  <span className="text-[11px] text-gray-500">table: {data.sql.table ?? '--'}</span>
                  {sqlOk && <span className={`text-[11px] font-semibold ${data.sql.max_memory_mb! > 8000 ? 'text-red-600' : 'text-gray-700'}`}>max memory {mbStr(data.sql.max_memory_mb ?? 0)}</span>}
                  <span className="ml-auto text-[11px] text-gray-500">last punch {data.sql.last_punch}</span>
                </div>
                {!sqlOk && data.sql.error && <p className="px-3 pb-2 text-[11px] text-red-500">Error: {data.sql.error}</p>}
              </div>

              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50/60 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase">
                  <RefreshCw size={11} /> Sync worker
                </div>
                <div className="px-3 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div><span className="text-gray-400">status</span><p className="font-semibold text-gray-700">{data.sync.status ?? '--'}</p></div>
                  <div><span className="text-gray-400">last sync</span><p className="font-semibold text-gray-700">{data.sync.last_sync}</p></div>
                  <div><span className="text-gray-400">table</span><p className="font-semibold text-gray-700 truncate">{data.sync.table}</p></div>
                  <div><span className="text-gray-400">error</span><p className={`font-semibold ${data.sync.error ? 'text-red-600' : 'text-gray-700'}`}>{data.sync.error ? 'yes' : 'none'}</p></div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50/60 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase">Devices</div>
                <table className="w-full text-[11px]">
                  <thead className="text-left text-gray-400 border-b border-gray-100">
                    <tr>
                      <th className="px-3 py-1.5 font-semibold">Device</th>
                      <th className="px-3 py-1.5 font-semibold">Status</th>
                      <th className="px-3 py-1.5 font-semibold text-right">In</th>
                      <th className="px-3 py-1.5 font-semibold">Last ping</th>
                      <th className="px-3 py-1.5 font-semibold">Last punch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.devices.map(d => (
                      <tr key={d.device_id} className="border-b border-gray-50">
                        <td className="px-3 py-1.5 font-medium text-gray-700">{d.name}</td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${d.status === 'Online' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                            <span className={`w-1 h-1 rounded-full ${d.status === 'Online' ? 'bg-emerald-500' : 'bg-red-500'}`} /> {d.status}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold text-gray-700">{d.present}</td>
                        <td className="px-3 py-1.5 text-gray-500">{d.last_ping}</td>
                        <td className="px-3 py-1.5 text-gray-500">{d.last_punch}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}