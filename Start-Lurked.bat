@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ============================================================
::  LurkedTV - Startup Launcher
:: ============================================================

cd /d "%~dp0"
title LurkedTV - Starting Up...
color 0F

:: ----------------------------------------
:: CONFIGURATION
:: ----------------------------------------
set "FFMPEG_DIR=%~dp0tools\ffmpeg"
set "FFMPEG_EXE=%~dp0tools\ffmpeg\bin\ffmpeg.exe"
set "FFMPEG_BIN=%~dp0tools\ffmpeg\bin"
set "FFMPEG_ZIP=%TEMP%\ffmpeg-release.zip"
set "FFMPEG_URL=https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
set "FFMPEG_EXTRACT_TEMP=%TEMP%\ffmpeg-extract-temp"
set "NO_UPDATE_NOTIFIER=1"
set "NPM_CONFIG_UPDATE_NOTIFIER=false"

:: ----------------------------------------
:: SPLASH SCREEN
:: ----------------------------------------
cls
call :PRINT_LOGO
echo.
call :SLEEP 800
echo  SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS
echo.
call :SLEEP 200
echo  [*]  Preparing services...
call :SLEEP 500
echo  [*]  Checking environment...
call :SLEEP 400
echo.
echo  SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS
echo.

:: ----------------------------------------
:: STEP 1 -- Node.js
:: ----------------------------------------
call :SLEEP 300
echo  [1 / 5]  Node.js
echo  ---------------------------------------------------------
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!]  Node.js not found in PATH.
    echo  [!]  Download: https://nodejs.org
    call :FATAL "Node.js is required to run LurkedTV."
    goto :ABORT
)
for /f "tokens=*" %%v in ('node -e "process.stdout.write(process.version)"') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% detected.
echo.
call :SLEEP 300

:: ----------------------------------------
:: STEP 2 -- npm
:: ----------------------------------------
echo  [2 / 5]  npm
echo  ---------------------------------------------------------
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!]  npm not found. Reinstall Node.js from nodejs.org.
    call :FATAL "npm is required to run LurkedTV."
    goto :ABORT
)
for /f "tokens=*" %%v in ('node -e "const fs=require('fs'),p=require('path');try{const pkg=JSON.parse(fs.readFileSync(p.join(p.dirname(process.execPath),'node_modules','npm','package.json')));process.stdout.write(pkg.version);}catch(e){process.stdout.write('unknown');}"') do set NPM_VER=%%v
echo  [OK] npm v%NPM_VER% detected.
echo.
call :SLEEP 300

:: ----------------------------------------
:: STEP 3 -- Dependencies
:: ----------------------------------------
echo  [3 / 5]  Node modules
echo  ---------------------------------------------------------
if not exist "node_modules\" (
    echo  [~]  node_modules not found. Installing dependencies...
    echo.
    npm install --no-fund --no-audit
    if %errorlevel% neq 0 (
        call :FATAL "npm install failed. Check your network or package.json."
        goto :ABORT
    )
    echo.
    echo  [OK] Dependencies installed successfully.
) else (
    echo  [OK] Dependencies already installed.
)
echo.
call :SLEEP 300

:: ----------------------------------------
:: STEP 4 -- ffmpeg
:: ----------------------------------------
echo  [4 / 5]  ffmpeg
echo  ---------------------------------------------------------

if exist "%FFMPEG_EXE%" (
    echo  [OK] ffmpeg found at local tools path.
    goto :ffmpeg_add_path
)

where ffmpeg >nul 2>&1
if %errorlevel% equ 0 (
    echo  [OK] ffmpeg found on system PATH.
    goto :ffmpeg_done
)

echo  [~]  ffmpeg not found. Downloading now...
echo  [~]  Source : %FFMPEG_URL%
echo  [~]  Target : %FFMPEG_BIN%\
echo.

if not exist "%~dp0tools"   mkdir "%~dp0tools"
if not exist "%FFMPEG_DIR%" mkdir "%FFMPEG_DIR%"
if not exist "%FFMPEG_BIN%" mkdir "%FFMPEG_BIN%"

