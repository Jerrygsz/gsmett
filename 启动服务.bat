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
  rem 系统 PATH 里没有 node：去 WorkBuddy 自带的 node 目录里找
  set "NODE_DIR="
  for /d %%G in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%G\node.exe" set "NODE_DIR=%%G"
  )
  if defined NODE_DIR (
    set "PATH=%NODE_DIR%;%PATH%"
    echo   已找到 WorkBuddy 自带 Node：%NODE_DIR%
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没找到 Node.js
  echo   请先安装 Node.js 20 或更高版本：https://nodejs.org
  echo   或确认 WorkBuddy 已安装（自带 Node 位于 %USERPROFILE%\.workbuddy\binaries\node）
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
