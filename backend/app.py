import os
import json
import threading
import time
import re
import secrets
import ipaddress
from copy import deepcopy
import urllib.request
from datetime import date, datetime, timedelta
import pyodbc
from flask import Flask, render_template_string, jsonify, request, redirect, session, url_for, send_from_directory, make_response, g
from functools import wraps
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RUNTIME_CONFIG_PATH = os.environ.get("UA_CONFIG_FILE", os.path.join(BASE_DIR, "config.json"))
try:
    with open(RUNTIME_CONFIG_PATH, "r", encoding="utf-8") as config_file:
        RUNTIME_CONFIG = json.load(config_file)
except FileNotFoundError:
    RUNTIME_CONFIG = {}
except (OSError, json.JSONDecodeError) as exc:
    raise RuntimeError(f"Invalid runtime config: {exc}") from exc


def config_value(name, default=None):
    value = os.environ.get(name)
    if value is not None and value.strip():
        return value.strip()
    value = RUNTIME_CONFIG.get(name)
    if value is not None and str(value).strip():
        return str(value).strip()
    return default


def required_config(name):
    value = config_value(name)
    if not value:
        raise RuntimeError(f"Missing required configuration value: {name}")
    return value


def odbc_escape(value):
    return str(value).replace("}", "}}")


def config_bool(name, default):
    value = config_value(name, default).strip().lower()
    if value not in ("yes", "no"):
        raise RuntimeError(f"{name} must be yes or no")
    return value


SECRET_KEY = required_config("SECRET_KEY")
DB_SERVER = required_config("DB_SERVER")
DB_DATABASE = required_config("DB_DATABASE")
DB_UID = required_config("DB_UID")
DB_PASSWORD = required_config("DB_PASSWORD")
DB_DRIVER = required_config("DB_DRIVER")
DB_NAME = DB_DATABASE
DB_ENCRYPT = config_bool("DB_ENCRYPT", "yes")
DB_TRUST_SERVER_CERTIFICATE = config_bool("DB_TRUST_SERVER_CERTIFICATE", "no")
DB_CONFIG = (
    f"DRIVER={{{odbc_escape(DB_DRIVER)}}};"
    f"SERVER={{{odbc_escape(DB_SERVER)}}};"
    f"DATABASE={{{odbc_escape(DB_DATABASE)}}};"
    f"UID={{{odbc_escape(DB_UID)}}};"
    f"PWD={{{odbc_escape(DB_PASSWORD)}}};"
    f"Encrypt={DB_ENCRYPT};"
    f"TrustServerCertificate={DB_TRUST_SERVER_CERTIFICATE};"
    "Pooling=True;"
)

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=config_bool("SESSION_COOKIE_SECURE", "yes") == "yes",
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=480,
    MAX_CONTENT_LENGTH=1024 * 1024,
)


class PrefixMiddleware:
    def __init__(self, app, prefix=''):
        self.app = app
        self.prefix = prefix.rstrip('/')

    def __call__(self, environ, start_response):
        if environ.get('attendance.prefix_applied') or not self.prefix:
            return self.app(environ, start_response)
        path = environ.get('PATH_INFO', '')
        lower_path = path.lower()
        lower_prefix = self.prefix.lower()
        matched = None
        if lower_path == lower_prefix:
            matched = self.prefix
        elif lower_path.startswith(lower_prefix + '/'):
            matched = path[:len(self.prefix)]
        if matched is None:
            return self.app(environ, start_response)
        suffix = path[len(matched):]
        environ['PATH_INFO'] = suffix or '/'
        script_name = environ.get('SCRIPT_NAME', '').rstrip('/')
        if not (script_name.lower() == lower_prefix or script_name.lower().endswith(lower_prefix + '/')):
            script_name += matched
        environ['SCRIPT_NAME'] = script_name or '/'
        environ['attendance.prefix_applied'] = True
        return self.app(environ, start_response)


class LocalProxyMiddleware:
    def __init__(self, app):
        self.app = app

    def __call__(self, environ, start_response):
        remote_addr = environ.get('REMOTE_ADDR', '')
        try:
            address = ipaddress.ip_address(remote_addr)
            if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
                address = address.ipv4_mapped
            trusted = address.is_loopback
        except ValueError:
            trusted = False
        if not trusted:
            environ.pop('HTTP_X_FORWARDED_FOR', None)
            environ.pop('HTTP_X_FORWARDED_PROTO', None)
        return self.app(environ, start_response)


app.wsgi_app = PrefixMiddleware(app.wsgi_app, prefix='/UA')
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=0, x_port=0, x_prefix=0)
app.wsgi_app = LocalProxyMiddleware(app.wsgi_app)

USERS_FILE = os.path.join(BASE_DIR, "users.json")
BACKUP_DIR = config_value("BACKUP_DIR", r"C:\Backups")

LOGIN_ATTEMPTS = {}
LOGIN_LOCK = threading.Lock()
MAX_LOGIN_ATTEMPTS = 5
LOGIN_BLOCK_SECONDS = 15 * 60

def check_password(stored, given):
    if not stored:
        return False
    if stored.startswith(("pbkdf2:", "scrypt:")):
        return check_password_hash(stored, given)
    return stored == given

def hash_password(password):
    return generate_password_hash(password)

def get_client_ip():
    return request.remote_addr or "unknown"

def get_login_retry_after(client_ip):
    now = time.time()
    with LOGIN_LOCK:
        state = LOGIN_ATTEMPTS.get(client_ip)
        if not state:
            return 0
        blocked_until = state.get("blocked_until")
        if blocked_until is None:
            return 0
        if blocked_until <= now:
            LOGIN_ATTEMPTS.pop(client_ip, None)
            return 0
        return int(blocked_until - now) + 1

def record_login_failure(client_ip):
    now = time.time()
    with LOGIN_LOCK:
        state = LOGIN_ATTEMPTS.setdefault(client_ip, {"count": 0})
        state["count"] += 1
        if state["count"] >= MAX_LOGIN_ATTEMPTS:
            state["blocked_until"] = now + LOGIN_BLOCK_SECONDS
            return int(LOGIN_BLOCK_SECONDS)
        return 0

def reset_login_attempts(client_ip):
    with LOGIN_LOCK:
        LOGIN_ATTEMPTS.pop(client_ip, None)

LOG_TABLES = ["DeviceLogs_8_2026", "DeviceLogs_08_2026", "DeviceLogs_7_2026", "DeviceLogs_07_2026", "DeviceLogs"]

ONLINE_WINDOW_SECONDS = 30 * 60

LIVE_CACHES = {}
USER_CACHE = None
USERS_LOCK = threading.Lock()
SYNC_STATS = {"last_sync": "--", "table": "--", "per_device_logs": {}, "error": None, "manual": False}

LOCATIONS = {
    23: {"name": "UA_Theevattipatti", "location": "Theevattipatti", "serial": "JNP2262000588"},
    24: {"name": "UA_Sipcot", "location": "Sipcot", "serial": "JNP2262000593"},
    25: {"name": "UA_head_lab", "location": "Salem Head", "serial": "NFZ8240403160"},
    42: {"name": "UA_NAMAKKAL", "location": "Namakkal", "serial": "CEXJ232161147"},
    58: {"name": "UA_Neikarapatti", "location": "Neikarapatti", "serial": "JNP2262000589"},
    59: {"name": "UA_HEAD_OFFICE", "location": "Salem", "serial": "CEXJ224862554"},
}

# NSRL Lab (25): ignore weekly off / permission rules and late detection —
# only in/out total working hours are computed for this device. UAI HEAD
# OFFICE (59) uses the full shift classification (late, permission, half-day)
# with per-employee shift windows.
SIMPLE_MODE_DEVICES = set()

# UAI HEAD OFFICE (59): members who actually work on declared weekly-off/holiday
# days (e.g. Sundays, Independence Day) still get their work time counted.
WORKED_RULE_DEVICES = {59, 25, 58, 24, 23, 42}

# Devices whose per-day shift label is driven by the roster schedule (shift rules)
# rather than by punch-time auto-detection. On these devices the scheduled shift
# (A/B/C/G from the roster) is authoritative and is NOT overridden by punches.
ROSTER_SHIFT_DEVICES = {42}

def refresh_device_names():
    """Sync LOCATIONS display names from the ESSL Devices table (matched by SerialNumber)."""
    try:
        conn = pyodbc.connect(DB_CONFIG)
        cursor = conn.cursor()
        cursor.execute("SELECT SerialNumber, DeviceFName FROM Devices WHERE SerialNumber IS NOT NULL AND LEN(SerialNumber) > 0")
        sn_name = {}
        for r in cursor.fetchall():
            sn_name[str(r[0]).strip()] = str(r[1]).strip()
        conn.close()
        for dev_id, info in LOCATIONS.items():
            sn = info.get("serial")
            if sn and sn in sn_name:
                info["name"] = sn_name[sn]
    except Exception:
        pass


_LOG_TABLES_TS = 0.0

def refresh_log_tables(force=False):
    """Keep LOG_TABLES current with the real DeviceLogs_* monthly tables so
    live sync, analytics and monthly views stay accurate when the month rolls
    over (throttled to once per 30s unless force=True)."""
    global LOG_TABLES, _LOG_TABLES_TS
    t = time.time()
    if not force and (t - _LOG_TABLES_TS) < 30:
        return
    try:
        conn = pyodbc.connect(DB_CONFIG)
        cur = conn.cursor()
        cur.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'DeviceLogs[_]%'")
        tables = [str(r[0]) for r in cur.fetchall()]
        conn.close()
        best = []
        for tb in tables:
            m = re.match(r"^DeviceLogs_(\d{1,2})_(\d{4})$", tb)
            if m:
                best.append(((int(m.group(2)), int(m.group(1))), tb))
        best.sort(key=lambda x: x[0], reverse=True)
        now = datetime.now()
        want = ("DeviceLogs_%d_%d" % (now.month, now.year), "DeviceLogs_%02d_%d" % (now.month, now.year))
        named = [tb for tb in tables if tb in want]
        ordered = named + [tb for (_k, tb) in best if tb not in named]
        if "DeviceLogs" in tables and "DeviceLogs" not in ordered:
            ordered.append("DeviceLogs")
        if ordered:
            LOG_TABLES = ordered
            _LOG_TABLES_TS = t
    except Exception:
        pass

refresh_device_names()
refresh_log_tables(force=True)

def load_users():
    global USER_CACHE
    with USERS_LOCK:
        if os.path.exists(USERS_FILE):
            with open(USERS_FILE, "r") as f:
                USER_CACHE = json.load(f)
        else:
            USER_CACHE = {}
    return USER_CACHE

def save_users(users):
    with USERS_LOCK:
        with open(USERS_FILE, "w") as f:
            json.dump(users, f, indent=2)
        global USER_CACHE
        USER_CACHE = dict(users)

load_users()

ADMIN_API_ENDPOINTS = {
    "api_server_health",
    "api_analytics",
    "api_ai_insights",
    "api_day",
    "api_chat",
    "api_ai_query",
    "api_ml_profiles",
    "api_ai_facts",
    "api_roster_list",
    "api_users",
    "api_delete_user",
    "api_update_user",
    "api_rules_set",
    "api_rules_delete",
    "api_admin_employee",
    "api_admin_employees",
    "api_admin_employee_lookup",
    "api_admin_employee_lookup_code",
    "api_admin_employee_delete",
    "api_roster_upsert",
    "api_roster_delete",
    "api_roster_seed",
    "api_schedule_set",
    "api_admin_pool",
    "api_admin_pool_restart",
    "api_backup",
    "api_backup_tables",
    "api_backup_download",
    "api_backup_create",
}
MANAGER_DEVICE_ENDPOINTS = {
    "api_employee_monthly",
    "api_schedule_get",
    "api_rules_get",
    "api_monthly_summary",
    "api_roster_list",
}


def current_api_user():
    username = session.get("user")
    if not username:
        return None, None
    user_data = load_users().get(username)
    if not user_data:
        session.clear()
        return None, None
    if int(session.get("auth_version", 0)) != int(user_data.get("auth_version", 0)):
        session.clear()
        return None, None
    auth = {
        "username": username,
        "role": user_data.get("role", "manager"),
        "device_id": user_data.get("device_id"),
        "label": user_data.get("label", username),
    }
    return auth, None


@app.before_request
def authenticate_api_request():
    if request.path == "/backup":
        auth, _unused = current_api_user()
        if not auth:
            return jsonify({"error": "Not found"}), 404
        if auth.get("role") not in ("admin", "superadmin"):
            return jsonify({"error": "Forbidden"}), 403
        return None
    if not request.path.startswith("/api"):
        return None
    if request.path == "/api/login" and request.endpoint == "api_login":
        return None
    if request.endpoint == "serve_frontend":
        return jsonify({"error": "Not found"}), 404
    auth, _unused = current_api_user()
    if not auth:
        return jsonify({"error": "Unauthorized"}), 401
    if request.endpoint in ADMIN_API_ENDPOINTS and auth.get("role") not in ("admin", "superadmin"):
        return jsonify({"error": "Forbidden"}), 403
    if auth.get("role") == "manager" and request.endpoint in MANAGER_DEVICE_ENDPOINTS | {"api_live"}:
        requested = request.view_args.get("device_id") if request.view_args else None
        if requested is None:
            requested = request.args.get("device_id")
        assigned = auth.get("device_id")
        if requested is None or not assigned:
            return jsonify({"error": "Assigned device required"}), 403
        try:
            if int(requested) != int(assigned):
                return jsonify({"error": "Forbidden"}), 403
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid device_id"}), 400
    g.api_auth = auth
    return None


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth, _unused = current_api_user()
        if not auth:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated

def role_required(*roles):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            auth, _unused = current_api_user()
            if not auth or auth.get("role") not in roles:
                return redirect(url_for("login"))
            return f(*args, **kwargs)
        return decorated
    return decorator

def run_sync_once(manual=False):
    try:
        refresh_device_names()
        refresh_log_tables()
        today = date.today()
        today_str = today.strftime("%Y-%m-%d")
        device_ids = list(LOCATIONS.keys())

        conn = pyodbc.connect(DB_CONFIG)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT EmployeeCode, EmployeeCodeInDevice, EmployeeName, DeviceId
            FROM Employees
            ORDER BY CAST(EmployeeCode AS INT)
        """)
        all_emps = cursor.fetchall()

        emp_map = {}
        badge_map = {}
        for r in all_emps:
            code = str(r[0]).strip()
            badge = str(r[1]).strip() if r[1] and str(r[1]).strip() else code
            name = str(r[2]).strip() if r[2] and str(r[2]).strip() else f"Employee {badge}"
            dev_id = r[3]
            emp_map[code] = {"name": name, "device_id": dev_id, "badge": badge}
            badge_map[badge] = {"name": name, "device_id": dev_id}

        device_emps = {}
        try:
            placeholders = ",".join("?" for _ in device_ids)
            cursor.execute(f"""
                SELECT du.DeviceId, e.EmployeeCodeInDevice, e.EmployeeCode, e.EmployeeName
                FROM DeviceUsers du
                LEFT JOIN Employees e ON du.EmployeeId = e.EmployeeId
                WHERE du.DeviceId IN ({placeholders})
            """, device_ids)
            for r in cursor.fetchall():
                dev = r[0]
                badge = str(r[1]).strip() if r[1] is not None and str(r[1]).strip() else (str(r[2]).strip() if r[2] is not None else "")
                name = str(r[3]).strip() if r[3] and str(r[3]).strip() else f"Employee {badge}"
                if dev in LOCATIONS and badge:
                    device_emps.setdefault(dev, {})[badge] = name
        except pyodbc.Error:
            pass

        logs_by_device = {}
        device_latest_by_dev = {}

        for dev_id in device_ids:
            logs_by_device[dev_id] = []
            device_latest_by_dev[dev_id] = None

        last_ping_by_dev = {}
        try:
            placeholders = ",".join("?" for _ in device_ids)
            cursor.execute(f"SELECT DeviceId, LastPing FROM Devices WHERE DeviceId IN ({placeholders})", device_ids)
            for r in cursor.fetchall():
                last_ping_by_dev[r[0]] = r[1]
        except pyodbc.Error:
            pass

        used_table = None
        all_logs = []
        for table in LOG_TABLES:
            try:
                placeholders = ",".join("?" for _ in device_ids)
                cursor.execute(f"""
                    SELECT UserId, LogDate, C1, DeviceId
                    FROM {table}
                    WHERE DeviceId IN ({placeholders}) AND CONVERT(date, LogDate) = ?
                    ORDER BY LogDate ASC
                """, device_ids + [today_str])
                all_logs = cursor.fetchall()
                used_table = table
                break
            except pyodbc.Error:
                continue

        for row in all_logs:
            uid = str(row[0]).strip()
            punch_time = row[1]
            direction = str(row[2]).strip().lower() if row[2] else ""
            dev_id = row[3]
            if dev_id in logs_by_device:
                logs_by_device[dev_id].append({"uid": uid, "time": punch_time, "dir": direction})
            if device_latest_by_dev.get(dev_id) is None or punch_time > device_latest_by_dev[dev_id]:
                device_latest_by_dev[dev_id] = punch_time

        per_device_logs = {}
        for dev_id in device_ids:
            per_device_logs[str(dev_id)] = len(logs_by_device[dev_id])
            punch_users = set()
            for log in logs_by_device[dev_id]:
                punch_users.add(log["uid"])

            enrolled = list(device_emps.get(dev_id, {}).keys())
            assigned = [e["badge"] for e in emp_map.values() if e["device_id"] == dev_id and e["badge"]]
            known = set(enrolled) | set(assigned)
            relevant = list(dict.fromkeys(enrolled + assigned + [u for u in punch_users if u in known]))
            if not relevant:
                relevant = enrolled or assigned

            employees = {}
            for uid in relevant:
                if uid in device_emps.get(dev_id, {}):
                    name = device_emps[dev_id][uid]
                elif uid in badge_map and badge_map[uid]["device_id"] == dev_id:
                    name = badge_map[uid]["name"]
                else:
                    name = f"Employee {uid}"
                employees[uid] = {"name": name, "punches": [], "status": "Absent", "last_punch": "--:--:--"}

            for log in logs_by_device[dev_id]:
                if log["uid"] in employees:
                    employees[log["uid"]]["punches"].append({"time": log["time"], "dir": log["dir"]})

            for uid, emp in employees.items():
                if emp["punches"]:
                    raw_punches = emp["punches"]
                    punches = _dedup_punch_records(raw_punches)
                    punches = _drop_stray_out(punches)
                    if _face_id_test_window(datetime.now().date()):
                        punches = _keep_only_punch_in(punches)
                    emp["punches"] = punches
                    last = punches[-1]
                    # If punches count is even (e.g. 2, 4), the last punch is an OUT (Logout)
                    # If punches count is odd (e.g. 1, 3), the last punch is an IN (Working)
                    is_even_punches = (len(punches) % 2 == 0)
                    is_still_in = not is_even_punches
                    if is_still_in:
                        # Odd punch (1st/3rd/... = IN) means still working: only the
                        # First Punch is set, Last Punch stays empty until the OUT lands.
                        emp["status"] = "Present"
                        emp["last_punch"] = ""
                        emp["last_punch_raw"] = ""
                    else:
                        # Even punch (2nd/4th/... = OUT) completes the pair: Last Punch = OUT.
                        emp["status"] = "Absent"
                        emp["last_punch"] = last["time"].strftime("%I:%M:%S %p") if last else ""
                        emp["last_punch_raw"] = last["time"].isoformat() if last else ""
                    emp["punch_times"] = [p["time"].strftime("%I:%M:%S %p") for p in punches]
                    emp["punch_dirs"] = ["IN" if i % 2 == 0 else "OUT" for i in range(len(punches))]
                else:
                    emp["last_punch"] = ""
                    emp["last_punch_raw"] = ""
                    emp["punch_times"] = []
                    emp["punch_dirs"] = []

            present = sum(1 for e in employees.values() if e["status"] == "Present")
            absent = sum(1 for e in employees.values() if e["status"] == "Absent")
            sorted_emps = sorted(employees.items(), key=lambda x: int(x[0]) if x[0].isdigit() else x[0])

            dev_info = LOCATIONS.get(dev_id, {"name": f"Device {dev_id}", "location": ""})
            last_punch = device_latest_by_dev.get(dev_id)
            last_ping = last_ping_by_dev.get(dev_id)
            now = datetime.now()
            online = (
                last_ping is not None
                and last_ping.year > 2000
                and (now - last_ping).total_seconds() <= ONLINE_WINDOW_SECONDS
            )

            LIVE_CACHES[dev_id] = {
                "present": present,
                "absent": absent,
                "employees": {uid: {"name": e["name"], "status": e["status"], "last_punch": e["last_punch"], "last_punch_raw": e.get("last_punch_raw", ""), "punch_times": e.get("punch_times",[]), "punch_dirs": e.get("punch_dirs",[])} for uid, e in employees.items()},
                "employees_sorted": [{"uid": uid, "name": e["name"], "status": e["status"], "last_punch": e["last_punch"], "last_punch_raw": e.get("last_punch_raw", ""), "punch_times": e.get("punch_times",[]), "punch_dirs": e.get("punch_dirs",[])} for uid, e in sorted_emps],
                "device_status": {
                    "name": dev_info["name"],
                    "location": dev_info["location"],
                    "last_punch": last_punch.strftime("%Y-%m-%d %I:%M:%S %p") if last_punch else "--",
                    "last_ping": last_ping.strftime("%Y-%m-%d %I:%M:%S %p") if last_ping and last_ping.year > 2000 else "--",
                    "status": "Online" if online else "Offline",
                },
                "last_updated": datetime.now().strftime("%I:%M:%S %p"),
            }

        SYNC_STATS["last_sync"] = datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")
        SYNC_STATS["table"] = used_table or "none"
        SYNC_STATS["per_device_logs"] = per_device_logs
        SYNC_STATS["error"] = None
        SYNC_STATS["manual"] = manual
        conn.close()
        return SYNC_STATS

    except Exception as e:
        print(f"Sync error: {e}")
        SYNC_STATS["error"] = str(e)
        SYNC_STATS["last_sync"] = datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")
        return SYNC_STATS

def database_sync_worker():
    while True:
        run_sync_once()
        time.sleep(3)

LOGIN_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>UA Attendance - Login</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
        }
        .login-box {
            background: #ffffff; border-radius: 16px; padding: 40px; width: 400px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .login-title { font-size: 1.8rem; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
        .login-sub { color: #64748b; font-size: 0.85rem; margin-bottom: 24px; }
        .form-group { margin-bottom: 16px; }
        label { display: block; font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 6px; }
        input {
            width: 100%; padding: 12px 14px; border: 1.5px solid #e2e8f0; border-radius: 8px;
            font-size: 0.95rem; outline: none; transition: border 0.2s;
        }
        input:focus { border-color: #3b82f6; }
        .btn {
            width: 100%; padding: 12px; background: #2563eb; color: white; border: none;
            border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer;
        }
        .btn:hover { background: #1d4ed8; }
        .error { background: #fef2f2; color: #dc2626; padding: 10px; border-radius: 6px; font-size: 0.85rem; margin-bottom: 16px; }
    </style>
</head>
<body>
    <div class="login-box">
        <div class="login-title">UA Attendance</div>
        <div class="login-sub">Sign in with your credentials</div>
        {% if error %}
        <div class="error">{{ error }}</div>
        {% endif %}
        <form method="POST">
            <div class="form-group">
                <label>Username</label>
                <input type="text" name="username" placeholder="Enter username" required>
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="text" name="password" placeholder="Enter password" required>
            </div>
            <button type="submit" class="btn">Sign In</button>
            <div style="text-align:center;margin-top:16px;font-size:0.8rem;">
                <a href="#" onclick="alert('Contact your administrator to reset your password.');return false;" style="color:#64748b;text-decoration:none;">Forgot Password?</a>
            </div>
        </form>
    </div>
</body>
</html>
"""

