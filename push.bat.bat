@echo off
cd /d C:\Users\abuye\digitronics-wa-bot

git status
git add .
git commit -m "Update bot logic and WANotifier endpoint"
git push origin main

pause
