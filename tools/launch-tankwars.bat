@echo off
cd /d "C:\Users\vebjo\AI-home\projects\tankwars"
start "tankwars-dev-server" cmd /c "npm run dev"
timeout /t 3 /nobreak >nul
start "" "http://localhost:5180"
