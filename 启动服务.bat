@echo off
chcp 65001 >nul
title 贸智库 本地服务
cd /d "%~dp0"

echo.
echo   贸智库 - 企业 AI 服务交付平台
echo   ------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没找到 Node.js
  echo   请先安装 Node.js 20 或更高版本：https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   首次启动，正在安装依赖，需要一两分钟...
  call npm install --no-audit --no-fund
  echo.
)

echo   正在启动，服务起来后浏览器会自动打开
echo   关掉这个窗口 = 停止服务
echo.

rem 延时 2 秒再开浏览器，避免服务还没监听就打空
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 2; Start-Process 'http://localhost:8787/'"

node server/index.js

pause
