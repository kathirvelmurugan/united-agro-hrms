export interface PunchRecord {
  time: string;
  direction: 'IN' | 'OUT';
}

export interface Employee {
  id: string;
  name: string;
  status: 'IN' | 'OUT';
  lastPunch: string;
  lastPunchRaw: string;
  punchTimes: string[];
  punchDirs: string[];
}

export interface LiveData {
  present: number;
  absent: number;
  employees: Employee[];
  deviceName: string;
  deviceLocation: string;
  deviceStatus: string;
  lastPunch?: string;
  lastPing?: string;
  lastUpdated: string;
}

export type DetailedStatus =
  | 'absent'
  | 'working'
  | 'late'
  | 'break'
  | 'leave'
  | 'overtime'
  | 'missingPunch';

export interface EmployeeAnalytics {
  id: string;
  name: string;
  status: DetailedStatus;
  hoursToday: number;
  firstPunch: string;
  lastPunch: string;
}
