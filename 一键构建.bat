@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "RC=0"

echo ==========================================
echo   Freya 水印相机 - 一键构建 index.html
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没找到 Node.js。
  echo        请先安装 Node 18 或更高版本：https://nodejs.org
  set "RC=1"
  goto :done
)

for /f "delims=" %%v in ('node -v 2^>nul') do echo Node 版本：%%v
echo.

node build.js
if errorlevel 1 (
  echo.
  echo [失败] 构建出错，请看上面的报错信息。
  set "RC=1"
  goto :done
)

echo.
echo [自检] 静态一致性检查（声明表 / DEFAULTS / HTML 初值）...
node tools\check.js
if errorlevel 1 (
  echo.
  echo [提示] 静态检查有告警，但 index.html 已经生成，不影响使用。
)

echo.
echo [完成] %CD%\index.html
echo        双击 index.html 即可使用。

:done
echo.
if not defined FREYA_NO_PAUSE pause
exit /b %RC%
