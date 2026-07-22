@echo off
chcp 65001 >nul 2>&1
title Pi Web Mobile Tunnel

set CLOUDFLARED=%~dp0resources\cloudflared\cloudflared.exe
set TUNNEL_NAME=pi-mobile

if not exist "%CLOUDFLARED%" (
    echo [ERROR] cloudflared.exe not found at %CLOUDFLARED%
    pause
    exit /b 1
)

echo ========================================
echo   Pi Web Mobile Tunnel
echo ========================================
echo.

REM Check if tunnel config exists
if not exist "%USERPROFILE%\.cloudflared\config.yml" (
    echo [INFO] No tunnel config found. Running setup...
    echo.
    echo A browser window will open for Cloudflare authorization.
    echo Select tt56677.top and click Authorize.
    echo.
    "%CLOUDFLARED%" tunnel login
    if errorlevel 1 (
        echo [ERROR] Login failed.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Login successful. Now run tunnel-auto-setup.sh to complete setup.
    pause
    exit /b 0
)

REM Check if tunnel is already running
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>nul | find /i "cloudflared.exe" >nul
if %errorlevel% equ 0 (
    echo [INFO] Tunnel is already running.
    echo.
    echo Open https://mobile.tt56677.top/mobile/ on your phone.
    echo.
    pause
    exit /b 0
)

echo [START] Launching tunnel...
echo.
echo PWA URL: https://mobile.tt56677.top/mobile/
echo Press Ctrl+C to stop the tunnel.
echo.

"%CLOUDFLARED%" tunnel run %TUNNEL_NAME%

echo.
echo [STOPPED] Tunnel stopped.
pause
