export function cameraErrorMessage(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Chrome은 카메라에 http://127.0.0.1 또는 https 주소만 허용합니다. 지금 주소 대신 http://127.0.0.1:43124 를 여세요.";
  }
  const name = err && typeof err === "object" && "name" in err ? String((err as DOMException).name) : "";
  const msg = err && typeof err === "object" && "message" in err ? String((err as Error).message) : String(err);
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "카메라 권한이 거부되었습니다. 주소창의 카메라 아이콘에서 허용한 뒤 다시 시작해 주세요.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "사용 가능한 웹캠이 없습니다. 노트북 내장 카메라가 연결돼 있는지 확인하세요.";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || msg.includes("in use")) {
    return "다른 앱이 카메라를 사용 중일 수 있습니다. Zoom, Teams, 다른 브라우저 탭을 종료한 뒤 다시 시도하세요.";
  }
  if (msg.includes("model") || msg.includes("WASM") || msg.includes("wasm")) {
    return "자세 모델 또는 WASM을 불러오지 못했습니다. 앱을 다시 시작하고, 파일이 app/public/models 와 app/public/mediapipe 에 있는지 확인하세요.";
  }
  return `카메라를 열 수 없습니다. (${name || msg})`;
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}
