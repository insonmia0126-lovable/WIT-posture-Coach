@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 목격자 DEMO — 추가 패키지 없이 모의 시연을 시작합니다.
python -m wit.app
if errorlevel 1 (
  echo Python 실행에 실패했습니다. Python 3.11 64-bit가 PATH에 있는지 확인하세요.
  pause
)
