import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Employee } from '../types';
import { getDetailedStatus, getStatusConfig, calcHoursToday } from '../data/attendanceUtils';

interface EmployeeCardProps {
  employee: Employee;
  index: number;
  onSelect?: (emp: Employee) => void;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function getInOutTimes(employee: Employee): { inTime: string; outTime: string } {
  const { punchTimes, punchDirs, status } = employee;
  if (!punchTimes || punchTimes.length === 0) return { inTime: '--:--:--', outTime: '--:--:--' };

  let inTime = '--:--:--';
  let outTime = '--:--:--';

  for (let i = 0; i < punchTimes.length; i++) {
    const dir = punchDirs?.[i] || (i % 2 === 0 ? 'IN' : 'OUT');
    if (dir === 'IN' && inTime === '--:--:--') inTime = punchTimes[i];
    if (dir === 'OUT') outTime = punchTimes[i];
  }

  if (status === 'IN' && outTime !== '--:--:--') outTime = 'Active';

  return { inTime, outTime };
}

export default function EmployeeCard({ employee, index, onSelect }: EmployeeCardProps) {
  const hasPunch = Boolean(employee.lastPunchRaw);
  const [seconds, setSeconds] = useState(0);

  const detailStatus = useMemo(() => getDetailedStatus(employee), [employee]);
  const statusCfg = useMemo(() => getStatusConfig(detailStatus), [detailStatus]);
  const hoursToday = useMemo(() => calcHoursToday(employee), [employee]);
  const { inTime, outTime } = useMemo(() => getInOutTimes(employee), [employee]);

  useEffect(() => {
    if (!hasPunch || employee.status !== 'IN') return;
    function tick() {
      const then = new Date(employee.lastPunchRaw).getTime();
      if (isNaN(then)) return;
      setSeconds(Math.max(0, Math.floor((Date.now() - then) / 1000)));
    }
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [employee.lastPunchRaw, hasPunch, employee.status]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.2 }}
      onClick={() => onSelect?.(employee)}
      className={`rounded-xl border ${statusCfg.border} ${statusCfg.bg}/40 bg-white p-2.5 flex flex-col gap-1 cursor-pointer hover:shadow-md transition-shadow`}
    >
      <div className="flex items-center justify-between gap-1">
        <p className="text-sm font-bold text-gray-900 leading-tight min-w-0 break-words">{employee.name}</p>
        <span className={`shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-medium ${statusCfg.color} ${statusCfg.bg}`}>
          <span className={`w-1 h-1 rounded-full ${statusCfg.dot}`} />
          {statusCfg.label}
        </span>
      </div>
      <p className="text-[10px] font-mono text-gray-500 font-bold">ID: {employee.id}</p>

      <div className="bg-gray-50 border border-gray-100 rounded-lg p-1.5 text-[10px] space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">
            In:
            <strong className="text-emerald-700 font-semibold ml-1">{inTime}</strong>
          </span>
          <span className="text-gray-500">
            Out:
            <strong className={`font-semibold ml-1 ${outTime === 'Active' ? 'text-amber-600' : 'text-red-600'}`}>{outTime}</strong>
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 pt-1">
          <span className="text-gray-500">
            Dur:
            <strong className="text-gray-800 font-bold ml-1">
              {employee.status === 'IN' && hasPunch
                ? formatDuration(seconds)
                : employee.status === 'OUT' && hoursToday > 0
                  ? `${Math.floor(hoursToday)}h ${Math.round((hoursToday % 1) * 60)}m`
                  : '--:--:--'}
            </strong>
          </span>
        </div>
      </div>
    </motion.div>
  );
}
