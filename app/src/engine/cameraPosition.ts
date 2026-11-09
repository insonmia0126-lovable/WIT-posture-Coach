import type { CameraPosition } from "./types";

export const CAMERA_POSITIONS: { value: CameraPosition; label: string }[] = [
  { value: "front", label: "정면" },
  { value: "left", label: "왼쪽 대각" },
  { value: "right", label: "오른쪽 대각" },
];

export function isCameraPosition(value: unknown): value is CameraPosition {
  return CAMERA_POSITIONS.some((position) => position.value === value);
}

export function cameraPositionLabel(position: CameraPosition): string {
  return CAMERA_POSITIONS.find((item) => item.value === position)!.label;
}

export function cameraPositionGuide(position: CameraPosition): string {
  if (position === "front") return "얼굴과 양쪽 어깨가 보이도록 앉고, 평소 업무 화면을 보며 기준을 등록하세요.";
  const side = position === "left" ? "왼쪽" : "오른쪽";
  return `카메라를 사용자 기준 ${side} 대각에 놓으세요. ${side} 눈·귀와 양쪽 어깨가 보여야 합니다. 카메라 대신 평소 업무 화면을 보며 등록하세요.`;
}
