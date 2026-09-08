# Session Summary - Attendance Dashboard

## Running Servers
- Frontend (Vite): http://108.181.175.250:5174/ (port 5174, host 0.0.0.0)
- Backend (Flask): http://108.181.175.250:5000 (port 5000)
- Run with: `C:\Users\Administrator\AppData\Local\Programs\Thonny\python.exe app.py`

## Projects
1. React/Vite frontend: `C:\Users\Administrator\Desktop\attendance-dashboard`
2. Flask backend: `C:\Users\Administrator\Desktop\attendance_dashboard`

## Changes Made
### Dashboard.tsx
- Analytics cards reordered: Avg Hours → Present → Absent → Total → Best Performer → Lowest Hours
- Removed legend dots (Working/Late/Break/etc.)
- Added status filter dropdown (All Stages, Working, Late, Leave/Early Exit, Absent/Missing Punch, Overtime)
- Employees sorted by first punch time ascending (absent at bottom)

### EmployeeCard.tsx
- Name always visible (no truncation)
- Status badge smaller (text-[8px])
- ID in dark bold (text-gray-900 font-bold)
- Compact layout (p-2.5, smaller durations box)

### SidebarLayout.tsx
- Right notifications panel removed
- Notifications moved to left sidebar (collapsible)
- Notifications fetch live API data every 3s for real counts
- Notification buttons apply filters on dashboard:
  - Missing Punches → filter 'absent'
  - Late Arrivals → filter 'late'
  - Early Exit → filter 'leave'
  - Leave Requests → switches to Leave Management tab
  - Payroll Ready / Attendance Synced → modal with user name

### App.tsx
- Added statusFilter state and onNotification handler
- Filters reset on tab change

### Holidays.tsx
- Calendar enlarged (100% width, no max-w constraint)
- "Jump to today" moved to left before calendar
- Weekly Off & Govt Holidays in 2-column grid
- Calendar uses gap-px grid for full-width fit

## To Restart After Reboot
```powershell
# Start Flask backend
cd C:\Users\Administrator\Desktop\attendance_dashboard
Start-Process -NoNewWindow powershell "-Command & 'C:\Users\Administrator\AppData\Local\Programs\Thonny\python.exe' app.py"

# Start Vite frontend
cd C:\Users\Administrator\Desktop\attendance-dashboard
Start-Process -NoNewWindow powershell "-Command npm run dev -- --host 0.0.0.0 --port 5174"
```
