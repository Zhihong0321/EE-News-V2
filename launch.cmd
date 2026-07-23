@echo off
REM Launcher for the news-crawler app (Windows).
REM   1. Stops anything listening on PORT (default 31313).
REM   2. Starts the server on that same port.
setlocal
if "%PORT%"=="" set PORT=31313
cd /d "%~dp0"

echo [launch] freeing port %PORT%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo [launch]   killing PID %%p
  taskkill /PID %%p /F >nul 2>&1
)

echo [launch] starting server on port %PORT%...
REM Force IPv4-first DNS: the Supabase direct host is IPv6-only and this
REM network can't route IPv6 (ENETUNREACH). Without this the DB shows as
REM "unavailable" whenever pg picks the IPv6 address.
set NODE_OPTIONS=%NODE_OPTIONS% --dns-result-order=ipv4first
node --dns-result-order=ipv4first src\server.js
endlocal
