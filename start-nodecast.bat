@echo off
setlocal enabledelayedexpansion

call :MAIN
echo.
echo Press any key to close this window...
pause >nul
exit /b

:MAIN

cd /d "%~dp0"

echo =======================================
echo        Nodecast TV - Startup
echo =======================================
echo.

:: ----------------------------------------
:: CONFIGURATION
:: ----------------------------------------
set "FFMPEG_DIR=%~dp0tools\ffmpeg"
set "FFMPEG_EXE=%~dp0tools\ffmpeg\bin\ffmpeg.exe"
set "FFMPEG_BIN=%~dp0tools\ffmpeg\bin"
set "FFMPEG_ZIP=%TEMP%\ffmpeg-release.zip"
set "FFMPEG_URL=https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
set "FFMPEG_EXTRACT_TEMP=%TEMP%\ffmpeg-extract-temp"

:: Suppress npm update check
set "NO_UPDATE_NOTIFIER=1"
set "NPM_CONFIG_UPDATE_NOTIFIER=false"

:: ----------------------------------------
:: CHECK: Node.js
:: ----------------------------------------
echo [1/5] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found in PATH.
    echo         Download it from: https://nodejs.org
    exit /b 1
)
for /f "tokens=*" %%v in ('node -e "process.stdout.write(process.version)"') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER% found.
echo.

:: ----------------------------------------
:: CHECK: npm
:: ----------------------------------------
echo [2/5] Checking npm...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm not found in PATH. Please reinstall Node.js.
    exit /b 1
)
for /f "tokens=*" %%v in ('node -e "const fs=require('fs'),p=require('path');try{const pkg=JSON.parse(fs.readFileSync(p.join(p.dirname(process.execPath),'node_modules','npm','package.json')));process.stdout.write(pkg.version);}catch(e){process.stdout.write('unknown');}"') do set NPM_VER=%%v
echo [OK] npm v%NPM_VER% found.
echo.

:: ----------------------------------------
:: CHECK: node_modules
:: ----------------------------------------
echo [3/5] Checking dependencies...
if not exist "node_modules\" (
    echo [INFO] node_modules not found. Running npm install...
    npm install --no-fund --no-audit
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        exit /b 1
    )
    echo [OK] Dependencies installed.
) else (
    echo [OK] node_modules found.
)
echo.

:: ----------------------------------------
:: CHECK & INSTALL: ffmpeg
:: ----------------------------------------
echo [4/5] Checking ffmpeg...

if exist "%FFMPEG_EXE%" (
    echo [OK] ffmpeg already installed locally.
    goto :ffmpeg_add_path
)

where ffmpeg >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] ffmpeg found on system PATH.
    goto :ffmpeg_done
)

echo [INFO] ffmpeg not found. Starting download...
echo        URL    : %FFMPEG_URL%
echo        Target : %FFMPEG_BIN%\
echo.

if not exist "%~dp0tools" mkdir "%~dp0tools"
if not exist "%FFMPEG_DIR%" mkdir "%FFMPEG_DIR%"
if not exist "%FFMPEG_BIN%" mkdir "%FFMPEG_BIN%"

:: Use Node.js to write all ps1 files - avoids ALL batch escape character leaking
set "PS_DOWNLOAD=%TEMP%\nc_dl.ps1"
set "PS_EXTRACT=%TEMP%\nc_ex.ps1"
set "PS_SETPATH=%TEMP%\nc_sp.ps1"

node -e "require('fs').writeFileSync(process.env.PS_DOWNLOAD, \"$ProgressPreference='SilentlyContinue'\n[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12\nInvoke-WebRequest -Uri $env:FFMPEG_URL -OutFile $env:FFMPEG_ZIP\n\")"
node -e "require('fs').writeFileSync(process.env.PS_EXTRACT, \"$ProgressPreference='SilentlyContinue'\nExpand-Archive -Path $env:FFMPEG_ZIP -DestinationPath $env:FFMPEG_EXTRACT_TEMP -Force\n\")"
node -e "require('fs').writeFileSync(process.env.PS_SETPATH, \"$bin = $env:FFMPEG_BIN\n$cur = [Environment]::GetEnvironmentVariable('PATH', 'User')\nif ($cur -notlike \"*$bin*\") {\n    [Environment]::SetEnvironmentVariable('PATH', $cur + ';' + $bin, 'User')\n    Write-Host 'PATH updated.'\n} else {\n    Write-Host 'Already in PATH.'\n}\n\")"

