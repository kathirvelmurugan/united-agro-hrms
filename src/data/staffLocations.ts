export const STAFF_LOCATION_MAP: Record<string, string> = {
  'VIVEK S': 'Office',
  'S.KESAVAN': 'Office',
  'T.GOVINDRAJ': 'yard',
  'A.THIYAGARAJAN': 'yard',
  'M.JANAGARAJ': 'yard',
  'MANIKANDAN': 'yard',
  'R.RAJASEKAR': 'Maintenance',
  'G.SIVAKUMAR': 'Driver',
  'J.MATHAN KUMAR': 'yard',
  'C.LOGANATHAN': 'yard',
  'PERUMAL': 'House keeping',
};

export const SLP_DEVICE_ID = 42;

export const STAFF_LOCATIONS: string[] = ['Office', 'yard', 'Maintenance', 'Driver', 'House keeping'];

export const STAFF_ROSTER_ALIASES: Record<string, string> = {
  'J.MATHAN KUMAR': 'Madhankumar',
};

function norm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z]/g, '');
}

export function getStaffLocation(name: string, deviceId?: number): string | undefined {
  if (!name) return undefined;
  if (deviceId !== undefined && deviceId !== SLP_DEVICE_ID) return undefined;
  const d = norm(name);
  if (d.length === 0) return undefined;
  for (const [rosterName, loc] of Object.entries(STAFF_LOCATION_MAP)) {
    const r = norm(rosterName);
    const alias = STAFF_ROSTER_ALIASES[rosterName];
    if (alias && norm(alias) === d) return loc;
    const minLen = Math.min(r.length, d.length);
    if (minLen >= 4 && (r.includes(d) || d.includes(r))) return loc;
  }
  return undefined;
}