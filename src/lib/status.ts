export type EmpStatus = 'working' | 'late' | 'absent' | 'logout';

export interface Statusable {
  status: 'IN' | 'OUT';
  punchTimes: string[];
  punchDirs?: string[];
  branch?: string;
  id?: string | null;
}

export interface ShiftWindow {
  name: string;
  generalStart: string; // 'HH:MM'
  generalEnd: string;   // 'HH:MM'
  lunchStart?: string;
  lunchEnd?: string;
  graceMinutes?: number;
  extraShifts?: { label: string; start: string; end: string }[];
  employeeShifts?: Record<string, { generalStart: string; generalEnd: string; lunch?: boolean; graceMinutes?: number }>;
}

export const BRANCH_SHIFTS: Record<string, ShiftWindow> = {
  'SS_Theevattipatti': {
    name: 'SS_Theevattipatti',
    generalStart: '09:30', generalEnd: '18:30',
    lunchStart: '13:00', lunchEnd: '14:00',
    extraShifts: [
      { label: '2nd', start: '13:00', end: '21:00' },
      { label: 'Night', start: '21:00', end: '06:00' },
    ],
  },
  'UAI Neikarapatti': {
    name: 'UAI Neikarapatti',
    generalStart: '09:00', generalEnd: '19:00',
    lunchStart: '13:00', lunchEnd: '14:00',
    extraShifts: [{ label: 'Night', start: '20:00', end: '06:00' }],
  },
  'SS_Sidco': {
    name: 'SS_Sidco',
    generalStart: '09:15', generalEnd: '18:00',
    lunchStart: '13:00', lunchEnd: '14:00',
    extraShifts: [
      { label: '1st', start: '06:00', end: '14:00' },
      { label: '2nd', start: '14:00', end: '22:00' },
      { label: 'Night', start: '22:00', end: '06:00' },
    ],
  },
  'UAI HEAD OFFICE': {
    name: 'UAI HEAD OFFICE',
    generalStart: '09:45', generalEnd: '18:00',
    lunchStart: '13:00', lunchEnd: '13:30',
    employeeShifts: {
      '31': { generalStart: '09:00', generalEnd: '17:30', graceMinutes: 15 },
      '32': { generalStart: '08:00', generalEnd: '19:30', graceMinutes: 15 },
    },
  },
  'SS SLP': {
    name: 'SS SLP',
    generalStart: '09:00', generalEnd: '18:00',
    lunchStart: '13:00', lunchEnd: '14:00',
    extraShifts: [
      { label: '1st', start: '06:00', end: '14:00' },
      { label: '2nd', start: '14:00', end: '22:00' },
      { label: 'Night', start: '22:00', end: '06:00' },
    ],
    employeeShifts: {
      '6': { generalStart: '08:00', generalEnd: '20:00' }, // Durairaj day/night rotation
      '30': { generalStart: '09:00', generalEnd: '18:00' }, // Vivek - Office
      '49': { generalStart: '09:00', generalEnd: '18:00' }, // Kesavan - Office
      '28': { generalStart: '09:00', generalEnd: '18:00' }, // Rajasekar - Maintenance
      '25': { generalStart: '08:00', generalEnd: '19:00' }, // Janagaraj - Yard
      '26': { generalStart: '08:00', generalEnd: '19:00' }, // Govindraj - Yard
      '27': { generalStart: '08:00', generalEnd: '19:00' }, // Thiyagarajan - Yard
      '34': { generalStart: '08:00', generalEnd: '19:00' }, // Manikandan - Yard
      '48': { generalStart: '08:00', generalEnd: '19:00' }, // Madhankumar - Yard
    },
  },
  'NSRL Lab': {
    name: 'NSRL Lab',
    generalStart: '09:45', generalEnd: '18:00',
    lunchStart: '13:00', lunchEnd: '13:30',
    employeeShifts: {
      '11': { generalStart: '09:00', generalEnd: '17:30' },   // Renuga
      '14': { generalStart: '08:00', generalEnd: '19:30' },   // Narayanan
      '4':  { generalStart: '12:00', generalEnd: '20:30', lunch: false }, // Muruganagendiran
    },
  },
};

const DEFAULT_SHIFT: ShiftWindow = {
  name: 'Default',
  generalStart: '09:35', generalEnd: '18:00',
};

export function shiftForBranch(branch?: string): ShiftWindow {
  return (branch && BRANCH_SHIFTS[branch]) || DEFAULT_SHIFT;
}

export function shiftForEmployee(branch: string | undefined, id?: string | null): ShiftWindow {
  const base = shiftForBranch(branch);
  if (id && base.employeeShifts) {
    const emp = base.employeeShifts[id.replace(/^0+/, '')];
    if (emp) {
      return {
        ...base,
        generalStart: emp.generalStart,
        generalEnd: emp.generalEnd,
        ...(emp.lunch === false ? { lunchStart: undefined, lunchEnd: undefined } : {}),
        ...(emp.graceMinutes != null ? { graceMinutes: emp.graceMinutes } : {}),
      };
    }
  }
  return base;
}

export function shiftSeconds(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 3600 + m * 60;
}

