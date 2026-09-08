# ESSL Punch Stability — Complete Implementation & Validation Plan

> Goal: make the punch serving path resilient, get **immediate alerts** the moment it
> stalls, and use AI/statistics to **prove the root cause** instead of guessing.
>
> Status: **PLAN ONLY — nothing implemented.** All items below are grouped and
> ordered so each can be applied and validated independently.

---

## 0. Facts confirmed on the server (2026-08-19)

| Check | Value | Risk |
|---|---|---|
| RAM | 5,328 MB total (`sys.dm_os_sys_info`) | — |
| SQL `max server memory (MB)` | **2147483647 (unlimited)** | HIGH — SQL will grow unbounded, starving IIS |
| AppPool recycle schedule | **none** | MEDIUM — a hung pool never self-heals |
| `disallowOverlappingRotation` | `False` | LOW (already OK — overlap allowed) |
| Rapid-fail protection | not visibly enabled | MEDIUM — crash loop does not auto-recover |
| Punch ingress | devices → IIS `/iclock` (port 3366) | the pulse to watch |
| DB | `localhost\SQLEXPRESS`, `eTimetracklite1` | —
| DB restore (08-18) & hard reboot (08-19 09:31, Event 6008/41) | happened | correlates with stalls |

### Ranked hypotheses (from `ESSL-PUNCH-RECOVERY.md`)
1. **PRIMARY — memory exhaustion:** 5.3 GB, SQL unlimited + w3wp + python → paged out, stalls all devices at once.
2. **SECONDARY — stale SQL connection after restore:** `/iclock`/pooled conn dies after 08-18 restore; punches stop until recycle.
3. **TERTIARY — no watchdog:** even a stalled pool has **no automatic recovery**, so every failure looks like "needs restart".

---

## GROUP A — Stabilise the server (prevention)

### A1. Cap SQL Server memory  (highest priority)
- **Input:** `sp_configure 'max server memory (MB)', 2048; RECONFIGURE WITH OVERRIDE;`
- **Why:** leaves ≥ 2 GB for IIS/w3wp/python — directly removes the PRIMARY hypothesis (self-inflicted starvation).
- **Validation:** `SELECT physical_memory_in_use_kb, locked_page_allocations_kb FROM sys.dm_os_process_memory;` → used ≤ ~2048 MB; RAM free grows; punch flow stays steady.

### A2. Fix page file / commit charge baseline
- **Input:** Windows Settings → System → Advanced → Virtual Memory → set to System Managed (or a fixed ≥ 8 GB) on C:.
- **Why:** when RAM nears full, the OS needs swap headroom instead of freezing.
- **Validation:** observe `Free & Zero Page List Bytes` / page file usage during a busy morning.

### A3. App-pool recycle schedule (safety net)
- **Input:** `Add-WebConfigurationProperty` schedule entry `@index 0` value `03:00:00` on DefaultAppPool (quiet hours, 03:00 avoids punch times).
- **Why:** every night the IIS side of the punch path is laundered — clears any slow leak even if the watchdog never fires.
- **Validation:** next 03:00 event → `Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-IIS-W3SVC-WP/Operational'}` shows recycle; `present` count survives (devices reconnect within ~1 min).

### A4. (Optional) NSRL/HO simple-mode — re-checked
- No change needed for stability; noted only so it is not mistaken for the bug. Punches for 25/59 are still stored in the DB; only classification differs.

---

## GROUP B — Immediate alerts (detection)

### B1. Watchdog — SQL-side pulse check  (core alert)
- **Input:** `C:\Backups\watchdog.ps1` run by Task Scheduler **every 1 minute**.
  - Reads `SELECT MAX(LogDate) FROM DeviceLogs_8_2026 WHERE DeviceId IN (23,24,25,42,58,59)` (use the month table the app selects — `LOG_TABLES` logic). Also read RAM + SQL `max server memory` snapshot.
  - If any device's latest punch is older than **5 minutes** (threshold configurable, weekday-aware so Sunday weekly-off for 25/59 does not false-alarm) → **fire alert**.
  - Appends to `C:\Backups\watchdog.log` one line per run (`time, per-device last-punch, RAM, SQL-mem`) — this log is the **forensic dataset** for Group C.
  - On first healthy run after a stall → send "RECOVERED" so you have the full start/stop/resume timeline.
- **Why this design:** the checker starts fresh every minute and exits → cannot itself leak or hang; it remains alive for the realistic failure modes (pool hang, stale SQL, memory pressure) because only a *full OS crash* kills it.
- **Validation:** kill/stop the app pool manually → expect alert ≤ 5 min; restart pool → expect RECOVERED ≤ 2 min. Confirm `watchdog.log` rows appear every 60 s.

### B2. Alert channel — Email (always reliable, free)
- **Input:** SMTP send (e.g. via local IIS SMTP relay or `python email` / `smtplib`) to the client's mailbox. Message carries the snapshot from B1 (`device, last punch, gap, RAM, SQL-mem, restore event`).
- **Validation:** trigger B1 test → mailbox receives alert with correct data within ~1–2 min.

### B3. Alert channel — WhatsApp (optional push)
- **Option 1 (free, quick):** CallMeBot-style URL `https://api.callmebot.com/whatsapp.php?phone=<num>&text=<msg>` → message arrives in a WhatsApp chat with the bot contact. Sufficient for a single owner/monitor.
- **Option 2 (production):** Twilio WhatsApp Business API (template-based, per-message cost) — proper, rules-compliant, team distribution.
- **Validation:** send a test message; confirm arrival + that the alert text includes device/gap/time.

