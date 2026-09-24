# UA Attendance – Full Code Reference (Code + Its Use, Tabular)

Live URL: `https://win.howtostart.in/UA/`
Stack: `SQL Server (eTimetracklite1) → Flask (app.py) → React SPA (dist)`

Folders:
- Backend (deployed): `C:\inetpub\wwwroot\ua\`
- Frontend source: `C:\Users\Administrator\Desktop\attendance-dashboard\src\`
- Built frontend: `C:\inetpub\wwwroot\ua\dist\`

---

## How the app works (1-line flow)
Punch devices write to SQL Server → `app.py` computes live attendance every 3s into `LIVE_CACHES` → React reads via `/api/live/<id>` every 2s → renders current IN/OUT cards.

---

## A. Backend `app.py`

### A1. Setup & configuration

| # | Code | Its use |
|---|---|---|
| L13 | `app = Flask(__name__)` | Create the Flask web app |
| L14 | `app.secret_key = <redacted>` | Sign session cookies |
| L15-19 | `SESSION_COOKIE_HTTPONLY/SAMESITE`, `PERMANENT_SESSION_LIFETIME=480` | Cookie safety + session lifetime (480 min) |
| L24-31 | `DB_CONFIG` | SQL Server connection string (`eTimetracklite1`) |
| L33 | `LOG_TABLES=[...]` | Which punch-log tables to search for today |
| L35 | `LIVE_CACHES = {}` | In-memory live attendance per device |
| L39-45 | `LOCATIONS = {21,23,24,25,42}` | Device id → name/location (**add/remove devices here**) |

### A2. Data access

| # | Code | Its use |
|---|---|---|
| L47 | `load_users()` | Read `users.json` into cache |
| L57 | `save_users(users)` | Write `users.json` back |

### A3. Auth decorators

| # | Code | Its use |
|---|---|---|
| L66 | `login_required` | Redirect to login if no session |
| L74 | `role_required(*roles)` | Redirect unless user role in allowed list |

### A4. Core engine — `database_sync_worker()` (L88-225)

| Step | Code | Its use |
|---|---|---|
| L93 | `device_ids = list(LOCATIONS.keys())` | Loop over every configured device |
| L98-103 | Load all `Employees` | Build global name lookup |
| L112-128 | LEFT JOIN `DeviceUsers` + `Employees` | Which employees are enrolled on each device |
| L137-149 | Read punch logs from `LOG_TABLES` for today | Get today's punch events per device |
| L161-171 | Build `relevant` = enrolled + assigned + punched | Decide which employees to show |
| L172-197 | Compute name, punches, status (IN/OUT) | Per-employee live data |
| L199-201 | `present`/`absent` counts + sort | Totals for header |
| L206-218 | Write into `LIVE_CACHES[dev_id]` | Store final result |
| L225 | `time.sleep(3)` | **Poll interval ~3s** |

### A5. Routes (HTTP endpoints)

| Route | Use |
|---|---|
| `GET /` , `GET /<path>` (L598) | Serve React SPA (`dist/index.html`) |
| `POST /api/login` (L683) | Validate login → `{success,role,label,device_id}` or 401 |
| `GET /api/live/<id>` (L655) | Live data for one device (Dashboard/Admin) |
| `GET /api/locations` (L700) | All devices list (switcher/admin) |
| `GET/POST /api/users` (L715) | List/create users (admin role + session cookie required) |
| `DELETE /api/users/<user>` (L758) | Delete user (admin role + session cookie required) |
| `GET /login` `GET /dashboard` `GET /admin` ... | Legacy server-rendered pages (mostly unused) |
| `GET /logout` (L860) | Clear session |

---

## B. Frontend `src\`

### B1. Session / routing — `App.tsx`

| Code | Its use |
|---|---|
| `STORAGE_KEY = 'ua_session_user'` | Key for localStorage login persistence |
| `loadUser()` | Restore session on page load (survives refresh) |
| `handleLogin(...)` | Save user to state + localStorage |
| `handleLogout()` | Clear user + localStorage |
| Render logic | Show Login / Dashboard / Admin |

### B2. Login — `LoginPage.tsx`

| Code | Its use |
|---|---|
| `fetch(/api/login)` | Call login endpoint |
| `onLogin(d.username, d.role, d.label, d.device_id)` | Hand result to App |
| `autoComplete` + clear-on-mount | Prevent browser autofill |

### B3. Layout — `SidebarLayout.tsx`

| Code | Its use |
|---|---|
| `Dashboard` button | Main view |
| `Admin Panel` (admin+ role) | Enter admin page |
| `Logout` button | End session |

### B4. Live view — `Dashboard.tsx`

| Code | Its use |
|---|---|
| Poll `/api/live/<id>` every **2s** (L64) | Auto-refresh attendance |
| ONLINE/OFFLINE badge | Device connectivity (green/red) |
| Location switcher (admin/superadmin) | Switch devices |
| Present / Absent / Total cards | Summary |
| Filter dropdown (`FILTER_OPTIONS`) | Filter by stage |
| Employee card grid | Show each employee |

### B5. Employee card — `EmployeeCard.tsx`

| Code | Its use |
|---|---|
| `lastPunchRaw` + `Date.now()` | Live in-duration counter |
| `getDetailedStatus` / `calcHoursToday` | Status chip + hours |

### B6. Admin — `AdminPage.tsx`

| Code | Its use |
|---|---|
| `authFetch('/api/users')` | Load users with session cookie |
| `fetch('/api/locations')` | Load devices |
| All-location live cards | Overview per device |
| Add User form | Create manager/admin |
| Users table + Delete | Manage existing |

---

## C. Utility / config files

| File | Code | Its use |
|---|---|---|
| `mockData.ts` | `API_URL = ...BASE_URL` → `/UA` | Same-origin API base |
| `mockData.ts` | `DEVICE_ID = 24` | Default device when manager has none |
| `attendanceUtils.ts` L26-28 | `8:30 / 9:30 / 18:00` | Shift start, late, overtime thresholds |
| `attendanceUtils.ts` | `getDetailedStatus`, `getStatusConfig` | Status chip colors/labels |
| `types.ts` | `Employee`, `LiveData`, ... | TypeScript types |

---

## D. Build & deploy (manual)

| Step | Command / Action |
|---|---|
| Build | `npm run build` in `attendance-dashboard\` |
| Deploy | copy `dist\` → `C:\inetpub\wwwroot\ua\dist\` (remove old assets) |
| Backend change | edit `C:\inetpub\wwwroot\ua\app.py` or `users.json` directly |
| Apply | recycle IIS `DefaultAppPool` if needed |

---

## E. Common tasks → where to edit

| Task | Edit |
|---|---|
| Add/remove/rename device | `LOCATIONS` in `app.py` |
| Change start/late/overtime hours | `attendanceUtils.ts` L26-28 |
| Change default display device | `DEVICE_ID` in `mockData.ts` |
| Change refresh speed | `Dashboard.tsx` L64 (`2000`) |
| Change login persistence key | `App.tsx` `STORAGE_KEY` |
| Add/delete user | `users.json` OR Admin Panel |

---

## F. Default users

| Role | Username | Password | Device |
|---|---|---|---|---|
| superadmin | `admin` | `<redacted>` | all |
| admin | `admin_sipcot` | `<redacted>` | 24 |
| manager | `manager_sipcot` | `<redacted>` | 24 |
| admin | `admin_neikarapatti` | `<redacted>` | 21 |
| admin | `admin_theevattipatti` | `<redacted>` | 23 |
| admin | `admin_headlab` | `<redacted>` | 25 |
| admin | `admin_namakkal` | `<redacted>` | 42 |
| + | `manager_<site>` | per site | per site |

---

## G. Key technical notes

- Status rule: Present = last punch `in` OR odd punch count; else Absent.
- Name precedence: enrolled → global Employees → `Employee id`.
- Admin/superadmin see all devices; manager sees only their device.
- Frontend login uses `localStorage` (independent of pre-server sessions).
- App pool idle/recycle disabled to prevent restarts (the old "45 min logout").