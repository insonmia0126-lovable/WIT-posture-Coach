@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 LTS가 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
echo 패키지를 설치합니다...
call npm install --prefix app
if errorlevel 1 (
  echo npm install 에 실패했습니다.
  pause
  exit /b 1
)
echo 개발 서버를 시작합니다. 이 창을 닫으면 브라우저 접속도 끊깁니다.
echo Chrome에서 http://127.0.0.1:43124 를 여세요.
start "" http://127.0.0.1:43124
call npm run dev --prefix app
pause
