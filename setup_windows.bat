@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 카메라 모드용 패키지와 Pose Landmarker Lite 모델을 설치합니다.
python -m pip install -r requirements-camera.txt
if not exist models mkdir models
if not exist models\pose_landmarker_lite.task (
  echo 모델 다운로드 중...
  curl -L -o models\pose_landmarker_lite.task "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
)
python -m pip freeze > requirements.lock.txt
echo 설치가 끝나면 run_windows.bat 을 다시 실행하고 카메라 시작을 누르세요.
pause
