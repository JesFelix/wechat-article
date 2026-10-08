@echo off
chcp 65001 >nul
rem ZiJian PaiBan - one-click setup and start (Windows)
rem Auto-installs Node.js (portable, from npmmirror) if missing,
rem then installs dependencies and starts the dev server.

setlocal EnableDelayedExpansion
cd /d "%~dp0"
title 字间排版 · 一键启动

set NODE_VERSION=v22.14.0
set RUNTIME_DIR=.node-runtime
set NODE_DIR=%RUNTIME_DIR%\node-%NODE_VERSION%-win-x64

echo ======================================
echo   字间排版 · 一键启动（Windows）
echo ======================================

rem 系统里已有 Node 18+ 就直接用
set MAJOR=
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set RAW=%%v
if defined RAW set MAJOR=!RAW:v=!
if defined MAJOR (
  if !MAJOR! GEQ 18 (
    echo 检测到系统 Node.js
    goto :deps
  )
)

rem 之前下载过的本地运行库直接复用
if exist "%NODE_DIR%\node.exe" (
  echo 使用项目内置 Node.js
  set "PATH=%CD%\%NODE_DIR%;%PATH%"
  goto :deps
)

echo 未检测到 Node.js，正在从国内镜像下载免安装版（约 30MB）...
if not exist %RUNTIME_DIR% mkdir %RUNTIME_DIR%
set URL=https://registry.npmmirror.com/-/binary/node/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip
powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%URL%' -OutFile '%RUNTIME_DIR%\node.zip' -UseBasicParsing } catch { exit 1 }"
if errorlevel 1 (
  echo.
  echo 下载失败。请检查网络后重试，或手动安装 Node.js：https://nodejs.org
  pause
  exit /b 1
)
powershell -NoProfile -Command "Expand-Archive -Path '%RUNTIME_DIR%\node.zip' -DestinationPath '%RUNTIME_DIR%' -Force"
del /q "%RUNTIME_DIR%\node.zip"
set "PATH=%CD%\%NODE_DIR%;%PATH%"
echo Node.js 就绪

:deps
node -v
if not exist node_modules (
  echo 首次运行，正在安装依赖（国内镜像加速）...
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo.
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo.
echo 启动中，浏览器稍后自动打开 http://localhost:5173
echo 若端口被占用，请以终端显示的实际地址为准。
echo 关闭本窗口即停止服务。
echo.
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:5173'"
call npm run dev
pause