### B4. (Optional) Independent liveness — covers full-server death
- **Input:** Healthchecks.io / UptimeRobot **free tier**, or a second machine, pinging the site every minute. If the whole server is offline, this still fires (B1 cannot, since it runs on the server).
- **Validation:** shut the box down briefly → external alert arrives while B1 is silent; boot → recovery ping.

---

## GROUP C — AI / statistics to prove the root cause

### C1. Instrumentation first (the missing data)
- **Input:** nothing new beyond B1's `watchdog.log` (time-series of per-device last-punch, RAM, SQL-mem every 60 s) + IIS `/iclock` log (per-device cdata timestamps) + Windows Event log (6008, 41, WAS recycle events).
- **Why:** AI can only analyse what was captured. This destroys the current "no data from the failure moment" gap.

### C2. Cadence anomaly detector (free, offline, scikit-learn)
- **Input:** per-device **push interval baseline** per time-of-day/weekday from `watchdog.log` (+ any historical IIS logs).
- **Model:** rolling mean/std of intervals; optionally `IsolationForest` on `[interval, hour, dow, device_id, SQL-mem, RAM-free]`.
- **Output:** an alert *before* the fixed 5-min threshold when cadence deviates sharply; weekend/Sunday awareness to suppress false alarms for 25/59.
- **Validation:** replay historical events against the detector — must flag the known 08-14/08-18/08-19 stalls and NOT Sunday quiet periods.

### C3. Root-cause correlation & ranking (LLM reasoning, on demand)
- **Input:** a JSON snapshot taken at every stall (C1 data): which devices stalled, simultaneous vs single, RAM at T, SQL-mem at T, last restore, app-pool uptime, reboot events.
- **Method:** each hypothesis (memory | stale-SQL | unknown) is scored against observable predictions:
  - memory → all devices stall together, RAM near-full, recovers when memory released → matches PRIMARY.
  - stale-SQL → stalls correlated with restores, recover on pool recycle regardless of RAM.
- **Output:** ranked probability + *"next check this / run this experiment"* each incident.
- **Validation:** score the three historical incidents; the reasoning must reproduce our manual ranking (memory > stale-SQL > unknown) and recommend A1 as the first experiment.

### C4. Controlled fault-injection experiments (prove, don't guess)
- Experiment A—**memory:** with B1 active, temporarily set SQL to a tiny cap (e.g. 256 MB) during work hours, watch punches stall within minutes → **confirms memory causation**; restore cap, watch resume. *(Snapshot/backup first — `C:\Backups`.)*
- Experiment B—**stale SQL:** perform the routine DB restore while the app is live (reproduce 08-18 exactly), watch whether `/iclock` pushes silently stop → **confirms stale-connection causation**.
- **Validation:** only the experiment that reproduces the stall + recovers on the reversal mechanism is the confirmed cause; results recorded in `watchdog.log`.

---

## GROUP D — Fix after cause is proven

- **D-a (if memory confirmed):** keep A1 cap; add RAM (≥ 8 GB) → the only permanent cure.
- **D-b (if stale-confirmed):** make the DB connection pool resilient — validate/reconnect on `pyodbc` errors in `run_sync_once`/punch handler, retry with backoff, or add a lightweight "test connection and recycle pool" step in B1.
- **D-c (always):** B1 watchdog stays permanently (it fixes the *recovery gap* for any cause) + A3 nightly recycle.
- **D-d (if unknown after A/B fail):** widen C1 collection (add per-device RAM, network capture on 3366) and re-run the C2/C3 loop.

---

## Suggested rollout order (minimise risk, validate at each step)

1. **A1** (SQL cap) — 5-min change, removes self-starvation, biggest coverage.
2. **B1 + B2** (watchdog + email) — 30–60 min, gives alerts + the forensic log.
3. **B3** (WhatsApp) — optional, once B2 works.
4. **A3** (recycle schedule) — after B1 so the alerts are already live.
5. **B4** (external liveness) — covers full-server death.
6. **C1 → C2 → C4** (analysis) — once a few days of `watchdog.log` exist.
7. **D** — apply only the proven fix.

### Validation checklist (final acceptance)
- [ ] SQL memory stable ≤ 2048 MB for 7 days
- [ ] `watchdog.log` running every 60 s for 7 days, no gaps
- [ ] Manual pool-stop → alert ≤ 5 min → restore → RECOVERED ≤ 2 min
- [ ] Email (and WhatsApp if enabled) both deliver alerts
- [ ] External liveness fires on full server shutdown (if B4 added)
- [ ] Historical replay: detector flags 08-14 / 08-18 / 08-19 stalls, ignores Sundays
- [ ] One fault-injection experiment (A or B) reproduced + explained the stall
- [ ] Documented root cause + D-fix applied and re-validated for 7 days

---

## Reminders / safety
- Every destructive step starts with a `.bak` to `C:\Backups` (they are **manual only** today; Group B/D do not assume automation).
- Reapply of the watchdog will overwrite nothing — the previous version was fully reverted, so the server is at factory state and all of the above is clean.
- The `SIMPLE_MODE_DEVICES`/late/stat-card changes remain unaffected by this plan.