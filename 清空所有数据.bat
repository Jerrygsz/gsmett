@echo off
chcp 65001 >nul
title 贸智库 - 清空所有数据
cd /d "%~dp0"

echo.
echo   ============================================
echo     清空所有客户数据
echo   ============================================
echo.
echo   这会删除：
echo     - 所有客户档案
echo     - 所有项目进度、上传的资料、知识库索引
echo     - 所有测试记录、成员、反馈
echo.
echo   会保留：
echo     - 平台模型 API Key（data\config.json）
echo.
echo   清空前会自动备份到 backup\ 目录，可以找回。
echo.
set /p OK=  确认清空请输入 YES 然后回车（其他任何输入都会取消）：

if /i not "%OK%"=="YES" (
  echo.
  echo   已取消，什么都没删。
  echo.
  pause
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没找到 Node.js
  pause
  exit /b 1
)

echo.
node tools\reset-data.js

echo.
echo   如果服务正在运行，回到浏览器按 Ctrl + Shift + R 强制刷新即可。
echo.
pause
