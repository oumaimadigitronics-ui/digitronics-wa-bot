@echo off
cd /d "%~dp0"

git status
git add .
git commit -m "Update bot logic and WANotifier endpoint"
git push origin main

pause
