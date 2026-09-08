import type { Employee, DetailedStatus, EmployeeAnalytics } from '../types';

function parseTime(t: string): Date | null {
  const match = t.match(/(\d{2}):(\d{2}):(\d{2}) (AM|PM)/);
  if (!match) return null;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]), s = parseInt(match[3]);
  if (match[4] === 'PM' && h !== 12) h += 12;
  if (match[4] === 'AM' && h === 12) h = 0;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, s);
}

function parseRaw(iso: string): Date | null {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function getDetailedStatus(emp: Employee): DetailedStatus {
  const hasPunches = emp.punchTimes.length > 0;
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const totalMins = currentHour * 60 + currentMin;

  const startMins = 8 * 60 + 30;    // 8:30 AM shift start
  const lateMins = 9 * 60 + 30;     // 9:30 AM late threshold
  const overtimeMins = 18 * 60;     // 6:00 PM overtime

  if (emp.status === 'OUT' && !hasPunches) return 'absent';

  if (emp.status === 'IN' && hasPunches) {
    const firstIn = parseRaw(emp.lastPunchRaw) || parseTime(emp.punchTimes[0]);
    if (firstIn) {
      const inMins = firstIn.getHours() * 60 + firstIn.getMinutes();

      if (totalMins >= overtimeMins) return 'overtime';

      if (inMins >= lateMins) return 'late';

      if (inMins >= startMins) return 'working';
      return 'working';
    }
    if (totalMins >= overtimeMins) return 'overtime';
    return 'working';
  }

  if (emp.status === 'OUT' && hasPunches) {
    return 'leave';
  }

  return 'working';
}

export function getStatusConfig(status: DetailedStatus) {
  const map: Record<DetailedStatus, { label: string; color: string; bg: string; border: string; dot: string }> = {
    working:    { label: 'Working',    color: 'text-emerald-700', bg: 'bg-emerald-50',   border: 'border-emerald-300', dot: 'bg-emerald-500' },
    late:       { label: 'Late',       color: 'text-orange-700',  bg: 'bg-orange-50',    border: 'border-orange-300',  dot: 'bg-orange-500' },
    break:      { label: 'Break',      color: 'text-blue-700',    bg: 'bg-blue-50',      border: 'border-blue-300',    dot: 'bg-blue-500' },
    leave:      { label: 'Leave',      color: 'text-purple-700',  bg: 'bg-purple-50',    border: 'border-purple-300',  dot: 'bg-purple-500' },
    absent:     { label: 'Absent',     color: 'text-red-700',     bg: 'bg-red-50',       border: 'border-red-300',     dot: 'bg-red-500' },
    overtime:   { label: 'Overtime',   color: 'text-yellow-700',  bg: 'bg-yellow-50',    border: 'border-yellow-300',  dot: 'bg-yellow-500' },
    missingPunch: { label: 'Missing Punch', color: 'text-pink-700', bg: 'bg-pink-50',    border: 'border-pink-300',    dot: 'bg-pink-500' },
  };
  return map[status];
}

export function calcHoursToday(emp: Employee): number {
  const now = new Date();

  if (emp.punchTimes.length === 0) return 0;

  const firstIn = parseRaw(emp.lastPunchRaw) || parseTime(emp.punchTimes[0]);
  if (!firstIn) return 0;

  if (emp.status === 'IN') {
    return (now.getTime() - firstIn.getTime()) / (1000 * 3600);
  }

  // OUT - use last punch as end time
  const lastPunch = parseRaw(emp.lastPunchRaw);
  if (lastPunch && !isNaN(lastPunch.getTime())) {
    return (lastPunch.getTime() - firstIn.getTime()) / (1000 * 3600);
  }

  return 0;
}

export function computeAnalytics(employees: Employee[]): {
  list: EmployeeAnalytics[];
  avgHours: number;
  best: EmployeeAnalytics | null;
  worst: EmployeeAnalytics | null;
} {
  const list: EmployeeAnalytics[] = employees.map(emp => {
    const status = getDetailedStatus(emp);
    const hoursToday = calcHoursToday(emp);
    return {
      id: emp.id,
      name: emp.name,
      status,
      hoursToday: Math.round(hoursToday * 100) / 100,
      firstPunch: emp.punchTimes[0] || '--',
      lastPunch: emp.punchTimes[emp.punchTimes.length - 1] || '--',
    };
  });

  list.sort((a, b) => b.hoursToday - a.hoursToday);

  const withHours = list.filter(e => e.hoursToday > 0);
  const avgHours = withHours.length
    ? Math.round((withHours.reduce((s, e) => s + e.hoursToday, 0) / withHours.length) * 100) / 100
    : 0;

  return {
    list,
    avgHours,
    best: withHours[0] || null,
    worst: withHours.length > 1 ? withHours[withHours.length - 1] : null,
  };
}
