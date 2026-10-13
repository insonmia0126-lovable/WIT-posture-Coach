import type { Baseline, Metrics, Point } from "./types";

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
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
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

/**
 * 2D image-space metrics. Coordinates are normalized (0–1), y down.
 * Head/shoulder tilts are angles from the horizontal. Torso offsets are
 * shoulder-width normalized. These are not clinical CVA / FHP angles.
 */
export function computeMetrics(points: Point[], minVis: number): Metrics {
  const need = [LM.NOSE, LM.LEFT_EYE, LM.RIGHT_EYE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER];
  if (points.length < 13) {
    return invalid("랜드마크가 부족합니다. 구도를 확인해 주세요.");
  }
  for (const i of need) {
    const p = points[i];
    if (!p || p.visibility < minVis) {
      return invalid("얼굴 또는 어깨 신뢰도가 낮습니다. 구도를 확인해 주세요.");
    }
  }
  const le = points[LM.LEFT_EYE];
  const re = points[LM.RIGHT_EYE];
  const ls = points[LM.LEFT_SHOULDER];
  const rs = points[LM.RIGHT_SHOULDER];
  const nose = points[LM.NOSE];
  const width = dist(ls, rs);
  if (width < 0.04) {
    return invalid("어깨가 너무 가깝게 보입니다. 거리를 조정해 주세요.");
  }
  const face = midpoint(le, re);
  const sh = midpoint(ls, rs);
  return {
    headTiltDeg: lineTiltDeg(le, re),
    shoulderTiltDeg: lineTiltDeg(ls, rs),
    torsoDx: (face.x - sh.x) / width,
    torsoDy: (nose.y - sh.y) / width,
    valid: true,
    reason: "",
  };
}

export function deltas(m: Metrics, b: Baseline) {
  return {
    head: m.headTiltDeg - b.headTiltDeg,
    shoulder: m.shoulderTiltDeg - b.shoulderTiltDeg,
    torso: Math.hypot(m.torsoDx - b.torsoDx, m.torsoDy - b.torsoDy),
  };
}

export function baselineFromFrames(frames: Metrics[]): Baseline | null {
  const ok = frames.filter((f) => f.valid);
  if (ok.length < 8) return null;
  return {
    headTiltDeg: median(ok.map((f) => f.headTiltDeg)),
    shoulderTiltDeg: median(ok.map((f) => f.shoulderTiltDeg)),
    torsoDx: median(ok.map((f) => f.torsoDx)),
    torsoDy: median(ok.map((f) => f.torsoDy)),
  };
}

function invalid(reason: string): Metrics {
  return {
    headTiltDeg: 0,
    shoulderTiltDeg: 0,
    torsoDx: 0,
    torsoDy: 0,
    valid: false,
    reason,
  };
}
