@echo off
title Stop StudyForge Server
echo Looking for process on port 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do (
    echo Stopping PID %%a...
    taskkill /F /PID %%a
)
echo Done. StudyForge server stopped.
pause
