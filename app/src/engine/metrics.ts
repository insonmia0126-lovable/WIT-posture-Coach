import type { Baseline, CameraPosition, Metrics, Point } from "./types";

/** BlazePose / Pose Landmarker indices */
export const LM = {
  NOSE: 0,
  LEFT_EYE: 2,
  RIGHT_EYE: 5,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
} as const;

export function lineTiltDeg(a: Point, b: Point): number {
  return wrapLineTilt((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}

// A face/shoulder line has no direction: swapping left/right must not add 180°.
function wrapLineTilt(degrees: number): number {
  return ((degrees + 270) % 180) - 90;
}

export function lineAngleDifference(angle: number, reference: number): number {
  return wrapLineTilt(angle - reference);
}

export function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  if (s.length === 0) return 0;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function cameraFaceLandmarks(position: CameraPosition): { eye: number; ear: number; shoulder: number } {
  return position === "left"
    ? { eye: LM.LEFT_EYE, ear: LM.LEFT_EAR, shoulder: LM.LEFT_SHOULDER }
    : { eye: LM.RIGHT_EYE, ear: LM.RIGHT_EAR, shoulder: LM.RIGHT_SHOULDER };
}

/**
 * 2D image-space comparison, not clinical CVA / FHP angles.
 * Front: eye-line tilt and face offsets normalized by shoulder width.
 * Oblique: selected eye/ear-line tilt and ear/shoulder offsets; deltas use
 * the ear-to-shoulder scale recorded at calibration, not projected shoulder width.
 */
export function computeMetrics(points: Point[], minVis: number, cameraPosition: CameraPosition = "front"): Metrics {
  const side = cameraFaceLandmarks(cameraPosition);
  const need = cameraPosition === "front"
    ? [LM.NOSE, LM.LEFT_EYE, LM.RIGHT_EYE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER]
    : [LM.NOSE, side.eye, side.ear, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER];
  if (points.length < 13) {
    return invalid("랜드마크가 부족합니다. 구도를 확인해 주세요.", cameraPosition);
  }
  for (const i of need) {
    const p = points[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.visibility) || p.visibility < minVis) {
      const reason = cameraPosition === "front"
        ? "양쪽 눈과 어깨가 보이도록 구도를 확인해 주세요."
        : `카메라 쪽 ${cameraPosition === "left" ? "왼쪽" : "오른쪽"} 눈·귀와 양쪽 어깨가 보여야 합니다. 완전한 옆모습은 지원하지 않습니다.`;
      return invalid(reason, cameraPosition);
    }
  }
  const le = points[LM.LEFT_EYE];
  const re = points[LM.RIGHT_EYE];
  const ls = points[LM.LEFT_SHOULDER];
  const rs = points[LM.RIGHT_SHOULDER];
  const nose = points[LM.NOSE];
  const width = dist(ls, rs);
  if (width < 0.04) {
    return invalid("양쪽 어깨가 구분되지 않습니다. 카메라를 정면 쪽으로 옮기거나 거리를 조정해 주세요.", cameraPosition);
  }
  if (cameraPosition !== "front") {
    const eye = points[side.eye];
    const ear = points[side.ear];
    const shoulder = points[side.shoulder];
    const scale = dist(ear, shoulder);
    if (dist(eye, ear) < 0.015 || scale < 0.05) {
      return invalid("카메라 쪽 눈·귀·어깨가 구분되지 않습니다. 구도와 거리를 조정해 주세요.", cameraPosition);
    }
    return {
      cameraPosition,
      // Freeze this scale in the baseline: a compressed shoulder span in an oblique
      // view must not amplify ordinary head movement on every frame.
      torsoScale: scale,
      headTiltDeg: lineTiltDeg(ear, eye),
      shoulderTiltDeg: lineTiltDeg(ls, rs),
      torsoDx: ear.x - shoulder.x,
      torsoDy: ear.y - shoulder.y,
      valid: true,
      reason: "",
    };
  }
  const face = midpoint(le, re);
  const sh = midpoint(ls, rs);
  return {
    cameraPosition,
    torsoScale: 1,
    headTiltDeg: lineTiltDeg(le, re),
    shoulderTiltDeg: lineTiltDeg(ls, rs),
    torsoDx: (face.x - sh.x) / width,
    torsoDy: (nose.y - sh.y) / width,
    valid: true,
    reason: "",
  };
}

export function deltas(m: Metrics, b: Baseline) {
  if (m.cameraPosition !== b.cameraPosition) throw new Error("카메라 위치가 변경되었습니다. 기준을 다시 등록하세요.");
  return {
    head: wrapLineTilt(m.headTiltDeg - b.headTiltDeg),
    shoulder: wrapLineTilt(m.shoulderTiltDeg - b.shoulderTiltDeg),
    torso: Math.hypot(m.torsoDx - b.torsoDx, m.torsoDy - b.torsoDy) / b.torsoScale,
  };
}

export function baselineFromFrames(frames: Metrics[]): Baseline | null {
  const ok = frames.filter((f) => f.valid);
  if (ok.length < 8) return null;
  if (ok.some((frame) => frame.cameraPosition !== ok[0].cameraPosition)) return null;
  return {
    cameraPosition: ok[0].cameraPosition,
    torsoScale: median(ok.map((frame) => frame.torsoScale)),
    headTiltDeg: median(ok.map((f) => f.headTiltDeg)),
    shoulderTiltDeg: median(ok.map((f) => f.shoulderTiltDeg)),
    torsoDx: median(ok.map((f) => f.torsoDx)),
    torsoDy: median(ok.map((f) => f.torsoDy)),
  };
}

function invalid(reason: string, cameraPosition: CameraPosition): Metrics {
  return {
    cameraPosition,
    torsoScale: 1,
    headTiltDeg: 0,
    shoulderTiltDeg: 0,
    torsoDx: 0,
    torsoDy: 0,
    valid: false,
    reason,
  };
}
