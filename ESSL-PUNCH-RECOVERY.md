# eSSL Punch-Only-After-Restart — Root Cause Analysis & Fix Plan

**Date:** 2026-08-19
**System:** win.howtostart.in (UA Attendance Portal)
**Symptom:** Biometric punches are recorded by eSSL only after a server restart. During the outage eSSL "is not receiving" punches; after a reboot everything works again.

---

## 1. Architecture (how punches actually arrive)

```
 Biometric devices (23,24,25,42,58,59)
        |  POST /iclock/cdata.aspx?SN=...&table=ATTLOG   (iClock+Proxy/1.09)
        v
   PUBLIC PORT 3366  (http.sys, PID 4 = IIS)
        |  "/iclock" ASP.NET app (eTimeTrackLite) in DefaultAppPool
        v
   SQL Server  localhost\SQLEXPRESS   (eTimetracklite1)
```

- The punch "server" is **not a Windows service** — it is the **IIS `/iclock` ASP.NET app** running in the `DefaultAppPool` (w3wp.exe). Devices push HTTP directly to port 3366.
- nginx (80/443) only fronts the *browser* UI; the devices bypass nginx and hit 3366 directly.
- The UA dashboard (`/ua`) and `/deviceform` run in the **same** DefaultAppPool as `/iclock`.

---

## 2. Evidence gathered (live diagnostics)

| Check | Result | Meaning |
|---|---|---|
| Port 3366 owner | PID 4 (http.sys / IIS) | Punch path = IIS, single point |
| ESSL service | **None installed** (no eSSL service in services.msc) | Nothing to restart except app pool / IIS |
| Last boot | 2026-08-19 09:31:07 | Server was hard-rebooted this morning |
| Kernel-Power Event 41 (09:31) + Event 6008 (09:30:22) | Unexpected shutdown | The **OS itself hung**; only hard reboot recovered |
| RAM | 5.2 GB total, **1.8 GB free** | Heavy pressure; SQL unlimited memory + multiple python + SSMS + RDP |
| SQL max memory | **2147483647 MB (unlimited)** | SQL will consume all available RAM when busy |
| Device cdata last push | 06:31 UTC = 12:01 IST | **Punches ARE flowing now** (healthy post-reboot) |
| w3wp crash events | None | No repeated worker crash → not a classic crash-loop |
| App pool rapid-fail | Enabled (5 crashes / 5 min) | If the app throws, pool can be auto-disabled |
| App pool recycle schedule | None (idle 0, no time/request limit) | Long uptime → stale connections accumulate |
| 08-18 DB restore | eTimetracklite1 restored at 16:18 | Restore **killed the live punch write path** until reboot |

---

## 3. Root cause (ranked, with reasoning)

### 3.1 PRIMARY — Memory exhaustion hangs the whole server (matches symptom exactly)
- 5.2 GB box runs: SQL Server (unlimited memory cap), IIS w3wp, 2 Flask/waitress instances, 5 wfastcgi python workers, RDP, SSMS, Chrome.
- When memory runs out, the OS thrashes → **IIS/http.sys and SQL stop responding** → devices' `/iclock/cdata.aspx` POSTs time out → "eSSL not receiving".
- Kernel-Power 41 (unexpected shutdown) confirms the OS froze — that is why **only a restart** fixes it.
- This is the strongest match to "punches only received after server restart."

### 3.2 SECONDARY — Stale SQL connection in the ASP.NET pool after DB events
- The punch app holds SQL connections. Any event that kills the connection (DB **restore**, failover, idle timeout) leaves the app pool with dead connections and **no retry logic**.
- On 08-18 we restored `eTimetracklite1` at 16:18; immediately after, all units showed zero punches until the server was rebooted the next morning. This incident is direct proof of this path.

### 3.3 TERTIARY — No watchdog / no auto-heal
- Nothing monitors `/iclock` health. When the pool or SQL stalls, nothing restarts it automatically — downtime continues until a human reboots.

---

## 4. Recommended fixes (grouped for implementation)

### Group A — Keep the punch path alive automatically (DO FIRST)
| # | Action | Tool | Why |
|---|---|---|---|
| A1 | Health watchdog every 1 min: probe `http://127.0.0.1:3366/iclock/Default.aspx` (or `/cdata` reachability) and SQL `SELECT 1` | Task Scheduler script | Auto-restart pool/SQL instead of waiting for a reboot |
| A2 | On failure: restart `DefaultAppPool`, then SQL if still failing | same script | Restores punch ingestion in <2 min |
| A3 | Add "Today's punch count" heartbeat: store last punch time per device in a small table; alarm if no punch for X hours on an active day | script/query | Early detection |

### Group B — Prevent the hang (root fix)
| # | Action | Tool | Why |
|---|---|---|---|
| B1 | **Cap SQL Server memory** to ~2 GB (`sp_configure 'max server memory'`) | SQL | Stops SQL eating all 5.2 GB → prevents OS hang |
| B2 | Set `DefaultAppPool` recycle schedule (e.g. 03:00 daily) + enable overlapping rotation | IIS | Fresh process daily; zero gap on recycle |
| B3 | Increase plan to 8 GB+ RAM (or move `/iclock` to a dedicated box) | hosting | Eliminates the resource ceiling permanently |
| B4 | Configure SQL Agent backup job + enable ESSL auto-backup | SQL / eSSL | Safe recovery without manual `.bak` restores (still pending from earlier) |