export function parsePunchTime(t: string | undefined): number | null {
  if (!t) return null;
  const m = t.match(/(\d{2}):(\d{2}):(\d{2}) (AM|PM)/);
  if (!m) return null;
  let h = +m[1];
  if (m[4] === 'PM' && h !== 12) h += 12;
  if (m[4] === 'AM' && h === 12) h = 0;
  return h * 3600 + +m[2] * 60 + +m[3];
}

export function isLate(e: Statusable): boolean {
  return lateInfo(e).isLate;
}

export function nowSeconds(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export function workingSeconds(e: Statusable, now: number): number | null {
  const times: number[] = [];
  for (const t of e.punchTimes) {
    const p = parsePunchTime(t);
    if (p != null) times.push(p);
  }
  if (times.length === 0) return null;

  // If status is OUT (or even number of punches and last punch is an OUT), 
  // working time should be fixed (frozen) between punch pairs, NOT ticking to now!
  const isOut = e.status === 'OUT' || (times.length % 2 === 0);

  let totalSec = 0;
  for (let i = 0; i < times.length; i += 2) {
    const inTime = times[i];
    if (i + 1 < times.length) {
      const outTime = times[i + 1];
      let diff = outTime - inTime;
      if (diff < 0) diff += 86400;
      totalSec += diff;
    } else {
      if (isOut) {
        // If logged out with single/odd unmatched punch, treat session as closed or 0 live time
        totalSec += 0;
      } else {
        // Still IN / working — live tick
        let diff = now - inTime;
        if (diff < 0) diff += 86400;
        totalSec += diff;
      }
    }
  }
  return Math.max(0, totalSec);
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

export interface LateInfo {
  isLate: boolean;
  minutes: number;
  shift: string;
}

export function lateInfo(e: Statusable): LateInfo {
  const shift = shiftForEmployee(e.branch, e.id);
  const first = parsePunchTime(e.punchTimes[0]);
  if (first == null) return { isLate: false, minutes: 0, shift: 'General' };

  const DAY = 86400;
  const candidates: { label: string; startSec: number }[] = [
    { label: 'General', startSec: shiftSeconds(shift.generalStart) },
    ...(shift.extraShifts ?? []).map(s => ({ label: s.label, startSec: shiftSeconds(s.start) })),
  ];

  const grace = (shift.graceMinutes ?? 0) * 60;
  let best: { label: string; delta: number } | null = null;
  for (const c of candidates) {
    let d = first - c.startSec;
    if (Math.abs(d + DAY) < Math.abs(d)) d += DAY;
    if (!best || Math.abs(d) < Math.abs(best.delta)) best = { label: c.label, delta: d };
  }
  if (!best || best.delta <= grace) return { isLate: false, minutes: 0, shift: best?.label ?? 'General' };
  return { isLate: true, minutes: Math.round((best.delta - grace) / 60), shift: best.label };
}

export function isWorking(e: Statusable): boolean {
  return e.status === 'IN';
}

export function isAbsent(e: Statusable): boolean {
  return !isWorking(e) && (e.punchTimes?.length ?? 0) === 0;
}

export function isLogout(e: Statusable): boolean {
  return !isWorking(e) && (e.punchTimes?.length ?? 0) > 0;
}

export function deriveStatus(e: Statusable): EmpStatus {
  if (isWorking(e)) return isLate(e) ? 'late' : 'working';
  return isLogout(e) ? 'logout' : 'absent';
}

export const STATUS_META: Record<string, { label: string; badge: string; dot: string }> = {
  working: { label: 'Working', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  late: { label: 'Late', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  absent: { label: 'Absent', badge: 'bg-red-100 text-red-600', dot: 'bg-red-500' },
  logout: { label: 'Logout', badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  on_time: { label: 'On Time', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  present: { label: 'Present', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  weekly_off: { label: 'Weekly Off', badge: 'bg-red-100 text-red-600', dot: 'bg-red-500' },
  holiday: { label: 'Holiday', badge: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  permission: { label: 'Permission', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  no_data: { label: 'No Data', badge: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' },
};

export const STATUS_ORDER: EmpStatus[] = ['working', 'late', 'logout', 'absent'];

export function parseDeviceTs(ts: string): Date | null {
  if (!ts || ts === '--') return null;
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/);
  if (!m) return null;
  let h = +m[4];
  if (m[7] === 'PM' && h < 12) h += 12;
  if (m[7] === 'AM' && h === 12) h = 0;
  const d = new Date(+m[1], +m[2] - 1, +m[3], h, +m[5], +m[6]);
  return isNaN(d.getTime()) ? null : d;
}

export function timeAgoText(ts: string, nowMs: number): string {
  if (!ts || ts === '--') return '--';
  const d = parseDeviceTs(ts);
  if (!d) return '--';
  const s = Math.max(0, Math.floor((nowMs - d.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtPunch(ts: string): string {
  if (!ts || ts === '--') return ts || '--';
  const d = parseDeviceTs(ts);
  if (!d) return ts;
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = `${h}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} ${ap}`;
  const today = new Date();
  if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) {
    return `Today ${time}`;
  }
  return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${time}`;
}
