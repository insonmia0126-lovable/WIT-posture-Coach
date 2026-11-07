# CHANGELOG

형식: [Keep a Changelog](https://keepachangelog.com)에 가깝게, 확인된 변경만 적습니다.

## [Unreleased]

## [v0.3] — 2026-11-07

업무 중 허용 범위를 넓히고, 한 세션을 끝낸 뒤 다시 측정할 때 얼굴·어깨 안내선이 사라지던 문제를 고친 버전.

### 변경
- 고개·어깨 이탈 기준 8° → 14°, 복귀 5° → 9°. 상체 보조 0.12 → 0.22, 복귀 0.08 → 0.14. 의료 기준이 아닌 사용 피드백 반영.
- 측정 화면의 비디오를 세션 종료 후에도 유지한다. 인식 오류가 나도 루프를 끊지 않고, 필요하면 자세 모델을 다시 연다.

### 유지
- 기준 등록 7초, 이탈 지속 20초, 반복 안내 3분, 복귀 확인 3초
- 개인 아이디와 브라우저 로컬 이력

## [v0.2] — 2026-10-13

노트북 웹캠 온디바이스 웹 프로토타입.

### 추가
- React + TypeScript + Vite 측정 앱 (`app/`)
- 브라우저 로컬 MediaPipe Pose Landmarker Lite
- 고개·어깨 기울기, 상체 보조 지표
- 세션 결과 표, 개인 코치 가이드, CSV
- 시연 모드에서 실시간 웹캠 미리보기
- 기준 등록 7초, 이탈 지속 20초, 반복 안내 3분 (시연은 단축)
- 버전 이력 `version/`, 학습 기록 `learning/`
- Windows 실행 `start_windows.bat`
- 공개 사이트 https://insonmia0126-lovable.github.io/WIT-posture-Coach/

### 변경
- 주 시연 경로를 Python GUI에서 웹앱으로 이동

태그: `v0.2` · 릴리스: https://github.com/insonmia0126-lovable/WIT-posture-Coach/releases/tag/v0.2

## [v0.1] — 2026-10-13

중간발표용 PC 연구 프로토타입.

### 추가
- 규칙 기반 상태 엔진, 상태 전이 테스트 8개
- 모의 슬라이더 DEMO, Tkinter GUI, 측면 카메라 연결 코드
- CSV 기록, 발표·실험 문서

태그: `v0.1` · 릴리스: https://github.com/insonmia0126-lovable/WIT-posture-Coach/releases/tag/v0.1