set "PS_DOWNLOAD=%TEMP%\ltv_dl.ps1"
set "PS_EXTRACT=%TEMP%\ltv_ex.ps1"
set "PS_SETPATH=%TEMP%\ltv_sp.ps1"

node -e "require('fs').writeFileSync(process.env.PS_DOWNLOAD, \"$ProgressPreference='SilentlyContinue'\n[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12\nInvoke-WebRequest -Uri $env:FFMPEG_URL -OutFile $env:FFMPEG_ZIP\n\")"
node -e "require('fs').writeFileSync(process.env.PS_EXTRACT, \"$ProgressPreference='SilentlyContinue'\nExpand-Archive -Path $env:FFMPEG_ZIP -DestinationPath $env:FFMPEG_EXTRACT_TEMP -Force\n\")"
node -e "require('fs').writeFileSync(process.env.PS_SETPATH, \"$bin = $env:FFMPEG_BIN\n$cur = [Environment]::GetEnvironmentVariable('PATH', 'User')\nif ($cur -notlike '*' + $bin + '*') {\n    [Environment]::SetEnvironmentVariable('PATH', $cur + ';' + $bin, 'User')\n    Write-Host '[OK] PATH updated.'\n} else {\n    Write-Host '[OK] Already in PATH.'\n}\n\")"

echo  [~]  Downloading ffmpeg (this may take a moment)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_DOWNLOAD%"
if %errorlevel% neq 0 (
    del /q "%PS_DOWNLOAD%" "%PS_EXTRACT%" "%PS_SETPATH%" >nul 2>&1
    call :FATAL "ffmpeg download failed. Check your internet connection."
    goto :ABORT
)
echo  [OK] Download complete.
echo.
call :SLEEP 200

echo  [~]  Extracting archive...
if exist "%FFMPEG_EXTRACT_TEMP%" rmdir /s /q "%FFMPEG_EXTRACT_TEMP%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_EXTRACT%"
if %errorlevel% neq 0 (
    del /q "%PS_DOWNLOAD%" "%PS_EXTRACT%" "%PS_SETPATH%" >nul 2>&1
    call :FATAL "Extraction failed. Delete %FFMPEG_ZIP% and retry."
    goto :ABORT
)

echo  [~]  Copying binaries...
for /d %%D in ("%FFMPEG_EXTRACT_TEMP%\ffmpeg-*") do (
    if exist "%%D\bin\ffmpeg.exe" (
        copy /y "%%D\bin\ffmpeg.exe"  "%FFMPEG_BIN%\ffmpeg.exe"  >nul
        copy /y "%%D\bin\ffprobe.exe" "%FFMPEG_BIN%\ffprobe.exe" >nul
        copy /y "%%D\bin\ffplay.exe"  "%FFMPEG_BIN%\ffplay.exe"  >nul 2>&1
    )
)

del /q "%FFMPEG_ZIP%"               >nul 2>&1
rmdir /s /q "%FFMPEG_EXTRACT_TEMP%" >nul 2>&1

if not exist "%FFMPEG_EXE%" (
    del /q "%PS_DOWNLOAD%" "%PS_EXTRACT%" "%PS_SETPATH%" >nul 2>&1
    call :FATAL "ffmpeg.exe missing after extraction. Try: https://www.gyan.dev/ffmpeg/builds/"
    goto :ABORT
)

echo  [OK] ffmpeg installed to: %FFMPEG_BIN%\
echo.
echo  [~]  Updating user PATH permanently...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SETPATH%"
del /q "%PS_DOWNLOAD%" "%PS_EXTRACT%" "%PS_SETPATH%" >nul 2>&1

:ffmpeg_add_path
set "PATH=%FFMPEG_BIN%;%PATH%"
"%FFMPEG_BIN%\ffmpeg.exe" -version >nul 2>&1
if %errorlevel% equ 0 (
    echo  [OK] ffmpeg is active and verified.
) else (
    echo  [!]  ffmpeg installed but could not be verified. Check %FFMPEG_BIN%\
)

