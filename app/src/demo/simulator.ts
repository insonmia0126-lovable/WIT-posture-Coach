import { LM } from "../engine/metrics";
import type { Point } from "../engine/types";

/** Scripted landmarks for the presentation demo. Not model output. */
export function simulatedPose(elapsedMs: number): { points: Point[]; poseCount: number } {
  const pts: Point[] = Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  let head = 0;
  // 0–5s baseline, 5–12s tilt, then return
  if (elapsedMs > 5200 && elapsedMs < 14000) {
    const u = Math.min(1, (elapsedMs - 5200) / 800);
    head = 18 * u;
  } else if (elapsedMs >= 14000 && elapsedMs < 18000) {
    head = 18 * (1 - (elapsedMs - 14000) / 4000);
  }
  const rad = (head * Math.PI) / 180;
  pts[LM.NOSE] = { x: 0.5, y: 0.33, visibility: 1 };
  for (const [index, dx, dy] of [
    [LM.LEFT_EYE, -0.06, 0], [LM.RIGHT_EYE, 0.06, 0],
    [LM.LEFT_EAR, -0.1, 0.01], [LM.RIGHT_EAR, 0.1, 0.01],
  ]) {
    pts[index] = {
      x: 0.5 + Math.cos(rad) * dx - Math.sin(rad) * dy,
      y: 0.31 + Math.sin(rad) * dx + Math.cos(rad) * dy,
      visibility: 1,
    };
  }
  pts[LM.LEFT_SHOULDER] = { x: 0.34, y: 0.52, visibility: 1 };
  pts[LM.RIGHT_SHOULDER] = { x: 0.66, y: 0.52, visibility: 1 };
  return { points: pts, poseCount: 1 };
}
