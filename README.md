# 목격자 (W.I.T) v0.1

개인 기준 대비 자세 변화를 감지하고, 알림 이후 회복을 확인하는 **연구용 PC 프로토타입**입니다. 스마트폰 APK나 Windows EXE가 아니며, 실측 성능은 아직 검증하지 않았습니다.

대상은 책상에서 장시간 작업하는 사용자입니다. 모든 움직임을 나쁜 자세로 보지 않고, 개인 기준에서 **+12° 이상**이 **5초** 이어질 때만 알립니다. 회복은 **+8° 이하가 2초** 유지될 때 확인합니다. 각도는 귀와 어깨를 잇는 선과 수직선 사이의 2D 대리지표이며 **임상 CVA가 아닙니다**.

## 실행 (모의 시연, 추가 패키지 없음)

Python 3.10+ (발표 환경은 3.11 64-bit 권장).

```bash
python -m unittest tests.test_state_machine -v
python run_tests.py
python -m wit.app
```

Windows: `run_windows.bat`

브라우저 미리보기:

```bash
python -m wit.web_server 43123
```

## 카메라 모드 (선택)

측면 카메라만 지원합니다. 정면 스마트폰 추정과 IMU 결합은 후속 과제입니다.

```bash
# Windows: setup_windows.bat
python -m pip install -r requirements-camera.txt
mkdir -p models
curl -L -o models/pose_landmarker_lite.task \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
```

앱에서 왼쪽/오른쪽 측면을 고르고 카메라를 시작합니다. 최초 패키지·모델 설치만 온라인이고, 실행 중 프레임 처리와 추론은 PC 내부입니다. `app.py`는 네트워크 호출과 영상 저장이 없습니다.

## 상태 전이

기준 기록 5초 → 안정 / 경계 / 변화 지속 → 5초 이상 이탈 시 알림 → 2초 복귀 시 회복. 경계 구간은 지속 타이머를 초기화합니다. 저신뢰·가림·1.5초 초과 입력 공백은 관찰 중단이며, 중단된 경고는 회복 성공으로 집계하지 않습니다.

자동 테스트 8개는 판단 로직 검증입니다. AI 인식 정확도 100%를 의미하지 않습니다.

## A/B

- **B**: 교정 피드백 표시 체크. 화면·알림·로그 노출.
- **A**: 체크 해제. 화면 피드백을 숨기고 내부 판단만 CSV에 기록. 조건 전환 시 세션을 초기화하세요. A의 `alerts`는 전달한 알림이 아니라 내부 경고 조건 횟수입니다.

CSV 열에 `mode`(DEMO/CAMERA)와 `feedback_enabled`가 있습니다. 모의 시연과 실측을 섞지 마세요.

## 문서

- `docs/presentation.md` — 10분 구성안
- `docs/demo_script.md` — 90초 시연
- `docs/experiment_form.md` — 파일럿 양식 (결과 칸은 미측정)

## 한계

정면 촬영 없음. 몸통 기울기·어깨 움직임이 머리 변화로 오인될 수 있음. 카메라 이동 자동 감지 없음(이동 후 수동 재보정). 개인 기준이 임상적 정상을 보장하지 않음. 12°와 5초는 동작 확인용 설계값입니다.
