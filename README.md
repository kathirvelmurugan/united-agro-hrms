# United Agro HRMS Attendance

React/TypeScript attendance dashboard with a Flask API, SQL Server attendance data, IIS/wfastcgi backend hosting, and Nginx HTTPS routing.

## Production

- Application: `https://win.howtostart.in/UA/`
- Nginx: HTTPS `443`, HTTP redirect `80`
- IIS: HTTP `3366`, application `/ua`
- IIS backend: `C:\inetpub\wwwroot\ua`
- IIS frontend: `C:\inetpub\wwwroot\ua\dist`
- Database: SQL Server `eTimetracklite1`

## Repository layout

```text
src/                    React application
backend/app.py          Flask API and attendance integration
backend/wsgi.py         IIS/wfastcgi entry point
backend/requirements.txt Pinned Python environment
backend/web.config      IIS FastCGI configuration
backend/*.example.json  Non-secret configuration templates
```

Runtime files such as `backend/config.json`, `backend/users.json`, `venv`, logs, model output, and backups are intentionally excluded from Git.

## Prerequisites

- Node.js version used by the current lockfile
- Python 3.14 x64
- Microsoft ODBC Driver 17 for SQL Server
- IIS with FastCGI and wfastcgi
- Nginx for TLS and reverse proxy
- SQL Server access to `eTimetracklite1`

## Frontend development

```powershell
npm ci
npm run lint
npm run build
npm run dev
```

The production frontend uses the same `/UA` origin as the API. All API calls except login use `src/lib/auth.ts`, which adds the bearer token.

## Backend development

Create a private runtime configuration outside Git:

```powershell
Copy-Item backend/config.example.json backend/config.json
```

Set these values in `backend/config.json` or the process environment:

- `SECRET_KEY`
- `DB_SERVER`
- `DB_DATABASE`
- `DB_UID`
- `DB_PASSWORD`
- `DB_DRIVER`
- `DB_ENCRYPT`
- `DB_TRUST_SERVER_CERTIFICATE`
- `FRONTEND_DIR`
- `BACKUP_DIR`

Environment variables override `config.json`. Never commit either file.

Create and activate an isolated environment:

```powershell
python -m venv backend/venv
.\backend\venv\Scripts\python.exe -m pip install -r backend/requirements.txt
$env:FRONTEND_DIR = "$PWD\dist"
.\backend\venv\Scripts\python.exe -m flask --app backend.app run --host 127.0.0.1 --port 5050 --no-reload
```

`backend/users.json` is the user store. Passwords must be Werkzeug `scrypt:` or `pbkdf2:` hashes. Do not store plaintext passwords.

## Authentication and authorization

- `/api/login` is public.
- Every other `/api` route requires a valid bearer token.
- User management, employee writes, rules writes, roster writes, backups, health details, and application-pool controls require `admin` or `superadmin`.
- Manager access is limited to the assigned device.
- Password changes invalidate all API tokens for that user.
- Five failed logins from one client IP trigger a 15-minute block.
- Passwords are stored with salted Werkzeug hashes.

## IIS and Nginx deployment

Backend release:

1. Stop or recycle `DefaultAppPool` before replacing backend files.
2. Preserve the deployed `config.json`, `users.json`, `chat_config.json`, and `ml` directory.
3. Copy `backend/app.py`, `backend/wsgi.py`, `backend/requirements.txt`, and `backend/web.config` to `C:\inetpub\wwwroot\ua`.
4. Install pinned requirements in `C:\inetpub\wwwroot\ua\venv`.
5. Recycle `DefaultAppPool`.

Frontend release:

```powershell
npm ci
npm run lint
npm run build
```

Deploy the contents of `dist` to `C:\inetpub\wwwroot\ua\dist` using a versioned release folder and an atomic pointer where possible.

Nginx must preserve the `/UA` URI when proxying to IIS:

```nginx
location /UA/ {
    proxy_pass http://127.0.0.1:3366;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
}
```

The current Nginx configuration serves `/UA/`, `/UA/assets/`, `favicon.svg`, and `icons.svg` directly from the deployed `dist` directory. All other `/UA/` requests are proxied to IIS.

## Verification

Run before every release:

```powershell
python -m py_compile backend/app.py backend/wsgi.py
npm run lint
npm run build
git diff --check
```

Then verify:

1. `https://win.howtostart.in/UA/` returns HTTP 200.
2. HTTP redirects to HTTPS.
3. Login succeeds and stores a bearer token.
4. Unauthenticated API requests return HTTP 401.
5. Manager accounts see only their assigned device.
6. Administrative APIs reject manager accounts with HTTP 403.
7. Password changes invalidate the previous token.
8. Five consecutive failed logins produce a block.
9. Punch ingestion at `/iclock/` remains available.
10. SQL backups and roster operations succeed for an administrator.

## Rollback

Keep the previous frontend release folder and previous backend files until the new release passes verification. Restore the previous release, then recycle `DefaultAppPool`. Do not overwrite `config.json`, `users.json`, `chat_config.json`, or the `ml` directory during a release.

## Security handover

- Rotate database, Flask, Gemini, and user credentials before transferring server access.
- Restrict `config.json`, `users.json`, backups, and the virtual environment with Windows ACLs.
- Do not place API keys in URLs, source files, public documentation, or browser storage.
- Review Git history before publishing source code. The historical static API key has been removed from current code and must never be restored.
- Limit server and database administrator access to named client operators.
