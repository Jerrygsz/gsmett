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

echo   正在启动，启动后浏览器会自动打开
echo   关闭这个窗口就停止服务
echo.

start "" http://localhost:8787/

node server/index.js

pause