### Group C — Harden the punch app pool
| # | Action | Tool | Why |
|---|---|---|---|
| C1 | Rapid-fail: raise crash count or disable (keep disabled only if A1 exists) | IIS | Pool won't silently disable itself |
| C2 | Keep `/iclock`, `/ua`, `/deviceform` in one pool but ensure heavy pages (WorkerPage live poll) cannot block `cdata` | IIS config | Punch POSTs get CPU even during UI polling |

### Group D — Monitoring & logging
| # | Action | Tool | Why |
|---|---|---|---|
| D1 | Enable IIS **Failed Request Tracing** for `/iclock` | IIS | Captures why punches fail during next incident |
| D2 | Forward `C:\inetpub\logs\LogFiles\W3SVC1\u_ex*.log` to a daily archive + alert on non-200 spikes | script | Post-incident forensics |
| D3 | Keep nginx access log (already working) and correlate timestamps (UTC) with punch gaps | nginx | Tells us "devices pushing but not stored" vs "not reaching server" |

---

## 5. Implementation detail

### A1/A2 — Watchdog script (`C:\Backups\watchdog.ps1`)
```powershell
$log = "C:\Backups\watchdog.log"
$pool = "DefaultAppPool"
$sqlConn = "Server=localhost\SQLEXPRESS;Database=master;User Id=sa;Password=<redacted>;Connect Timeout=5"
function Stamp { Get-Date -Format "yyyy-MM-dd HH:mm:ss" }
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:3366/iclock/Default.aspx" -UseBasicParsing -TimeoutSec 8
    $httpOk = ($r.StatusCode -eq 200)
} catch { $httpOk = $false }
try {
    $c = New-Object System.Data.SqlClient.SqlConnection($sqlConn); $c.Open(); $c.Close(); $sqlOk = $true
} catch { $sqlOk = $false }
if (-not $httpOk) {
    Add-Content $log "$(Stamp) HTTP DOWN -> recycling $pool"
    Import-Module WebAdministration
    Restart-WebAppPool -Name $pool
    Start-Sleep 5
    try { $r2 = Invoke-WebRequest -Uri "http://127.0.0.1:3366/iclock/Default.aspx" -UseBasicParsing -TimeoutSec 8; $httpOk = ($r2.StatusCode -eq 200) } catch { $httpOk = $false }
    if (-not $httpOk) { Add-Content $log "$(Stamp) still down after pool recycle" }
}
if (-not $sqlOk) {
    Add-Content $log "$(Stamp) SQL DOWN -> restarting MSSQL$SQLEXPRESS"
    Restart-Service "MSSQL$SQLEXPRESS" -Force
}
```
**Task Scheduler:** trigger = Repeat every 1 minute, indefinitely; action = `powershell.exe -ExecutionPolicy Bypass -File C:\Backups\watchdog.ps1`; run whether logged in or not.

### B1 — SQL memory cap
```sql
sp_configure 'show advanced options', 1; RECONFIGURE;
sp_configure 'max server memory (MB)', 2048; RECONFIGURE;
```

### B2 — App pool recycle schedule
```powershell
Import-Module WebAdministration
# add a 3:00 AM daily recycle
Set-ItemProperty -Path "IIS:\AppPools\DefaultAppPool\recycling" -Name "disallowOverlappingRotation" -Value $false
# scheduled recycle via appcmd (3:00 AM)
& "$env:windir\system32\inetsrv\appcmd.exe" set apppool "DefaultAppPool" /recycling.periodicRestart.schedule:"03:00:00"
```

---

## 6. Validation checklist (after implementation)

1. **Immediate health:** open https://win.howtostart.in/UA/ → all units Online, punch counts increase on refresh.
2. **Watchdog fires correctly (test):** stop `DefaultAppPool` → verify the task restarts it within ~2 min and `/iclock` returns 200 again. Read `C:\Backups\watchdog.log`.
3. **SQL memory cap:** confirm `sqlservr` stays ≤ ~2.1 GB under load; OS free RAM no longer drops to near-zero.
4. **No-loss during recycle:** force a scheduled recycle at 03:00 and confirm next morning's punches cover the whole day.
5. **Downtime reduction:** next incident (if any) heals in <2 min without a reboot, and the failed request trace shows exactly why.

---

## 7. Alternative approaches (if you prefer not to script)

| Option | Pros | Cons | Effort |
|---|---|---|---|
| **Increase RAM to 8–16 GB** (B3) | True root fix; no downtime risk | Cost; still no auto-heal | Hosting ticket |
| **Dedicated box for `/iclock`** | Full isolation from dashboard load | Requires device IP re-targeting + move | Highest |
| **ESSL Cloud / ADMS failover** | Vendor-managed redundancy | Cost; vendor dependency | Vendor |
| **Keep manual reboot but add alerting** | Simplest; zero change risk | Still manual; still gaps | Minimal |
| **Watchdog (A1/A2) + RAM cap (B1)** ← **recommended** | Auto-heal + addresses root cause | Needs Task Scheduler setup (I can do it) | Medium |

---

## 8. Summary answer to the team

**Yes — AI analysis is exactly what identified this.** The condition is: the punch path is a single IIS app pool + SQL on a 5.2 GB server with unlimited SQL memory. Under memory pressure or after a DB event (restore), IIS/SQL silently stop accepting `/iclock` punch POSTs, and nothing auto-recovers — so only a full server restart fixes it. Fixes: cap SQL memory, add a 1-minute watchdog that auto-restarts the app pool/SQL, schedule a daily clean recycle, and add failed-request tracing. Recommend implementing Group A + B1 + B2 first (I can create the script + Task Scheduler entry and run the SQL memory cap now).
