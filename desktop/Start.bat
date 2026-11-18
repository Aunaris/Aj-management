@echo off
chcp 65001 >nul
title 2D Animation Classroom
cd /d "%~dp0"
rem Disable QuickEdit for this window so a stray click cannot freeze the server
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s='[DllImport(\"kernel32.dll\")]public static extern IntPtr GetStdHandle(int h);[DllImport(\"kernel32.dll\")]public static extern bool GetConsoleMode(IntPtr h,out uint m);[DllImport(\"kernel32.dll\")]public static extern bool SetConsoleMode(IntPtr h,uint m);';$k=Add-Type -MemberDefinition $s -Name K -Namespace W -PassThru;$h=$k::GetStdHandle(-10);$m=0;if($k::GetConsoleMode($h,[ref]$m)){[void]$k::SetConsoleMode($h,($m -band (-bnot 0x40)) -bor 0x80)}" >nul 2>&1
"%~dp0runtime\node.exe" --no-warnings "%~dp0app\src\desktop.js"
echo.
echo Program stopped. Press any key to close this window.
pause >nul
