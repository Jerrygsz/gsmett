@echo off
chcp 65001 >nul
title 贸智库 一键启动（本地服务 + 公网隧道）
cd /d "%~dp0"

echo.
echo   贸智库 - 本地服务 + Cloudflare 临时隧道
echo   ------------------------------------
echo.

rem --- 找 node（系统 PATH 没有就去找 WorkBuddy 自带的）---
where node >nul 2>nul
if errorlevel 1 (
  set "NODE_DIR="
  for /d %%G in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%G\node.exe" set "NODE_DIR=%%G"
  )
  if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没找到 Node.js
  echo   请确认 WorkBuddy 已安装（自带 Node 位于 %USERPROFILE%\.workbuddy\binaries\node）
  pause
  exit /b 1
)

rem --- 找 cloudflared（放在用户目录下的 cloudflared 文件夹）---
set "CF=%USERPROFILE%\cloudflared\cloudflared.exe"
if not exist "%CF%" (
  echo   [错误] 没找到 cloudflared.exe
  echo   请先把它放到 %USERPROFILE%\cloudflared\cloudflared.exe
  pause
  exit /b 1
)

rem --- 启动本地服务（独立窗口，关掉该窗口即停止服务）---
echo   正在启动本地服务（弹出新窗口）...
start "贸智库本地服务" cmd /k "cd /d \"%~dp0\" && node server/index.js"

rem --- 等 2 秒让服务先监听 ---
timeout /t 2 >nul

rem --- 启动临时隧道（本窗口会显示公网网址）---
echo.
echo   正在建立公网隧道，稍候会显示 https://xxxx.trycloudflare.com
echo   注意：临时隧道网址【每次重启都会变】。
echo   关掉本窗口 = 停止隧道（本地服务窗口需单独关闭）。
echo.
"%CF%" tunnel --url http://localhost:8787

pause
