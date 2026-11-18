@echo off
chcp 65001 >nul
title 2D Animation Classroom
cd /d "%~dp0"
"%~dp0runtime\node.exe" --no-warnings "%~dp0app\src\desktop.js"
echo.
echo Program stopped. Press any key to close this window.
pause >nul
