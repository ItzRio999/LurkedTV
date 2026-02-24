@echo off
setlocal

cd /d "%~dp0"

echo Starting Nodecast web server...
start "Nodecast Web Server" cmd /k "npm run start"

echo Starting Nodecast Discord bot...
start "Nodecast Discord Bot" cmd /k "npm run bot:discord"

echo Both processes launched.
