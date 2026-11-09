import { describe, expect, it } from "vitest";
import { baselineFromFrames, computeMetrics, deltas, lineTiltDeg, LM } from "./metrics";
import type { Point } from "./types";

function frontalPose(tilt: number) {
  const radians = (tilt * Math.PI) / 180;
  const points: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  points[LM.NOSE] = { x: 0.5, y: 0.32, visibility: 1 };
  points[LM.LEFT_EYE] = { x: 0.5 + Math.cos(radians) * 0.06, y: 0.3 + Math.sin(radians) * 0.06, visibility: 1 };
  points[LM.RIGHT_EYE] = { x: 0.5 - Math.cos(radians) * 0.06, y: 0.3 - Math.sin(radians) * 0.06, visibility: 1 };
  points[LM.LEFT_SHOULDER] = { x: 0.65, y: 0.5, visibility: 1 };
  points[LM.RIGHT_SHOULDER] = { x: 0.35, y: 0.5, visibility: 1 };
  return computeMetrics(points, 0.55);
}

describe("face and shoulder line angles", () => {
  it("gives the same tilt regardless of landmark order", () => {
    const a = { x: 0.4, y: 0.3, visibility: 1 };
    const b = { x: 0.6, y: 0.32, visibility: 1 };
    expect(lineTiltDeg(a, b)).toBeCloseTo(lineTiltDeg(b, a));
  });

  it("keeps a frontal baseline near horizontal when raw angles straddle -180 and +180", () => {
    const frames = [-1, 1, -0.5, 0.5, -1, 1, -0.5, 0.5].map(frontalPose);
    const baseline = baselineFromFrames(frames)!;
    expect(baseline.headTiltDeg).toBeCloseTo(0);
    expect(baseline.shoulderTiltDeg).toBeCloseTo(0);
    expect(deltas(frontalPose(1), baseline).head).toBeCloseTo(1);
  });

  it("measures a small crossing of the angle boundary as a small change", () => {
    const before = frontalPose(-1);
    const after = frontalPose(1);
    expect(deltas(after, before).head).toBeCloseTo(2);
  });
});
