import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, User, Send, X, Maximize2, Minimize2, Sparkles, ChevronDown } from 'lucide-react';
import { API_URL } from '../data/mockData';
import { authFetch } from '../lib/auth';
import { deriveStatus, lateInfo, workingSeconds, formatDuration, parsePunchTime, type Statusable } from '../lib/status';

interface Anomaly {
  severity: 'High' | 'Medium' | 'Low';
  type: string;
  message: string;
  employee: string;
  id: string;
  branch: string;
  time: string;
}

interface RiskRow {
  id: string;
  name: string;
  branch: string;
  device_id: number;
  score: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  early_days: number;
  reasons: string[];
}

interface BranchEmpStat {
  id: string;
  name: string;
  absent: number;
  late: number;
}

interface BranchStat {
  branch: string;
  records: number;
  present: number;
  absent: number;
  late: number;
  hours: number;
  active: number;
  absent_emps: BranchEmpStat[];
  late_emps: BranchEmpStat[];
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

interface LiveEmployee {
  id: string;
  name: string;
  status: 'IN' | 'OUT';
  lastPunch: string;
  punchTimes: string[];
  branch: string;
}

interface MonthStat {
  month: string;
  label: string;
  overview: Overview;
}

interface AiData {
  generated: string;
  range_days: number;
  months: MonthStat[];
  anomalies: Anomaly[];
  risk: RiskRow[];
}

interface LiveData {
  branches: { device_id: number; name: string; location: string; present: number; absent: number; deviceStatus: string; lastPing: string }[];
  employees: LiveEmployee[];
}

interface AnalyticsEmp {
  id: string;
  name: string;
  branch: string;
  current_on_time_streak: number;
  current_late_streak: number;
  month: { present_days: number; total_hours: number; avg_hours: number };
}

interface AnalyticsData {
  employees: AnalyticsEmp[];
  leaders: {
    on_time_streak: AnalyticsEmp[];
    late_streak: AnalyticsEmp[];
    week_on_time: AnalyticsEmp[];
    week_late: AnalyticsEmp[];
    month_hours: AnalyticsEmp[];
  };
}

interface ChatMsg {
  role: 'user' | 'ai';
  text: string;
}

interface ChatApi {
  open: boolean;
  setOpen: (v: boolean) => void;
  messages: ChatMsg[];
  send: (text?: string) => void;
}

const ChatCtx = createContext<ChatApi | null>(null);

export function useChat(): ChatApi {
  const c = useContext(ChatCtx);
  if (!c) throw new Error('useChat must be used within AiChatProvider');
  return c;
}

function fmtClock(sec: number): string {
  const h24 = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  const ap = h24 >= 12 ? 'PM' : 'AM';
  const hh = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

const SUGGESTIONS = ['Who is late today?', 'Who is not on time?', 'Who was late yesterday?', 'Who was absent yesterday?', 'Earliest login today', 'Who worked most hours this month?', 'Which branch has most absents?', 'Attendance rate this month'];

const BRANCH_KEYS: [string, string][] = [
  ['sidco', 'SS_Sidco'],
  ['slp', 'SS SLP'],
  ['theevat', 'SS_Theevattipatti'],
  ['neikarapatti', 'UAI Neikarapatti'],
  ['head', 'UAI HEAD OFFICE'],
  ['office', 'UAI HEAD OFFICE'],
  ['nsrl', 'NSRL Lab'],
  ['tvp', 'SS_Theevattipatti'],
];

export function AiChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [maxed, setMaxed] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [live, setLive] = useState<LiveData | null>(null);
  const [data, setData] = useState<AiData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [facts, setFacts] = useState<string[] | null>(null);
  const [factsNarr, setFactsNarr] = useState<string | null>(null);
  const [factsLoading, setFactsLoading] = useState(false);
  const [factsShow, setFactsShow] = useState(false);
  const chatEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || facts || factsLoading) return;
    setFactsLoading(true);
    authFetch(`${API_URL}/api/ai/facts`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j && !j.fallback) {
          setFacts(j.facts ?? []);
          setFactsNarr(j.narrative ?? null);
        }
      })
      .catch(() => { /* ignore */ })
      .finally(() => setFactsLoading(false));
  }, [open, facts, factsLoading]);

  async function fetchData() {
    try {
      const [ar, lr, yr] = await Promise.all([
        authFetch(`${API_URL}/api/ai-insights`),
        authFetch(`${API_URL}/api/live/all`),
        authFetch(`${API_URL}/api/analytics`),
      ]);
      if (ar.ok) setData(await ar.json());
      if (lr.ok) setLive(await lr.json());
      if (yr.ok) setAnalytics(await yr.json());
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (open) chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

    const NO_LOCAL_MATCH = '__NO_LOCAL_MATCH__';

  const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function isoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function resolvePastDay(q: string): { date: string; label: string } | null {
    const t = q.toLowerCase();
    const now = new Date();
    const back = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return isoDate(d); };
    if (/day before yesterday|day-before-yesterday/.test(t)) return { date: back(2), label: 'the day before yesterday' };
    if (/\byesterday\b|last night/.test(t)) return { date: back(1), label: 'yesterday' };
    const dm = t.match(/(?:on |of |before )?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)\w*/);
    if (dm) {
      const day = parseInt(dm[1], 10);
      const mm = MONTHS[dm[2].slice(0, 3)];
      let year = now.getFullYear();
      const candidate = new Date(year, mm - 1, day);
      if (candidate > now) year -= 1;
      return { date: `${year}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`, label: `${dm[1]} ${dm[2].slice(0, 3)} ${year}` };
    }
    const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, label: `${iso[1]}-${iso[2]}-${iso[3]}` };
    return null;
  }

  const PAST_DAY_RE = /\byesterday\b|day before yesterday|day-before-yesterday|last night|\d{1,2}(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|\b20\d{2}-\d{2}-\d{2}\b/;

  async function pastDayAnswer(q: string): Promise<string | null> {
    const pd = resolvePastDay(q);
    if (!pd) return null;
    try {
      const r = await authFetch(`${API_URL}/api/day?date=${pd.date}`);
      if (!r.ok) return null;
      const s = await r.json();
      if (!s || Array.isArray(s)) return null;
      const t = q.toLowerCase();
      const late = s.late ?? [];
      const absent = s.absent ?? [];
      if (/late|not on time|punctual|on time/.test(t)) {
        if (!late.length && !(s.unusual_count ?? 0)) return `No employees were late on ${pd.label} (${pd.date}).`;
        let out = `${late.length} employee(s) late on ${pd.label}:\n` + late.slice(0, 15)
          .map((e: { name: string; branch: string; minutes: number; shift: string }) => `- ${e.name} (${e.branch}): ${e.minutes} min late (${e.shift} shift)`)
          .join('\n');
        if (s.unusual_count) out += `\n\n${s.unusual_count} more had no punch before shift start (unusual arrival):\n` + (s.unusual ?? []).slice(0, 15)
          .map((e: { name: string; branch: string; first: string; minutes: number; shift: string }) => `- ${e.name} (${e.branch}): first punch ${e.first}, ${e.minutes} min after ${e.shift} shift start`)
          .join('\n');
        return out;
      }
      if (/absent|didn'?t come|did not come|not report/.test(t)) {
        if (!absent.length) return `No one was absent on ${pd.label} (${pd.date}).`;
        return `${absent.length} employee(s) absent on ${pd.label}:\n` + absent.slice(0, 15)
          .map((e: { name: string; branch: string }) => `- ${e.name} (${e.branch})`).join('\n');
      }
      return `${pd.label} (${pd.date}) summary: ${s.present_count ?? 0} present, ${s.late_count ?? 0} late, ${s.absent_count ?? 0} absent (${s.total_count ?? 0} total, ${s.branch_count ?? 0} branches).`;
    } catch {
      return null;
    }
  }

  function answer(q: string): string {
    const text = q.toLowerCase().trim();
    const emps = live?.employees ?? [];
    const asStatusable = (e: LiveEmployee): Statusable => ({ status: e.status, punchTimes: e.punchTimes, branch: e.branch });

    if (!emps.length) return 'I need live data to answer that. Please wait a moment and try again.';

    // Past-day questions are answered deterministically via /api/day (see pastDayAnswer)
    if (PAST_DAY_RE.test(text)) return NO_LOCAL_MATCH;

    // Greetings & small talk -> always answer back
    if (/^(hi|hii|hello|hey|good (morning|afternoon|evening)|namaste|yo|hai)\b/.test(text)) {
      return 'Hi! I can answer questions about live attendance, monthly stats and patterns. Try:\n' +
        '- "Who is late today?" / "Who is not on time?" / "Who was late yesterday / day before yesterday?"\n' +
        '- "Who is absent?" / "Who was absent yesterday?" / "Who is working now?"\n' +
        '- "Earliest login today" / "Average check-in time"\n' +
        '- "SS_Sidco summary" / "Which branch has most absents?"\n' +
        '- "Who worked the most hours this month?" / "Best on-time streaks"\n' +
        '- "Attendance rate this month" / "Top risk employees" / "Any anomalies?"\n' +
        '- "status of <employee name>"';
    }

    // Named employee lookup ("status of X", "where is X", "what about X")
    const named = emps.find(e => text.includes(e.name.toLowerCase()) && e.name.length > 1);
    if (named) {
      const s = asStatusable(named);
      const st = deriveStatus(s);
      const li = lateInfo(s);
      const work = workingSeconds(s, new Date().getHours() * 3600 + new Date().getMinutes() * 60 + new Date().getSeconds());
      const statusText = st === 'working' ? 'Working (on time)' : st === 'late' ? `Late by ${li.minutes} min` : st === 'logout' ? 'Logged out' : 'Absent today';
      return `${named.name} (ID ${named.id}, ${named.branch}) is ${statusText}.` +
        (named.punchTimes.length ? ` Punches: ${named.punchTimes.join(' → ')}` : '') +
        (work != null ? ` Working time: ${formatDuration(work)}` : '') +
        (st === 'late' ? ` Shift: ${li.shift}` : '');
    }

    // Branch detection
    const branchMatch = BRANCH_KEYS.find(([k]) => text.includes(k));
    const branch = branchMatch ? branchMatch[1] : null;

    // "who is late / not on time / late comers" (today, live)
    if (/not on time|on time|late comers|latecomers|came late|arrived late|reached late|running late|is late|are late|late right now|delayed/.test(text)) {
      const late = emps.filter(e => deriveStatus(asStatusable(e)) === 'late');
      const scope = branch ? late.filter(e => e.branch === branch) : late;
      if (!scope.length) return `No one is late right now${branch ? ` in ${branch}` : ''} — everyone is on time.`;
      return `${scope.length} employee(s) late / not on time:\n` + scope
        .map(e => `- ${e.name} (${e.branch}): ${lateInfo(asStatusable(e)).minutes} min late (${lateInfo(asStatusable(e)).shift} shift)`)
        .join('\n');
    }

    // "not on time" might also mean absent if no late matches but user asked generally
    if (/who is not on time|who are not on time|how many.*not on time|not on time/.test(text)) {
      const late = emps.filter(e => deriveStatus(asStatusable(e)) === 'late');
      const ab = emps.filter(e => deriveStatus(asStatusable(e)) === 'absent');
      const scopeLate = branch ? late.filter(e => e.branch === branch) : late;
      const scopeAbs = branch ? ab.filter(e => e.branch === branch) : ab;
      if (!scopeLate.length && !scopeAbs.length) return 'Everyone is on time and accounted for.';
      const lines: string[] = [];
      if (scopeLate.length) lines.push(`${scopeLate.length} late:` + scopeLate.map(e => ` ${e.name} (${lateInfo(asStatusable(e)).minutes}m)`).join(', '));
      if (scopeAbs.length) lines.push(`${scopeAbs.length} not in / no punch:` + scopeAbs.map(e => ` ${e.name}`).join(', '));
      return lines.join('\n');
    }

    if (branch || /branch|summary|unit/.test(text)) {
      const b = branch ?? (data && text.match(/branch (\w+)/)?.[1]);
      const list = b ? emps.filter(e => e.branch.toLowerCase().includes(String(b).toLowerCase())) : emps;
      if (!list.length) return `No employees found for that branch.`;
      const c = { working: 0, late: 0, logout: 0, absent: 0 };
      for (const e of list) c[deriveStatus(asStatusable(e))]++;
      const bl = (live?.branches ?? []).find(x => x.name === list[0].branch);
      return `${list[0].branch}: ${c.working} working, ${c.late} late, ${c.logout} logged out, ${c.absent} absent (${list.length} total). Device ${bl ? (bl.deviceStatus === 'Online' ? 'online' : 'offline') : 'unknown'}.` +
        (c.late ? ` Late: ${list.filter(e => deriveStatus(asStatusable(e)) === 'late').map(e => `${e.name} (${lateInfo(asStatusable(e)).minutes}m)`).join(', ')}` : '');
    }

    if (/earliest|first to arrive|who came first|first login|first punch/.test(text)) {
      const withFirst = emps.map(e => ({ e, first: parsePunchTime(e.punchTimes[0]) }))
        .filter((x): x is { e: LiveEmployee; first: number } => x.first != null)
        .sort((a, b) => a.first - b.first);
      if (!withFirst.length) return 'No one has punched in yet today.';
      const top = withFirst.slice(0, 5);
      return `Earliest login today: ${fmtClock(top[0].first)} by ${top[0].e.name} (${top[0].e.branch}).\nNext: ` +
        top.slice(1).map(x => `${x.e.name} (${x.e.branch}) at ${fmtClock(x.first)}`).join(', ') || 'Earliest login is also the only login so far.';
    }

    if (/average check|avg check|avg login|mean check/.test(text)) {
      const withFirst = emps.map(e => ({ first: parsePunchTime(e.punchTimes[0]) }))
        .filter((x): x is { first: number } => x.first != null);
      if (!withFirst.length) return 'No check-ins yet today.';
      const avg = Math.round(withFirst.reduce((s, x) => s + x.first, 0) / withFirst.length);
      return `Average check-in time today: ${fmtClock(avg)} across ${withFirst.length} employees.`;
    }

    if (/which branch|branch.*absent|absent.*branch|most absent|worst unit|absenteeism/.test(text)) {
      const m = data?.months?.[0];
      const byBranch = m?.overview?.by_branch ?? [];
      if (!byBranch.length) return 'No branch data available.';
      const sorted = [...byBranch].sort((a, b) => b.absent - a.absent).slice(0, 5);
      return `Absent records by branch (${m?.label ?? 'this month'}):\n` +
        sorted.map(b => `- ${b.branch}: ${b.absent} absent / ${b.present} present`).join('\n');
    }

    if (/attendance rate|monthly summary|how is attendance|overall attendance|attendance%|attendance percent/.test(text)) {
      const m = data?.months?.[0];
      if (!m) return 'No monthly data available yet.';
      const o = m.overview;
      return `${m.label} so far: ${o.attendance_rate}% attendance (${o.present_records} present of ${o.total_records} records), ${o.absent_records} absent, ${o.late_records} late, avg ${o.avg_hours}h/day, ${o.active_employees} active of ${o.total_employees} employees.`;
    }

    if (/most hours|worked the most|longest hours/.test(text)) {
      const list = [...(analytics?.employees ?? [])]
        .sort((a, b) => b.month.total_hours - a.month.total_hours)
        .slice(0, 5);
      if (!list.length) return 'No hours data available yet.';
      return 'Most working hours this month:\n' + list.map((e, i) => `- #${i + 1} ${e.name} (${e.branch}): ${e.month.total_hours}h over ${e.month.present_days} days`).join('\n');
    }

    if (/best streak|on.?time streak|streak leader/.test(text)) {
      const list = analytics?.leaders?.on_time_streak ?? [];
      if (!list.length) return 'No streak data yet.';
      return 'Best on-time streaks:\n' + list.slice(0, 5).map((e, i) => `- #${i + 1} ${e.name} (${e.branch}): ${e.current_on_time_streak} days`).join('\n');
    }

    // Generic "who is late today?" / "who is absent?" / "who is working now?"
    if (/who is late|who are late|late today|who.*late\b/.test(text)) {
      const late = emps.filter(e => deriveStatus(asStatusable(e)) === 'late');
      if (!late.length) return 'No one is late right now.';
      return `${late.length} employee(s) late:\n` + late
        .map(e => `- ${e.name} (${e.branch}): ${lateInfo(asStatusable(e)).minutes} min late (${lateInfo(asStatusable(e)).shift} shift)`)
        .join('\n');
    }

    if (/absent|not punch|no punch|didn'?t come|did not come|not report/.test(text)) {
      const ab = emps.filter(e => deriveStatus(asStatusable(e)) === 'absent');
      if (!ab.length) return 'No one is absent today.';
      const names = ab.slice(0, 15).map(e => `${e.name} (${e.branch})`).join(', ');
      return `${ab.length} employee(s) absent today (no punches): ${names}${ab.length > 15 ? ` +${ab.length - 15} more` : ''}`;
    }

    if (/logout|logged out|left|out\b/.test(text)) {
      const lo = emps.filter(e => deriveStatus(asStatusable(e)) === 'logout');
      if (!lo.length) return 'No one has logged out yet.';
      const names = lo.slice(0, 15).map(e => `${e.name} (${e.branch}, last ${e.lastPunch})`).join('\n');
      return `${lo.length} employee(s) logged out:\n${names}${lo.length > 15 ? `\n+${lo.length - 15} more` : ''}`;
    }

    if (/working|present|now|online/.test(text)) {
      const w = emps.filter(e => deriveStatus(asStatusable(e)) === 'working' || deriveStatus(asStatusable(e)) === 'late');
      if (!w.length) return 'No one is currently punched in.';
      return `${w.length} employee(s) currently punched in: ${w.map(e => e.name).join(', ')}`;
    }

    if (/risk|score|worst|concern/.test(text)) {
      const top = (data?.risk ?? []).slice(0, 8);
      if (!top.length) return 'No risk data available yet.';
      return `Top at-risk employees (last 30 days):\n` + top.map((r, i) => `- #${i + 1} ${r.name} (${r.branch}): score ${r.score}${r.reasons.length ? ' — ' + r.reasons.join('; ') : ''}`).join('\n');
    }

    if (/anomal|alert|issue|problem|feed/.test(text)) {
      const an = data?.anomalies ?? [];
      if (!an.length) return 'No anomalies detected today — all clear.';
      const bySev = (s: string) => an.filter(a => a.severity === s);
      return `${an.length} anomalies today (${bySev('High').length} high, ${bySev('Medium').length} medium, ${bySev('Low').length} low):\n` +
        an.slice(0, 12).map(a => `- [${a.severity}] ${a.employee} (${a.branch}): ${a.type} — ${a.message}`).join('\n');
    }

    if (/total|count|how many|all employee/.test(text)) {
      const c = { working: 0, late: 0, logout: 0, absent: 0 };
      for (const e of emps) c[deriveStatus(asStatusable(e))]++;
      return `Total ${emps.length} employees: ${c.working} working, ${c.late} late, ${c.logout} logged out, ${c.absent} absent. Branches online: ${(live?.branches ?? []).filter(b => b.deviceStatus === 'Online').length}/${live?.branches.length ?? 0}.`;
    }

    return NO_LOCAL_MATCH;
  }

  async function askAI(q: string): Promise<string> {
    // 0) Past-day questions ("who was late yesterday?") -> deterministic from the ESSL DB via /api/day
    const pastDay = await pastDayAnswer(q);
    if (pastDay) return pastDay;
    // 1) Local rules first - deterministic, zero Gemini quota for built-in questions
    const local = answer(q);
    if (local !== NO_LOCAL_MATCH) return local;
    // 2) Custom / unknown question -> free-form Gemini (can answer anything about HRMS)
    try {
      const r = await authFetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      if (r.ok) {
        const j = await r.json();
        if (!j.fallback && typeof j.answer === 'string' && j.answer) return j.answer;
      }
    } catch { /* fall through */ }
    // 3) Structured query as a last attempt for built-in style questions
    try {
      const r = await authFetch(`${API_URL}/api/ai/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      if (r.ok) {
        const j = await r.json();
        if (!j.fallback && typeof j.answer === 'string' && j.answer) return j.answer;
      }
    } catch { /* fall through */ }
    return 'I could not answer that right now. Try a question like "who is late today?", "who is not on time?", or ask about a specific employee.';
  }

  function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q) return;
    setMessages(m => [...m, { role: 'user', text: q }]);
    setInput('');
    void askAI(q).then(a => {
      setMessages(m => [...m, { role: 'ai', text: a }]);
    });
  }

  return (
    <ChatCtx.Provider value={{ open, setOpen, messages, send }}>
      {children}
      {open && (
        <div className={`fixed z-50 bg-white rounded-xl border border-gray-200 shadow-2xl flex flex-col transition-all duration-200 ${
          maxed
            ? 'top-4 right-4 bottom-4 left-4 w-auto max-w-none'
            : 'top-16 right-4 w-[380px] max-w-[calc(100vw-2rem)] max-h-[75vh]'
        }`}>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-brand-100">
              <Bot size={14} className="text-brand-600" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-800 leading-tight">Ask AI</h2>
              <p className="text-[10px] text-gray-400">Live attendance assistant</p>
            </div>
            <button
              onClick={() => setMaxed(m => !m)}
              title={maxed ? 'Restore size' : 'Enlarge'}
              className="ml-auto p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
            >
              {maxed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <X size={14} />
            </button>
          </div>
            <div className="flex-1 overflow-auto px-3 py-3 space-y-3 min-h-[200px]">
              {(factsLoading || (facts && facts.length > 0)) && (
                <div className="rounded-xl border border-brand-200 bg-brand-50/70">
                  <button
                    onClick={() => setFactsShow(s => !s)}
                    className="w-full px-3 py-2 flex items-center gap-2 text-left"
                  >
                    <Sparkles size={13} className="text-brand-600 shrink-0" />
                    <span className={`font-semibold text-brand-800 ${maxed ? 'text-sm' : 'text-xs'}`}>
                      {factsLoading ? 'Analyzing today\'s data...' : 'Today\'s insights'}
                    </span>
                    {!factsLoading && (
                      <ChevronDown size={13} className={`ml-auto text-brand-400 transition-transform ${factsShow ? 'rotate-180' : ''}`} />
                    )}
                  </button>
                  {!factsLoading && factsShow && facts && (
                    <div className="px-3 pb-2 space-y-1">
                      {facts.map((f, i) => (
                        <p key={i} className={`text-gray-500 leading-relaxed ${maxed ? 'text-xs' : 'text-[11px]'}`}>• {f}</p>
                      ))}
                    </div>
                  )}
                  {!factsLoading && !factsShow && factsNarr && (
                    <div className="px-3 pb-2 space-y-1">
                      {factsNarr.split('\n').filter(Boolean).map((l, i) => (
                        <p key={i} className={`text-gray-600 leading-relaxed ${maxed ? 'text-xs' : 'text-[11px]'}`}>• {l}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {messages.length === 0 && (
                <p className={`${maxed ? 'text-sm' : 'text-xs'} text-gray-400 leading-relaxed`}>
                  e.g. Which shift has the most overtime? Which department needs more staff?
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex items-start gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <span className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-lg ${m.role === 'user' ? 'bg-brand-600' : 'bg-gray-100'}`}>
                    {m.role === 'user' ? <User size={12} className="text-white" /> : <Bot size={12} className="text-gray-500" />}
                  </span>
                  <div className={`max-w-[85%] px-3 py-2 rounded-xl whitespace-pre-line leading-relaxed ${
                    maxed ? 'text-sm' : 'text-xs'
                  } ${
                    m.role === 'user' ? 'bg-brand-600 text-white rounded-tr-sm' : 'bg-gray-50 text-gray-700 border border-gray-100 rounded-tl-sm'
                  }`}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <div className="px-3 pb-2 flex flex-wrap gap-1 shrink-0">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className={`px-2 py-1 rounded-full border border-gray-200 font-semibold text-gray-500 hover:bg-gray-50 hover:text-brand-600 transition-colors ${maxed ? 'text-xs' : 'text-[10px]'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="px-3 pb-3 flex items-center gap-2 shrink-0">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send(); }}
                placeholder="Ask about attendance..."
                className={`flex-1 rounded-lg border border-gray-200 px-3 py-2 outline-none focus:border-brand-500 bg-white ${maxed ? 'text-sm' : 'text-xs'}`}
              />
            <button
              onClick={() => send()}
              className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      )}
    </ChatCtx.Provider>
  );
}
