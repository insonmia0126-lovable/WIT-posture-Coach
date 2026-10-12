"""측면 카메라 → MediaPipe Pose Landmarker Lite → 귀-어깨 2D 각도.

패키지·모델이 없으면 ImportError를 내고 DEMO 모드로 전환한다.
정면 촬영은 지원하지 않는다. 어깨는 제7경추가 아니므로 임상 CVA로 부르지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
)
MODEL_NAME = "pose_landmarker_lite.task"


@dataclass
class PoseReading:
    angle_deg: float
    visibility: float
    occluded: bool


def default_model_path() -> Path:
    return Path(__file__).resolve().parent.parent / "models" / MODEL_NAME


def ear_shoulder_angle_deg(
    ear_x: float,
    ear_y: float,
    shoulder_x: float,
    shoulder_y: float,
) -> float:
    """귀→어깨 벡터와 아래 수직선(0, +1) 사이 각도(도). y는 화면 좌표(아래가 +)."""
    import math

    vx = shoulder_x - ear_x
    vy = shoulder_y - ear_y
    # 수직 아래 벡터: (0, 1)
    norm = math.hypot(vx, vy)
    if norm < 1e-6:
        return 0.0
    cos_a = (vy) / norm
    cos_a = max(-1.0, min(1.0, cos_a))
    return math.degrees(math.acos(cos_a))


class SideCameraPose:
    def __init__(
        self,
        camera_index: int = 0,
        side: str = "left",
        model_path: Optional[Path] = None,
    ) -> None:
        try:
            import cv2  # noqa: F401
            import mediapipe as mp  # noqa: F401
        except ImportError as exc:
            raise ImportError(
                "카메라 모드는 opencv-python과 mediapipe가 필요합니다. "
                "setup 스크립트를 실행하거나 DEMO 모드를 사용하세요."
            ) from exc

        self.camera_index = camera_index
        self.side = side
        self.model_path = model_path or default_model_path()
        self._cap = None
        self._landmarker = None

    def open(self) -> None:
        import cv2
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision

        if not self.model_path.exists():
            raise FileNotFoundError(
                f"모델 파일이 없습니다: {self.model_path}\n"
                f"setup 스크립트로 {MODEL_URL} 을 내려받으세요."
            )
        self._cap = cv2.VideoCapture(self.camera_index)
        if not self._cap.isOpened():
            raise RuntimeError(
                f"카메라 {self.camera_index}를 열 수 없습니다. DEMO 모드로 전환하세요."
            )
        base = mp_python.BaseOptions(model_asset_path=str(self.model_path))
        options = vision.PoseLandmarkerOptions(
            base_options=base,
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)

    def read(self, timestamp_ms: int) -> tuple[Optional[object], Optional[PoseReading]]:
        import cv2
        import mediapipe as mp
        from mediapipe.tasks.python.vision import PoseLandmarkerResult

        if self._cap is None or self._landmarker is None:
            raise RuntimeError("open()을 먼저 호출하세요.")
        ok, frame = self._cap.read()
        if not ok:
            return None, None
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result: PoseLandmarkerResult = self._landmarker.detect_for_video(
            mp_image, timestamp_ms
        )
        reading = self._from_result(result)
        return frame, reading

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self._landmarker = None

    def _from_result(self, result) -> Optional[PoseReading]:
        if not result.pose_landmarks:
            return PoseReading(0.0, 0.0, True)
        lm = result.pose_landmarks[0]
        # BlazePose: 7 left ear, 8 right ear, 11 left shoulder, 12 right shoulder
        if self.side == "right":
            ear, shoulder = lm[8], lm[12]
        else:
            ear, shoulder = lm[7], lm[11]
        vis = min(getattr(ear, "visibility", 1.0) or 0.0, getattr(shoulder, "visibility", 1.0) or 0.0)
        angle = ear_shoulder_angle_deg(ear.x, ear.y, shoulder.x, shoulder.y)
        occluded = vis < 0.5
        return PoseReading(angle, vis, occluded)
