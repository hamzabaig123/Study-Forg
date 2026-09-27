@echo off
title StudyForge Local Server
cd /d "D:\class 11 app\study fork\src\frontend"

:: Check if port 5173 is already active
netstat -ano | findstr :5173 | findstr LISTENING >nul
if %errorlevel% equ 0 (
    echo StudyForge server is already running!
    start http://localhost:5173
    exit /b 0
)

:: Start Vite dev server in background and wait for it to be ready
echo Starting StudyForge local server...
start /b cmd /c "pnpm dev"

:: Wait up to 15 seconds for server to start responding
set count=0
:wait_loop
timeout /t 1 /nobreak >nul
netstat -ano | findstr :5173 | findstr LISTENING >nul
if %errorlevel% equ 0 goto server_ready
set /a count+=1
if %count% geq 15 goto server_timeout
goto wait_loop

:server_ready
echo Server ready! Opening browser...
start http://localhost:5173
exit /b 0

:server_timeout
echo Server launch timed out or taking longer than expected. Opening browser anyway...
start http://localhost:5173
exit /b 0
