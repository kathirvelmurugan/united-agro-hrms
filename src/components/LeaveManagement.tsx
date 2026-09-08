import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarCheck, Clock, AlertCircle, CheckCircle, XCircle, Plus, X } from 'lucide-react';

interface LeaveRequest {
  id: string;
  type: string;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  appliedOn: string;
}

const LEAVE_TYPES = [
  { key: 'sick', label: 'Sick Leave', balance: 12, color: 'rose', icon: 'ðŸ¥' },
  { key: 'casual', label: 'Casual Leave', balance: 10, color: 'blue', icon: 'ðŸŒ´' },
  { key: 'annual', label: 'Annual Leave', balance: 15, color: 'purple', icon: 'âœˆï¸' },
  { key: 'personal', label: 'Personal Leave', balance: 5, color: 'amber', icon: 'ðŸ‘¤' },
];

const STORAGE_KEY = 'ua_leave_requests';

function loadRequests(): LeaveRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRequests(requests: LeaveRequest[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
}

export default function LeaveManagement() {
  const [requests, setRequests] = useState<LeaveRequest[]>(loadRequests);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'sick', from: '', to: '', reason: '' });
  const [error, setError] = useState('');

  useEffect(() => { saveRequests(requests); }, [requests]);

  function calcDays(from: string, to: string) {
    if (!from || !to) return 0;
    const f = new Date(from), t = new Date(to);
    return Math.max(1, Math.floor((t.getTime() - f.getTime()) / (86400000)) + 1);
  }

  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.from || !form.to) { setError('Select from and to dates'); return; }
    if (new Date(form.from) > new Date(form.to)) { setError('From date cannot be after To date'); return; }

    const days = calcDays(form.from, form.to);
    const type = LEAVE_TYPES.find(t => t.key === form.type);
    if (!type) return;

    const used = requests
      .filter(r => r.type === form.type && r.status !== 'rejected')
      .reduce((s, r) => s + r.days, 0);
    if (used + days > type.balance) {
      setError(`Insufficient ${type.label} balance (${type.balance - used} days remaining)`);
      return;
    }

    const newReq: LeaveRequest = {
      id: Date.now().toString(),
      type: form.type,
      from: form.from,
      to: form.to,
      days,
      reason: form.reason,
      status: 'pending',
      appliedOn: new Date().toISOString().split('T')[0],
    };
    setRequests(prev => [newReq, ...prev]);
    setShowForm(false);
    setForm({ type: 'sick', from: '', to: '', reason: '' });
  }

  const balance = useMemo(() => {
    return LEAVE_TYPES.map(t => {
      const used = requests
        .filter(r => r.type === t.key && r.status !== 'rejected')
        .reduce((s, r) => s + r.days, 0);
      return { ...t, used, remaining: t.balance - used };
    });
  }, [requests]);

  const pending = useMemo(() => requests.filter(r => r.status === 'pending'), [requests]);
  const history = useMemo(() => requests, [requests]);

  const statusIcon: Record<string, React.ReactNode> = {
    pending: <Clock size={14} className="text-amber-500" />,
    approved: <CheckCircle size={14} className="text-green-500" />,
    rejected: <XCircle size={14} className="text-red-500" />,
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <CalendarCheck size={16} className="text-white" />
            </div>
            <h1 className="text-sm font-semibold text-gray-900">Leave Management</h1>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-2 rounded-lg transition-colors"
          >
            <Plus size={14} /> Apply Leave
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {balance.map((b, i) => (
              <motion.div
                key={b.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-white rounded-xl border border-gray-200 p-4"
              >
                <p className="text-xs text-gray-400 mb-1.5">{b.label}</p>
                <p className={`text-2xl font-bold ${b.remaining <= 2 ? 'text-red-600' : 'text-gray-900'}`}>
                  {b.remaining}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">{b.used} used of {b.balance}</p>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-3 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-900">Leave History</h2>
                </div>
                {history.length === 0 ? (
                  <div className="p-10 text-center text-sm text-gray-400">
                    No leave applications yet. Click "Apply Leave" to request time off.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 border-b border-gray-50">
                          <th className="text-left px-4 py-3 font-medium">Type</th>
                          <th className="text-left px-4 py-3 font-medium">From</th>
                          <th className="text-left px-4 py-3 font-medium">To</th>
                          <th className="text-center px-4 py-3 font-medium">Days</th>
                          <th className="text-left px-4 py-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(r => (
                          <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3">
                              <span className="text-gray-900 font-medium capitalize">{r.type}</span>
                              {r.reason && <p className="text-xs text-gray-400 truncate max-w-[180px]">{r.reason}</p>}
                            </td>
                            <td className="px-4 py-3 text-gray-600">{r.from}</td>
                            <td className="px-4 py-3 text-gray-600">{r.to}</td>
                            <td className="px-4 py-3 text-center text-gray-900 font-medium">{r.days}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${
                                r.status === 'approved' ? 'bg-green-50 text-green-700' :
                                r.status === 'rejected' ? 'bg-red-50 text-red-700' :
                                'bg-amber-50 text-amber-700'
                              }`}>
                                {statusIcon[r.status]}
                                {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div>
              {pending.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white rounded-xl border border-gray-200 mb-4"
                >
                  <div className="px-5 py-3 border-b border-gray-100">
                    <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <Clock size={14} className="text-amber-500" />
                      Pending ({pending.length})
                    </h2>
                  </div>
                  <div className="p-4 space-y-3">
                    {pending.map(r => (
                      <div key={r.id} className="text-sm">
                        <p className="text-gray-900 font-medium capitalize">{r.type} Leave</p>
                        <p className="text-xs text-gray-400">{r.from} → {r.to} ({r.days} day{r.days > 1 ? 's' : ''})</p>
                        {r.reason && <p className="text-xs text-gray-500 mt-0.5">{r.reason}</p>}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-white rounded-xl border border-gray-200 p-5"
              >
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Leave Policy</h3>
                <ul className="text-xs text-gray-500 space-y-1.5">
                  <li>• Apply at least 1 day in advance</li>
                  <li>• Sick leave requires medical certificate for 3+ days</li>
                  <li>• Annual leave needs manager approval</li>
                  <li>• Weekends and holidays are not counted</li>
                </ul>
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
            onClick={() => setShowForm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">Apply for Leave</h2>
                <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleApply} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Leave Type</label>
                  <select
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                  >
                    {LEAVE_TYPES.map(t => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">From Date</label>
                    <input
                      type="date"
                      value={form.from}
                      onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">To Date</label>
                    <input
                      type="date"
                      value={form.to}
                      onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">
                    Duration: <span className="text-gray-900 font-semibold">{calcDays(form.from, form.to)} day{calcDays(form.from, form.to) !== 1 ? 's' : ''}</span>
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Reason (optional)</label>
                  <textarea
                    value={form.reason}
                    onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                    rows={3}
                    placeholder="Enter reason for leave"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
                  />
                </div>
                {error && (
                  <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg flex items-center gap-1.5">
                    <AlertCircle size={12} /> {error}
                  </p>
                )}
                <button
                  type="submit"
                  className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg text-sm transition-colors"
                >
                  Submit Request
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
