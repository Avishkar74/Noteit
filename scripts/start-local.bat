@echo off
REM start-local.bat - start backend and phone-app bound to a specific IP
REM Usage: start-local.bat 100.128.167.245

set IP=%1
if "%IP%"=="" set IP=100.128.167.245

echo Starting Snabby local servers using IP: %IP%

REM Change to repo root (script lives in scripts/) and start backend in new window
pushd "%~dp0.."
start "Snabby Backend" cmd /k "set BASE_URL=http://%IP% && cd backend && npm run dev"

REM Start static server bound to the chosen IP in another window
start "Snabby Phone App" cmd /k "npx serve . -l http://%IP%:5500"

popd

echo Launched backend and phone app windows. Close these windows to stop the servers.
pause