DASHBOARD_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>{{ location.name }} - Live Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100vw; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; overflow-x: hidden; }
        body { display: flex; flex-direction: column; }
        .top-bar { display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 10px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
        .top-bar h1 { font-size: 1.1rem; color: #0f172a; }
        .top-bar h1 span { color: #2563eb; }
        .top-right { display: flex; align-items: center; gap: 12px; }
        .top-right .update-time { color: #64748b; font-size: 0.7rem; }
        .user-label { font-size: 0.75rem; color: #64748b; background: #f1f5f9; padding: 4px 10px; border-radius: 4px; }
        .logout-btn { padding: 5px 12px; background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; border-radius: 5px; font-size: 0.75rem; cursor: pointer; text-decoration: none; font-weight: 500; }
        .logout-btn:hover { background: #e2e8f0; }
        .main { padding: 10px 20px 20px; flex: 1; display: flex; flex-direction: column; gap: 10px; }
        .stats-row { display: flex; gap: 10px; }
        .stat-card { flex: 1; background: #ffffff; border-radius: 8px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-left: 4px solid; }
        .stat-card .num { font-size: 1.8rem; font-weight: 700; margin-top: 2px; }
        .stat-card .label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .stat-present { border-left-color: #10b981; } .stat-present .num { color: #10b981; } .stat-present .label { color: #059669; }
        .stat-absent { border-left-color: #ef4444; } .stat-absent .num { color: #ef4444; } .stat-absent .label { color: #dc2626; }
        .device-card { background: #ffffff; border-radius: 8px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
        .device-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .dev-item .dev-label { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        .dev-item .dev-value { font-size: 0.85rem; font-weight: 600; color: #0f172a; margin-top: 1px; }
        .dev-item .status-badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 0.7rem; font-weight: 600; }
        .status-online { background: #d1fae5; color: #059669; } .status-offline { background: #fee2e2; color: #dc2626; }
        .emp-section { flex: 1; display: flex; flex-direction: column; }
        .emp-table-wrap { background: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); overflow: auto; flex: 1; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f8fafc; color: #64748b; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; }
        td { padding: 6px 12px; border-bottom: 1px solid #f1f5f9; font-size: 0.8rem; color: #334155; }
        .emp-status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
        .emp-present { background: #d1fae5; color: #059669; } .emp-absent { background: #fee2e2; color: #dc2626; }
        .no-data { text-align: center; padding: 30px; color: #94a3b8; }
        .search-bar { margin-bottom: 8px; }
        .search-bar input { width: 100%; padding: 8px 12px; border: 1.5px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem; outline: none; }
        .search-bar input:focus { border-color: #3b82f6; }
        .punch-detail { font-size: 0.7rem; color: #64748b; margin-top: 4px; }
        .punch-detail span { display: inline-block; margin-right: 8px; }
        .row-toggle { cursor: pointer; user-select: none; }
        .row-toggle:hover { background: #f8fafc; }
        .punch-row { display: none; }
        .punch-row.show { display: table-row; }
        .punch-row td { background: #f8fafc; padding: 6px 12px 6px 40px; }
        .punch-chip { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 600; margin: 1px 3px; }
        .punch-in { background: #d1fae5; color: #059669; }
        .punch-out { background: #fef3c7; color: #d97706; }
        .badge-count { font-size: 0.65rem; color: #94a3b8; margin-left: 4px; }
        .arrow { font-size: 0.7rem; color: #94a3b8; margin-right: 6px; transition: transform 0.2s; display: inline-block; }
        .arrow.open { transform: rotate(90deg); }
    </style>
</head>
<body>
    <div class="top-bar">
        <h1>{{ location.name }} <span>Live Dashboard</span></h1>
        <div class="top-right">
            <span class="user-label">{{ user_label }}</span>
            <span class="update-time">Updated: <span id="update-time">{{ data.last_updated }}</span></span>
            {% if is_admin %}<a href="{{ url_for('admin_panel') }}" class="logout-btn">Admin</a>{% endif %}
            <a href="{{ url_for('logout') }}" class="logout-btn">Logout</a>
        </div>
    </div>
    <div class="main">
        <div class="stats-row">
            <div class="stat-card stat-present"><div class="label">Present</div><div class="num" id="present-count">{{ data.present }}</div></div>
            <div class="stat-card stat-absent"><div class="label">Absent</div><div class="num" id="absent-count">{{ data.absent }}</div></div>
        </div>
        <div class="device-card">
            <div class="device-grid">
                <div class="dev-item"><div class="dev-label">Device</div><div class="dev-value">{{ data.device_status.name }}</div></div>
                <div class="dev-item"><div class="dev-label">Location</div><div class="dev-value">{{ data.device_status.location }}</div></div>
                <div class="dev-item"><div class="dev-label">Last Punch</div><div class="dev-value" id="device-last-punch">{{ data.device_status.last_punch }}</div></div>
                <div class="dev-item"><div class="dev-label">Status</div><div class="dev-value"><span class="status-badge {{ 'status-online' if data.device_status.status == 'Online' else 'status-offline' }}" id="device-status">{{ data.device_status.status }}</span></div></div>
            </div>
        </div>
        <div class="emp-section">
            <div class="search-bar">
                <input type="text" id="search-input" placeholder="Search by name or ID..." oninput="filterEmployees()">
            </div>
            <div class="emp-table-wrap">
                <table>
                    <thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Punches</th><th>Last Punch</th></tr></thead>
                    <tbody id="emp-tbody">
                        {% if data.employees_sorted %}
                            {% for emp in data.employees_sorted %}
                            <tr class="emp-row" data-name="{{ emp.name|lower }}" data-id="{{ emp.uid.zfill(4) }}">
                                <td>{{ emp.uid.zfill(4) }}</td>
                                <td>{{ emp.name }}</td>
                                <td><span class="emp-status {{ 'emp-present' if emp.status == 'Present' else 'emp-absent' }}">{{ emp.status }}</span></td>
                                <td><span class="row-toggle" onclick="togglePunches('{{ emp.uid }}')"><span class="arrow" id="arrow-{{ emp.uid }}">&#9654;</span>{{ emp.punch_times|length }} punches</span></td>
                                <td>{{ emp.last_punch }}</td>
                            </tr>
                            <tr class="punch-row" id="punch-row-{{ emp.uid }}">
                                <td colspan="5">
                                    {% if emp.punch_times %}
                                        {% for i in range(emp.punch_times|length) %}
                                        <span class="punch-chip {{ 'punch-in' if emp.punch_dirs[i] == 'IN' else 'punch-out' }}">{{ emp.punch_times[i] }} {{ emp.punch_dirs[i] }}</span>
                                        {% endfor %}
                                    {% else %}
                                        <span style="color:#94a3b8;font-size:0.75rem">No punches today</span>
                                    {% endif %}
                                </td>
                            </tr>
                            {% endfor %}
                        {% else %}
                            <tr><td colspan="5" class="no-data">No data</td></tr>
                        {% endif %}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    <script>
        let apiUrl = '{{ url_for("api_data") }}';

        function togglePunches(uid) {
            let row = document.getElementById('punch-row-' + uid);
            let arrow = document.getElementById('arrow-' + uid);
            if (row) {
                row.classList.toggle('show');
                if (arrow) arrow.classList.toggle('open');
            }
        }

        function filterEmployees() {
            let q = document.getElementById('search-input').value.toLowerCase();
            let rows = document.querySelectorAll('.emp-row');
            rows.forEach(row => {
                let name = row.getAttribute('data-name') || '';
                let id = row.getAttribute('data-id') || '';
                if (name.includes(q) || id.includes(q)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        }

        async function refresh() {
            try {
                let r = await fetch(apiUrl);
                let d = await r.json();
                document.getElementById('present-count').innerText = d.present;
                document.getElementById('absent-count').innerText = d.absent;
                document.getElementById('update-time').innerText = d.last_updated;
                document.getElementById('device-last-punch').innerText = d.device_status.last_punch;
                let ds = document.getElementById('device-status');
                ds.innerText = d.device_status.status;
                ds.className = 'status-badge ' + (d.device_status.status === 'Online' ? 'status-online' : 'status-offline');

                let tbody = document.getElementById('emp-tbody');
                let html = '';
                let keys = Object.keys(d.employees).sort();
                keys.forEach(uid => {
                    let emp = d.employees[uid];
                    let sc = emp.status === 'Present' ? 'emp-present' : 'emp-absent';
                    let punchesHtml = '';
                    if (emp.punch_times && emp.punch_times.length > 0) {
                        for (let i = 0; i < emp.punch_times.length; i++) {
                            let dir = (emp.punch_dirs && emp.punch_dirs[i]) || '---';
                            let cls = dir === 'IN' ? 'punch-in' : 'punch-out';
                            punchesHtml += '<span class="punch-chip ' + cls + '">' + emp.punch_times[i] + ' ' + dir + '</span>';
                        }
                    } else {
                        punchesHtml = '<span style="color:#94a3b8;font-size:0.75rem">No punches today</span>';
                    }
                    let punchCount = (emp.punch_times && emp.punch_times.length) || 0;
                    html += '<tr class="emp-row" data-name="' + emp.name.toLowerCase() + '" data-id="' + uid.padStart(4, '0') + '">';
                    html += '<td>' + uid.padStart(4, '0') + '</td>';
                    html += '<td>' + emp.name + '</td>';
                    html += '<td><span class="emp-status ' + sc + '">' + emp.status + '</span></td>';
                    html += '<td><span class="row-toggle" onclick="togglePunches(\'' + uid + '\')"><span class="arrow" id="arrow-' + uid + '">&#9654;</span>' + punchCount + ' punches</span></td>';
                    html += '<td>' + emp.last_punch + '</td></tr>';
                    html += '<tr class="punch-row" id="punch-row-' + uid + '"><td colspan="5">' + punchesHtml + '</td></tr>';
                });
                tbody.innerHTML = html || '<tr><td colspan="5" class="no-data">No data</td></tr>';
                filterEmployees();
            } catch(e) { console.log('refresh error', e); }
        }
        refresh();
        setInterval(refresh, 3000);
    </script>
</body>
</html>
"""

ADMIN_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>{{ title }}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .header h1 { font-size: 1.3rem; color: #0f172a; }
        .header h1 span { color: #2563eb; }
        .card { background: #ffffff; border-radius: 10px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 20px; }
        .card h2 { font-size: 1rem; color: #0f172a; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f8fafc; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 14px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        td { padding: 8px 14px; border-bottom: 1px solid #f1f5f9; font-size: 0.85rem; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
        .badge-admin { background: #dbeafe; color: #2563eb; }
        .badge-manager { background: #d1fae5; color: #059669; }
        .badge-super { background: #fef3c7; color: #d97706; }
        .btn { padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; font-weight: 500; cursor: pointer; text-decoration: none; display: inline-block; border: none; }
        .btn-primary { background: #2563eb; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-sm { padding: 4px 10px; font-size: 0.75rem; }
        .btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
        .form-row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
        .form-group { margin-bottom: 10px; }
        .form-group label { display: block; font-size: 0.8rem; font-weight: 600; color: #334155; margin-bottom: 4px; }
        .form-group input, .form-group select { padding: 8px 12px; border: 1.5px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem; outline: none; }
        .form-group input:focus, .form-group select:focus { border-color: #3b82f6; }
        .success { background: #d1fae5; color: #059669; padding: 10px; border-radius: 6px; font-size: 0.85rem; margin-bottom: 12px; }
        .error-msg { background: #fee2e2; color: #dc2626; padding: 10px; border-radius: 6px; font-size: 0.85rem; margin-bottom: 12px; }
        .nav-links { display: flex; gap: 8px; }
        .empty { color: #94a3b8; text-align: center; padding: 20px; font-size: 0.85rem; }
    </style>
</head>
<body>
    <div class="header">
        <h1>{{ title }} <span>Management</span></h1>
        <div class="nav-links">
            {% if is_super %}<a href="{{ url_for('super_admin') }}" class="btn btn-secondary btn-sm">All Locations</a>{% endif %}
            <a href="{{ url_for('dashboard_view') }}" class="btn btn-secondary btn-sm">Dashboard</a>
            <a href="{{ url_for('logout') }}" class="btn btn-secondary btn-sm">Logout</a>
        </div>
    </div>

    {% if msg %}
    <div class="{{ 'success' if msg_type == 'success' else 'error-msg' }}">{{ msg }}</div>
    {% endif %}

    <div class="card">
        <h2>Add Manager</h2>
        <form method="POST">
            <div class="form-row">
                <div class="form-group">
                    <label>Username</label>
                    <input type="text" name="new_username" placeholder="manager_username" required>
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="text" name="new_password" placeholder="password" required>
                </div>
                <div class="form-group">
                    <label>Label</label>
                    <input type="text" name="new_label" placeholder="Manager - Location" required>
                </div>
                {% if is_super %}
                <div class="form-group">
                    <label>Device</label>
                    <select name="new_device_id">
                        {% for did, loc in locations.items() %}
                        <option value="{{ did }}">{{ loc.name }} ({{ loc.location }})</option>
                        {% endfor %}
                    </select>
                </div>
                <div class="form-group">
                    <label>Role</label>
                    <select name="new_role">
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                    </select>
                </div>
                {% endif %}
                <div class="form-group">
                    <button type="submit" class="btn btn-primary">Add User</button>
                </div>
            </div>
        </form>
    </div>

    <div class="card">
        <h2>Users at {{ location_name }}</h2>
        <table>
            <thead><tr><th>Username</th><th>Label</th><th>Role</th><th>Device</th><th>Action</th></tr></thead>
            <tbody>
                {% for u, data in users_list %}
                <tr>
                    <td>{{ u }}</td>
                    <td>{{ data.label }}</td>
                    <td><span class="badge badge-{{ data.role }}">{{ data.role }}</span></td>
                    <td>{{ data.device_id or '-' }}</td>
                    <td>
                        {% if data.role != 'superadmin' and u != session_username %}
                        <form method="POST" action="{{ url_for('delete_user') }}" style="display:inline" onsubmit="return confirm('Delete {{ u }}?')">
                            <input type="hidden" name="username" value="{{ u }}">
                            <button type="submit" class="btn btn-danger btn-sm">Delete</button>
                        </form>
                        {% endif %}
                    </td>
                </tr>
                {% else %}
                <tr><td colspan="5" class="empty">No users found</td></tr>
                {% endfor %}
            </tbody>
        </table>
    </div>
</body>
</html>
"""

FRONTEND_DIR = config_value("FRONTEND_DIR", os.path.join(BASE_DIR, "dist"))

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path.startswith("UA/"):
        path = path[3:]
    full = os.path.join(FRONTEND_DIR, path)
    if path and os.path.isfile(full):
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if "user" in session:
        return redirect(url_for("dashboard_view"))
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        client_ip = get_client_ip()
        retry_after = get_login_retry_after(client_ip)
        if retry_after:
            return render_template_string(
                LOGIN_PAGE,
                error=f"Too many login attempts. Try again in {retry_after} seconds.",
            ), 429, {"Retry-After": str(retry_after)}
        users = load_users()
        user_data = users.get(username)
        if user_data and check_password(user_data.get("password"), password):
            reset_login_attempts(client_ip)
            session.clear()
            session.permanent = True
            session["user"] = username
            session["auth_version"] = int(user_data.get("auth_version", 0))
            return redirect(url_for("dashboard_view"))
        retry_after = record_login_failure(client_ip)
        error = "Invalid username or password"
        if retry_after:
            error += f" Try again in {retry_after} seconds."
    return render_template_string(LOGIN_PAGE, error=error)

@app.route("/dashboard")
@login_required
def dashboard_view():
    users = load_users()
    user_data = users.get(session["user"], {})
    role = user_data.get("role")

    if role == "superadmin":
        return redirect(url_for("super_admin"))

    device_id = user_data.get("device_id")
    if not device_id:
        return redirect(url_for("logout"))
    if device_id not in LIVE_CACHES:
        LIVE_CACHES[device_id] = {"present":0,"absent":0,"employees":{},"employees_sorted":[],"device_status":{"name":LOCATIONS.get(device_id,{}).get("name","Device"),"location":LOCATIONS.get(device_id,{}).get("location",""),"last_punch":"--","status":"Offline"},"last_updated":"--"}

    data = LIVE_CACHES.get(device_id, {"present":0,"absent":0,"employees":{},"employees_sorted":[],"device_status":{"name":"...","location":"","last_punch":"--","status":"Offline"},"last_updated":"--"})
    loc = LOCATIONS.get(device_id, {"name": f"Device {device_id}", "location": device_id})
    return render_template_string(DASHBOARD_PAGE, location=loc, data=data, user_label=user_data.get("label",""), is_admin=(role=="admin" or role=="superadmin"))

@app.route("/api/data")
def api_data():
    device_id = g.api_auth.get("device_id")
    if not device_id:
        return jsonify({"present":0,"absent":0,"employees":{},"device_status":{"name":"","location":"","last_punch":"--","status":"Offline"},"last_updated":"--"})
    data = LIVE_CACHES.get(device_id, {"present":0,"absent":0,"employees":{},"device_status":{"name":"","location":"","last_punch":"--","status":"Offline"},"last_updated":"--"})
    return jsonify(data)

@app.route("/api/live/<int:device_id>")
def api_live(device_id):
    data = LIVE_CACHES.get(device_id)
    if not data:
        return jsonify({"present":0,"absent":0,"employees":[],"last_updated":"--"})
    employees_list = []
    for emp in data.get("employees_sorted", []):
        db_status = emp["status"]
        api_status = "IN" if db_status == "Present" else "OUT"
        employees_list.append({
            "id": emp["uid"].zfill(4),
            "name": emp["name"],
            "status": api_status,
            "lastPunch": emp["last_punch"],
            "lastPunchRaw": emp.get("last_punch_raw", ""),
            "punchTimes": emp.get("punch_times", []),
            "punchDirs": emp.get("punch_dirs", []),
        })
    return jsonify({
        "present": data["present"],
        "absent": data["absent"],
        "employees": employees_list,
        "deviceName": data["device_status"]["name"],
        "deviceLocation": data["device_status"]["location"],
        "deviceStatus": data["device_status"]["status"],
        "lastPunch": data["device_status"].get("last_punch", "--"),
        "lastPing": data["device_status"].get("last_ping", "--"),
        "lastUpdated": data["last_updated"],
    })

@app.route("/api/live/all")
def api_live_all():
    branches = []
    combined = []
    total_present = 0
    total_absent = 0
    now_str = datetime.now().strftime("%I:%M:%S %p")

    allowed_devices = LOCATIONS
    if g.api_auth.get("role") == "manager":
        if not g.api_auth.get("device_id"):
            return jsonify({"error": "Assigned device required"}), 403
        device_id = int(g.api_auth["device_id"])
        allowed_devices = {device_id: LOCATIONS.get(device_id, {})}
    for dev_id, info in allowed_devices.items():
        data = LIVE_CACHES.get(dev_id)
        if not data:
            branches.append({
                "device_id": dev_id,
                "name": info["name"],
                "location": info["location"],
                "present": 0,
                "absent": 0,
                "deviceStatus": "Offline",
                "lastUpdated": "--",
            })
            continue

        employees_list = []
        for emp in data.get("employees_sorted", []):
            db_status = emp["status"]
            api_status = "IN" if db_status == "Present" else "OUT"
            employees_list.append({
                "id": emp["uid"].zfill(4),
                "name": emp["name"],
                "status": api_status,
                "lastPunch": emp["last_punch"],
                "lastPunchRaw": emp.get("last_punch_raw", ""),
                "punchTimes": emp.get("punch_times", []),
                "punchDirs": emp.get("punch_dirs", []),
                "branch": info["name"],
                "location": info["location"],
                "device_id": dev_id,
            })

        branches.append({
            "device_id": dev_id,
            "name": info["name"],
            "location": info["location"],
            "present": data["present"],
            "absent": data["absent"],
            "deviceStatus": data["device_status"]["status"],
            "lastPing": data["device_status"].get("last_ping", "--"),
            "lastPunch": data["device_status"].get("last_punch", "--"),
            "lastUpdated": data["last_updated"],
        })
        total_present += data["present"]
        total_absent += data["absent"]
        combined.extend(employees_list)

    return jsonify({
        "branches": branches,
        "present": total_present,
        "absent": total_absent,
        "employees": combined,
        "lastUpdated": now_str,
    })


@app.route("/api/server/health")
def api_server_health():
    try:
        psutil_ok = False
        try:
            import psutil
            psutil_ok = True
        except Exception:
            psutil = None

        mem = {}
        cpu = None
        if psutil_ok:
            vm = psutil.virtual_memory()
            mem = {"total": round(vm.total / (1024 ** 3), 2), "available": round(vm.available / (1024 ** 3), 2),
                   "used": round(vm.used / (1024 ** 3), 2), "percent": vm.percent}
            cpu = psutil.cpu_percent(interval=0.5)

        uptime = None
        try:
            uptime = round(time.time() - psutil.boot_time()) if psutil_ok else None
        except Exception:
            pass

        cpu_cores = None
        try:
            if psutil_ok:
                cpu_cores = [round(c, 1) for c in psutil.cpu_percent(percpu=True, interval=0)]
        except Exception:
            pass

        processes = []
        try:
            if psutil_ok:
                agg = {}
                for proc in psutil.process_iter(['name', 'pid', 'memory_info', 'cpu_percent']):
                    try:
                        pin = proc.info
                        name = (pin.get('name') or '?')
                        mem_mb = round(pin.get('memory_info').rss / (1024 ** 2)) if pin.get('memory_info') else 0
                        cpu = round(pin.get('cpu_percent') or 0, 1)
                        agg.setdefault(name, {"count": 0, "mem_mb": 0, "cpu": 0.0})
                        agg[name]["count"] += 1
                        agg[name]["mem_mb"] += mem_mb
                        agg[name]["cpu"] += cpu
                    except Exception:
                        continue
                processes = [{"name": n, "count": v["count"], "mem_mb": v["mem_mb"], "cpu": round(v["cpu"], 1)}
                             for n, v in sorted(agg.items(), key=lambda kv: -kv[1]["mem_mb"])][:15]
        except Exception:
            pass

        sql = {"connected": False, "max_memory_mb": None, "last_punch": "--", "error": None}
        try:
            conn = pyodbc.connect(DB_CONFIG, timeout=3)
            cur = conn.cursor()
            cur.execute("SELECT CAST(value_in_use AS bigint) FROM sys.configurations WHERE name = 'max server memory (MB)'")
            row = cur.fetchone()
            sql["max_memory_mb"] = row[0] if row else None
            table = None
            for t in LOG_TABLES:
                try:
                    cur.execute("SELECT TOP 1 UserId, DeviceId, LogDate FROM {} ORDER BY LogDate DESC".format(t))
                    r = cur.fetchone()
                    if r:
                        table = t
                        sql["last_punch"] = r[2].strftime("%Y-%m-%d %I:%M:%S %p") if r[2] else "--"
                        break
                except pyodbc.Error:
                    continue
            sql["table"] = table
            sql["connected"] = True
            conn.close()
        except Exception as e:
            sql["connected"] = False
            sql["error"] = str(e)

        now = datetime.now()
        devices = []
        for dev_id, info in LOCATIONS.items():
            data = LIVE_CACHES.get(dev_id)
            if data:
                ds = data.get("device_status", {})
                lp = ds.get("last_punch", "--")
                devices.append({
                    "device_id": dev_id,
                    "name": info["name"],
                    "status": ds.get("status", "Offline"),
                    "present": data.get("present", 0),
                    "absent": data.get("absent", 0),
                    "last_punch": lp,
                    "last_ping": ds.get("last_ping", "--"),
                    "cache_updated": data.get("last_updated", "--"),
                })
            else:
                devices.append({"device_id": dev_id, "name": info["name"], "status": "No cache", "present": 0,
                                "absent": 0, "last_punch": "--", "last_ping": "--", "cache_updated": "--"})

        sync = SYNC_STATS.copy()
        sync["status"] = "running" if any(th.getName() == "ua-sync-worker" and th.is_alive() for th in threading.enumerate()) else "not running"

        return jsonify({
            "server_time": now.strftime("%Y-%m-%d %I:%M:%S %p"),
            "uptime": uptime,
            "cpu_percent": cpu,
            "memory": mem,
            "psutil": psutil_ok,
            "cpu_cores": cpu_cores,
            "processes": processes,
            "sql": sql,
            "sync": sync,
            "devices": devices,
            "online_count": sum(1 for d in devices if d["status"] == "Online"),
            "device_count": len(devices),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    client_ip = get_client_ip()
    retry_after = get_login_retry_after(client_ip)
    if retry_after:
        return jsonify({
            "success": False,
            "error": "Too many login attempts",
            "retry_after": retry_after,
        }), 429, {"Retry-After": str(retry_after)}
    users = load_users()
    user_data = users.get(username)
    if user_data and check_password(user_data.get("password"), password):
        reset_login_attempts(client_ip)
        session.clear()
        session.permanent = True
        session["user"] = username
        session["auth_version"] = int(user_data.get("auth_version", 0))
        return jsonify({
            "success": True,
            "username": username,
            "role": user_data.get("role", "manager"),
            "label": user_data.get("label", username),
            "device_id": user_data.get("device_id"),
        })
    retry_after = record_login_failure(client_ip)
    response = {"success": False, "error": "Invalid username or password"}
    if retry_after:
        response["retry_after"] = retry_after
        return jsonify(response), 429, {"Retry-After": str(retry_after)}
    return jsonify(response), 401

@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"success": True})

@app.route("/api/locations")
def api_locations():
    locations = LOCATIONS
    if g.api_auth.get("role") == "manager":
        if not g.api_auth.get("device_id"):
            return jsonify({"error": "Assigned device required"}), 403
        device_id = int(g.api_auth["device_id"])
        locations = {device_id: LOCATIONS.get(device_id, {})}
    return jsonify([
        {"device_id": did, "name": loc["name"], "location": loc["location"]}
        for did, loc in locations.items()
    ])

@app.route("/api/users", methods=["GET", "POST"])
def api_users():
    users = deepcopy(load_users())
    actor = g.api_auth

    if request.method == "GET":
        result = []
        for u, d in users.items():
            if d.get("role") == "superadmin":
                continue
            if actor.get("role") == "admin" and d.get("device_id") != actor.get("device_id"):
                continue
            result.append({
                "username": u,
                "role": d.get("role"),
                "label": d.get("label", ""),
                "device_id": d.get("device_id"),
                "location": d.get("location", ""),
            })
        return jsonify(result)

    data = request.get_json(force=True, silent=True) or request.form
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    label = (data.get("label") or "").strip()
    role = str(data.get("role", "manager")).strip().lower()
    try:
        device_id = int(data.get("device_id", actor.get("device_id") or 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid device_id"}), 400
    if not username or not password or not label:
        return jsonify({"error": "Missing required fields"}), 400
    if username in users:
        return jsonify({"error": "Username already exists"}), 409
    if role not in ("manager", "admin", "superadmin"):
        return jsonify({"error": "Invalid role"}), 400
    if role == "superadmin" and actor.get("role") != "superadmin":
        return jsonify({"error": "Forbidden"}), 403
    if device_id not in LOCATIONS:
        return jsonify({"error": "Unknown device_id"}), 400
    if actor.get("role") == "admin" and (role != "manager" or device_id != actor.get("device_id")):
        return jsonify({"error": "Forbidden"}), 403
    users[username] = {
        "password": hash_password(password),
        "role": role,
        "label": label,
        "device_id": device_id,
        "location": LOCATIONS.get(device_id, {}).get("location", ""),
    }
    save_users(users)
    return jsonify({"success": f"User '{username}' created as {role}"}), 201

@app.route("/api/users/<username>", methods=["DELETE"])
def api_delete_user(username):
    users = deepcopy(load_users())
    if username not in users or users[username].get("role") == "superadmin":
        return jsonify({"error": "Cannot delete this user"}), 400
    if g.api_auth.get("role") == "admin" and users[username].get("device_id") != g.api_auth.get("device_id"):
        return jsonify({"error": "Forbidden"}), 403
    del users[username]
    save_users(users)
    return jsonify({"success": f"User '{username}' deleted"})

@app.route("/api/users/<username>", methods=["PUT"])
def api_update_user(username):
    users = deepcopy(load_users())
    if username not in users:
        return jsonify({"error": "User not found"}), 404
    if users[username].get("role") == "superadmin":
        return jsonify({"error": "Cannot edit superadmin"}), 400
    actor = g.api_auth
    if actor.get("role") == "admin" and users[username].get("device_id") != actor.get("device_id"):
        return jsonify({"error": "Forbidden"}), 403
    data = request.get_json(force=True, silent=True) or {}
    if "password" in data and data["password"].strip():
        users[username]["password"] = hash_password(data["password"].strip())
        users[username]["auth_version"] = int(users[username].get("auth_version", 0)) + 1
    if "label" in data:
        users[username]["label"] = data["label"].strip()
    if "role" in data:
        role = str(data["role"]).strip().lower()
        if role not in ("manager", "admin", "superadmin"):
            return jsonify({"error": "Invalid role"}), 400
        if role == "superadmin" and actor.get("role") != "superadmin":
            return jsonify({"error": "Forbidden"}), 403
        if actor.get("role") == "admin" and role != "manager":
            return jsonify({"error": "Forbidden"}), 403
        users[username]["role"] = role
    if "device_id" in data:
        try:
            did = int(data["device_id"])
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid device_id"}), 400
        if did not in LOCATIONS:
            return jsonify({"error": "Unknown device_id"}), 400
        if actor.get("role") == "admin" and did != actor.get("device_id"):
            return jsonify({"error": "Forbidden"}), 403
        users[username]["device_id"] = did
        users[username]["location"] = LOCATIONS.get(did, {}).get("location", "")
    save_users(users)
    return jsonify({"success": f"User '{username}' updated"})

@app.route("/admin", methods=["GET", "POST"])
@login_required
@role_required("superadmin", "admin")
def admin_panel():
    users = load_users()
    user_data = users.get(session["user"], {})
    role = user_data.get("role")
    msg = None
    msg_type = None

    if role == "superadmin":
        return redirect(url_for("super_admin"))

    device_id = user_data.get("device_id")
    loc = LOCATIONS.get(device_id, {})

    if request.method == "POST":
        new_user = request.form.get("new_username", "").strip()
        new_pass = request.form.get("new_password", "").strip()
        new_label = request.form.get("new_label", "").strip()

        if new_user and new_pass and new_label:
            if new_user in users:
                msg = f"Username '{new_user}' already exists"
                msg_type = "error"
            else:
                users[new_user] = {
                    "password": hash_password(new_pass),
                    "role": "manager",
                    "label": new_label,
                    "device_id": device_id,
                    "location": loc.get("location", ""),
                }
                save_users(users)
                msg = f"Manager '{new_user}' created successfully"
                msg_type = "success"

    users_list = [(u, d) for u, d in users.items() if d.get("device_id") == device_id and d.get("role") != "superadmin"]
    return render_template_string(ADMIN_PAGE, title=f"Admin - {loc.get('name','')}", is_super=False, session_username=session["user"], users_list=users_list, locations=LOCATIONS, location_name=loc.get("name",""), msg=msg, msg_type=msg_type)

@app.route("/super-admin", methods=["GET", "POST"])
@login_required
@role_required("superadmin")
def super_admin():
    users = load_users()
    msg = None
    msg_type = None

    if request.method == "POST":
        new_user = request.form.get("new_username", "").strip()
        new_pass = request.form.get("new_password", "").strip()
        new_label = request.form.get("new_label", "").strip()
        new_role = request.form.get("new_role", "manager")
        new_dev = int(request.form.get("new_device_id", 0))

        if new_user and new_pass and new_label:
            if new_user in users:
                msg = f"Username '{new_user}' already exists"
                msg_type = "error"
            else:
                users[new_user] = {
                    "password": hash_password(new_pass),
                    "role": new_role,
                    "label": new_label,
                    "device_id": new_dev,
                    "location": LOCATIONS.get(new_dev, {}).get("location", ""),
                }
                save_users(users)
                msg = f"User '{new_user}' created as {new_role}"
                msg_type = "success"

    users_list = [(u, d) for u, d in users.items() if d.get("role") != "superadmin"]
    return render_template_string(ADMIN_PAGE, title="Super Admin", is_super=True, session_username=session["user"], users_list=users_list, locations=LOCATIONS, location_name="All Locations", msg=msg, msg_type=msg_type)

@app.route("/admin/delete", methods=["POST"])
@login_required
@role_required("superadmin", "admin")
def delete_user():
    users = load_users()
    user_data = users.get(session["user"], {})
    target = request.form.get("username", "").strip()
    if target and target in users and target != session["user"]:
        target_data = users[target]
        if user_data.get("role") == "admin":
            if target_data.get("device_id") != user_data.get("device_id"):
                return redirect(url_for("admin_panel"))
        if target_data.get("role") != "superadmin":
            del users[target]
            save_users(users)
    return redirect(url_for("admin_panel" if user_data.get("role") != "superadmin" else "super_admin"))

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

SHIFTS = {
    23: ("09:30", "18:30"),
    24: ("09:15", "18:00"),
    25: ("09:45", "18:00"),
    42: ("09:00", "18:00"),
    58: ("09:00", "19:00"),
    59: ("09:45", "18:00"),
}
DEFAULT_SHIFT = ("09:35", "18:00")

SHIFT_EXTRAS = {
    23: [("2nd", "13:00", "21:00"), ("Night", "21:00", "06:00")],
    24: [("1st", "06:00", "14:00"), ("2nd", "14:00", "22:00"), ("Night", "22:00", "06:00")],
    25: [],  # NSRL Lab extras handled per-employee (Muruganagendiran 12:00-20:30)
    42: [("1st", "06:00", "14:00"), ("2nd", "14:00", "22:00"), ("Night", "22:00", "06:00")],
    58: [("Night", "20:00", "06:00")],
    59: [],
}

# Per-employee shift overrides keyed by device_id -> {badge: (start, end)}.
# Device 59 (UAI HEAD OFFICE): Yeswini/Rajendiran get their own windows; all
# other HO staff use SHIFTS[59] = 09:45-18:00.
# Device 25 (NSRL Lab): Renuga/Narayanan/Muruganagendiran get their own windows;
# all other NSRL staff use SHIFTS[25] = 09:45-18:00.
EMPLOYEE_SHIFTS = {
    59: {
        "31": ("09:00", "17:30"),  # Yeswini
        "32": ("08:00", "19:30"),  # Rajendiran
    },
    25: {
        "11": ("09:00", "17:30"),   # Renuga
        "14": ("10:00", "18:45"),   # Narayanan
        "17": ("10:00", "18:45"),   # Shankar
        "4":  ("12:00", "20:30"),   # Muruganagendiran
    },
    42: {
        "6": ("08:00", "20:00"),   # Durairaj day/night rotation
        "5": ("08:00", "20:00"),   # Ashok day/night rotation
        "30": ("09:00", "18:00"),  # Vivek - Office
        "49": ("09:00", "18:00"),  # Kesavan - Office
        "28": ("09:00", "18:00"),  # Rajasekar - Maintenance
        "52": ("09:30", "18:00"),  # Vijayaraja - General (09:30)
        "1":  ("09:30", "18:00"),  # Diwakar - General (09:30)
        "15": ("09:30", "18:00"),  # Pradeep Kumar - General (09:30)
    },
}

# 15-minute grace period for specific employees (device_id -> {badge: minutes}):
# punching within X minutes after their shift start counts as on-time/working.
LATE_GRACE_MINUTES = {
    59: {"31": 15, "32": 15},  # Yeswini, Rajendiran
}

# Device 42 (SS SLP) yard employees: two possible shifts auto-detected from
# first punch time. If first IN punch is before 08:30 → 08:00-19:00, else 09:00-20:00.
YARD_SHIFTS = {
    42: {  # SS SLP yard employees
        "25": [("08:00", "19:00"), ("09:00", "20:00")],  # Janagaraj
        "26": [("08:00", "19:00"), ("09:00", "20:00")],  # Govindraj
        "27": [("08:00", "19:00"), ("09:00", "20:00")],  # Thiyagarajan
        "34": [("08:00", "19:00"), ("09:00", "20:00")],  # Manikandan
        "48": [("08:00", "19:00"), ("09:00", "20:00")],  # Madhankumar
    },
}

# Employees who do NOT get a lunch-break deduction (device_id -> set of badges).
NO_LUNCH_EMPLOYEES = {
    25: {"4"},  # Muruganagendiran works 12:00-20:30 with no lunch break
}

# Lunch window per device (start, end) in seconds.
LUNCH_WINDOWS = {
    58: (13 * 3600, 14 * 3600),  # UAI NKP: 1-hour lunch 13:00-14:00
    24: (13 * 3600, 14 * 3600),  # SS Sidco day shift: 1-hour lunch 13:00-14:00
    23: (13 * 3600, 14 * 3600),  # SS TVP day shift: 1-hour lunch 13:00-14:00
    42: (13 * 3600, 14 * 3600),  # SS SLP day shift: 1-hour lunch 13:00-14:00
}

# Per-device, per-employee rotation patterns for W.Off detection.
# Each pattern is a list of 7 labels starting from the rotation anchor date.
# Labels: "G", "I", "II", "III", "W.Off"
# anchor_date: the date of index 0 in the pattern.
ROTATION_ANCHOR = {42: date(2026, 8, 1)}  # August 1, 2026 = Saturday
ROTATION_PATTERNS = {
    42: {  # device_id -> badge -> pattern
        # Rotation employees (A/B/C shifts + W.Off)
        "14": ["W.Off","G","II","II","II","I","I"],       # Dhakshnamoorthi
        "42": ["III","III","I","W.Off","II","III","III"],   # Gokul Sri
        "44": ["I","I","W.Off","II","III","III","III"],     # Suganeshwar
        "53": ["II","II","III","III","I","W.Off","II"],     # Gowtham
        "45": ["II","II","II","III","III","I","W.Off"],     # Chandran
        "9":  ["III","III","III","I","W.Off","II","II"],    # Vadivelan
        # General employees (G shift + per-employee W.Off day)
        "52": ["G","W.Off","G","G","G","G","G"],           # Vijayaraja - Sun off
        "1":  ["G","W.Off","G","G","G","G","G"],           # Diwakar - Sun off
        "15": ["W.Off","G","G","G","G","G","G"],           # Pradeep Kumar - Sat off
        "17": ["G","W.Off","G","G","G","G","G"],           # Senthamil Selavan - Sun off
        "11": ["G","W.Off","G","G","G","G","G"],           # Vinayakumar - Sun off
        "13": ["G","G","W.Off","G","G","G","G"],           # Sathishkumar - Mon off
        "12": ["G","W.Off","G","G","G","G","G"],           # Gobinath - Sun off
        "41": ["G","G","W.Off","G","G","G","G"],           # Devaraj - Mon off
        "5":  ["G","W.Off","G","G","G","G","G"],           # Ashok - Sun off
        "6":  ["G","G","W.Off","G","G","G","G"],           # Durairaj - Mon off
    },
}

ANALYTICS_DAYS = 45
ANALYTICS_CACHE = {"ts": 0.0, "data": None}


def _hms(hm):
    h, m = hm.split(":")
    return int(h) * 3600 + int(m) * 60


def _merge_night_crossovers(dp, device_id):
    """Re-attach a night-shift punch that landed after midnight (real tap on the
    next calendar day, e.g. out at 03:58) to the previous day's open night
    session so the night duty stays paired with the day it started. Only fires
    when a day already has a daytime start, ends the day odd-count with an
    evening night-start, and the next day opens inside the night window.
    Mutates dp (date -> sorted punch list) in place."""
    night_end = None
    for lb, _s, e in SHIFT_EXTRAS.get(device_id, []):
        if lb == "Night":
            night_end = _hms(e)
            break
    if night_end is None or night_end >= 12 * 3600:
        return
    for k in list(dp):
        if not dp[k]:
            continue
        dp[k] = _dedup_punches(sorted(dp[k]))
    dates = sorted(dp)
    for i in range(len(dates) - 1):
        d, nxt = dates[i], dates[i + 1]
        if (nxt - d).days != 1:
            continue
        p = dp.get(d)
        q = dp.get(nxt)
        if not p or not q:
            continue
        if len(p) % 2 != 1:
            continue
        fsec = p[0].hour * 3600 + p[0].minute * 60 + p[0].second
        if fsec >= 12 * 3600:
            continue
        lsec = p[-1].hour * 3600 + p[-1].minute * 60 + p[-1].second
        if lsec < 17 * 3600:
            continue
        f2 = q[0].hour * 3600 + q[0].minute * 60 + q[0].second
        if f2 >= night_end:
            continue
        dp[d] = _dedup_punches(sorted(p + [q[0]]))
        rest = q[1:]
        if rest:
            dp[nxt] = _dedup_punches(rest)
        else:
            del dp[nxt]


def _lunch_seconds_for_device(device_id, badge=None):
    """Return the lunch window (start, end) seconds for a device. An employee in
    NO_LUNCH_EMPLOYEES (e.g. Muruganagendiran at NSRL Lab) returns (0, 0) so no
    lunch break is deducted from their worked hours."""
    if badge and device_id in NO_LUNCH_EMPLOYEES and str(badge).lstrip("0") in NO_LUNCH_EMPLOYEES[device_id]:
        return (0, 0)
    return LUNCH_WINDOWS.get(device_id, (LUNCH_START_SEC, LUNCH_END_SEC))


def _roster_shift_label(device_id, badge, day):
    """Return the shift label (G, 1st, 2nd, 3rd, Night, W.Off, etc.) for a
    given day based on AttendanceRules, even when no punches exist.
    Employee-specific rules take priority over device-wide rules."""
    if day is None:
        return None
    rules = _get_rules_cached()
    eid = _badge_empid(device_id, badge) if badge else None
    device_wide = None
    specific = None
    day_iso = day.isoformat()
    for r in rules:
        if r.get("type") != "shift" or r.get("device_id") != device_id:
            continue
        if not r.get("start") or not r.get("end"):
            continue
        # Date-specific rule: only match if date matches
        if r.get("date"):
            if r["date"] != day_iso:
                continue
        else:
            # Date-range filter
            if r.get("start_date") or r.get("end_date"):
                if r.get("start_date") and day < _date_from_iso(r["start_date"]):
                    continue
                if r.get("end_date") and day > _date_from_iso(r["end_date"]):
                    continue
            # Weekday filter (0=Mon ... 6=Sun)
            if r.get("weekdays"):
                if day.weekday() not in r["weekdays"]:
                    continue
        if r.get("empid"):
            if eid is not None and int(r.get("empid")) == eid:
                specific = r
        else:
            device_wide = r
    rule = specific or device_wide
    if rule:
        start_t = rule["start"]
        end_t = rule["end"]
        # Determine label from times
        extras = SHIFT_EXTRAS.get(device_id, [])
        for lb, s, e in extras:
            if s == start_t and e == end_t:
                return lb
        # Check if it's the general shift
        gen = SHIFTS.get(device_id, DEFAULT_SHIFT)
        if start_t == gen[0] and end_t == gen[1]:
            return "G"
        # Custom shift - return times
        return f"{start_t}-{end_t}"
    # No shift rule found - check rotation pattern for W.Off / G
    dev_patterns = ROTATION_PATTERNS.get(device_id, {})
    badge_clean = str(badge).lstrip("0") if badge else ""
    matched_key = None
    for k in dev_patterns:
        if str(k).lstrip("0") == badge_clean:
            matched_key = k
            break
    if matched_key:
        anchor = ROTATION_ANCHOR.get(device_id)
        if anchor:
            pattern = dev_patterns[matched_key]
            idx = (day - anchor).days
            if 0 <= idx < len(pattern) * 64:  # allow many repeated cycles (~14 months)
                lbl = pattern[idx % len(pattern)]
                # Map rotation labels "I", "II", "III" to "1st", "2nd", "Night" for SS SLP (device 42)
                if device_id == 42:
                    if lbl == "I": return "1st"
                    if lbl == "II": return "2nd"
                    if lbl == "III": return "Night"
                return lbl
    return None


def _employee_shift(device_id, badge, day=None, first_punch_sec=None):
    """Resolve the effective (start, end) shift times (as 'HH:MM' strings) for
    one employee. UI-created 'shift' rules (AttendanceRules) take top priority,
    then devices in EMPLOYEE_SHIFTS give certain employees their own shift
    window; YARD_SHIFTS employees auto-detect from first punch time; everyone
    else on that device uses the device default shift.
    `day` (a date) restricts date-ranged / weekday-scoped shift rules.
    Returns a (start, end) tuple of strings, or None when the device/badge does
    not have a per-employee override (the standard SHIFTS table is used)."""
    if not badge:
        return None
    ov = _rule_shift(device_id, badge, day)
    if ov:
        return ov
    emp = EMPLOYEE_SHIFTS.get(device_id)
    if emp:
        key = str(badge).lstrip("0")
        if key in emp:
            return emp[key]
    # Yard employees: auto-detect shift from first punch time
    yard = YARD_SHIFTS.get(device_id)
    if yard:
        key = str(badge).lstrip("0")
        if key in yard and first_punch_sec is not None:
            early = yard[key][0]  # ("08:00", "19:00")
            late = yard[key][1]   # ("09:00", "20:00")
            cutoff = 8 * 3600 + 30 * 60  # 08:30 in seconds
            return early if first_punch_sec < cutoff else late
    return None


# Cache: (device_id, badge) -> EmployeeId resolved from DeviceUsers. Used so a
# UI-created "shift" rule tied to a specific employee can override their window.
_BADGE_EMPID_CACHE = {}


def _badge_empid(device_id, badge):
    if badge is None:
        return None
    key = (device_id, str(badge).lstrip("0"))
    if key in _BADGE_EMPID_CACHE:
        return _BADGE_EMPID_CACHE[key]
    eid = None
    try:
        conn = pyodbc.connect(DB_CONFIG)
        try:
            cur = conn.cursor()
            # The device badge is Employees.EmployeeCodeInDevice. Prefer an exact
            # in-device match so a badge never resolves to an employee whose
            # EmployeeCode merely happens to equal another employee's badge.
            cur.execute(
                "SELECT du.EmployeeId FROM DeviceUsers du JOIN Employees e ON e.EmployeeId=du.EmployeeId "
                "WHERE du.DeviceId=? AND e.EmployeeCodeInDevice=?",
                device_id, str(badge))
            row = cur.fetchone()
            if row:
                eid = int(row[0])
            if eid is None:
                cur.execute(
                    "SELECT du.EmployeeId FROM DeviceUsers du JOIN Employees e ON e.EmployeeId=du.EmployeeId "
                    "WHERE du.DeviceId=? AND e.EmployeeCode=?",
                    device_id, str(badge))
                row = cur.fetchone()
                if row:
                    eid = int(row[0])
        finally:
            conn.close()
    except pyodbc.Error:
        pass
    _BADGE_EMPID_CACHE[key] = eid
    return eid


def _rule_shift(device_id, badge, day=None):
    """Return a (start, end) shift override from AttendanceRules of type 'shift'
    for this device (and, if specified, the matching employee by EmployeeId).
    Employee-scoped rules win over device-wide rules. `day` (date) filters rules
    that are date-ranged or weekday-scoped so they only apply on the right days.
    None when no rule applies."""
    rules = _get_rules_cached()
    eid = _badge_empid(device_id, badge) if badge is not None else None
    device_wide = None
    specific = None
    for r in rules:
        if r.get("type") != "shift" or r.get("device_id") != device_id:
            continue
        if not r.get("start") or not r.get("end"):
            continue
        # Date-range filter
        if day is not None and (r.get("start_date") or r.get("end_date")):
            if r.get("start_date") and day < _date_from_iso(r["start_date"]):
                continue
            if r.get("end_date") and day > _date_from_iso(r["end_date"]):
                continue
        # Weekday filter (0=Mon … 6=Sun)
        if day is not None and r.get("weekdays"):
            if day.weekday() not in r["weekdays"]:
                continue
        if r.get("empid"):
            # EmpId column stores the EmployeeId; match the resolved employee.
            if eid is not None and int(r.get("empid")) == eid:
                specific = (r["start"], r["end"])
        else:
            device_wide = (r["start"], r["end"])
    return specific or device_wide


def _date_from_iso(s):
    from datetime import date as _date
    try:
        y, m, d = s.split("-")
        return _date(int(y), int(m), int(d))
    except (ValueError, AttributeError, TypeError):
        return None



def _shift_grace_sec(device_id, badge=None):
    """Grace period in seconds after an employee's shift start before a first
    punch counts as late. Only employees listed in LATE_GRACE_MINUTES get it."""
    if badge is None:
        return 0
    key = str(badge).lstrip("0")
    return LATE_GRACE_MINUTES.get(device_id, {}).get(key, 0) * 60


def shift_late_minutes(device_id, fsec, badge=None, day=None):
    """Assign a first-punch to the shift with the nearest start time and
    report lateness (minutes) relative to that shift start. Night windows
    that cross midnight are handled by wrapping to the next day."""
    emp_shift = _employee_shift(device_id, badge, day, first_punch_sec=fsec)
    shift = SHIFTS.get(device_id, DEFAULT_SHIFT)
    candidates = []
    is_morning_punch = (4 * 3600 <= fsec <= 12 * 3600)
    # Always include extras first so rotation shifts get correct labels (not "General")
    for label, start, _end in SHIFT_EXTRAS.get(device_id, []):
        if is_morning_punch and label == "Night":
            continue
        candidates.append((label, _hms(start)))
    gen_start_hm = emp_shift[0] if emp_shift else shift[0]
    if is_morning_punch and emp_shift and _hms(emp_shift[0]) >= 19 * 3600:
        gen_start_hm = shift[0]
    candidates.append(("General", _hms(gen_start_hm)))

    # If device 42 (SS SLP), ensure standard shifts (1st, 2nd, Night) are always considered candidates
    if device_id == 42 and not SHIFT_EXTRAS.get(42):
        pass # already covered by SHIFT_EXTRAS.get(42)

    best = None
    daysec = 86400
    for label, start in candidates:
        d = fsec - start
        if abs(d + daysec) < abs(d):
            d += daysec
        if best is None or abs(d) < abs(best[1]):
            best = (label, d)
    label, delta = best
    if delta <= 0:
        return False, 0, label
    grace = _shift_grace_sec(device_id, badge)
    if delta <= grace:
        return False, 0, label
    # A first punch at or after the shift END (or past the shift mid-point) is
    # not a meaningful "late arrival" - the employee missed the normal check-in
    # (forgot the morning punch / odd afternoon or evening punch). Reporting it
    # as "late by 8 hours" is misleading, so treat it as not late; the day is
    # classified as present (incomplete) or permission instead.
    start_sec = _shift_start_sec(device_id, label, badge, day)
    end_sec = _shift_end_sec(device_id, label, badge, day)
    mid_sec = (start_sec + end_sec) // 2
    if fsec >= mid_sec:
        return False, 0, label
    return True, int(round(delta / 60)), label


LUNCH_START_SEC = 13 * 3600
LUNCH_END_SEC = 13 * 3600 + 30 * 60


def _shift_start_sec(device_id, label, badge=None, day=None, first_punch_sec=None):
    emp_shift = _employee_shift(device_id, badge, day, first_punch_sec=first_punch_sec)
    shift = SHIFTS.get(device_id, DEFAULT_SHIFT)
    is_morning_punch = (first_punch_sec is not None and 4 * 3600 <= first_punch_sec <= 12 * 3600)
    if label == "General":
        s_hm = emp_shift[0] if emp_shift else shift[0]
        if is_morning_punch and emp_shift and _hms(emp_shift[0]) >= 19 * 3600:
            s_hm = shift[0]
        return _hms(s_hm)
    for lb, s, _e in SHIFT_EXTRAS.get(device_id, []):
        if lb == label:
            return _hms(s)
    return _hms(shift[0])


def _lunch_deduction(label, punches, lunch_start_sec=LUNCH_START_SEC, lunch_end_sec=LUNCH_END_SEC):
    """Lunch seconds to subtract per pair. For the general shift, when a
    single IN->OUT pair spans the whole lunch window (no punch-out recorded
    around lunch) the lunch break is taken out. Employees who punch in/out
    around lunch already exclude it, so nothing is deducted."""
    if label != "General":
        return 0
    lunch_len = lunch_end_sec - lunch_start_sec
    total = 0
    i = 0
    while i + 1 < len(punches):
        s = punches[i].hour * 3600 + punches[i].minute * 60 + punches[i].second
        e = punches[i + 1].hour * 3600 + punches[i + 1].minute * 60 + punches[i + 1].second
        if s <= lunch_start_sec and e >= lunch_end_sec:
            total += lunch_len
        i += 2
    return total


def _dedup_punches(punches, gap=60):
    """Remove consecutive punches closer than `gap` seconds. The fingerprint
    devices frequently record two timestamps 2-3 seconds apart for a single tap
    (e.g. 09:37:30, 09:37:33). Without collapsing them, the IN/OUT pairing
    logic pairs the duplicates as tiny IN-OUT pairs and the real IN->OUT span
    is lost (worked hours collapse to ~0)."""
    if not punches:
        return list(punches)
    out = [punches[0]]
    for p in punches[1:]:
        if (p - out[-1]).total_seconds() < gap:
            continue
        out.append(p)
    return out


def _dedup_punch_records(records, gap=60):
    """Dedup a list of {'time','dir'} punch rows (already sorted ascending by
    time), keeping the first record of any cluster that falls within `gap`
    seconds. Unlike filtering by a set of deduped timestamps, rows that share
    an IDENTICAL timestamp collapse to a single punch, so a tap the devices log
    as two duplicate rows does not become an instant IN->OUT pair on the live
    board (which otherwise flips the employee to Absent with a phantom
    'last punch')."""
    out = []
    for r in records:
        if r.get("time") is None:
            continue
        if out and (r["time"] - out[-1]["time"]).total_seconds() < gap:
            continue
        out.append(r)
    return out


STRAY_OUT_SECONDS = 180

# Face-ID enrolment testing on the ESSL devices: employees tapped repeatedly
# while the admin verified scans, so spurious midpoint taps registered as "OUT"
# and flipped people to Logout. On the test day, any punch made BEFORE "now" is
# treated as test noise and collapses to the single punch-in (logout count drops
# to zero); any punch made FROM NOW ON is a genuine punch and pairs normally, so
# a real punch-out still shows as Logout. The window only covers the test day.
FACE_ID_TESTING_START = date(2026, 9, 16)
FACE_ID_TESTING_END = date(2026, 9, 15)  # inactive: START > END -> cleanup disabled

def _face_id_test_window(day):
    return FACE_ID_TESTING_START <= day <= FACE_ID_TESTING_END

def _test_cutoff():
    return datetime.now()

def _keep_only_punch_in(punches):
    """Drop test-tap OUTs logged before 'now' on the test day: keep the earliest
    punch-in plus any genuine punches from now onward. Accepts datetimes or
    {'time': datetime} rows."""
    if not punches:
        return punches
    cutoff = _test_cutoff()
    keep = [punches[0]]
    for p in punches[1:]:
        t = p["time"] if isinstance(p, dict) else p
        if t >= cutoff:
            keep.append(p)
    return keep

def _collapse_punches(punches):
    """Apply the full punch cleanup chain to a day's sorted datetime punches:
    duplicate collapse, stray-OUT drop, and face-ID test-day cleanup.
    Used by both day classification and the month-view first/last display so the
    two never disagree."""
    punches = _dedup_punches(punches)
    punches = _drop_stray_out(punches)
    if punches and _face_id_test_window(punches[0].date()):
        punches = _keep_only_punch_in(punches)
    return punches

def _drop_stray_out(punches):
    """Fingerprint readers log every scan, and employees re-tap when they think
    the first attempt did not register (site observed on SS SLP: Kesavan 08:53:43
    IN, 08:55:32 OUT). A trailing IN->OUT pair that spans only a couple of minutes
    is almost always such a stray re-scan: keeping the OUT flips the employee to
    Logout/Absent after a phantom sub-3-minute work session and truncates the day.
    Drop the OUT and keep the employee present/working on the open IN. Accepts
    either datetimes (monthly) or {'time': datetime} rows (live board)."""
    if len(punches) % 2 == 0 and len(punches) >= 2:
        a, b = punches[-2], punches[-1]
        ta = a["time"] if isinstance(a, dict) else a
        tb = b["time"] if isinstance(b, dict) else b
        if (tb - ta).total_seconds() <= STRAY_OUT_SECONDS:
            return punches[:-1]
    return punches


def _classify_day(device_id, punches, badge=None):
    """Classify one attendance day from its sorted punch list.
    Returns a dict with day_type ('present'|'half_day'|'permission'),
    worked seconds (after lunch deduction), lateness, assigned shift,
    extra/overtime seconds past shift end, and the expected shift seconds."""
    punches = _collapse_punches(punches)
    shift = SHIFTS.get(device_id, DEFAULT_SHIFT)
    n = len(punches)
    if n == 0:
        return {"day_type": "absent", "worked": 0, "is_late": False,
                "late_min": 0, "label": "General", "extra": 0,
                "lunch": False, "expected": 0, "shift_display": "General"}
    fsec = punches[0].hour * 3600 + punches[0].minute * 60 + punches[0].second
    day = punches[0].date()
    is_late, late_min, label = shift_late_minutes(device_id, fsec, badge, day)
    lunch_start_sec, lunch_end_sec = _lunch_seconds_for_device(device_id, badge)
    lunch_len = lunch_end_sec - lunch_start_sec
    span = 0.0
    i = 0
    while i + 1 < n:
        pair = (punches[i + 1] - punches[i]).total_seconds()
        if label == "General":
            s = punches[i].hour * 3600 + punches[i].minute * 60 + punches[i].second
            e = punches[i + 1].hour * 3600 + punches[i + 1].minute * 60 + punches[i + 1].second
            if s <= lunch_start_sec and e >= lunch_end_sec:
                pair -= lunch_len
        span += max(0, pair)
        i += 2
    lunch = _lunch_deduction(label, punches, lunch_start_sec, lunch_end_sec)
    worked = max(0, int(span))
    start_sec = _shift_start_sec(device_id, label, badge, day, first_punch_sec=fsec)
    end_sec = _shift_end_sec(device_id, label, badge, day, first_punch_sec=fsec)
    expected = max(0, end_sec - start_sec)
    if label == "General":
        expected = max(0, expected - lunch_len)
    extra = 0
    if n % 2 == 0 and not _shift_is_night(device_id, label, badge, day, first_punch_sec=fsec):
        lsec = punches[-1].hour * 3600 + punches[-1].minute * 60 + punches[-1].second
        if lsec > end_sec:
            extra = lsec - end_sec
    incomplete = (n % 2 == 1)
    est_in = est_out = None
    if incomplete:
        if n == 1:
            # Single punch for the whole day.
            last = punches[-1]
            last_sec = last.hour * 3600 + last.minute * 60 + last.second
            mid_sec = (start_sec + end_sec) // 2
            if last_sec >= mid_sec:
                # Lone evening punch => forgot morning IN; assume IN at shift start.
                est_in = datetime(last.year, last.month, last.day, start_sec // 3600, (start_sec % 3600) // 60)
                est_out = last
            else:
                # Lone morning IN => forgot punch-out; assume OUT at shift end.
                est_in = last
                est_out = datetime(last.year, last.month, last.day, end_sec // 3600, (end_sec % 3600) // 60)
        else:
            # Odd count >= 3: punches[0..n-2] already form complete IN/OUT pairs. The
            # final unpaired punch is either a genuine new IN (forgot OUT) or, far more
            # often, a stray duplicate OUT logged minutes after the real OUT. Only
            # estimate a missing OUT when the trailing punch is a real new session
            # (well after the previous punch and before shift end); otherwise treat it
            # as an error and ignore it so we do not double-count the day.
            prev = punches[-2]
            last = punches[-1]
            gap = (last - prev).total_seconds()
            last_sec = last.hour * 3600 + last.minute * 60 + last.second
            if gap <= 600 or last_sec >= end_sec:
                pass
            else:
                est_in = last
                est_out = datetime(last.year, last.month, last.day, end_sec // 3600, (end_sec % 3600) // 60)
        if est_in is not None and est_out is not None:
            s_est = est_in.hour * 3600 + est_in.minute * 60 + est_in.second
            e_est = est_out.hour * 3600 + est_out.minute * 60 + est_out.second
            pair = (est_out - est_in).total_seconds()
            if label == "General" and s_est <= lunch_start_sec and e_est >= lunch_end_sec:
                pair -= lunch_len
            span += max(0, pair)
        worked = max(0, int(span))
        # Never credit more than a full shift for a day with a missing punch.
        if expected > 0:
            worked = min(worked, int(expected))
        eff_out = est_out if est_out is not None else punches[-1]
        if incomplete and n >= 3 and est_out is None:
            eff_out = punches[-2]
        e_est = eff_out.hour * 3600 + eff_out.minute * 60 + eff_out.second
        eff_in = punches[0]
        in_s = eff_in.hour * 3600 + eff_in.minute * 60 + eff_in.second
        out_s = eff_out.hour * 3600 + eff_out.minute * 60 + eff_out.second
        lunch = bool(label == "General" and lunch_len > 0 and in_s <= lunch_start_sec and out_s >= lunch_end_sec)
        if not _shift_is_night(device_id, label, badge, day) and e_est > end_sec:
            extra = e_est - end_sec
    if expected > 0 and worked < expected * 0.35:
        day_type = "permission"
    elif expected > 0 and worked < expected * 0.75:
        day_type = "half_day"
    else:
        day_type = "present"
    if n % 2 == 1:
        # Incomplete day: punched IN but no matching OUT (missing punch-out).
        # The employee was physically present, so do NOT fabricate a full-shift
        # permission (which would otherwise credit the whole shift as permission).
        day_type = "present"
    if device_id in SIMPLE_MODE_DEVICES and day_type == "permission":
        day_type = "present"
    # A permission (sub-35%) day means the employee barely attended - it is not
    # a "late arrival", so suppress the late flag for it.
    if day_type == "permission":
        is_late = False
        late_min = 0
    emp_shift = _employee_shift(device_id, badge)
    shift_display = label  # Use the determined shift label (General, I, II, Night, etc.)
    return {
        "day_type": day_type, "worked": worked, "is_late": is_late,
        "late_min": late_min, "label": label, "extra": extra,
        "lunch": bool(lunch), "expected": expected, "shift_display": shift_display,
        "incomplete": incomplete,
    }


def _aggregate_month(device_id, day_punches, active_set, y, m, rules=None, badge=None):
    """Aggregate one employee's monthly attendance metrics from per-day
    punches (day_punches maps date -> sorted punch list) and the set of
    dates the branch was active (active_set). Rule days (weekly off,
    holidays, granted permission) are handled via rules."""
    import calendar as _cal
    _merge_night_crossovers(day_punches, device_id)
    agg = {
        "present": 0, "absent": 0, "on_time": 0, "late": 0,
        "total_hours": 0.0, "late_hours": 0.0,
        "extra_count": 0, "extra_hours": 0.0,
        "permission_count": 0, "permission_hours": 0.0,
        "half_day_count": 0, "overtime_count": 0, "overtime_hours": 0.0,
        "off_count": 0, "holiday_count": 0,
    }
    d = date(y, m, 1)
    last = date(y, m, _cal.monthrange(y, m)[1])
    while d <= last:
        rule = _rule_for_day(rules, device_id, d) if rules else None
        rule_off = rule and rule["type"] in ("weekly_off", "holiday")
        if d in day_punches:
            p = _dedup_punches(day_punches[d])
            c = _classify_day(device_id, p, badge)
            is_sunday = d.weekday() == 6 and device_id in WORKED_RULE_DEVICES
            if (rule_off and device_id in WORKED_RULE_DEVICES) or is_sunday:
                agg["present"] += 1
                agg["total_hours"] += c["worked"] / 3600.0
                agg["on_time"] += 1
                if c["extra"] > 0:
                    agg["extra_count"] += 1
                    agg["extra_hours"] += c["extra"] / 3600.0
                    agg["overtime_count"] += 1
                    agg["overtime_hours"] += c["extra"] / 3600.0
            else:
                if rule and rule["type"] == "permission":
                    agg["permission_count"] += 1
                    agg["permission_hours"] += rule.get("hours") or 2.0
                agg["present"] += 1
                agg["total_hours"] += c["worked"] / 3600.0
                if c["day_type"] == "half_day":
                    agg["half_day_count"] += 1
                elif c["day_type"] == "permission":
                    agg["permission_count"] += 1
                    # Ensure permission hours don't exceed the expected hours for a single day
                    expected_hrs = c["expected"] / 3600.0
                    permission_hrs = max(0, min(expected_hrs, (c["expected"] - c["worked"]) / 3600.0))
                    agg["permission_hours"] += permission_hrs
                if c["is_late"]:
                    agg["late"] += 1
                    agg["late_hours"] += c["late_min"] / 60.0
                elif c["day_type"] == "permission":
                    # A sub-35% attendance day is a permission, not on-time.
                    pass
                else:
                    agg["on_time"] += 1
                if c["extra"] > 0:
                    agg["extra_count"] += 1
                    agg["extra_hours"] += c["extra"] / 3600.0
                    agg["overtime_count"] += 1
                    agg["overtime_hours"] += c["extra"] / 3600.0
        elif rule_off:
            if rule["type"] == "weekly_off":
                agg["off_count"] += 1
            else:
                agg["holiday_count"] += 1
        elif d.weekday() == 6 and device_id in WORKED_RULE_DEVICES:
            agg["off_count"] += 1
        elif d in active_set:
            if rule and rule["type"] == "permission":
                agg["permission_count"] += 1
                agg["permission_hours"] += rule.get("hours") or 2.0
            else:
                agg["absent"] += 1
        d += timedelta(days=1)
    for k in ("total_hours", "late_hours", "extra_hours", "permission_hours", "overtime_hours"):
        agg[k] = round(agg[k], 2)
    return agg


def _is_worked_rule_day(rules, device_id, day):
    """True when a device's weekly-off/holiday rule covers the date AND the
    device treats worked rule days as present (WORKED_RULE_DEVICES)."""
    if device_id not in WORKED_RULE_DEVICES or not rules:
        return False
    rule = _rule_for_day(rules, device_id, day)
    return bool(rule and rule["type"] in ("weekly_off", "holiday"))


def compute_analytics():
    now = datetime.now()
    cutoff = now - timedelta(days=ANALYTICS_DAYS)
    device_ids = list(LOCATIONS.keys())

    conn = pyodbc.connect(DB_CONFIG)
    cursor = conn.cursor()
    rules = _load_rules(conn)

    device_emps = {}
    try:
        placeholders = ",".join("?" for _ in device_ids)
        cursor.execute(f"""
            SELECT du.DeviceId, e.EmployeeCodeInDevice, e.EmployeeCode, e.EmployeeName
            FROM DeviceUsers du
            LEFT JOIN Employees e ON du.EmployeeId = e.EmployeeId
            WHERE du.DeviceId IN ({placeholders})
        """, device_ids)
        for r in cursor.fetchall():
            dev = int(r[0])
            raw = r[1] if r[1] is not None else r[2]
            badge = str(raw).strip() if raw is not None and str(raw).strip() else ""
            name = str(r[3]).strip() if r[3] and str(r[3]).strip() else "Employee " + badge
            if dev in LOCATIONS and badge:
                device_emps.setdefault(dev, {})[badge] = name
    except pyodbc.Error:
        pass

    day_punches = {}
    active_dates = {}
    seen = set()
    for table in LOG_TABLES:
        try:
            placeholders = ",".join("?" for _ in device_ids)
            cursor.execute(f"""
                SELECT DeviceId, UserId, LogDate
                FROM {table}
                WHERE DeviceId IN ({placeholders}) AND LogDate >= ?
            """, device_ids + [cutoff])
            rows = cursor.fetchall()
        except pyodbc.Error:
            continue
        for r in rows:
            dev = int(r[0]); uid = str(r[1]).strip(); dt = r[2]
            if dt is None:
                continue
            skey = (dev, uid, dt)
            if skey in seen:
                continue
            seen.add(skey)
            dkey = dt.date()
            day_punches.setdefault((dev, uid, dkey), []).append(dt)
            active_dates.setdefault((dev, dkey), True)
    conn.close()

    for key in day_punches:
        day_punches[key].sort()

    week_start = now.date() - timedelta(days=now.date().weekday())
    month_start = now.date().replace(day=1)

    employees = []
    for dev, emp_map in device_emps.items():
        bname = LOCATIONS[dev]["name"]
        for badge, name in emp_map.items():
            days = {}
            for (d, u, dkey), punches in day_punches.items():
                if d == dev and u == badge:
                    days[dkey] = punches
            _merge_night_crossovers(days, dev)
            dates = sorted(days.keys())
            month_dates = [dk for dk in dates if dk >= month_start]
            if not days:
                continue
            if not month_dates:
                continue
            month_active = {k[1] for k in active_dates if k[0] == dev and k[1] >= month_start}
            absent_days = len(month_active - set(month_dates))

            on_time = 0; late = 0
            week_present = 0; week_on = 0; week_late = 0
            month_present = 0; month_hours = 0.0
            seq = []
            for dk in dates:
                p = _dedup_punches(days[dk])
                first = p[0]
                fsec = first.hour * 3600 + first.minute * 60 + first.second
                is_late, _m, _s = shift_late_minutes(dev, fsec, badge)
                if _is_worked_rule_day(rules, dev, dk):
                    is_late = False
                is_on = not is_late
                if dk >= month_start:
                    if is_late:
                        late += 1
                    else:
                        on_time += 1
                seq.append((dk, is_on))
                if dk >= week_start:
                    week_present += 1
                    if is_on:
                        week_on += 1
                    else:
                        week_late += 1
                if dk.month == now.month:
                    month_present += 1
                    h = 0.0
                    i = 0
                    while i + 1 < len(p):
                        h += (p[i + 1] - p[i]).total_seconds() / 3600.0
                        i += 2
                    month_hours += h

            best_on = 0; best_late = 0
            cur_on = 0; cur_late = 0
            for i, (dk, is_on) in enumerate(seq):
                consecutive = (i == 0) or ((dk - seq[i - 1][0]).days == 1)
                if not consecutive:
                    cur_on = 0; cur_late = 0
                cur_on = (cur_on + 1) if is_on else 0
                cur_late = (cur_late + 1) if not is_on else 0
                if cur_on > best_on: best_on = cur_on
                if cur_late > best_late: best_late = cur_late

            cur_on_now = 0
            for i in range(len(seq) - 1, -1, -1):
                dk, is_on = seq[i]
                if i < len(seq) - 1 and (seq[i + 1][0] - dk).days != 1:
                    break
                if not is_on:
                    break
                cur_on_now += 1

            cur_late_now = 0
            for i in range(len(seq) - 1, -1, -1):
                dk, is_on = seq[i]
                if i < len(seq) - 1 and (seq[i + 1][0] - dk).days != 1:
                    break
                if is_on:
                    break
                cur_late_now += 1

            employees.append({
                "id": badge.zfill(4) if badge.isdigit() else badge,
                "name": name,
                "branch": bname,
                "device_id": dev,
                "present_days": len(month_dates),
                "absent_days": absent_days,
                "working_days": len(month_dates) + absent_days,
                "on_time_days": on_time,
                "late_days": late,
                "current_on_time_streak": cur_on_now,
                "best_on_time_streak": best_on,
                "current_late_streak": cur_late_now,
                "best_late_streak": best_late,
                "week": {"present": week_present, "on_time": week_on, "late": week_late},
                "month": {
                    "present_days": month_present,
                    "total_hours": round(month_hours, 1),
                    "avg_hours": round(month_hours / month_present, 1) if month_present else 0,
                },
            })

    def top(key, n=10):
        return sorted(employees, key=lambda e: e[key], reverse=True)[:n]

    leaders = {
        "on_time_streak": top("current_on_time_streak"),
        "late_streak": top("current_late_streak"),
        "week_on_time": sorted(employees, key=lambda e: (e["week"]["on_time"], e["present_days"]), reverse=True)[:10],
        "week_late": sorted(employees, key=lambda e: e["week"]["late"], reverse=True)[:10],
        "month_hours": [e for e in sorted(employees, key=lambda e: e["month"]["avg_hours"], reverse=True)
                        if e["month"]["present_days"] >= 3][:10],
    }

    return {
        "generated": now.strftime("%I:%M:%S %p"),
        "range_days": ANALYTICS_DAYS,
        "employees": employees,
        "leaders": leaders,
    }


@app.route("/api/analytics")
def api_analytics():
    now = time.time()
    if not ANALYTICS_CACHE["data"] or now - ANALYTICS_CACHE["ts"] > 60:
        try:
            ANALYTICS_CACHE["data"] = compute_analytics()
            ANALYTICS_CACHE["ts"] = now
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return jsonify(ANALYTICS_CACHE["data"])


AI_CACHE = {"ts": 0.0, "data": None}


def _shift_end_sec(dev, label, badge=None, day=None, first_punch_sec=None):
    emp_shift = _employee_shift(dev, badge, day, first_punch_sec=first_punch_sec)
    shift = SHIFTS.get(dev, DEFAULT_SHIFT)
    is_morning_punch = (first_punch_sec is not None and 4 * 3600 <= first_punch_sec <= 12 * 3600)
    if label == "General":
        e_hm = emp_shift[1] if emp_shift else shift[1]
        if is_morning_punch and emp_shift and _hms(emp_shift[0]) >= 19 * 3600:
            e_hm = shift[1]
        return _hms(e_hm)
    for lb, _s, end in SHIFT_EXTRAS.get(dev, []):
        if lb == label:
            return _hms(end)
    return _hms(shift[1])


def _shift_is_night(dev, label, badge=None, day=None, first_punch_sec=None):
    emp_shift = _employee_shift(dev, badge, day, first_punch_sec=first_punch_sec)
    shift = SHIFTS.get(dev, DEFAULT_SHIFT)
    is_morning_punch = (first_punch_sec is not None and 4 * 3600 <= first_punch_sec <= 12 * 3600)
    if label == "General":
        s, e = (emp_shift[0], emp_shift[1]) if emp_shift else (_hms(shift[0]), _hms(shift[1]))
        if is_morning_punch and emp_shift and _hms(emp_shift[0]) >= 19 * 3600:
            s, e = shift[0], shift[1]
        return e < s
    for lb, s, e in SHIFT_EXTRAS.get(dev, []):
        if lb == label:
            return _hms(e) < _hms(s)
    return False


def compute_ai_insights():
    now = datetime.now()
    today = now.date()
    cutoff = now - timedelta(days=30)
    device_ids = list(LOCATIONS.keys())

    conn = pyodbc.connect(DB_CONFIG)
    cursor = conn.cursor()

    device_emps = {}
    try:
        placeholders = ",".join("?" for _ in device_ids)
        cursor.execute(f"""
            SELECT du.DeviceId, e.EmployeeCodeInDevice, e.EmployeeCode, e.EmployeeName
            FROM DeviceUsers du
            LEFT JOIN Employees e ON du.EmployeeId = e.EmployeeId
            WHERE du.DeviceId IN ({placeholders})
        """, device_ids)
        for r in cursor.fetchall():
            dev = int(r[0])
            raw = r[1] if r[1] is not None else r[2]
            badge = str(raw).strip() if raw is not None and str(raw).strip() else ""
            name = str(r[3]).strip() if r[3] and str(r[3]).strip() else "Employee " + badge
            if dev in LOCATIONS and badge:
                device_emps.setdefault(dev, {})[badge] = name
    except pyodbc.Error:
        pass

    month_tables = []
    try:
        cursor.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'DeviceLogs[_]%'")
        for (tname,) in cursor.fetchall():
            m = re.match(r"^DeviceLogs_(\d{1,2})_(\d{4})$", str(tname))
            if m:
                month_tables.append(((int(m.group(2)), int(m.group(1))), str(tname)))
    except pyodbc.Error:
        pass
    month_tables.sort()
    month_tables = month_tables[-6:]

    day_punches = {}
    active_dates = {}
    seen = set()
    for (_mk, table) in month_tables:
        try:
            placeholders = ",".join("?" for _ in device_ids)
            cursor.execute(f"""
                SELECT DeviceId, UserId, LogDate
                FROM {table}
                WHERE DeviceId IN ({placeholders})
            """, device_ids)
            rows = cursor.fetchall()
        except pyodbc.Error:
            continue
        for r in rows:
            dev = int(r[0]); uid = str(r[1]).strip(); dt = r[2]
            if dt is None:
                continue
            skey = (dev, uid, dt)
            if skey in seen:
                continue
            seen.add(skey)
            dkey = dt.date()
            day_punches.setdefault((dev, uid, dkey), []).append(dt)
            active_dates.setdefault((dev, dkey), True)
    rules = _load_rules(conn)
    conn.close()

    for key in day_punches:
        day_punches[key].sort()

    now_sec = now.hour * 3600 + now.minute * 60 + now.second
    anomalies = []
    risk_rows = []
    month_agg = {}
    month_emp_stats = {}
    total_employees = 0

    active_by_month = {}
    for (dev_k, dk) in active_dates:
        active_by_month.setdefault((dev_k, dk.strftime("%Y-%m")), set()).add(dk)

    for dev, emp_map in device_emps.items():
        shift = SHIFTS.get(dev, DEFAULT_SHIFT)
        g_start = _hms(shift[0])
        bname = LOCATIONS[dev]["name"]
        active_30 = {k[1] for k in active_dates if k[0] == dev and k[1] >= cutoff.date()}

        for badge, name in emp_map.items():
            total_employees += 1
            lunch_start, lunch_end = _lunch_seconds_for_device(dev, badge)
            days = {}
            for (d, u, dkey), punches in day_punches.items():
                if d == dev and u == badge:
                    days[dkey] = punches
            _merge_night_crossovers(days, dev)
            if not days:
                continue

            dates = sorted(days.keys())
            active = active_30
            emp_id = badge.zfill(4) if badge.isdigit() else badge

            # ---------- today's anomalies ----------
            if today in days:
                p = days[today]
                fsec = p[0].hour * 3600 + p[0].minute * 60 + p[0].second
                is_late, late_min, label = shift_late_minutes(dev, fsec, badge)
                is_late = is_late and not _is_worked_rule_day(rules, dev, today)
                g_end_sec = _shift_end_sec(dev, label, badge)
                night = _shift_is_night(dev, label, badge)

                if is_late:
                    if late_min >= 180:
                        anomalies.append({"severity": "High", "type": "Unusual Punch Time",
                            "message": f"First punch 3h+ after {label} shift start",
                            "employee": name, "id": emp_id, "branch": bname,
                            "time": p[0].strftime("%I:%M:%S %p")})
                    elif late_min >= 30:
                        anomalies.append({"severity": "Medium", "type": "Late Arrival",
                            "message": f"{late_min} min late for {label} shift",
                            "employee": name, "id": emp_id, "branch": bname,
                            "time": p[0].strftime("%I:%M:%S %p")})
                    elif late_min >= 15:
                        anomalies.append({"severity": "Low", "type": "Late Arrival",
                            "message": f"{late_min} min late for {label} shift",
                            "employee": name, "id": emp_id, "branch": bname,
                            "time": p[0].strftime("%I:%M:%S %p")})

                last = p[-1]
                lsec = last.hour * 3600 + last.minute * 60 + last.second
                if len(p) % 2 == 0:
                    if (not night) and lsec <= g_end_sec - 45 * 60 and (last - p[0]).total_seconds() >= 4 * 3600:
                        anomalies.append({"severity": "Medium", "type": "Left Early",
                            "message": f"Logged out {int((g_end_sec - lsec) / 60)} min before {label} shift end",
                            "employee": name, "id": emp_id, "branch": bname,
                            "time": last.strftime("%I:%M:%S %p")})
                else:
                    if now_sec > g_end_sec + 30 * 60 and (now - last).total_seconds() > 30 * 60:
                        anomalies.append({"severity": "High", "type": "No Punch-Out",
                            "message": f"Punched in but no punch-out after {label} shift end",
                            "employee": name, "id": emp_id, "branch": bname,
                            "time": last.strftime("%I:%M:%S %p")})

                for i in range(2, len(p)):
                    if (p[i] - p[i - 2]).total_seconds() <= 5 * 60:
                        anomalies.append({"severity": "Low", "type": "Rapid Punches",
                            "message": f"{i + 1} punches within 5 minutes (possible mis-swipes)",
                            "employee": name, "id": emp_id, "branch": bname,
                            "time": p[i].strftime("%I:%M:%S %p")})
                        break

                if fsec < lunch_start - 15 * 60 and lsec > lunch_end + 15 * 60:
                    in_lunch = any(lunch_start - 15 * 60 <= (x.hour * 3600 + x.minute * 60) <= lunch_end + 15 * 60 for x in p)
                    if not in_lunch:
                        anomalies.append({"severity": "Medium", "type": "No Lunch Break",
                            "message": "No punch recorded during lunch window",
                            "employee": name, "id": emp_id, "branch": bname,
                            "time": "--"})

            # ---------- per-day info ----------
            info = {}
            for dk in dates:
                p = days[dk]
                fsec = p[0].hour * 3600 + p[0].minute * 60 + p[0].second
                il, _m, label = shift_late_minutes(dev, fsec, badge)
                if _is_worked_rule_day(rules, dev, dk):
                    il = False
                n = len(p)
                h = 0.0
                i = 0
                while i + 1 < n:
                    h += (p[i + 1] - p[i]).total_seconds() / 3600.0
                    i += 2
                info[dk] = (il, label, h, n)

            # ---------- 30-day risk ----------
            risk_dates = [dk for dk in dates if dk >= cutoff.date()]
            present_days = len(risk_dates)
            absent_days = len(active - set(risk_dates))
            late_days = 0
            early_days = 0
            for dk in risk_dates:
                il, label, h, n = info[dk]
                if il:
                    late_days += 1
                if n % 2 == 0 and not _shift_is_night(dev, label, badge):
                    p = days[dk]
                    lsec = p[-1].hour * 3600 + p[-1].minute * 60 + p[-1].second
                    if lsec <= _shift_end_sec(dev, label, badge) - 45 * 60 and (p[-1] - p[0]).total_seconds() >= 4 * 3600:
                        early_days += 1

            # ---------- monthly aggregation ----------
            by_month = {}
            for dk in dates:
                by_month.setdefault(dk.strftime("%Y-%m"), []).append(dk)
            for month, mdates in by_month.items():
                mrecords = 0
                mpresent = 0
                mlate = 0
                mhours = 0.0
                for dk in mdates:
                    il, label, h, n = info[dk]
                    mrecords += n
                    mpresent += (n + 1) // 2
                    if il:
                        mlate += 1
                    mhours += h
                mactive = active_by_month.get((dev, month), set())
                mabsent = len(mactive - set(mdates))
                agg = month_agg.setdefault(month, {}).setdefault(bname, {"records": 0, "present": 0, "absent": 0, "late": 0, "hours": 0.0, "active": 0})
                agg["records"] += mrecords
                agg["present"] += mpresent
                agg["absent"] += mabsent
                agg["late"] += mlate
                agg["hours"] += mhours
                if mpresent:
                    agg["active"] += 1
                emp_stats = month_emp_stats.setdefault((month, bname), {}).setdefault(emp_id, {"id": emp_id, "name": name, "absent": 0, "late": 0})
                emp_stats["absent"] += mabsent
                emp_stats["late"] += mlate

            active_count = max(1, len(active))
            absent_rate = absent_days / active_count
            late_rate = late_days / present_days if present_days else 0
            early_rate = early_days / present_days if present_days else 0
            if absent_days >= active_count:
                score = 100
            else:
                score = min(99, round(absent_rate * 80 + late_rate * 15 + early_rate * 5))

            reasons = []
            if absent_days:
                reasons.append(f"Absent {absent_days} of {active_count} active days")
            if late_days:
                reasons.append(f"Late {late_days} days")
            if early_days:
                reasons.append(f"Left early {early_days} days")

            risk_rows.append({
                "id": emp_id,
                "name": name,
                "branch": bname,
                "device_id": dev,
                "score": score,
                "present_days": present_days,
                "absent_days": absent_days,
                "late_days": late_days,
                "early_days": early_days,
                "reasons": reasons,
            })

    risk_rows.sort(key=lambda r: r["score"], reverse=True)
    anomalies.sort(key=lambda a: {"High": 0, "Medium": 1, "Low": 2}.get(a["severity"], 3))

    months_out = []
    for month in sorted(month_agg.keys(), reverse=True)[:6]:
        branch_agg = month_agg[month]
        total_records = sum(a["records"] for a in branch_agg.values())
        present_records = sum(a["present"] for a in branch_agg.values())
        absent_records = sum(a["absent"] for a in branch_agg.values())
        late_records = sum(a["late"] for a in branch_agg.values())
        total_hours = sum(a["hours"] for a in branch_agg.values())
        total_present_days = sum(a["present"] // 2 for a in branch_agg.values()) if present_records else 0
        active_employees = sum(a["active"] for a in branch_agg.values())
        worst_unit = max(branch_agg.items(), key=lambda kv: kv[1]["absent"]) if branch_agg else (None, None)
        try:
            label = datetime.strptime(month, "%Y-%m").strftime("%b %Y")
        except ValueError:
            label = month
        months_out.append({
            "month": month,
            "label": label,
            "overview": {
                "total_employees": total_employees,
                "active_employees": active_employees,
                "units": len(branch_agg),
                "total_records": total_records,
                "present_records": present_records,
                "absent_records": absent_records,
                "late_records": late_records,
                "attendance_rate": round(100 * present_records / total_records, 1) if total_records else 0,
                "late_rate": round(100 * late_records / total_records, 1) if total_records else 0,
                "avg_hours": round(total_hours / max(1, total_present_days), 1),
                "worst_unit": {"branch": worst_unit[0], "absent": worst_unit[1]["absent"]} if worst_unit[0] else None,
                "by_branch": [
                    {
                        "branch": b,
                        "records": a["records"],
                        "present": a["present"],
                        "absent": a["absent"],
                        "late": a["late"],
                        "hours": round(a["hours"] / max(1, a["present"] // 2), 1),
                        "active": a["active"],
                        "absent_emps": sorted(
                            (s for s in month_emp_stats.get((month, b), {}).values() if s["absent"] > 0),
                            key=lambda s: -s["absent"],
                        ),
                        "late_emps": sorted(
                            (s for s in month_emp_stats.get((month, b), {}).values() if s["late"] > 0),
                            key=lambda s: -s["late"],
                        ),
                    }
                    for b, a in sorted(branch_agg.items(), key=lambda kv: -kv[1]["absent"])
                ],
            },
        })

    return {
        "generated": now.strftime("%I:%M:%S %p"),
        "range_days": 30,
        "months": months_out,
        "anomalies": anomalies,
        "risk": risk_rows,
    }


@app.route("/api/ai-insights")
def api_ai_insights():
    now = time.time()
    if not AI_CACHE["data"] or now - AI_CACHE["ts"] > 60:
        try:
            AI_CACHE["data"] = compute_ai_insights()
            AI_CACHE["ts"] = now
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return jsonify(AI_CACHE["data"])


@app.route("/api/day")
def api_day():
    try:
        d = datetime.strptime(request.args.get("date", ""), "%Y-%m-%d").date()
    except Exception:
        return jsonify({"error": "date parameter required as YYYY-MM-DD"}), 400
    try:
        return jsonify(compute_day_summary(d))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def compute_day_summary(d):
    device_ids = list(LOCATIONS.keys())
    conn = pyodbc.connect(DB_CONFIG)
    cursor = conn.cursor()

    device_emps = {}
    try:
        placeholders = ",".join("?" for _ in device_ids)
        cursor.execute(f"""
            SELECT du.DeviceId, e.EmployeeCodeInDevice, e.EmployeeCode, e.EmployeeName
            FROM DeviceUsers du
            LEFT JOIN Employees e ON du.EmployeeId = e.EmployeeId
            WHERE du.DeviceId IN ({placeholders})
        """, device_ids)
        for r in cursor.fetchall():
            dev = int(r[0])
            raw = r[1] if r[1] is not None else r[2]
            badge = str(raw).strip() if raw is not None and str(raw).strip() else ""
            name = str(r[3]).strip() if r[3] and str(r[3]).strip() else "Employee " + badge
            if dev in LOCATIONS and badge:
                device_emps.setdefault(dev, {})[badge] = name
    except pyodbc.Error:
        pass

    badge_names = {}
    try:
        cursor.execute("SELECT EmployeeCodeInDevice, EmployeeName FROM Employees")
        for r in cursor.fetchall():
            badge = str(r[0]).strip()
            name = str(r[1]).strip()
            if badge:
                badge_names[badge] = name
    except pyodbc.Error:
        pass

    table = None
    try:
        cursor.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'DeviceLogs[_]%'")
        for (tname,) in cursor.fetchall():
            m = re.match(r"^DeviceLogs_(\d{1,2})_(\d{4})$", str(tname))
            if m and int(m.group(2)) == d.year and int(m.group(1)) == d.month:
                table = str(tname)
                break
    except pyodbc.Error:
        pass
    rules = _load_rules(conn)
    if not table:
        conn.close()
        return {"date": d.isoformat(), "late": [], "late_count": 0, "absent": [], "absent_count": 0,
                "present_count": 0, "total_count": 0, "branch_count": 0,
                "note": "no log table for this month"}

    day_str = d.strftime("%Y-%m-%d")
    day_punches = {}
    active_devices = set()
    try:
        placeholders = ",".join("?" for _ in device_ids)
        cursor.execute(f"""
            SELECT DeviceId, UserId, LogDate
            FROM {table}
            WHERE DeviceId IN ({placeholders}) AND CONVERT(date, LogDate) = ?
        """, device_ids + [day_str])
        for r in cursor.fetchall():
            dev = int(r[0]); uid = str(r[1]).strip(); dt = r[2]
            if dt is None:
                continue
            day_punches.setdefault((dev, uid), []).append(dt)
            active_devices.add(dev)
    except pyodbc.Error:
        pass
    conn.close()

    late = []
    unusual = []
    present_count = 0
    for (dev, uid), punches in day_punches.items():
        punches = _dedup_punches(sorted(punches))
        first = punches[0]
        fsec = first.hour * 3600 + first.minute * 60 + first.second
        is_late, minutes, label = shift_late_minutes(dev, fsec, uid)
        if _is_worked_rule_day(rules, dev, d):
            is_late = False
        present_count += 1
        h = 0.0
        i = 0
        while i + 1 < len(punches):
            h += (punches[i + 1] - punches[i]).total_seconds() / 3600.0
            i += 2
        if is_late:
            entry = {
                "id": uid.zfill(4) if uid.isdigit() else uid,
                "name": device_emps.get(dev, {}).get(uid) or badge_names.get(uid) or "Employee " + uid,
                "branch": LOCATIONS[dev]["name"],
                "minutes": minutes,
                "shift": label,
                "first": first.strftime("%I:%M:%S %p"),
                "hours": round(h, 1),
            }
            if minutes > 180:
                unusual.append(entry)
            else:
                late.append(entry)
    late.sort(key=lambda x: -x["minutes"])
    unusual.sort(key=lambda x: -x["minutes"])

    absent = []
    for dev in sorted(active_devices):
        enrolled = device_emps.get(dev, {})
        punched = {uid for (dv, uid) in day_punches if dv == dev}
        for uid, name in enrolled.items():
            if uid not in punched:
                absent.append({
                    "id": uid.zfill(4) if uid.isdigit() else uid,
                    "name": name,
                    "branch": LOCATIONS[dev]["name"],
                })
    absent.sort(key=lambda x: x["name"].lower())

    return {
        "date": d.isoformat(),
        "late": late,
        "late_count": len(late),
        "unusual": unusual,
        "unusual_count": len(unusual),
        "absent": absent,
        "absent_count": len(absent),
        "present_count": present_count,
        "total_count": present_count + len(absent),
        "branch_count": len(active_devices),
    }


@app.route("/api/export/punches")
def api_export_punches():
    """Raw punches per employee per day for a date range (max 92 days)."""
    try:
        f = datetime.strptime(request.args.get("from", ""), "%Y-%m-%d").date()
        t = datetime.strptime(request.args.get("to", ""), "%Y-%m-%d").date()
    except Exception:
        return jsonify({"error": "from and to required as YYYY-MM-DD"}), 400
    if t < f:
        return jsonify({"error": "to must be on or after from"}), 400
    if (t - f).days > 92:
        return jsonify({"error": "range too large (max 92 days)"}), 400

    if g.api_auth.get("role") == "manager":
        assigned = g.api_auth.get("device_id")
        if not assigned:
            return jsonify({"error": "Assigned device required"}), 403
        device_ids = [int(assigned)]
    else:
        device_ids = list(LOCATIONS.keys())
    try:
        conn = pyodbc.connect(DB_CONFIG)
        cursor = conn.cursor()

        device_emps = {}
        try:
            ph = ",".join("?" for _ in device_ids)
            cursor.execute(f"""
                SELECT du.DeviceId, e.EmployeeCodeInDevice, e.EmployeeCode, e.EmployeeName
                FROM DeviceUsers du
                LEFT JOIN Employees e ON du.EmployeeId = e.EmployeeId
                WHERE du.DeviceId IN ({ph})
            """, device_ids)
            for r in cursor.fetchall():
                dev = int(r[0])
                raw = r[1] if r[1] is not None else r[2]
                badge = str(raw).strip() if raw is not None and str(raw).strip() else ""
                name = str(r[3]).strip() if r[3] and str(r[3]).strip() else "Employee " + badge
                if dev in LOCATIONS and badge:
                    device_emps.setdefault(dev, {})[badge] = name
        except pyodbc.Error:
            pass

        total_months = (t.year - f.year) * 12 + (t.month - f.month) + 1
        tables = []
        for i in range(total_months):
            mm = f.month + i
            yy = f.year + (mm - 1) // 12
            mm = (mm - 1) % 12 + 1
            tables.append("DeviceLogs_%d_%d" % (mm, yy))

        raw = []
        for table in tables:
            try:
                cursor.execute("SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = ?", (table,))
                if cursor.fetchone() is None:
                    continue
            except pyodbc.Error:
                continue
            try:
                ph = ",".join("?" for _ in device_ids)
                cursor.execute(f"""
                    SELECT DeviceId, UserId, LogDate, C1
                    FROM {table}
                    WHERE DeviceId IN ({ph}) AND CONVERT(date, LogDate) >= ? AND CONVERT(date, LogDate) <= ?
                """, device_ids + [f.isoformat(), t.isoformat()])
                for r in cursor.fetchall():
                    dev = int(r[0])
                    uid = str(r[1]).strip()
                    dt = r[2]
                    if dt is None:
                        continue
                    c1 = str(r[3]).strip() if r[3] is not None else ""
                    raw.append((dev, uid, dt, c1))
            except pyodbc.Error:
                continue
        conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    by = {}
    for dev, uid, dt, c1 in raw:
        by.setdefault((dev, uid), []).append((dt, c1))

    out = []
    for (dev, uid), punches in by.items():
        punches.sort(key=lambda x: x[0])
        name = device_emps.get(dev, {}).get(uid) or "Employee " + uid
        days = {}
        for p, c1 in punches:
            days.setdefault(p.date(), []).append((p, c1))
        for d in sorted(days):
            plist = sorted(days[d], key=lambda x: x[0])
            hours = 0.0
            i = 0
            while i + 1 < len(plist):
                hours += (plist[i + 1][0] - plist[i][0]).total_seconds() / 3600.0
                i += 2
            out.append({
                "date": d.isoformat(),
                "id": uid.zfill(4) if uid.isdigit() else uid,
                "name": name,
                "branch": LOCATIONS[dev]["name"],
                "punchCount": len(plist),
                "first": plist[0][0].strftime("%I:%M:%S %p"),
                "last": plist[-1][0].strftime("%I:%M:%S %p"),
                "punches": [x[0].strftime("%I:%M:%S %p") for x in plist],
                "punchDirs": ["IN" if i % 2 == 0 else "OUT" for i in range(len(plist))],
                "hours": round(hours, 2),
                "status": "Present",
            })
    out.sort(key=lambda x: (x["date"], x["branch"], x["name"].lower()))
    return jsonify({
        "from": f.isoformat(),
        "to": t.isoformat(),
        "days": (t - f).days + 1,
        "count": len(out),
        "rows": out,
    })


CHAT_CONFIG_PATH = os.path.join(BASE_DIR, "chat_config.json")

GEMINI_MIN_INTERVAL = 2.0
GEMINI_LAST = [0.0]
GEMINI_LOCK = threading.Lock()
CHAT_CACHE = {"data": {}, "ts": time.time()}
CHAT_CACHE_TTL = 180


def _gemini_complete(cfg, system_text, user_text):
    """Call Gemini via the Interactions API (POST /v1beta/interactions).

    Spaces requests to respect free-tier rate limits and retries on 429,
    sleeping for the retry delay reported by the API (capped).
    """
    url = "https://generativelanguage.googleapis.com/v1beta/interactions"
    combined = ("%s\n\n%s" % (system_text, user_text)) if system_text else user_text
    body = {"model": cfg["model"], "input": combined}
    last_err = None
    attempts = 2
    for attempt in range(attempts):
        with GEMINI_LOCK:
            wait = GEMINI_LAST[0] + GEMINI_MIN_INTERVAL - time.time()
            if wait > 0:
                time.sleep(wait)
            GEMINI_LAST[0] = time.time()
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": cfg["api_key"]},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429:
                wait = 3 + attempt * 3
                try:
                    raw = e.read().decode("utf-8", "ignore")
                    m = re.search(r"retry in ([\d.]+)s", raw)
                    if m:
                        wait = float(m.group(1)) + 1
                        wait = max(wait, 2)
                        wait = min(wait, 8)
                except Exception:
                    pass
                time.sleep(wait)
                continue
            raise
    else:
        raise last_err
    steps = result.get("steps") or []
    texts = []
    for step in steps:
        content = step.get("content") or []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                t = str(part.get("text", "")).strip()
                if t:
                    texts.append(t)
    if not texts:
        raise RuntimeError("Gemini returned no output steps")
    return texts[-1]


def _chat_cache_get(q):
    try:
        if time.time() - CHAT_CACHE["ts"] > CHAT_CACHE_TTL:
            CHAT_CACHE["data"] = {}
            CHAT_CACHE["ts"] = time.time()
        return CHAT_CACHE["data"].get(q)
    except Exception:
        return None


def _chat_cache_put(q, answer):
    try:
        CHAT_CACHE["data"][q] = answer
        if len(CHAT_CACHE["data"]) > 100:
            CHAT_CACHE["data"] = dict(list(CHAT_CACHE["data"].items())[-60:])
    except Exception:
        pass


def _load_chat_config():
    try:
        with open(CHAT_CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return {
            "api_key": str(cfg.get("api_key", "")).strip(),
            "model": str(cfg.get("model", "")).strip() or "gemini-3.6-flash",
        }
    except Exception:
        return {
            "api_key": os.environ.get("UA_GEMINI_KEY", "").strip(),
            "model": os.environ.get("UA_GEMINI_MODEL", "") or "gemini-3.6-flash",
        }


def _get_ai_cache_data():
    now = time.time()
    if not AI_CACHE["data"] or now - AI_CACHE["ts"] > 60:
        try:
            AI_CACHE["data"] = compute_ai_insights()
            AI_CACHE["ts"] = now
        except Exception:
            return None
    return AI_CACHE["data"]


def _build_chat_context():
    lines = []
    ai = _get_ai_cache_data()
    if ai:
        months = ai.get("months") or []
        if months:
            m = months[0]
            ov = m["overview"]
            lines.append(
                "MONTH %s (to date): attendance rate %s%% (%s present of %s records), absent records %s, "
                "late rate %s%% (%s late), avg working hours %sh, active employees %s of %s registered, "
                "worst unit %s." % (
                    m["label"], ov["attendance_rate"], ov["present_records"], ov["total_records"],
                    ov["absent_records"], ov["late_rate"], ov["late_records"], ov["avg_hours"],
                    ov["active_employees"], ov["total_employees"], ov["worst_unit"]["branch"] if ov["worst_unit"] else "none",
                )
            )
            for b in ov["by_branch"]:
                lines.append("- %s: records=%s, present=%s, absent=%s, late=%s, avg_hours=%sh, active=%s." % (
                    b["branch"], b["records"], b["present"], b["absent"], b["late"], b["hours"], b["active"]))
        if ai.get("anomalies"):
            lines.append("ANOMALIES TODAY: " + "; ".join(
                "[%s] %s (%s): %s - %s" % (a["severity"], a["employee"], a["branch"], a["type"], a["message"])
                for a in ai["anomalies"][:25]))
        if ai.get("risk"):
            lines.append("TOP RISK EMPLOYEES (30 days): " + "; ".join(
                "%s (%s) score %s: %s" % (r["name"], r["branch"], r["score"], ", ".join(r["reasons"]) or "consistent")
                for r in ai["risk"][:10]))

    # Full live roster per branch - every employee with current status
    for dev in LOCATIONS:
        cache = LIVE_CACHES.get(dev)
        if not cache:
            continue
        info = LOCATIONS[dev]
        name = info["name"]
        ds = cache.get("device_status", {})
        status = ds.get("status", "Offline")
        roster = []
        for emp in cache.get("employees_sorted", []):
            eid = str(emp.get("uid", "")).zfill(4) if str(emp.get("uid", "")).isdigit() else str(emp.get("uid", ""))
            db_status = emp.get("status")
            st = "IN" if db_status == "Present" else "OUT"
            roster.append("%s (ID %s, %s)" % (emp.get("name", "?"), eid, st))
        lines.append("BRANCH %s (device %s): %s present, %s absent. Roster: %s." % (
            name, status, cache.get("present", 0), cache.get("absent", 0),
            ", ".join(roster) if roster else "none"))

    # Yesterday's summary for historical questions
    try:
        today = datetime.now().date()
        yst = compute_day_summary(today - timedelta(days=1))
        if yst and yst.get("total_count"):
            lines.append("YESTERDAY: %s present, %s late, %s absent out of %s." % (
                yst["present_count"], yst["late_count"], yst["absent_count"], yst["total_count"]))
            if yst.get("late"):
                lines.append("YESTERDAY LATE: " + "; ".join(
                    "%s (%s) %d min" % (e["name"], e["branch"], e["minutes"]) for e in yst["late"][:20]))
            if yst.get("absent"):
                lines.append("YESTERDAY ABSENT: " + "; ".join(
                    "%s (%s)" % (e["name"], e["branch"]) for e in yst["absent"][:30]))
    except Exception:
        pass
    return "\n".join(lines)


@app.route("/api/chat", methods=["POST"])
def api_chat():
    body = request.get_json(silent=True) or {}
    q = str(body.get("question", "")).strip()
    if not q:
        return jsonify({"fallback": True})
    cfg = _load_chat_config()
    if not cfg["api_key"]:
        return jsonify({"fallback": True})
    system_text = (
        "You are the HRMS attendance assistant for Ulaganathan Associates (UA), a factory attendance dashboard "
        "covering the branches SS_Theevattipatti, SS_Sidco, NSRL Lab, SS SLP, UAI Neikarapatti and UAI HEAD OFFICE. "
        "Answer the user's question as completely as possible. Use the provided DATA when it contains the answer "
        "(for example employee names, IDs, branches, statuses, late lists, absence lists, monthly statistics). "
        "You can also answer general HRMS questions (leave policy, shifts, what a feature does) sensibly. Be concise, "
        "specific, and use employee names with their IDs and branch when listing people. If the data does not contain "
        "the answer, say so honestly and summarize what information is available."
    )
    context = _build_chat_context()
    cached = _chat_cache_get("chat:" + q)
    if cached:
        return jsonify({"answer": cached, "fallback": False, "cached": True})
    try:
        answer_text = _gemini_complete(cfg, system_text, "DATA:\n%s\n\nQUESTION: %s" % (context, q))
        _chat_cache_put("chat:" + q, answer_text)
        return jsonify({"answer": answer_text, "fallback": False})
    except Exception as e:
        return jsonify({
            "answer": "The AI assistant is momentarily overloaded (rate limit). Please ask again in about a minute.",
            "fallback": True,
            "detail": str(e)[:200],
        })


def _struct_prompt(q):
    return (
        "You convert a natural-language question about a factory attendance dashboard into a "
        "structured query. Return ONLY a JSON object - no markdown fences, no comments, no extra text.\n"
        'Schema: {"metric": string, "date_ref": string, "branch": string|null, "employee": string|null, "limit": number, "min_late": number|null}\n'
        "Metrics:\n"
        '- "late": who is late TODAY (live punches)\n'
        '- "absent": who has no punch TODAY\n'
        '- "present": who is currently punched in today\n'
        '- "logout": who logged out today\n'
        '- "earliest": earliest first punch today\n'
        '- "avg_checkin": average check-in time today\n'
        '- "branch_summary": status counts for a single branch (set branch)\n'
        '- "total_count": overall totals across branches\n'
        '- "day_late": late on a specific past day (set date_ref)\n'
        '- "day_absent": absent on a specific past day (set date_ref)\n'
        '- "hours_month": who worked the most hours this month\n'
        '- "streaks": best on-time streaks\n'
        '- "rate": monthly attendance rate summary\n'
        '- "absent_by_branch": absent records per branch (this month)\n'
        '- "risk": top at-risk employees (30 days)\n'
        '- "anomalies": today anomalies\n'
        '- "employee_status": status of one named employee (set employee)\n'
        "date_ref: 'today' | 'yesterday' | 'day_before_yesterday' | 'YYYY-MM-DD' | 'month'\n"
        "branch (exact name or null): SS_Theevattipatti, SS_Sidco, NSRL Lab, SS SLP, UAI Neikarapatti, UAI HEAD OFFICE\n"
        "min_late: only for metric late/day_late - filter to employees at least this many minutes late (else null)\n"
        "limit: max rows to list, default 15.\n"
        "Examples:\n"
        '- "who is late today?" -> {"metric":"late","date_ref":"today","branch":null,"employee":null,"limit":15,"min_late":null}\n'
        '- "who are all not on time today?" -> {"metric":"late","date_ref":"today","branch":null,"employee":null,"limit":15,"min_late":null}\n'
        '- "who was late yesterday?" -> {"metric":"day_late","date_ref":"yesterday","branch":null,"employee":null,"limit":15,"min_late":null}\n'
        '- "who came more than 90 minutes late yesterday?" -> {"metric":"day_late","date_ref":"yesterday","branch":null,"employee":null,"limit":15,"min_late":90}\n'
        '- "who was absent on 10 aug?" -> {"metric":"day_absent","date_ref":"2026-08-10","branch":null,"employee":null,"limit":15,"min_late":null}\n'
        '- "how is SS_Sidco doing today?" -> {"metric":"branch_summary","date_ref":"today","branch":"SS_Sidco","employee":null,"limit":15,"min_late":null}\n'
        '- "which branch has most absents?" -> {"metric":"absent_by_branch","date_ref":"month","branch":null,"employee":null,"limit":15,"min_late":null}\n'
        '- "status of Arulraj S" -> {"metric":"employee_status","date_ref":"today","branch":null,"employee":"Arulraj S","limit":1,"min_late":null}\n'
        '- "who worked most hours this month?" -> {"metric":"hours_month","date_ref":"month","branch":null,"employee":null,"limit":15,"min_late":null}\n'
        '- "any anomalies?" -> {"metric":"anomalies","date_ref":"today","branch":null,"employee":null,"limit":15,"min_late":null}\n'
        "Question: %s" % q
    )


def _gemini_json(cfg, prompt):
    text = _gemini_complete(cfg, "", prompt)
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text).strip()
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start:end + 1]
    obj = json.loads(text)
    if not isinstance(obj, dict):
        raise ValueError("structured query is not an object")
    return obj


def _resolve_date_ref(ref):
    now = datetime.now().date()
    r = (ref or "today").strip().lower()
    if r == "yesterday":
        return now - timedelta(days=1)
    if r in ("day_before_yesterday", "dby"):
        return now - timedelta(days=2)
    if r in ("today", ""):
        return now
    try:
        return datetime.strptime(r, "%Y-%m-%d").date()
    except ValueError:
        return now


def _day_label(d):
    diff = (datetime.now().date() - d).days
    if diff == 1:
        return "yesterday"
    if diff == 2:
        return "day before yesterday"
    return d.strftime("%a, %b %d")


def _parse_clock(text):
    m = re.match(r"\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)", str(text or ""))
    if not m:
        return None
    h = int(m.group(1)) % 12
    if m.group(4) == "PM":
        h += 12
    return h * 3600 + int(m.group(2)) * 60 + int(m.group(3))


def _fmt_clock(sec):
    h = (sec // 3600) % 24
    m = (sec % 3600) // 60
    s = sec % 60
    ap = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return "%02d:%02d:%02d %s" % (h12, m, s, ap)


def _fmt_duration(sec):
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    return "%02d:%02d:%02d" % (h, m, s)


def _work_seconds(punches, now_sec):
    times = []
    for t in punches:
        p = _parse_clock(t)
        if p is not None:
            times.append(p)
    if not times:
        return None
    first, last = times[0], times[-1]
    end = now_sec if len(times) % 2 == 1 else last
    if end < first:
        end += 86400
    return max(0, end - first)


def _live_rows():
    rows = []
    rules = _get_rules_cached()
    today = datetime.now().date()
    for dev_id, info in LOCATIONS.items():
        cache = LIVE_CACHES.get(dev_id)
        if not cache:
            continue
        for emp in cache.get("employees_sorted", []):
            punches = emp.get("punch_times") or []
            fsec = _parse_clock(punches[0]) if punches else None
            is_late = False
            minutes = 0
            shift_label = "General"
            if fsec is not None:
                is_late, minutes, shift_label = shift_late_minutes(dev_id, fsec, (emp.get("uid") or "").lstrip("0"))
                if _is_worked_rule_day(rules, dev_id, today):
                    is_late = False
            db_status = emp.get("status")
            status = "IN" if db_status == "Present" else "OUT"
            if status == "IN":
                derived = "late" if is_late else "working"
            else:
                derived = "logout" if punches else "absent"
            rows.append({
                "id": str(emp.get("uid", "")).zfill(4),
                "name": emp.get("name", "?"),
                "branch": info["name"],
                "device_id": dev_id,
                "status": derived,
                "minutes": minutes,
                "shift": shift_label,
                "punchTimes": list(punches),
                "lastPunch": emp.get("last_punch", ""),
                "fsec": fsec,
            })
    return rows


def _get_analytics_cached():
    now = time.time()
    if not ANALYTICS_CACHE["data"] or now - ANALYTICS_CACHE["ts"] > 60:
        ANALYTICS_CACHE["data"] = compute_analytics()
        ANALYTICS_CACHE["ts"] = now
    return ANALYTICS_CACHE["data"] or {}


def _exec_structured(sq):
    metric = sq.get("metric") or "total_count"
    branch = sq.get("branch") or None
    emp_q = str(sq.get("employee") or "").strip()
    try:
        limit = max(1, min(int(sq.get("limit") or 15), 50))
    except (TypeError, ValueError):
        limit = 15
    try:
        min_late = max(0, int(sq.get("min_late") or 0))
    except (TypeError, ValueError):
        min_late = 0

    rows = _live_rows()
    if branch:
        rows = [r for r in rows if r["branch"] == branch]

    if metric == "employee_status":
        matches = [r for r in rows if emp_q and emp_q.lower() in r["name"].lower()]
        if not matches:
            return "No employee found with that name."
        r = matches[0]
        now_dt = datetime.now()
        now_sec = now_dt.hour * 3600 + now_dt.minute * 60 + now_dt.second
        work = _work_seconds(r["punchTimes"], now_sec)
        st_text = {
            "working": "Working (on time)",
            "late": "Late by %d min" % r["minutes"],
            "logout": "Logged out",
            "absent": "Absent today",
        }.get(r["status"], r["status"])
        parts = ["%s (ID %s, %s) is %s" % (r["name"], r["id"], r["branch"], st_text)]
        if r["punchTimes"]:
            parts.append("Punches: " + " -> ".join(str(x) for x in r["punchTimes"]))
        if work is not None:
            parts.append("Working time: %s" % _fmt_duration(work))
        if r["status"] == "late":
            parts.append("Shift: %s" % r["shift"])
        return " ".join(parts)

    if metric == "early" or metric == "earliest":
        with_first = sorted((r for r in rows if r["fsec"] is not None), key=lambda r: r["fsec"])
        if not with_first:
            return "No one has punched in yet today."
        top = with_first[:5]
        out = "Earliest login today: %s by %s (%s)." % (
            _fmt_clock(top[0]["fsec"]), top[0]["name"], top[0]["branch"])
        nxt = ", ".join("%s (%s) at %s" % (r["name"], r["branch"], _fmt_clock(r["fsec"])) for r in top[1:])
        return out + ("\nNext: " + nxt if nxt else "")

    if metric == "avg_checkin":
        with_first = [r for r in rows if r["fsec"] is not None]
        if not with_first:
            return "No check-ins yet today."
        avg = int(sum(r["fsec"] for r in with_first) / len(with_first))
        return "Average check-in time today: %s across %d employees." % (_fmt_clock(avg), len(with_first))

    if metric == "branch_summary":
        if not rows:
            return "No employees found for that branch."
        c = {"working": 0, "late": 0, "logout": 0, "absent": 0}
        for r in rows:
            c[r["status"]] += 1
        dev_status = LIVE_CACHES.get(rows[0]["device_id"], {}).get("device_status", {}).get("status", "Offline")
        out = "%s: %d working, %d late, %d logged out, %d absent (%d total). Device %s." % (
            rows[0]["branch"], c["working"], c["late"], c["logout"], c["absent"], len(rows),
            "online" if dev_status == "Online" else "offline")
        if c["late"]:
            out += "\nLate: " + ", ".join("%s (%dm)" % (r["name"], r["minutes"]) for r in rows if r["status"] == "late")
        return out

    if metric == "late":
        late = [r for r in rows if r["status"] == "late" and r["minutes"] >= min_late]
        if not late:
            return "No one is late right now." if min_late == 0 else "No one is late by more than %d minutes right now." % min_late
        return "%d employee(s) late:\n" % len(late) + "\n".join(
            "- %s (%s): %d min late (%s shift)" % (r["name"], r["branch"], r["minutes"], r["shift"])
            for r in late[:limit])

    if metric == "absent":
        ab = [r for r in rows if r["status"] == "absent"]
        if not ab:
            return "No one is absent today."
        names = ", ".join("%s (%s)" % (r["name"], r["branch"]) for r in ab[:15])
        return "%d employee(s) absent today (no punches): %s%s" % (
            len(ab), names, " +%d more" % (len(ab) - 15) if len(ab) > 15 else "")

    if metric == "present":
        w = [r for r in rows if r["status"] in ("working", "late")]
        if not w:
            return "No one is currently punched in."
        return "%d employee(s) currently punched in: %s" % (len(w), ", ".join(r["name"] for r in w))

    if metric == "logout":
        lo = [r for r in rows if r["status"] == "logout"]
        if not lo:
            return "No one has logged out yet."
        lines = "\n".join("- %s (%s, last %s)" % (r["name"], r["branch"], r["lastPunch"] or "-") for r in lo[:15])
        return "%d employee(s) logged out:\n%s%s" % (
            len(lo), lines, "\n+%d more" % (len(lo) - 15) if len(lo) > 15 else "")

    if metric == "total_count":
        c = {"working": 0, "late": 0, "logout": 0, "absent": 0}
        for r in rows:
            c[r["status"]] += 1
        online = sum(1 for d in LOCATIONS if LIVE_CACHES.get(d, {}).get("device_status", {}).get("status") == "Online")
        return "Total %d employees: %d working, %d late, %d logged out, %d absent. Branches online: %d/%d." % (
            len(rows), c["working"], c["late"], c["logout"], c["absent"], online, len(LOCATIONS))

    if metric in ("day_late", "day_absent"):
        d = _resolve_date_ref(sq.get("date_ref"))
        summary = compute_day_summary(d)
        label = "%s (%s)" % (_day_label(d), d.isoformat())
        if metric == "day_late":
            late_list = [e for e in summary["late"] if e["minutes"] >= min_late]
            if not late_list:
                if min_late:
                    return "No one was more than %d minutes late on %s." % (min_late, label)
                return "No employees were late on %s." % label
            out = "%d employee(s) late on %s:\n" % (len(late_list), label) + "\n".join(
                "- %s (%s): %d min late (%s shift)" % (e["name"], e["branch"], e["minutes"], e["shift"])
                for e in late_list[:limit])
            if summary["unusual_count"]:
                out += "\n\n%d more had no punch before shift start (unusual arrival):\n" % summary["unusual_count"] + "\n".join(
                    "- %s (%s): first punch %s, %d min after %s shift start" % (
                        e["name"], e["branch"], e["first"], e["minutes"], e["shift"])
                    for e in summary["unusual"][:15])
            return out
        if not summary["absent_count"]:
            return "No one was absent on %s." % label
        names = ", ".join("%s (%s)" % (e["name"], e["branch"]) for e in summary["absent"][:15])
        return "%d employee(s) absent on %s: %s%s" % (
            summary["absent_count"], label, names,
            " +%d more" % (summary["absent_count"] - 15) if summary["absent_count"] > 15 else "")

    ai = _get_ai_cache_data()

    if metric == "rate":
        if not ai or not ai.get("months"):
            return "No monthly data available yet."
        m = ai["months"][0]
        o = m["overview"]
        return "%s so far: %s%% attendance (%s present of %s records), %s absent, %s late, avg %sh/day, %s active of %s employees." % (
            m["label"], o["attendance_rate"], o["present_records"], o["total_records"],
            o["absent_records"], o["late_records"], o["avg_hours"], o["active_employees"], o["total_employees"])

    if metric == "absent_by_branch":
        if not ai or not ai.get("months"):
            return "No branch data available."
        m = ai["months"][0]
        by_branch = m["overview"]["by_branch"]
        if branch:
            by_branch = [b for b in by_branch if b["branch"] == branch]
        sorted_b = sorted(by_branch, key=lambda b: -b["absent"])[:5]
        return "Absent records by branch (%s):\n" % m["label"] + "\n".join(
            "- %s: %d absent / %d present" % (b["branch"], b["absent"], b["present"]) for b in sorted_b)

    if metric == "risk":
        if not ai or not ai.get("risk"):
            return "No risk data available yet."
        top = [r for r in ai["risk"] if not branch or r["branch"] == branch][:8]
        return "Top at-risk employees (last 30 days):\n" + "\n".join(
            "- #%d %s (%s): score %s%s" % (
                i + 1, r["name"], r["branch"], r["score"],
                " - " + "; ".join(r["reasons"]) if r.get("reasons") else "")
            for i, r in enumerate(top))

    if metric == "anomalies":
        if not ai or not ai.get("anomalies"):
            return "No anomalies detected today - all clear."
        an = [a for a in ai["anomalies"] if not branch or a["branch"] == branch]
        high = len([a for a in an if a["severity"] == "High"])
        med = len([a for a in an if a["severity"] == "Medium"])
        low = len([a for a in an if a["severity"] == "Low"])
        return "%d anomalies today (%d high, %d medium, %d low):\n" % (len(an), high, med, low) + "\n".join(
            "- [%s] %s (%s): %s - %s" % (a["severity"], a["employee"], a["branch"], a["type"], a["message"])
            for a in an[:12])

    if metric == "hours_month":
        an = _get_analytics_cached()
        emps = an.get("employees") or []
        if branch:
            emps = [e for e in emps if e["branch"] == branch]
        top = sorted(emps, key=lambda e: -e["month"]["total_hours"])[:5]
        if not top:
            return "No hours data available yet."
        return "Most working hours this month:\n" + "\n".join(
            "- #%d %s (%s): %sh over %d days" % (
                i + 1, e["name"], e["branch"], e["month"]["total_hours"], e["month"]["present_days"])
            for i, e in enumerate(top))

    if metric == "streaks":
        an = _get_analytics_cached()
        top = an.get("leaders", {}).get("on_time_streak") or []
        if branch:
            top = [e for e in top if e["branch"] == branch]
        if not top:
            return "No streak data yet."
        return "Best on-time streaks:\n" + "\n".join(
            "- #%d %s (%s): %d days" % (i + 1, e["name"], e["branch"], e["current_on_time_streak"])
            for i, e in enumerate(top[:5]))

    return ("I can help with questions about attendance. Try asking who is late or absent today, "
            "yesterday's late/absent list, branch summaries, attendance rate, most hours, streaks, "
            "risk employees, or anomalies.")


@app.route("/api/ai/query", methods=["POST"])
def api_ai_query():
    body = request.get_json(silent=True) or {}
    q = str(body.get("question", "")).strip()
    if not q:
        return jsonify({"fallback": True})
    cached = _chat_cache_get("sq:" + q)
    if cached:
        return jsonify({"answer": cached, "structured": None, "fallback": False, "cached": True})
    cfg = _load_chat_config()
    try:
        if cfg["api_key"]:
            sq = _gemini_json(cfg, _struct_prompt(q))
            answer = _exec_structured(sq)
            if not answer or not str(answer).strip():
                raise ValueError("empty answer")
            _chat_cache_put("sq:" + q, answer)
            return jsonify({"answer": answer, "structured": sq, "fallback": False})
        raise ValueError("no api key")
    except Exception:
        return jsonify({"answer": None, "structured": None, "fallback": True, "error": "structured-query unavailable"})


def _compute_fact_candidates():
    cands = []
    today = datetime.now().date()
    yst = today - timedelta(days=1)

    def safe_day(d):
        try:
            return compute_day_summary(d)
        except Exception:
            return None

    ds_today = safe_day(today)
    ds_yst = safe_day(yst)
    ai = _get_ai_cache_data()

    if ds_today:
        late = ds_today.get("late") or []
        if late:
            big = [e for e in late if e["minutes"] >= 60]
            if big:
                cands.append(
                    "%d employee(s) were over an hour late today - worst: %s (%s, %d min)." % (
                        len(big), big[0]["name"], big[0]["branch"], big[0]["minutes"]))
            if ds_yst:
                cands.append("%d employee(s) late today vs %d yesterday." % (
                    len(late), len(ds_yst.get("late") or [])))
        if ds_today.get("unusual_count"):
            e = ds_today["unusual"][0]
            cands.append("Unusual arrival: %s (%s) first punched %s, %d min after shift start." % (
                e["name"], e["branch"], e["first"], e["minutes"]))
        if ds_today.get("absent_count"):
            ab = ds_today["absent"]
            if ds_yst and ds_yst.get("absent_count"):
                overlap = set(
                    (a["id"], a["branch"]) for a in ab
                ) & set((a["id"], a["branch"]) for a in ds_yst.get("absent") or [])
                if overlap:
                    cands.append("%d employee(s) absent today were also absent yesterday (repeat absenteeism)." % len(overlap))

    rows = _live_rows()
    if rows:
        by_br = {}
        for r in rows:
            b = by_br.setdefault(r["branch"], {"working": 0, "late": 0, "logout": 0, "absent": 0})
            b[r["status"]] += 1
        if by_br:
            worst = max(by_br.items(), key=lambda kv: kv[1]["absent"])
            if worst[1]["absent"] > 0:
                month_rate = None
                if ai and ai.get("months"):
                    for b in ai["months"][0]["overview"]["by_branch"]:
                        if b["branch"] == worst[0]:
                            den = b["present"] + b["absent"]
                            month_rate = round(100 * b["present"] / den, 1) if den else None
                            break
                cands.append("%s leads absents today with %d absent employees%s." % (
                    worst[0], worst[1]["absent"],
                    " (month attendance %s%%)" % month_rate if month_rate is not None else ""))
            best = max(by_br.items(), key=lambda kv: kv[1]["working"] + kv[1]["late"])
            if best[1]["working"] + best[1]["late"] > 0:
                cands.append("%s has the most employees on duty today (%d present)." % (
                    best[0], best[1]["working"] + best[1]["late"]))

    offline = [LOCATIONS[d]["name"] for d in LOCATIONS
               if LIVE_CACHES.get(d, {}).get("device_status", {}).get("status") != "Online"]
    if offline:
        cands.append("Device(s) offline: %s." % ", ".join(offline))

    if ai and ai.get("months"):
        months = ai["months"]
        if len(months) >= 2:
            a, b = months[0], months[1]
            diff = round(a["overview"]["attendance_rate"] - b["overview"]["attendance_rate"], 1)
            if diff:
                cands.append("Attendance rate %s: %s%% vs %s: %s%% (change %s%%, %s is %s)." % (
                    a["label"], a["overview"]["attendance_rate"], b["label"],
                    b["overview"]["attendance_rate"], diff, a["label"],
                    "up" if diff > 0 else "down"))
        m0 = months[0]["overview"]
        if m0.get("worst_unit"):
            cands.append("Worst unit this month: %s with %d absent records." % (
                m0["worst_unit"]["branch"], m0["worst_unit"]["absent"]))
        anom = ai.get("anomalies") or []
        if anom:
            high = len([x for x in anom if x["severity"] == "High"])
            if high:
                cands.append("%d high-severity anomaly/anomalies flagged today - check %s." % (
                    high, anom[0]["employee"]))

    try:
        an = _get_analytics_cached()
        emps = an.get("employees") or []
        late_streaks = [e for e in emps if e.get("current_late_streak", 0) >= 3]
        if late_streaks:
            late_streaks.sort(key=lambda e: -e["current_late_streak"])
            top_ls = late_streaks[0]
            cands.append("%s (%s) has been late %d day(s) in a row." % (
                top_ls["name"], top_ls["branch"], top_ls["current_late_streak"]))
        if ds_today and ds_today.get("absent_count") and an.get("leaders"):
            leaders = an["leaders"].get("on_time_streak") or []
            if leaders:
                names = {e["name"] for e in ds_today["absent"]}
                hit = [e for e in leaders if e["name"] in names]
                if hit:
                    cands.append("%s has a %d-day on-time streak but is absent today." % (
                        hit[0]["name"], hit[0]["current_on_time_streak"]))
        high_hours = [e for e in emps if e["month"].get("avg_hours", 0) >= 12 and e["month"].get("present_days", 0) >= 5]
        if high_hours:
            high_hours.sort(key=lambda e: -e["month"]["avg_hours"])
            e = high_hours[0]
            cands.append("%s (%s) averages %.1fh/day over %d days this month." % (
                e["name"], e["branch"], e["month"]["avg_hours"], e["month"]["present_days"]))
    except Exception:
        pass

    if rows:
        early = []
        for r in rows:
            if r["fsec"] is None:
                continue
            shift = SHIFTS.get(r["device_id"], DEFAULT_SHIFT)
            start = _hms(shift[0])
            if start - r["fsec"] >= 3600:
                early.append(r)
        if len(early) >= 2:
            cands.append("%d employee(s) arrived more than an hour before shift start today." % len(early))

    return cands


ML_MODELS_JSON = os.path.join(BASE_DIR, "ml", "models.json")
ML_CACHE = {"mtime": None, "data": None, "ts": 0.0}


def _get_ml_profiles():
    try:
        mtime = os.path.getmtime(ML_MODELS_JSON)
    except OSError:
        return None
    now = time.time()
    if ML_CACHE["data"] is not None and ML_CACHE["mtime"] == mtime and now - ML_CACHE["ts"] < 120:
        return ML_CACHE["data"]
    try:
        with open(ML_MODELS_JSON, "r", encoding="utf-8") as f:
            ML_CACHE["data"] = json.load(f)
        ML_CACHE["mtime"] = mtime
        ML_CACHE["ts"] = now
    except Exception:
        return None
    return ML_CACHE["data"]


@app.route("/api/ml/profiles")
def api_ml_profiles():
    data = _get_ml_profiles()
    if not data:
        return jsonify({"error": "No trained model available yet"}), 503
    return jsonify(data)


@app.route("/api/ai/facts")
def api_ai_facts():
    cached = _chat_cache_get("facts:")
    if cached:
        return jsonify({"facts": cached["facts"], "narrative": cached["narrative"], "fallback": False, "cached": True})
    try:
        candidates = _compute_fact_candidates()
    except Exception:
        return jsonify({"facts": [], "narrative": None, "fallback": True})
    narrative = None
    cfg = _load_chat_config()
    if cfg["api_key"] and candidates:
        prompt = (
            "You are a factory attendance analyst. The facts below were computed accurately "
            "from the attendance database today. Pick the 3 to 5 most interesting or unusual ones "
            "and rewrite them as concise one-line insights for a manager. Do NOT invent numbers "
            "or add facts that are not listed. Output plain text, one insight per line, no bullets.\n"
            "FACTS:\n" + "\n".join("- " + c for c in candidates)
        )
        try:
            narrative = _gemini_complete(cfg, "", prompt)
        except Exception:
            narrative = None
    _chat_cache_put("facts:", {"facts": candidates, "narrative": narrative})
    return jsonify({"facts": candidates, "narrative": narrative, "fallback": False})


def _parse_schedule_pattern(pattern):
    """Parse '42:10,24:10' -> [(device_id, days), ...]."""
    out = []
    if not pattern:
        return out
    for part in str(pattern).split(","):
        part = part.strip()
        if not part:
            continue
        try:
            dev, days = part.split(":")
            out.append((int(dev), int(days)))
        except (ValueError, AttributeError):
            continue
    return out


def _resolve_schedule_empids(conn, empid):
    """Return {empid} plus every empid linked to it via EmployeeLinks (both directions)."""
    ids = {empid}
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT EmployeeId, LinkedEmployeeId FROM EmployeeLinks
            WHERE EmployeeId = ? OR LinkedEmployeeId = ?
        """, empid, empid)
        for a, b in cur.fetchall():
            if a is not None:
                ids.add(int(a))
            if b is not None:
                ids.add(int(b))
    except pyodbc.Error:
        pass
    return ids


def _load_schedule(conn, empid):
    """Fetch the schedule (pattern + start date) for empid or any linked empid."""
    for eid in _resolve_schedule_empids(conn, empid):
        try:
            cur = conn.cursor()
            cur.execute("SELECT Pattern, StartDate FROM EmployeeSchedules WHERE EmployeeId = ?", eid)
            row = cur.fetchone()
            if row and row[0]:
                return _parse_schedule_pattern(row[0]), row[1]
        except pyodbc.Error:
            continue
    return None

def _schedule_device_for_day(schedule, day):
    """Given ([(dev, days)...], start_date), compute the device scheduled for a date."""
    if not schedule:
        return None
    segments, start = schedule
    if not segments or start is None:
        return None
    total = sum(d for _d, d in segments)
    if total <= 0:
        return None
    elapsed = (day - start).days
    if elapsed < 0:
        return None
    offset = elapsed % total
    for dev, days in segments:
        if offset < days:
            return dev
        offset -= days
    return segments[-1][0]


def _schedule_summary(schedule):
    """Human-readable summary like 'SS SLP x10, SS_Sidco x10'."""
    if not schedule:
        return None
    segments, start = schedule
    parts = []
    for dev, days in segments:
        name = LOCATIONS.get(dev, {}).get("name", "Device %d" % dev)
        parts.append("%s x%d" % (name, days))
    stxt = ", ".join(parts)
    if start:
        stxt += " (from %s)" % start.isoformat()
    return stxt


def _schedule_pattern_text(schedule):
    """Raw pattern text like '42:10,24:10'."""
    if not schedule:
        return None
    segments, start = schedule
    return ",".join("%d:%d" % (dev, days) for dev, days in segments)


def _load_rules(conn):
    """Load all AttendanceRules rows into a list of dicts."""
    out = []
    try:
        cur = conn.cursor()
        cur.execute("SELECT Id, DeviceId, RuleType, RuleDate, DayOfWeek, Name, Hours, "
                    "StartTime, EndTime, EmpId, StartDate, EndDate, WeekDays FROM AttendanceRules")
        for r in cur.fetchall():
            def _t(v):
                if v is None:
                    return None
                return v.strftime("%H:%M")
            def _d(v):
                if v is None:
                    return None
                return v.isoformat()
            def _wd(v):
                if not v:
                    return None
                try:
                    return [int(x) for x in str(v).split(",") if x.strip() != ""]
                except ValueError:
                    return None
            out.append({
                "id": int(r[0]),
                "device_id": int(r[1]),
                "type": str(r[2]).strip(),
                "date": r[3].isoformat() if r[3] is not None else None,
                "day_of_week": int(r[4]) if r[4] is not None else None,
                "name": str(r[5]).strip() if r[5] else None,
                "hours": float(r[6]) if r[6] is not None else None,
                "start": _t(r[7]),
                "end": _t(r[8]),
                "empid": int(r[9]) if r[9] is not None else None,
                "start_date": _d(r[10]),
                "end_date": _d(r[11]),
                "weekdays": _wd(r[12]),
            })
    except pyodbc.Error:
        pass
    return out


RULES_CACHE = {"ts": 0.0, "data": None}


def _get_rules_cached():
    now = time.time()
    if not RULES_CACHE["data"] or now - RULES_CACHE["ts"] > 300:
        try:
            conn = pyodbc.connect(DB_CONFIG)
            try:
                RULES_CACHE["data"] = _load_rules(conn)
                RULES_CACHE["ts"] = now
            finally:
                conn.close()
        except pyodbc.Error:
            pass
    return RULES_CACHE["data"] or []


def _rule_for_day(rules, device_id, day):
    """Find the AttendanceRule applying to a device on a date (None if none)."""
    if not rules:
        return None
    for r in rules:
        if r["device_id"] != device_id:
            continue
        if device_id in SIMPLE_MODE_DEVICES and r["type"] == "permission":
            continue
        if r["type"] == "weekly_off":
            if r["day_of_week"] is not None and day.weekday() == r["day_of_week"]:
                return r
        else:
            if r["date"] is not None and day.isoformat() == r["date"]:
                return r
    return None


@app.route("/api/employee/monthly")
def api_employee_monthly():
    try:
        device_id = int(request.args.get("device_id", "0"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid device_id"}), 400
    badge = request.args.get("id", "").strip()
    if not badge:
        return jsonify({"error": "Missing employee id"}), 400
    badge_q = badge.lstrip("0") or badge
    try:
        days_back = max(0, min(int(request.args.get("days", "120")), 365))
    except (TypeError, ValueError):
        days_back = 120

    now = datetime.now()
    cutoff = now - timedelta(days=days_back)

    conn = pyodbc.connect(DB_CONFIG)
    cursor = conn.cursor()

    name = None
    linked_targets = []
    try:
        cursor.execute("""
            SELECT e.EmployeeId, e.EmployeeName
            FROM DeviceUsers du
            LEFT JOIN Employees e ON du.EmployeeId = e.EmployeeId
            WHERE du.DeviceId = ? AND (e.EmployeeCodeInDevice IN (?, ?) OR e.EmployeeCode IN (?, ?))
        """, device_id, badge_q, badge, badge_q, badge)
        rows = cursor.fetchall()
        if rows:
            row = rows[0]
            if row[1]:
                name = str(row[1]).strip()
            empid = row[0]
        else:
            empid = None
    except pyodbc.Error:
        empid = None

    sched = _load_schedule(conn, empid) if empid is not None else None
    sched_summary = _schedule_summary(sched)
    rules = _load_rules(conn)

    # Linked employee = the same person enrolled on another device
    # (e.g. Senthamil selvan works 10 days at SS SLP and 10 at SIDCO).
    if empid is not None:
        try:
            cursor.execute("""
                SELECT e2.EmployeeCodeInDevice, e2.DeviceId, e2.EmployeeName
                FROM EmployeeLinks el
                JOIN DeviceUsers du2 ON du2.EmployeeId = el.LinkedEmployeeId
                JOIN Employees e2 ON e2.EmployeeId = du2.EmployeeId
                WHERE el.EmployeeId = ?
            """, empid)
            for r in cursor.fetchall():
                if r[0] is not None and r[1] is not None:
                    linked_targets.append({
                        "device_id": int(r[1]),
                        "badge": str(r[0]).lstrip("0") or str(r[0]),
                        "name": str(r[2]).strip() if r[2] else name,
                    })
        except pyodbc.Error:
            pass

    badge_variants = {badge_q, badge}
    if empid is not None:
        try:
            cursor.execute("""
                SELECT EmployeeCodeInDevice, EmployeeCode FROM Employees WHERE EmployeeId = ?
            """, empid)
            r = cursor.fetchone()
            if r:
                if r[0]:
                    badge_variants.add(str(r[0]).strip())
                    badge_variants.add(str(r[0]).strip().lstrip("0") or str(r[0]).strip())
                if r[1]:
                    badge_variants.add(str(r[1]).strip())
                    badge_variants.add(str(r[1]).strip().lstrip("0") or str(r[1]).strip())
        except pyodbc.Error:
            pass

    targets = [{"device_id": device_id, "badge": b, "name": name} for b in badge_variants if b]

    day_punches = {}
    day_device = {}
    seen = set()
    for tgt in targets:
        for table in LOG_TABLES:
            try:
                cursor.execute(f"""
                    SELECT UserId, LogDate FROM {table}
                    WHERE DeviceId = ? AND UserId = ? AND LogDate >= ?
                """, tgt["device_id"], tgt["badge"], cutoff)
                rows = cursor.fetchall()
            except pyodbc.Error:
                continue
            for r in rows:
                if r[1] is None:
                    continue
                skey = r[1]
                if skey in seen:
                    continue
                seen.add(skey)
                day_punches.setdefault(r[1].date(), []).append(r[1])
                day_device.setdefault(r[1].date(), tgt["device_id"])

    branch_active = {}
    for tgt in targets:
        for table in LOG_TABLES:
            try:
                cursor.execute(f"""
                    SELECT DISTINCT CONVERT(date, LogDate) FROM {table}
                    WHERE DeviceId = ? AND LogDate >= ?
                """, tgt["device_id"], cutoff)
                rows = cursor.fetchall()
            except pyodbc.Error:
                continue
            for r in rows:
                if r[0] is not None:
                    branch_active[r[0]] = True
    conn.close()

    for d in day_punches:
        day_punches[d].sort()

    _merge_night_crossovers(day_punches, device_id)

    days = []
    months = {}
    d = cutoff.date()
    while d <= now.date():
        mkey = d.strftime("%Y-%m")
        m = months.setdefault(mkey, {"month": mkey, "present": 0, "absent": 0, "on_time": 0, "late": 0, "total_hours": 0.0,
            "late_hours": 0.0, "extra_count": 0, "extra_hours": 0.0,
            "permission_count": 0, "permission_hours": 0.0, "half_day_count": 0,
            "overtime_count": 0, "overtime_hours": 0.0, "off_count": 0, "holiday_count": 0})
        row = {"date": d.strftime("%Y-%m-%d"), "dow": d.strftime("%a"), "status": "no_data", "first": None, "last": None,
               "hours": 0, "shift": None, "late_min": 0, "day_type": None, "extra_min": 0, "lunch": False}
        if sched:
            sched_dev = _schedule_device_for_day(sched, d)
            row["scheduled_device"] = sched_dev
            row["scheduled_branch"] = LOCATIONS.get(sched_dev, {}).get("name") if sched_dev is not None else None
        else:
            row["scheduled_device"] = None
            row["scheduled_branch"] = None
        row["day_device"] = day_device.get(d, device_id) if d in day_punches else None
        rule = _rule_for_day(rules, device_id, d)
        if rule:
            row["rule_type"] = rule["type"]
            row["rule_name"] = rule["name"]
            if rule.get("hours") is not None:
                row["rule_hours"] = rule["hours"]
        rule_off = rule and rule["type"] in ("weekly_off", "holiday")
        # Always set the roster shift label for every day - even on W.Off/Holiday days
        roster_shift = _roster_shift_label(device_id, badge_q, d)
        if not roster_shift and rule_off:
            roster_shift = "W.Off" if rule["type"] == "weekly_off" else "Holiday"
        elif not roster_shift:
            # No shift rule found - use device default (G for most employees)
            roster_shift = "G"
        row["shift"] = roster_shift
        is_sunday = d.weekday() == 6
        worked_rule_day = ((rule_off or roster_shift in ("W.Off", "Holiday")) and device_id in WORKED_RULE_DEVICES and d in day_punches) or (is_sunday and device_id in WORKED_RULE_DEVICES and d in day_punches)
        if worked_rule_day:
            p = _collapse_punches(day_punches[d])
            dev_for_day = day_device.get(d, device_id)
            c = _classify_day(dev_for_day, p, badge_q)
            m["present"] += 1
            m["total_hours"] += c["worked"] / 3600.0
            m["on_time"] += 1
            row["day_type"] = "present"
            row["status"] = "on_time"
            if device_id not in ROSTER_SHIFT_DEVICES:
                row["shift"] = c.get("shift_display") or row["shift"]
            if c["extra"] > 0:
                m["extra_count"] += 1
                m["extra_hours"] += c["extra"] / 3600.0
                m["overtime_count"] += 1
                m["overtime_hours"] += c["extra"] / 3600.0
                row["extra_min"] = round(c["extra"] / 60)
            row["first"] = p[0].strftime("%H:%M")
            row["last"] = p[-1].strftime("%H:%M") if len(p) % 2 == 0 else None
            row["hours"] = round(c["worked"] / 3600.0, 1)
            row["late_min"] = 0
            row["lunch"] = c["lunch"]
            row["incomplete"] = c["incomplete"]
        elif rule_off and roster_shift in ("W.Off", "Holiday"):
            row["status"] = rule["type"]
            if rule["type"] == "weekly_off":
                m["off_count"] += 1
            else:
                m["holiday_count"] += 1
        elif roster_shift in ("W.Off",):
            row["status"] = "weekly_off"
            m["off_count"] += 1
        elif is_sunday and device_id in WORKED_RULE_DEVICES:
            row["status"] = "weekly_off"
            m["off_count"] += 1
        elif d in day_punches:
            p = _collapse_punches(day_punches[d])
            dev_for_day = day_device.get(d, device_id)
            c = _classify_day(dev_for_day, p, badge_q)
            m["present"] += 1
            m["total_hours"] += c["worked"] / 3600.0
            if device_id not in ROSTER_SHIFT_DEVICES:
                row["shift"] = c.get("shift_display") or row["shift"]
            if rule and rule["type"] == "permission":
                row["day_type"] = "permission"
                m["permission_count"] += 1
                m["permission_hours"] += rule.get("hours") or 2.0
            else:
                row["day_type"] = c["day_type"]
                if c["day_type"] == "half_day":
                    m["half_day_count"] += 1
                elif c["day_type"] == "permission":
                    m["permission_count"] += 1
                    m["permission_hours"] += max(0, c["expected"] - c["worked"]) / 3600.0
            if c["is_late"]:
                m["late"] += 1
                m["late_hours"] += c["late_min"] / 60.0
                row["status"] = "late"
            elif c["day_type"] == "permission":
                # A sub-35% attendance day is a permission, not an on-time day.
                row["status"] = "permission"
            else:
                m["on_time"] += 1
                row["status"] = "on_time"
            if c["extra"] > 0:
                m["extra_count"] += 1
                m["extra_hours"] += c["extra"] / 3600.0
                m["overtime_count"] += 1
                m["overtime_hours"] += c["extra"] / 3600.0
                row["extra_min"] = round(c["extra"] / 60)
            row["first"] = p[0].strftime("%H:%M")
            row["last"] = p[-1].strftime("%H:%M") if len(p) % 2 == 0 else None
            row["hours"] = round(c["worked"] / 3600.0, 1)
            row["late_min"] = c["late_min"]
            row["lunch"] = c["lunch"]
            row["incomplete"] = c["incomplete"]
        elif branch_active.get(d):
            if rule and rule["type"] == "permission":
                row["status"] = "permission"
                m["permission_count"] += 1
                m["permission_hours"] += rule.get("hours") or 2.0
            else:
                m["absent"] += 1
                row["status"] = "absent"
        days.append(row)
        d += timedelta(days=1)

    for k in ("total_hours", "late_hours", "extra_hours", "permission_hours", "overtime_hours"):
        for mk in months:
            months[mk][k] = round(months[mk][k], 2)

    # Monthly leave policy: 1 paid leave per month
    # absent stays as raw leave count, adjusted_absent = absent - 1 (min 0)
    emp_name = (name or "").strip()
    for mk in months:
        m = months[mk]
        raw = m["absent"]
        if emp_name != "Rajendran" and raw > 0:
            m["adjusted_absent"] = max(0, raw - 1)
        else:
            m["adjusted_absent"] = raw

    return jsonify({
        "employee": {
            "name": name or "Employee " + badge,
            "id": badge,
            "branch": LOCATIONS.get(device_id, {}).get("name", "Branch"),
            "device_id": device_id,
            "linked": [
                {
                    "device_id": t["device_id"],
                    "branch": LOCATIONS.get(t["device_id"], {}).get("name", "Branch"),
                    "id": t["badge"].zfill(4) if t["badge"].isdigit() else t["badge"],
                }
                for t in linked_targets
            ],
            "schedule": sched_summary,
            "schedule_pattern": _schedule_pattern_text(sched),
        },
        "months": [months[k] for k in sorted(months.keys())],
        "days": days,
    })


@app.route("/api/monthly/summary")
def api_monthly_summary():
    """Monthly attendance summary for every enrolled employee (optional
    device_id filter). Used by the All Branches list. Computed from punch
    logs with shift-aware late/extra/permission/half-day classification."""
    month = request.args.get("month", "").strip()
    try:
        y, m = (int(x) for x in month.split("-"))
        mkey = "%04d-%02d" % (y, m)
    except Exception:
        return jsonify({"error": "month required as YYYY-MM"}), 400

    device_filter = request.args.get("device_id", "").strip()
    try:
        devices = [int(device_filter)] if device_filter else list(LOCATIONS.keys())
    except (TypeError, ValueError):
        devices = list(LOCATIONS.keys())

    import calendar as _cal
    first = date(y, m, 1)
    last = date(y, m, _cal.monthrange(y, m)[1])

    conn = pyodbc.connect(DB_CONFIG)
    cursor = conn.cursor()

    device_emps = {}
    try:
        placeholders = ",".join("?" for _ in devices)
        cursor.execute(f"""
            SELECT du.DeviceId, e.EmployeeCodeInDevice, e.EmployeeCode, e.EmployeeName, e.EmployeeId
            FROM DeviceUsers du
            LEFT JOIN Employees e ON du.EmployeeId = e.EmployeeId
            WHERE du.DeviceId IN ({placeholders})
        """, devices)
        for r in cursor.fetchall():
            dev = int(r[0])
            raw = r[1] if r[1] is not None else r[2]
            badge = str(raw).strip() if raw is not None and str(raw).strip() else ""
            name = str(r[3]).strip() if r[3] and str(r[3]).strip() else "Employee " + badge
            empid = r[4]
            if dev in LOCATIONS and badge:
                device_emps.setdefault(dev, {})[badge] = {"name": name, "empid": empid}
    except pyodbc.Error:
        pass

    table = None
    try:
        cursor.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'DeviceLogs[_]%'")
        for (tname,) in cursor.fetchall():
            t = str(tname)
            if t in ("DeviceLogs_%d_%d" % (m, y), "DeviceLogs_%02d_%d" % (m, y)):
                table = t
                break
    except pyodbc.Error:
        pass

    day_punches = {}
    active_dates = {}
    if table:
        try:
            placeholders = ",".join("?" for _ in devices)
            cursor.execute(f"""
                SELECT DeviceId, UserId, LogDate FROM {table}
                WHERE DeviceId IN ({placeholders}) AND CONVERT(date, LogDate) BETWEEN ? AND ?
            """, devices + [first.isoformat(), last.isoformat()])
            for r in cursor.fetchall():
                dev = int(r[0]); uid = str(r[1]).strip(); dt = r[2]
                if dt is None:
                    continue
                dk = dt.date()
                day_punches.setdefault((dev, uid, dk), []).append(dt)
                active_dates.setdefault((dev, dk), True)
        except pyodbc.Error:
            pass
    conn.close()

    rules = []
    try:
        c2 = pyodbc.connect(DB_CONFIG)
        rules = _load_rules(c2)
        c2.close()
    except pyodbc.Error:
        pass

    schedule_cache = {}
    for dev in devices:
        for info in device_emps.get(dev, {}).values():
            empid = info.get("empid")
            if empid is None:
                continue
            cache_key = empid
            if cache_key not in schedule_cache:
                try:
                    c2 = pyodbc.connect(DB_CONFIG)
                    schedule_cache[cache_key] = _load_schedule(c2, empid)
                    c2.close()
                except pyodbc.Error:
                    schedule_cache[cache_key] = None

    for key in day_punches:
        day_punches[key].sort()

    rows = []
    for dev in devices:
        bname = LOCATIONS.get(dev, {}).get("name", "Branch")
        active_set = {dk for (dv, dk) in active_dates if dv == dev}
        for badge, info in device_emps.get(dev, {}).items():
            name = info["name"]
            empid = info["empid"]
            dmap = {}
            for (dv, u, dk), p in day_punches.items():
                if dv == dev and u == badge:
                    dmap.setdefault(dk, []).extend(p)
            agg = _aggregate_month(dev, dmap, active_set, y, m, rules, badge)
            # Monthly leave policy: 1 paid leave per month
            # absent stays as raw leave count for "Leaves Full"
            # adjusted_absent = absent - 1 (min 0) for "Absent" display
            raw_absent = agg["absent"]
            if name.strip() != "Rajendran" and raw_absent > 0:
                agg["adjusted_absent"] = max(0, raw_absent - 1)
            else:
                agg["adjusted_absent"] = raw_absent
            sched = schedule_cache.get(empid)
            row = {
                "id": badge.zfill(4) if badge.isdigit() else badge,
                "name": name,
                "branch": bname,
                "device_id": dev,
                "schedule": _schedule_summary(sched),
                "schedule_pattern": _schedule_pattern_text(sched),
                **agg,
            }
            rows.append(row)
    rows.sort(key=lambda r: r["name"].lower())

    return jsonify({
        "month": mkey,
        "rows": rows,
        "note": "half_day + absent = total leaves; permission = worked <35% of shift, half_day = 35-75%, present >= 75%; lunch 13:00-13:30 deducted for general shift",
    })


def _resolve_employee_id(conn, device_id, badge):
    """Resolve device + badge -> Employees.EmployeeId (or None)."""
    badge_q = badge.lstrip("0") or badge
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT e.EmployeeId
            FROM DeviceUsers du
            LEFT JOIN Employees e ON du.EmployeeId = e.EmployeeId
            WHERE du.DeviceId = ? AND e.EmployeeCodeInDevice IN (?, ?)
        """, device_id, badge_q, badge)
        row = cur.fetchone()
        return int(row[0]) if row and row[0] is not None else None
    except pyodbc.Error:
        return None


@app.route("/api/schedule", methods=["GET"])
def api_schedule_get():
    try:
        device_id = int(request.args.get("device_id", "0"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid device_id"}), 400
    badge = request.args.get("id", "").strip()
    if not badge:
        return jsonify({"error": "Missing employee id"}), 400
    conn = pyodbc.connect(DB_CONFIG)
    empid = _resolve_employee_id(conn, device_id, badge)
    if empid is None:
        conn.close()
        return jsonify({"schedule": None, "schedule_pattern": None, "start": None})
    sched = _load_schedule(conn, empid)
    conn.close()
    return jsonify({
        "schedule": _schedule_summary(sched),
        "schedule_pattern": _schedule_pattern_text(sched),
        "start": sched[1].isoformat() if sched and sched[1] is not None else None,
    })


@app.route("/api/schedule", methods=["POST"])
def api_schedule_set():
    try:
        device_id = int(request.args.get("device_id", "0"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid device_id"}), 400
    badge = request.args.get("id", "").strip()
    if not badge:
        return jsonify({"error": "Missing employee id"}), 400
    body = request.get_json(silent=True) or {}
    pattern = str(body.get("pattern", "")).strip()
    start_raw = str(body.get("start", "")).strip()

    if pattern:
        segments = _parse_schedule_pattern(pattern)
        if not segments:
            return jsonify({"error": "Invalid pattern. Format: 42:10,24:10 (device:days)"}), 400
        if any(days <= 0 for _d, days in segments):
            return jsonify({"error": "Each rotation day count must be > 0"}), 400
    start = None
    if start_raw:
        try:
            start = datetime.strptime(start_raw, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "Invalid start date. Use YYYY-MM-DD"}), 400

    conn = pyodbc.connect(DB_CONFIG, autocommit=True)
    empid = _resolve_employee_id(conn, device_id, badge)
    if empid is None:
        conn.close()
        return jsonify({"error": "Employee not found"}), 404
    cur = conn.cursor()
    if pattern:
        if start is None:
            start = date.today()
        # Keep only one schedule row per person: clear rows on every linked empid first,
        # then write to the resolved empid. This avoids conflicting patterns between
        # e.g. Senthamil's SLP (2773) and SIDCO (2722) records.
        for eid in _resolve_schedule_empids(conn, empid):
            cur.execute("DELETE FROM EmployeeSchedules WHERE EmployeeId = ?", eid)
        cur.execute("""
            IF EXISTS (SELECT 1 FROM EmployeeSchedules WHERE EmployeeId = ?)
                UPDATE EmployeeSchedules SET Pattern = ?, StartDate = ?, CreatedDate = GETDATE() WHERE EmployeeId = ?
            ELSE
                INSERT INTO EmployeeSchedules (EmployeeId, Pattern, StartDate) VALUES (?, ?, ?)
        """, empid, pattern, start, empid, empid, pattern, start)
    else:
        for eid in _resolve_schedule_empids(conn, empid):
            cur.execute("DELETE FROM EmployeeSchedules WHERE EmployeeId = ?", eid)
    conn.close()
    return jsonify({"success": True, "employee_id": empid})


@app.route("/api/rules", methods=["GET"])
def api_rules_get():
    device_filter = request.args.get("device_id", "").strip()
    conn = pyodbc.connect(DB_CONFIG)
    rules = _load_rules(conn)
    conn.close()
    if device_filter:
        try:
            dv = int(device_filter)
            rules = [r for r in rules if r["device_id"] == dv]
        except (TypeError, ValueError):
            pass
    resp = make_response(jsonify({"rules": rules}))
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp


@app.route("/api/rules", methods=["POST"])
def api_rules_set():
    body = request.get_json(silent=True) or {}
    try:
        device_id = int(body.get("device_id", "0"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid device_id"}), 400
    rtype = str(body.get("type", "")).strip().lower()
    if rtype not in ("weekly_off", "holiday", "permission", "shift"):
        return jsonify({"error": "type must be weekly_off | holiday | permission | shift"}), 400
    name = str(body.get("name", "")).strip() or None

    conn = pyodbc.connect(DB_CONFIG, autocommit=True)
    cur = conn.cursor()
    try:
        if rtype == "shift":
            start_t = str(body.get("start_time", "")).strip()
            end_t = str(body.get("end_time", "")).strip()
            if not start_t or not end_t:
                return jsonify({"error": "start_time and end_time required (HH:MM) for shift"}), 400
            try:
                datetime.strptime(start_t, "%H:%M")
                datetime.strptime(end_t, "%H:%M")
            except (ValueError, TypeError):
                return jsonify({"error": "start_time/end_time must be HH:MM"}), 400

            empid = body.get("empid")
            empid_v = None
            if empid not in (None, "", 0):
                try:
                    empid_v = int(empid)
                except (TypeError, ValueError):
                    return jsonify({"error": "empid must be numeric"}), 400

            start_date = body.get("start_date")
            end_date = body.get("end_date")
            weekdays = body.get("weekdays")

            if start_date:
                try:
                    datetime.strptime(start_date, "%Y-%m-%d")
                except (ValueError, TypeError):
                    return jsonify({"error": "start_date must be YYYY-MM-DD"}), 400

            if end_date:
                try:
                    datetime.strptime(end_date, "%Y-%m-%d")
                except (ValueError, TypeError):
                    return jsonify({"error": "end_date must be YYYY-MM-DD"}), 400

            if weekdays is not None:
                if not isinstance(weekdays, list) or not all(isinstance(d, int) and 0 <= d <= 6 for d in weekdays):
                    return jsonify({"error": "weekdays must be a list of integers 0-6"}), 400
                weekdays_str = ",".join(str(d) for d in weekdays)
            else:
                weekdays_str = None

            cur.execute("""
                INSERT INTO AttendanceRules (DeviceId, RuleType, Name, StartTime, EndTime, EmpId, StartDate, EndDate, WeekDays)
                VALUES (?, 'shift', ?, ?, ?, ?, ?, ?, ?)
            """, device_id, name, start_t, end_t, empid_v, start_date, end_date, weekdays_str)
            RULES_CACHE["ts"] = 0.0  # invalidate cache
            return jsonify({"success": True})

        rdate = str(body.get("date", "")).strip()
        dow = body.get("day_of_week")
        hours = body.get("hours")
        rule_date = None
        if rtype in ("holiday", "permission"):
            if not rdate:
                return jsonify({"error": "date required for %s" % rtype}), 400
            rule_date = _parse_rule_date(rdate)
            if rule_date is None:
                return jsonify({"error": "date must be YYYY-MM-DD or DD-MM-YYYY for %s" % rtype}), 400
        else:
            try:
                dow = int(dow)
                if dow not in range(7):
                    raise ValueError
            except (TypeError, ValueError):
                return jsonify({"error": "day_of_week 0-6 (Mon=0, Sun=6) required for weekly_off"}), 400

        hours_v = None
        if hours is not None:
            try:
                hours_v = float(hours)
            except (TypeError, ValueError):
                return jsonify({"error": "hours must be numeric"}), 400

        cur.execute("""
            INSERT INTO AttendanceRules (DeviceId, RuleType, RuleDate, DayOfWeek, Name, Hours)
            VALUES (?, ?, ?, ?, ?, ?)
        """, device_id, rtype, rule_date, dow, name, hours_v)
        RULES_CACHE["ts"] = 0.0  # invalidate cache
        return jsonify({"success": True})
    finally:
        conn.close()


def _parse_rule_date(s):
    """Accept YYYY-MM-DD or DD-MM-YYYY (browser locale) and return a date."""
    for fmt in ("%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except (ValueError, TypeError):
            continue
    return None



@app.route("/api/rules/delete", methods=["POST"])
def api_rules_delete():
    body = request.get_json(silent=True) or {}
    try:
        rid = int(body.get("id", "0"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid rule id"}), 400
    conn = pyodbc.connect(DB_CONFIG, autocommit=True)
    cur = conn.cursor()
    cur.execute("DELETE FROM AttendanceRules WHERE Id = ?", rid)
    RULES_CACHE["ts"] = 0.0  # invalidate cache
    conn.close()
    return jsonify({"success": True})


@app.route("/api/admin/employee", methods=["POST"])
def api_admin_employee():
    """Create an attendance employee (a person tracked for punches). Inserts into
    Employees (mirroring the minimal required columns) and links a DeviceUsers
    record so the device can accept their punches. Guarded by an admin bearer session."""
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    badge = str(body.get("badge", "")).strip()
    try:
        device_id = int(body.get("device_id", "0"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid device_id"}), 400
    gender = str(body.get("gender", "Male")).strip() or "Male"
    req_empid = body.get("empid")
    empid_v = None
    if req_empid not in (None, "", 0):
        try:
            empid_v = int(req_empid)
            if empid_v <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"error": "emp id must be a positive integer"}), 400

    if not name:
        return jsonify({"error": "name is required"}), 400
    if not badge:
        return jsonify({"error": "badge (employee code) is required"}), 400
    if device_id not in LOCATIONS:
        return jsonify({"error": "unknown device_id"}), 400

    try:
        num_code = int(badge)
    except (TypeError, ValueError):
        num_code = 0

    conn = pyodbc.connect(DB_CONFIG)
    try:
        cur = conn.cursor()
        # If an explicit employee id was requested, verify it is free first.
        if empid_v is not None:
            cur.execute("SELECT 1 FROM Employees WHERE EmployeeId = ?", empid_v)
            if cur.fetchone():
                conn.rollback()
                return jsonify({"error": f"employee id {empid_v} already exists"}), 409

        if empid_v is not None:
            # Employees.EmployeeId is an IDENTITY column; insert the explicit id.
            cur.execute("SET IDENTITY_INSERT Employees ON")
            cur.execute("""
                INSERT INTO Employees
                    (EmployeeId, EmployeeName, EmployeeCode, StringCode, NumericCode, Gender,
                     CompanyId, DepartmentId, CategoryId, EmployeeCodeInDevice,
                     EmployementType, Status, DeviceId)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, empid_v, name, badge, "", num_code, gender, 1, 1, 1, badge,
                 "Permanent", "Working", device_id)
            cur.execute("SET IDENTITY_INSERT Employees OFF")
            empid = empid_v
        else:
            # Employees.EmployeeId is an IDENTITY column; capture the new id.
            cur.execute("""
                INSERT INTO Employees
                    (EmployeeName, EmployeeCode, StringCode, NumericCode, Gender,
                     CompanyId, DepartmentId, CategoryId, EmployeeCodeInDevice,
                     EmployementType, Status, DeviceId)
                OUTPUT INSERTED.EmployeeId
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, name, badge, "", num_code, gender, 1, 1, 1, badge,
                 "Permanent", "Working", device_id)
            row = cur.fetchone()
            if not row:
                conn.rollback()
                return jsonify({"error": "failed to create employee record"}), 500
            empid = int(row[0])
        cur.execute("""
            INSERT INTO DeviceUsers (DeviceId, EmployeeId, GroupId)
            VALUES (?, ?, 1)
        """, device_id, empid)
        conn.commit()
        return jsonify({
            "success": True,
            "employee_id": empid,
            "badge": badge,
            "device_id": device_id,
            "name": name,
        }), 201
    except pyodbc.IntegrityError as e:
        conn.rollback()
        msg = str(e)
        if "UNIQUE" in msg or "duplicate" in msg.lower():
            return jsonify({"error": f"badge '{badge}' already exists"}), 409
        return jsonify({"error": "database constraint error: " + msg}), 400
    except pyodbc.Error as e:
        conn.rollback()
        return jsonify({"error": "database error: " + str(e)}), 500
    finally:
        conn.close()


@app.route("/api/admin/employees", methods=["GET"])
def api_admin_employees():
    """List every attendance employee across all units (devices), for the admin
    Manage Employees panel. Guarded by an admin bearer session."""
    conn = pyodbc.connect(DB_CONFIG)
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT e.EmployeeId, e.EmployeeName, e.EmployeeCode,
                   e.EmployeeCodeInDevice, du.DeviceId, d.DeviceFName, d.DeviceLocation
            FROM Employees e
            LEFT JOIN DeviceUsers du ON du.EmployeeId = e.EmployeeId
            LEFT JOIN Devices d ON d.DeviceId = du.DeviceId
            ORDER BY CASE WHEN e.EmployeeCodeInDevice IS NOT NULL
                          AND ISNUMERIC(e.EmployeeCodeInDevice) = 1
                     THEN CAST(e.EmployeeCodeInDevice AS INT)
                     ELSE 999999 END, e.EmployeeName
        """)
        rows = []
        for r in cur.fetchall():
            rows.append({
                "empid": int(r[0]),
                "name": str(r[1]).strip() if r[1] else "",
                "badge": str(r[2]).strip() if r[2] else "",
                "code_in_device": str(r[3]).strip() if r[3] else "",
                "device_id": int(r[4]) if r[4] is not None else None,
                "device_name": str(r[5]).strip() if r[5] else None,
                "location": str(r[6]).strip() if r[6] else None,
            })
        return jsonify({"employees": rows})
    finally:
        conn.close()


@app.route("/api/admin/employee/<int:empid>", methods=["GET"])
def api_admin_employee_lookup(empid):
    """Look up a single employee by id (used to validate the Emp ID entered in
    the Shift Rule form and show the employee name)."""
    conn = pyodbc.connect(DB_CONFIG)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT EmployeeId, EmployeeName, EmployeeCode FROM Employees WHERE EmployeeId=?",
            empid)
        r = cur.fetchone()
        if not r:
            return jsonify({"exists": False}), 404
        return jsonify({
            "exists": True,
            "empid": int(r[0]),
            "name": str(r[1]).strip() if r[1] else "",
            "badge": str(r[2]).strip() if r[2] else "",
        })
    finally:
        conn.close()


@app.route("/api/admin/employee/lookup", methods=["GET"])
def api_admin_employee_lookup_code():
    """Look up an employee by their CODE (badge / punch id) — the identifier users
    enter in the Shift Rule form. Returns the name so the UI can validate and show it."""
    code = (request.args.get("code") or "").strip()
    device = request.args.get("device_id")
    if not code:
        return jsonify({"exists": False}), 404
    conn = pyodbc.connect(DB_CONFIG)
    try:
        cur = conn.cursor()
        if device:
            # Employee codes are per-device; scope the lookup so the right person
            # on the chosen branch is found (badge lives in Employees.EmployeeCode).
            cur.execute("""
                SELECT e.EmployeeId, e.EmployeeName, e.EmployeeCode
                FROM DeviceUsers du
                JOIN Employees e ON e.EmployeeId = du.EmployeeId
                WHERE du.DeviceId = ? AND e.EmployeeCode = ?
            """, int(device), code)
        else:
            cur.execute(
                "SELECT EmployeeId, EmployeeName, EmployeeCode FROM Employees WHERE EmployeeCode=?",
                code)
        r = cur.fetchone()
        if not r:
            return jsonify({"exists": False}), 404
        return jsonify({
            "exists": True,
            "empid": int(r[0]),
            "name": str(r[1]).strip() if r[1] else "",
            "badge": str(r[2]).strip() if r[2] else "",
        })
    finally:
        conn.close()


@app.route("/api/admin/employee", methods=["DELETE"])
def api_admin_employee_delete():
    """Delete an attendance employee: removes the DeviceUsers links and the
    Employees row. Guarded by an admin bearer session."""
    body = request.get_json(silent=True) or {}
    try:
        empid = int(body.get("empid") if body.get("empid") is not None else request.args.get("empid"))
    except (TypeError, ValueError):
        return jsonify({"error": "empid required"}), 400
    conn = pyodbc.connect(DB_CONFIG, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM Employees WHERE EmployeeId=?", empid)
        if not cur.fetchone():
            return jsonify({"error": "employee not found"}), 404
        cur.execute("DELETE FROM DeviceUsers WHERE EmployeeId=?", empid)
        cur.execute("DELETE FROM Employees WHERE EmployeeId=?", empid)
        return jsonify({"success": True, "employee_id": empid})
    finally:
        conn.close()


# ----------------------------------------------------------------------------
# Unit roster (UARoster): the authorised per-unit employee list.
# Stored in the ESSL SQL Server database (eTimetracklite1) so the roster lives
# next to the attendance data and is served to the dashboard UI.
# Employees WITHOUT a punch id are stored with EmployeeCode = NULL and shown
# as "Pending ID" in the UI (they cannot be enrolled on a device until coded).
# ----------------------------------------------------------------------------

ROSTER_SEED = [
    # (device_id, punch_code or None, name)
    # Uai Nkp Unit (58)
    (58, '2', 'P Radhakrishnan'), (58, '5', 'K Mohan'), (58, '14', 'A Manohar'),
    (58, '4', 'M Nirmal Raj'), (58, '1', 'S VasanthaKumar'), (58, '6', 'A Kannan'),
    (58, '15', 'S Vellaisamy'), (58, '16', 'K Vasu'), (58, '3', 'P Arumugam'),
    (58, '8', 'M Kathiresan'), (58, '11', 'C Nadesan'), (58, '10', 'V Karthi'),
    (58, '18', 'P Vimal Raj'), (58, '7', 'E Chelladurai'), (58, '13', 'P Gandhieswari'),
    (58, None, 'Virendhar'), (58, None, 'Krishnamoorthy'),
    (58, '12', 'Mahaboob alli basha'), (58, '9', 'Kumar'),
    # SS Slp Unit (42)
    (42, '52', 'Vijayaraja'), (42, '1', 'Diwakar'), (42, '15', 'Pradeep Kumar'),
    (42, '17', 'Senthamil Selavan'), (42, '8', 'Vinayakumar'), (42, '13', 'Sathishkumar'),
    (42, '12', 'Gobinath'), (42, '41', 'Devaraj'), (42, '5', 'Ashok'),
    (42, '6', 'Durairaj'), (42, '14', 'Dhakshnamoorthi'), (42, '42', 'Gokul Sri'),
    (42, '44', 'Suganeshwar'), (42, '47', 'Vadivelan'), (42, '53', 'Gowtham'),
    (42, '45', 'Chandran'), (42, '49', 'Kesavan'), (42, '28', 'Rajasekar'),
    (42, '26', 'Govindaraj'), (42, '27', 'Thiyagarajan'), (42, '25', 'Janakaraj'),
    (42, '34', 'Manikandan'), (42, '30', 'Vivek'), (42, None, 'Vikram'),
    # Head office (59)
    (59, '20', 'Selvam.R GM'), (59, '6', 'Annamalai'), (59, '12', 'Bhuwaneshwari Reception'),
    (59, '5', 'Dr. Ganesh'), (59, '30', 'Boopathy'), (59, '13', 'Deepika'),
    (59, '11', 'Janani'), (59, '14', 'Malathi'), (59, '8', 'Nirmala'),
    (59, '28', 'Phuvaneshwari sales'), (59, '3', 'Ponni'), (59, '25', 'Prasanth'),
    (59, '32', 'Rajendiran'), (59, '26', 'Rajkumar'), (59, '24', 'Sathiya'),
    (59, '7', 'Selvabhavani'), (59, '9', 'Sri Ram'), (59, '10', 'Thinikaivel'),
    (59, '17', 'Vijayakumar'), (59, '31', 'Yeswini'),
    # SS TVP Unit (23) — R.Manikandan/9 is person A (kept)
    (23, '1', 'Arulraj'), (23, '2', 'K.Manikandan'), (23, '3', 'Dinakaran'),
    (23, '4', 'R.kumaresan'), (23, '6', 'Jeeva'), (23, '8', 'J.Gopinath'),
    (23, '5', 'Dhanraj'), (23, '7', 'Mathesh'), (23, '13', 'Sabarinathan'),
    (23, '9', 'R.Manikandan'), (23, '10', 'Surya'), (23, '11', 'Babu'),
    (23, '12', 'Kallial salam'),
    # Nsrl Lab (25) — P.Renugadevi corrected to 11, S.Prabha is 1;
    # R.Manikandan/23 is person B (kept)
    (25, '4', 'K.Muruganagendran'), (25, '13', 'k.Anbarasu'), (25, '8', 'R.Kavitha'),
    (25, '20', 'C.Priya'), (25, None, 'S.Booparhi'), (25, '11', 'P.Renugadevi'),
    (25, '7', 'S.Saranya'), (25, '14', 'G.Narayanan'), (25, '17', 'S.Sankar'),
    (25, '23', 'R.Manikandan'), (25, '25', 'S.Bhuvaneshwari'), (25, '2', 'S.Rama'),
    (25, '1', 'S.Prabha'), (25, '21', 'Prakash'), (25, '3', 'Arockiyameri'),
    # SS Sidco (24)
    (24, '2', 'karthik G'), (24, '1', 'Daniel'), (24, '3', 'Gokulan. S'),
    (24, '4', 'Anish Joseph'), (24, '8', 'Nitishwaren'), (24, '6', 'Gunal s'),
    (24, '5', 'Mohan Raj'),
]


def _ensure_roster_table(cur):
    """Create dbo.UARoster once if it does not exist. Safe to call every time."""
    cur.execute("""
        IF OBJECT_ID('dbo.UARoster', 'U') IS NULL
        CREATE TABLE dbo.UARoster (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            DeviceId INT NOT NULL,
            EmployeeCode VARCHAR(50) NULL,
            EmployeeName NVARCHAR(200) NOT NULL,
            CreatedAt DATETIME NOT NULL DEFAULT(GETDATE())
        )
    """)
    cur.execute("""
        IF NOT EXISTS (SELECT 1 FROM sys.indexes
                       WHERE name = 'UX_UARoster_DeviceCode' AND object_id = OBJECT_ID('dbo.UARoster'))
        CREATE UNIQUE INDEX UX_UARoster_DeviceCode ON dbo.UARoster (DeviceId, EmployeeCode)
        WHERE EmployeeCode IS NOT NULL
    """)


@app.route("/api/roster", methods=["GET"])
def api_roster_list():
    """Unit-wise authorised roster with live enrolment flags.
    Each row reports whether the punch code is enrolled on the device
    (DeviceUsers link) and present in the Employees master table, so the UI
    can highlight wrong-unit mappings and people missing from the device."""
    device_filter = request.args.get("device_id", "").strip()
    conn = pyodbc.connect(DB_CONFIG)
    try:
        cur = conn.cursor()
        _ensure_roster_table(cur)
        conn.commit()
        sql = """
            SELECT r.Id, r.DeviceId, r.EmployeeCode, r.EmployeeName,
                   CASE WHEN m.EmployeeId IS NULL THEN 0 ELSE 1 END AS Enrolled,
                   CASE WHEN m.InMaster IS NULL OR m.InMaster = 0 THEN 0 ELSE 1 END AS InMaster,
                   m.DbName AS DbName
            FROM dbo.UARoster r
            LEFT JOIN (
                SELECT du.DeviceId AS DevId,
                       LTRIM(RTRIM(CAST(e.EmployeeCode AS VARCHAR(50)))) AS Code,
                       MIN(e.EmployeeId) AS EmployeeId,
                       MIN(e.EmployeeName) AS DbName,
                       MAX(CASE WHEN e.DeviceId = du.DeviceId THEN 1 ELSE 0 END) AS InMaster
                FROM DeviceUsers du
                JOIN Employees e ON e.EmployeeId = du.EmployeeId
                GROUP BY du.DeviceId, LTRIM(RTRIM(CAST(e.EmployeeCode AS VARCHAR(50))))
            ) m ON m.DevId = r.DeviceId
               AND r.EmployeeCode IS NOT NULL
               AND m.Code = r.EmployeeCode
        """
        params = []
        if device_filter:
            try:
                sql += " WHERE r.DeviceId = ?"
                params.append(int(device_filter))
            except (TypeError, ValueError):
                pass
        sql += " ORDER BY r.DeviceId, CASE WHEN r.EmployeeCode IS NULL THEN 1 ELSE 0 END,"
        sql += " CASE WHEN ISNUMERIC(r.EmployeeCode) = 1 THEN CAST(r.EmployeeCode AS INT) ELSE 999999 END,"
        sql += " r.EmployeeName"
        cur.execute(sql, params)
        rows = []
        for r in cur.fetchall():
            rows.append({
                "id": int(r[0]),
                "device_id": int(r[1]),
                "code": (str(r[2]).strip() if r[2] is not None else None),
                "name": str(r[3]).strip() if r[3] else "",
                "enrolled": bool(r[4]),
                "in_master": bool(r[5]),
                "db_name": (str(r[6]).strip() if r[6] else None),
            })
        units = [
            {"device_id": did, "name": loc.get("name", str(did)),
             "location": loc.get("location", "")}
            for did, loc in LOCATIONS.items()
        ]
        resp = make_response(jsonify({"units": units, "roster": rows, "total": len(rows)}))
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return resp
    finally:
        conn.close()


@app.route("/api/roster", methods=["POST"])
def api_roster_upsert():
    """Add / edit / move a roster entry (insert when no id, update when id is
    given; changing device_id moves the person to another unit).
    Guarded by an admin bearer session. Managers are read-only in the UI."""
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    try:
        device_id = int(body.get("device_id", "0"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid device_id"}), 400
    raw_code = body.get("code", "")
    code = str(raw_code).strip() if raw_code is not None else ""
    code = code if code else None
    rid = body.get("id")
    try:
        rid = int(rid) if rid not in (None, "") else None
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid id"}), 400
    if not name:
        return jsonify({"error": "name is required"}), 400
    if device_id not in LOCATIONS:
        return jsonify({"error": "unknown device_id"}), 400
    conn = pyodbc.connect(DB_CONFIG)
    try:
        cur = conn.cursor()
        _ensure_roster_table(cur)
        if code is not None:
            cur.execute(
                "SELECT Id, EmployeeName FROM dbo.UARoster WHERE DeviceId = ? AND EmployeeCode = ?"
                + (" AND Id <> ?" if rid else ""),
                (device_id, code, rid) if rid else (device_id, code),
            )
            clash = cur.fetchone()
            if clash:
                return jsonify({"error": "Punch ID %s is already used in this unit by '%s'"
                                         % (code, str(clash[1]).strip())}), 409
        cur.execute(
            "SELECT Id FROM dbo.UARoster WHERE DeviceId = ? AND UPPER(LTRIM(RTRIM(EmployeeName))) = UPPER(?)"
            + (" AND Id <> ?" if rid else ""),
            (device_id, name, rid) if rid else (device_id, name),
        )
        if cur.fetchone():
            return jsonify({"error": "An employee with this name already exists in this unit"}), 409
        if rid:
            cur.execute("SELECT 1 FROM dbo.UARoster WHERE Id = ?", rid)
            if not cur.fetchone():
                return jsonify({"error": "roster entry not found"}), 404
            cur.execute(
                "UPDATE dbo.UARoster SET DeviceId = ?, EmployeeCode = ?, EmployeeName = ? WHERE Id = ?",
                device_id, code, name, rid,
            )
            conn.commit()
            return jsonify({"success": True, "id": rid})
        cur.execute(
            "INSERT INTO dbo.UARoster (DeviceId, EmployeeCode, EmployeeName) VALUES (?, ?, ?)",
            device_id, code, name,
        )
        cur.execute("SELECT @@IDENTITY")
        new_id = int(cur.fetchone()[0])
        conn.commit()
        return jsonify({"success": True, "id": new_id}), 201
    finally:
        conn.close()


@app.route("/api/roster", methods=["DELETE"])
def api_roster_delete():
    """Remove a roster entry by id. Guarded by an admin bearer session.
    This only removes the roster row — ESSL enrolment/device data is untouched."""
    body = request.get_json(silent=True) or {}
    try:
        rid = int(body.get("id") if body.get("id") is not None else request.args.get("id"))
    except (TypeError, ValueError):
        return jsonify({"error": "id required"}), 400
    conn = pyodbc.connect(DB_CONFIG, autocommit=True)
    try:
        cur = conn.cursor()
        _ensure_roster_table(cur)
        cur.execute("SELECT 1 FROM dbo.UARoster WHERE Id = ?", rid)
        if not cur.fetchone():
            return jsonify({"error": "roster entry not found"}), 404
        cur.execute("DELETE FROM dbo.UARoster WHERE Id = ?", rid)
        return jsonify({"success": True, "id": rid})
    finally:
        conn.close()


@app.route("/api/roster/seed", methods=["POST"])
def api_roster_seed():
    """One-time load of the authorised 98-name unit roster (94 coded + 4 pending).
    Existing rows (matched by device + code, or device + name for pending rows)
    are skipped, so re-running is safe. Guarded by an admin bearer session."""
    conn = pyodbc.connect(DB_CONFIG)
    try:
        cur = conn.cursor()
        _ensure_roster_table(cur)
        inserted = 0
        skipped = 0
        for dev, code, nm in ROSTER_SEED:
            if code is not None:
                cur.execute(
                    "SELECT 1 FROM dbo.UARoster WHERE DeviceId = ? AND EmployeeCode = ?",
                    dev, code,
                )
            else:
                cur.execute(
                    "SELECT 1 FROM dbo.UARoster WHERE DeviceId = ? AND EmployeeCode IS NULL"
                    " AND UPPER(LTRIM(RTRIM(EmployeeName))) = UPPER(?)",
                    dev, nm,
                )
            if cur.fetchone():
                skipped += 1
                continue
            cur.execute(
                "INSERT INTO dbo.UARoster (DeviceId, EmployeeCode, EmployeeName) VALUES (?, ?, ?)",
                dev, code, nm,
            )
            inserted += 1
        conn.commit()
        return jsonify({"success": True, "inserted": inserted,
                        "skipped": skipped, "total": len(ROSTER_SEED)})
    finally:
        conn.close()


@app.route("/api/admin/pool", methods=["GET"])
def api_admin_pool():
    """Read-only IIS application-pool status for the admin command palette.
    This does NOT restart the pool (status only) — it reports the current state
    and the command an admin can run manually."""
    import subprocess
    pool_name = "DefaultAppPool"
    state = "Started (app responding)"
    detail = None
    cmd = "Restart-WebAppPool -Name \"%s\"" % pool_name
    try:
        ps = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Import-Module WebAdministration -ErrorAction SilentlyContinue; "
             "(Get-WebAppPoolState -Name '%s').Value" % pool_name],
            capture_output=True, text=True, timeout=15,
        )
        if ps.returncode == 0 and ps.stdout.strip():
            state = ps.stdout.strip()
        elif ps.stderr.strip():
            detail = "pool-state read needs elevation: " + ps.stderr.strip()[:160]
    except Exception as e:
        detail = str(e)[:160]
    return jsonify({
        "pool_name": pool_name,
        "state": state,
        "restart_command": cmd,
        "detail": detail,
        "note": "Click 'Restart Pool' to recycle the app pool. Dashboard goes offline ~10–20s, then comes back with fresh data.",
    })


@app.route("/api/admin/pool/restart", methods=["POST"])
def api_admin_pool_restart():
    """Recycle the IIS app pool. Writes a trigger file that a background
    watcher process (running as SYSTEM) picks up and runs appcmd recycle."""
    pool_name = "DefaultAppPool"
    trigger = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_restart.trigger")
    try:
        with open(trigger, "w") as f:
            f.write(str(datetime.now()))
        return jsonify({"success": True,
                        "message": "Recycle triggered for %s. Dashboard offline ~10-20s." % pool_name})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)[:200]}), 500



def get_backup_files():
    """List .bak backup files on disk with metadata."""
    backups = []
    try:
        if os.path.isdir(BACKUP_DIR):
            for f in os.listdir(BACKUP_DIR):
                if f.lower().endswith(".bak"):
                    p = os.path.join(BACKUP_DIR, f)
                    st = os.stat(p)
                    backups.append({
                        "name": f,
                        "size": st.st_size,
                        "size_mb": round(st.st_size / (1024 * 1024), 2),
                        "mtime": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %I:%M:%S %p"),
                    })
    except Exception as e:
        backups = []
    backups.sort(key=lambda b: b["mtime"], reverse=True)
    return backups

def verify_backup_file(path):
    """Read a .bak header via RESTORE HEADERONLY to check validity."""
    try:
        conn = pyodbc.connect(DB_CONFIG)
        cur = conn.cursor()
        cur.execute("RESTORE HEADERONLY FROM DISK = ?", path)
        cols = [c[0] for c in cur.description]
        rows = cur.fetchall()
        conn.close()
        if not rows:
            return {"valid": False, "error": "No backup header found"}
        r = rows[0]
        d = dict(zip(cols, r))
        return {
            "valid": bool(not d.get("IsDamaged")),
            "database": str(d.get("DatabaseName", "")),
            "server": str(d.get("ServerName", "")),
            "start_date": str(d.get("BackupStartDate", ""))[:19],
            "finish_date": str(d.get("BackupFinishDate", ""))[:19],
            "backup_type": str(d.get("BackupTypeDescription", "")),
            "backup_size_mb": round(float(d.get("BackupSize") or 0) / (1024 * 1024), 2),
            "machine": str(d.get("MachineName", "")),
            "damaged": bool(d.get("IsDamaged")),
        }
    except Exception as e:
        return {"valid": False, "error": str(e)}

def create_sql_backup():
    """Run a full backup of eTimetracklite1 to C:\\Backups."""
    name = "essl_backup_%s.bak" % datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(BACKUP_DIR, name)
    try:
        if not os.path.isdir(BACKUP_DIR):
            os.makedirs(BACKUP_DIR)
        conn = pyodbc.connect(DB_CONFIG, autocommit=True)
        cur = conn.cursor()
        cur.execute("BACKUP DATABASE [" + DB_DATABASE.replace("]", "]]") + "] TO DISK = ? WITH INIT", path)
        while cur.nextset():
            pass
        conn.close()
        if not os.path.isfile(path):
            return {"success": False, "error": "Backup file was not created"}
        return {"success": True, "name": name, "path": path, "size": os.path.getsize(path)}
    except Exception as e:
        return {"success": False, "error": str(e)}

def log_table_rows():
    """Row counts of the monthly DeviceLogs tables (the actual backup data)."""
    out = []
    try:
        conn = pyodbc.connect(DB_CONFIG)
        cur = conn.cursor()
        cur.execute("""
            SELECT t.name, SUM(p.rows) AS total_rows
            FROM sys.tables t
            JOIN sys.partitions p ON t.object_id = p.object_id
            WHERE t.name LIKE 'DeviceLogs%' AND p.index_id IN (0, 1)
            GROUP BY t.name
            ORDER BY t.name
        """)
        for r in cur.fetchall():
            out.append({"table": r[0], "rows": int(r[1] or 0)})
        conn.close()
    except Exception:
        pass
    return out

BACKUP_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>Backup - Attendance Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .header h1 { font-size: 1.3rem; color: #0f172a; }
        .header h1 span { color: #2563eb; }
        .card { background: #ffffff; border-radius: 10px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 20px; }
        .card h2 { font-size: 1rem; color: #0f172a; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f8fafc; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 14px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        td { padding: 8px 14px; border-bottom: 1px solid #f1f5f9; font-size: 0.85rem; color: #334155; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
        .badge-ok { background: #d1fae5; color: #059669; }
        .badge-bad { background: #fee2e2; color: #dc2626; }
        .btn { padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; font-weight: 500; cursor: pointer; text-decoration: none; display: inline-block; border: none; }
        .btn-primary { background: #2563eb; color: white; }
        .btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
        .btn-sm { padding: 4px 10px; font-size: 0.75rem; }
        .btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
        .nav-links { display: flex; gap: 8px; }
        .msg { background: #d1fae5; color: #059669; padding: 10px; border-radius: 6px; font-size: 0.85rem; margin-bottom: 12px; }
        .err { background: #fee2e2; color: #dc2626; padding: 10px; border-radius: 6px; font-size: 0.85rem; margin-bottom: 12px; }
        .empty { color: #94a3b8; text-align: center; padding: 20px; font-size: 0.85rem; }
        .mono { font-family: Consolas, monospace; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Database <span>Backup</span></h1>
        <div class="nav-links">
            <a href="/UA/" class="btn btn-secondary">Dashboard</a>
        </div>
    </div>

    <div id="msg"></div>

    <div class="card">
        <h2>Create Backup</h2>
        <button id="create-btn" class="btn btn-primary" onclick="createBackup()">Create Backup Now</button>
        <span id="create-status" style="margin-left:10px;font-size:0.8rem;color:#64748b"></span>
    </div>

    <div class="card">
        <h2>Backup Files</h2>
        <table>
            <thead><tr><th>File</th><th>Size</th><th>Created</th><th>Status</th><th>Database</th><th>Backup Type</th><th>Finished</th><th></th></tr></thead>
            <tbody id="file-tbody">
                <tr><td colspan="8" class="empty">Loading...</td></tr>
            </tbody>
        </table>
    </div>

    <div class="card">
        <h2>Log Table Data (DeviceLogs_*_YYYY)</h2>
        <table>
            <thead><tr><th>Table</th><th>Rows</th></tr></thead>
            <tbody id="table-tbody">
                <tr><td colspan="2" class="empty">Loading...</td></tr>
            </tbody>
        </table>
    </div>

    <script>
        async function loadFiles() {
            try {
                let r = await fetch('/UA/api/backup');
                let d = await r.json();
                let tbody = document.getElementById('file-tbody');
                if (!d.backups || d.backups.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="8" class="empty">No backups found</td></tr>';
                    return;
                }
                tbody.innerHTML = '';
                d.backups.forEach(b => {
                    let tr = document.createElement('tr');
                    let tdName = document.createElement('td'); tdName.className = 'mono'; tdName.textContent = b.name;
                    let tdSize = document.createElement('td'); tdSize.textContent = b.size_mb + ' MB';
                    let tdTime = document.createElement('td'); tdTime.textContent = b.mtime;
                    let tdStatus = document.createElement('td');
                    let badge = document.createElement('span');
                    if (b.valid) { badge.className = 'badge badge-ok'; badge.textContent = 'Valid'; }
                    else { badge.className = 'badge badge-bad'; badge.textContent = 'Invalid / Error'; }
                    tdStatus.appendChild(badge);
                    let tdDb = document.createElement('td'); tdDb.textContent = b.database || '';
                    let tdType = document.createElement('td'); tdType.textContent = b.backup_type || '';
                    let tdFin = document.createElement('td'); tdFin.textContent = b.finish_date || '';
                    let tdBtn = document.createElement('td');
                    let btn = document.createElement('button');
                    btn.className = 'btn btn-primary btn-sm';
                    btn.textContent = 'Download';
                    btn.onclick = function() { window.location.href = '/UA/api/backup/download/' + encodeURIComponent(b.name); };
                    tdBtn.appendChild(btn);
                    tr.appendChild(tdName); tr.appendChild(tdSize); tr.appendChild(tdTime);
                    tr.appendChild(tdStatus); tr.appendChild(tdDb); tr.appendChild(tdType);
                    tr.appendChild(tdFin); tr.appendChild(tdBtn);
                    tbody.appendChild(tr);
                });
            } catch (e) {
                document.getElementById('file-tbody').innerHTML = '<tr><td colspan="8" class="empty">Failed to load backups</td></tr>';
            }
        }

        async function loadTables() {
            try {
                let r = await fetch('/UA/api/backup/tables');
                let d = await r.json();
                let tbody = document.getElementById('table-tbody');
                if (!d.tables || d.tables.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="2" class="empty">No log tables found</td></tr>';
                    return;
                }
                tbody.innerHTML = '';
                d.tables.forEach(t => {
                    let tr = document.createElement('tr');
                    tr.innerHTML = '<td class="mono">' + t.table + '</td><td>' + t.rows.toLocaleString() + '</td>';
                    tbody.appendChild(tr);
                });
            } catch (e) {
                document.getElementById('table-tbody').innerHTML = '<tr><td colspan="2" class="empty">Failed to load tables</td></tr>';
            }
        }

        async function createBackup() {
            let btn = document.getElementById('create-btn');
            let status = document.getElementById('create-status');
            btn.disabled = true;
            status.innerText = 'Creating backup...';
            try {
                let r = await fetch('/UA/api/backup/create', { method: 'POST' });
                let d = await r.json();
                if (d.success) {
                    status.innerText = 'Backup created: ' + d.name;
                    document.getElementById('msg').innerHTML = '<div class="msg">Backup created successfully: ' + d.name + ' (' + d.size_mb + ' MB)</div>';
                } else {
                    status.innerText = 'Failed';
                    document.getElementById('msg').innerHTML = '<div class="err">Backup failed: ' + d.error + '</div>';
                }
            } catch (e) {
                status.innerText = 'Failed';
                document.getElementById('msg').innerHTML = '<div class="err">Backup failed: ' + e + '</div>';
            }
            btn.disabled = false;
            loadFiles();
        }

        loadFiles();
        loadTables();
    </script>
</body>
</html>
"""

@app.route("/backup")
def backup_page():
    resp = make_response(render_template_string(BACKUP_PAGE))
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

@app.route("/api/backup")
def api_backup():
    backups = []
    for b in get_backup_files():
        info = verify_backup_file(os.path.join(BACKUP_DIR, b["name"]))
        backups.append({**b, **info})
    resp = make_response(jsonify({"backups": backups, "backup_dir": BACKUP_DIR}))
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp

@app.route("/api/backup/tables")
def api_backup_tables():
    resp = make_response(jsonify({"tables": log_table_rows()}))
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp

@app.route("/api/backup/download/<path:name>")
def api_backup_download(name):
    safe = os.path.basename(name)
    full = os.path.join(BACKUP_DIR, safe)
    if not safe.lower().endswith(".bak") or not os.path.isfile(full):
        return jsonify({"success": False, "error": "Backup file not found"}), 404
    return send_from_directory(BACKUP_DIR, safe, as_attachment=True)

@app.route("/api/backup/create", methods=["POST"])
def api_backup_create():
    result = create_sql_backup()
    if result.get("success"):
        result["size_mb"] = round(result["size"] / (1024 * 1024), 2)
    return jsonify(result)


_THREAD_STARTED = False
def _start_bg_thread():
    global _THREAD_STARTED
    if not _THREAD_STARTED:
        _THREAD_STARTED = True
        t = threading.Thread(target=database_sync_worker, daemon=True, name="ua-sync-worker")
        t.start()

_start_bg_thread()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
