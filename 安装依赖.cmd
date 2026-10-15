@echo off
chcp 65001 >nul
setlocal
set GOMAXPROCS=2
cd /d "%~dp0"
title Duo 首发助手 - 安装依赖
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]<22||(v[0]===22&&v[1]<12)){console.error('需要 Node.js 22.12 或更高版本');process.exit(1)}"
if errorlevel 1 goto failed
call npm ci
if errorlevel 1 goto failed
call npx playwright install chromium --no-shell
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
echo.
echo 安装完成。双击“启动助手.cmd”即可使用。
echo 默认使用已安装的 Google Chrome，首次请在助手执行窗口登录。
pause
exit /b 0
:failed
echo.
echo 安装未完成，请检查以上错误信息与网络连接。
pause
exit /b 1
