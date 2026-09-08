# UA Attendance Portal — Project Notes

**Last updated:** 2026-08-04

This document explains *what* we are building, *why*, how it is structured, and how things get deployed. It is for understanding only — it is not part of the live UI.

---

## 1. What this project is

The UA Biometric Attendance system tracks employees punching in/out on fingerprint devices
across multiple locations (branches). We are packaging that raw attendance data into an
**HRMS Pro–style web portal** that managers use to see, at a glance:

- Who is present / absent right now, across all branches.
- Each branch's live device health.
- Punches and IN/OUT timelines per employee.
- Early logins, late arrivals, and average check-in time.
- Employee/unit information.

The portal is a single-page React app served from behind the existing Flask API on IIS.

**Live URL:** `https://win.howtostart.in/UA/`

---

## 2. Why we are doing it

1. **Replace dead/emotional manual checking** — previously attendance had to be pulled by
   hand or guessed. The portal shows live status continuously (auto-refresh every ~5s).
2. **Single source of truth** — one dashboard summarises all 5 devices/branches instead of
   logging into each device separately.
3. **Structure for growth** — an HRMS-style sidebar leaves obvious room for future modules
   (payroll, leave, reports) without redesigning later.
4. **Decision support** — Activity Insights (early/late/average) gives supervisors real data
   about punctuality without extra effort.
5. **We reuse what's already live** — we deliberately use the existing `/api/live` endpoints
   and pre-built front-end features. No external AI API, nothing extra to install.

---

## 3. Tech stack & layout

| Layer      | Technology                          | Location (this machine)                                   |
|------------|-------------------------------------|-----------------------------------------------------------|
| Frontend   | React + Vite + TypeScript + Tailwind | `C:\Users\Administrator\Desktop\attendance-dashboard\`    |
| Backend    | Flask (wfastcgi) served by IIS       | `C:\inetpub\wwwroot\ua\app.py`                            |
| Dev copy   | Same Flask app (local mirror)        | `C:\Users\Administrator\Desktop\attendance_dashboard\`    |
| Auth       | `users.json` (roles: superadmin/admin/manager) | `C:\inetpub\wwwroot\ua\users.json`             |

- The SPA talks to the backend on the **same origin** (`API_URL = "/UA"`).
- The backend aggregates all `LOCATIONS` into one combined live payload via `/api/live/all`.

---

## 4. How the sidebar / modules are organised

The left sidebar is built around a `MenuKey` list. Currently active modules:

| Menu item         | What it shows                                        | Component                      |
|-------------------|------------------------------------------------------|--------------------------------|
| AI Insights       | Not built yet (placeholder)                          | `Placeholder`                  |
| Dashboard         | All-branches overview (goto for admin/superadmin)    | `AllBranchesPage`              |
| Employees         | Roster table: ID, Name, Branch, Status, First In/Last Punch | `EmployeesPage`          |
| Attendance        | Today's punch timeline per employee (collapsible IN→OUT pairs) | `AttendancePage`       |
| Units             | Branch cards with device health                      | `UnitsPage`                    |
| Activity Insights | Earliest login, average check-in, late arrivals      | `ActivityInsightsPage`         |

**Removed** (per request): Import Data, ROI Calculator, Business Benefits.

---

## 5. Activity Insights — the logic

Built entirely from the existing live payload. For each present employee we take their
**first punch** (first IN) and compare it to a cutoff:

- **Late threshold** = 09:35 AM (constant `LATE_MINUTES = 9*60+35`).
- **Early/On-time** = first punch at or before the cutoff.
- **Late** = first punch after the cutoff.
- **Earliest login** = the minimum first-punch time today.
- **Average check-in** = mean of all present employees' first-punch times.

So "early" vs "late" is judged against 09:35, computed client-side from the same data the
dashboard already uses. Note: this reflects *today's* punches only.

---

## 6. Current known caveats (read before changing things)

- **Today-only:** every live payload is filtered to `CONVERT(date, LogDate) = today`. There is
  no history/monthly view yet.
- **`Employees` vs `Attendance`:** both read the same `/api/live/all` data. They are separate
  pages only in *presentation* (roster vs punch timeline) — the underlying data is identical.
- **Status heuristic:** an employee is "Present/IN" if their last punch is an *in* punch or if
  the punch count is odd. This is a heuristic, not from the device's own flag.
- **LATE_MINUTES is duplicated** in `AllBranchesPage` and `ActivityInsightsPage`. If the cutoff
  ever changes, update both.
- **Backend refactor sits unused:** `app.py` has a `run_sync_once()` function and a `/api/sync`
  endpoint that we added earlier but are not using now that Import Data was removed. It is
  harmless. Confirm with the owner whether to delete it.

---

## 7. How to deploy

Edit a component in `src/`, then rebuild and copy to IIS:

```
# from C:\Users\Administrator\Desktop\attendance-dashboard
npm run build

# overwrite IIS copy
Remove-Item C:\inetpub\wwwroot\ua\dist -Recurse -Force
Copy-Item dist C:\inetpub\wwwroot\ua\dist -Recurse -Force
```

- Frontend changes → just copy `dist` (the hashed JS/CSS is picked up by `index.html`).
- Backend changes (`app.py`) → wfastcgi hot-reloads; if not, recycle the app pool.
- Always hard-refresh the browser (Ctrl+F5) after deploying, because filenames are hashed.
- Quick check: the deployed `index.html` shows which `index-*.js` / `index-*.css` is live.

---

## 8. Files that matter

- `src/components/SidebarLayout.tsx` — sidebar + `MenuKey`/`MENU_ITEMS`.
- `src/App.tsx` — routing between modules.
- `src/components/AllBranchesPage.tsx`, `EmployeesPage.tsx`, `AttendancePage.tsx`,
  `UnitsPage.tsx`, `ActivityInsightsPage.tsx` — the active pages.
- `C:\inetpub\wwwroot\ua\app.py` — Flask backend (source of truth), mirrored at
  `C:\Users\Administrator\Desktop\attendance_dashboard\app.py`.
- `C:\inetpub\wwwroot\ua\users.json` — user accounts.

---

## 9. What's probably next

- Confirm whether to remove the unused `/api/sync` / `run_sync_once()` backend work.
- Decide if the **Employees** tab should show more (e.g. hourly punches / status) to differ
  further from Attendance.
- Later: a date picker / history view (today-only is a real limitation).