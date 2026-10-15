@echo off
chcp 65001 >nul
setlocal
set GOMAXPROCS=2
cd /d "%~dp0"
title Duo 首发助手
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\.bin\tsx.cmd" (
  echo 请先双击“安装依赖.cmd”，完成首次安装。
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 goto failed
)
echo 正在启动 Duo 首发助手。
echo 请保持此窗口开启，关闭窗口会停止任务。
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo 启动未完成，请检查错误信息；如果端口被占用，请打开已启动的助手。
pause
exit /b 1