:ffmpeg_done
echo.
call :SLEEP 300

:: ----------------------------------------
:: STEP 5 -- .env
:: ----------------------------------------
echo  [5 / 5]  Environment config
echo  ---------------------------------------------------------
if not exist ".env" (
    echo  [!]  No .env file found.
    echo  [!]  The Discord bot may not function without it.
    echo  [!]  Create a .env file in the project root to continue.
) else (
    echo  [OK] .env file found.
)
echo.
call :SLEEP 500

:: ----------------------------------------
:: LAUNCH
:: ----------------------------------------
cls
call :PRINT_LOGO
echo.
echo  SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS
echo.
echo  [OK] All checks passed. Launching services...
echo.
call :SLEEP 400

:: Write helper launchers to temp -- avoids all nested-quote hell
set "LAUNCH_WEB=%TEMP%\ltv_web.bat"
set "LAUNCH_BOT=%TEMP%\ltv_bot.bat"
set "ESCAPED_BIN=%FFMPEG_BIN%"
set "ESCAPED_DIR=%~dp0"

(
    echo @echo off
    echo title LurkedTV - Web Server
    echo color 0A
    echo set "PATH=%ESCAPED_BIN%;%PATH%"
    echo cd /d "%ESCAPED_DIR%"
    echo echo.
    echo echo  [LurkedTV] Web Server starting...
    echo echo.
    echo npm run start
    echo echo.
    echo echo  [LurkedTV] Web Server stopped.
    echo echo  Press any key to close this window...
    echo pause ^>nul
) > "%LAUNCH_WEB%"

(
    echo @echo off
    echo title LurkedTV - Discord Bot
    echo color 0B
    echo set "PATH=%ESCAPED_BIN%;%PATH%"
    echo cd /d "%ESCAPED_DIR%"
    echo echo.
    echo echo  [LurkedTV] Discord Bot starting...
    echo echo.
    echo npm run bot:discord
    echo echo.
    echo echo  [LurkedTV] Discord Bot stopped.
    echo echo  Press any key to close this window...
    echo pause ^>nul
) > "%LAUNCH_BOT%"

echo  [~]  Starting web server...
call :SLEEP 300
start "LurkedTV - Web Server" cmd /c "%LAUNCH_WEB%"

call :SLEEP 1500

echo  [~]  Starting Discord bot...
call :SLEEP 300
start "LurkedTV - Discord Bot" cmd /c "%LAUNCH_BOT%"

call :SLEEP 800

echo.
echo  SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS
echo.
echo  [OK] LurkedTV is live. Both services are running.
echo.
echo       Web Server   -->  LurkedTV - Web Server  (separate window)
echo       Discord Bot  -->  LurkedTV - Discord Bot (separate window)
echo       ffmpeg path  -->  %FFMPEG_BIN%\
echo.
echo  SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS
echo.
title LurkedTV - Running
echo  Press any key to close this launcher (services keep running)...
pause >nul
goto :eof

:: ============================================================

:ABORT
echo.
echo  Press any key to close...
pause >nul
goto :eof

:: ============================================================
::  SUBROUTINES
:: ============================================================

:PRINT_LOGO
echo.
echo  =========================================================
echo    LurkedTV  --  Live. Streaming. Always lurking.
echo  =========================================================
echo.
goto :eof

:SLEEP
powershell -NoProfile -Command "Start-Sleep -Milliseconds %~1" >nul 2>&1
goto :eof

:FATAL
echo.
echo  +-------------------------------------------------------+
echo  ^|  FATAL ERROR                                          ^|
echo  +-------------------------------------------------------+
echo  ^|  %~1
echo  +-------------------------------------------------------+
echo.
echo  LurkedTV startup aborted. Resolve the issue above and retry.
echo.
goto :eof