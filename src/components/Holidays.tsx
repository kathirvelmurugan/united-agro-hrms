import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Sun } from 'lucide-react';

const GOVT_HOLIDAYS: Record<string, { date: string; name: string }[]> = {
  '2026': [
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-03-25', name: 'Holi' },
    { date: '2026-03-27', name: 'Good Friday' },
    { date: '2026-04-14', name: 'Ambedkar Jayanti' },
    { date: '2026-05-01', name: 'Labour Day' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-09-16', name: 'Ganesh Chaturthi' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-11-01', name: 'Diwali' },
    { date: '2026-11-04', name: 'Vishwakarma Day' },
    { date: '2026-11-15', name: 'Guru Nanak Jayanti' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
  '2025': [
    { date: '2025-01-26', name: 'Republic Day' },
    { date: '2025-03-14', name: 'Holi' },
    { date: '2025-04-18', name: 'Good Friday' },
    { date: '2025-04-14', name: 'Ambedkar Jayanti' },
    { date: '2025-05-01', name: 'Labour Day' },
    { date: '2025-08-15', name: 'Independence Day' },
    { date: '2025-08-27', name: 'Ganesh Chaturthi' },
    { date: '2025-10-02', name: 'Gandhi Jayanti' },
    { date: '2025-10-20', name: 'Diwali' },
    { date: '2025-11-05', name: 'Guru Nanak Jayanti' },
    { date: '2025-12-25', name: 'Christmas' },
  ],
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Holidays() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const holidays = useMemo(() => {
    const key = String(year);
    return GOVT_HOLIDAYS[key] || [];
  }, [year]);

  const monthHolidays = useMemo(() => {
    return holidays.filter(h => {
      const d = new Date(h.date);
      return d.getMonth() === month && d.getFullYear() === year;
    });
  }, [holidays, month, year]);

  const calendar = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = Array(firstDay).fill(null);
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push(i);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [year, month]);

  function isSunday(day: number) {
    const d = new Date(year, month, day);
    return d.getDay() === 0;
  }

  function isGovtHoliday(day: number) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return holidays.find(h => h.date === dateStr);
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
            <Sun size={16} className="text-white" />
          </div>
          <h1 className="text-sm font-semibold text-gray-900">Holidays</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
              className="text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors shrink-0"
            >
              Jump to today
            </button>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-sm font-semibold text-gray-900">{MONTHS[month]} {year}</h2>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-lg overflow-hidden">
                {DAYS.map(d => (
                  <div key={d} className="text-center text-xs font-medium text-gray-400 py-2 bg-white">{d}</div>
                ))}
                {calendar.map((day, i) => {
                  if (day === null) return <div key={`e-${i}`} className="bg-white" />;
                  const govt = isGovtHoliday(day);
                  const sun = isSunday(day);
                  const isHoliday = !!govt || sun;
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const isToday = dateStr === todayStr;
                  return (
                    <div
                      key={day}
                      className={`relative text-center py-3 text-sm transition-colors bg-white ${
                        isToday ? 'ring-2 ring-brand-500 ring-inset font-bold' : ''
                      } ${
                        isHoliday
                          ? 'bg-red-50 text-red-600 font-semibold'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                      title={govt ? govt.name : sun ? 'Sunday' : ''}
                    >
                      {day}
                      {isHoliday && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-400" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-xl border border-gray-200 p-4"
            >
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                Weekly Off
              </h3>
              <p className="text-sm text-gray-500">Every Sunday</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-xl border border-gray-200 p-4"
            >
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                Govt Holidays {year}
              </h3>
              {monthHolidays.length === 0 ? (
                <p className="text-sm text-gray-400">No government holidays this month</p>
              ) : (
                <ul className="space-y-1.5">
                  {monthHolidays.map(h => {
                    const d = new Date(h.date);
                    return (
                      <li key={h.date} className="flex items-start gap-2 text-sm">
                        <span className="text-amber-500 font-medium whitespace-nowrap">
                          {d.getDate()} {MONTHS[d.getMonth()].slice(0, 3)}
                        </span>
                        <span className="text-gray-700">{h.name}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