echo [INFO] Downloading ffmpeg (this may take a moment)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_DOWNLOAD%"
if %errorlevel% neq 0 (
    echo [ERROR] Download failed. Check your internet connection.
    del /q "%PS_DOWNLOAD%" "%PS_EXTRACT%" "%PS_SETPATH%" >nul 2>&1
    exit /b 1
)
echo [OK] Download complete.

echo [INFO] Extracting...
if exist "%FFMPEG_EXTRACT_TEMP%" rmdir /s /q "%FFMPEG_EXTRACT_TEMP%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_EXTRACT%"
if %errorlevel% neq 0 (
    echo [ERROR] Extraction failed. Delete %FFMPEG_ZIP% and retry.
    del /q "%PS_DOWNLOAD%" "%PS_EXTRACT%" "%PS_SETPATH%" >nul 2>&1
    exit /b 1
)

echo [INFO] Copying binaries...
for /d %%D in ("%FFMPEG_EXTRACT_TEMP%\ffmpeg-*") do (
    if exist "%%D\bin\ffmpeg.exe" (
        copy /y "%%D\bin\ffmpeg.exe"  "%FFMPEG_BIN%\ffmpeg.exe"  >nul
        copy /y "%%D\bin\ffprobe.exe" "%FFMPEG_BIN%\ffprobe.exe" >nul
        copy /y "%%D\bin\ffplay.exe"  "%FFMPEG_BIN%\ffplay.exe"  >nul 2>&1
    )
)

del /q "%FFMPEG_ZIP%" >nul 2>&1
rmdir /s /q "%FFMPEG_EXTRACT_TEMP%" >nul 2>&1

if not exist "%FFMPEG_EXE%" (
    echo [ERROR] ffmpeg.exe missing after extraction.
    echo         Try manually: https://www.gyan.dev/ffmpeg/builds/
    del /q "%PS_DOWNLOAD%" "%PS_EXTRACT%" "%PS_SETPATH%" >nul 2>&1
    exit /b 1
)
echo [OK] ffmpeg installed to %FFMPEG_BIN%\

echo [INFO] Adding to permanent user PATH...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SETPATH%"
echo [OK] User PATH updated permanently.

del /q "%PS_DOWNLOAD%" "%PS_EXTRACT%" "%PS_SETPATH%" >nul 2>&1

:ffmpeg_add_path
set "PATH=%FFMPEG_BIN%;%PATH%"
"%FFMPEG_BIN%\ffmpeg.exe" -version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] ffmpeg is active in PATH.
) else (
    echo [WARN] ffmpeg installed but could not be verified. Check %FFMPEG_BIN%\
)

:ffmpeg_done
echo.

:: ----------------------------------------
:: CHECK: .env file
:: ----------------------------------------
echo [5/5] Checking .env...
if not exist ".env" (
    echo [WARN] No .env file found. Discord bot may not work without it.
) else (
    echo [OK] .env file found.
)
echo.

:: ----------------------------------------
:: LAUNCH
:: ----------------------------------------
echo =======================================
echo         Launching Nodecast...
echo =======================================
echo.

set "CHILD_PATH=%FFMPEG_BIN%;%PATH%"

echo Starting web server...
start "Nodecast Web Server" cmd /k "set "PATH=%CHILD_PATH%" && cd /d "%~dp0" && npm run start"

timeout /t 2 /nobreak >nul

echo Starting Discord bot...
start "Nodecast Discord Bot" cmd /k "set "PATH=%CHILD_PATH%" && cd /d "%~dp0" && npm run bot:discord"

echo.
echo [DONE] Both services launched in separate windows.
echo        ffmpeg : %FFMPEG_BIN%\
echo.
exit /b 0