import { describe, expect, it } from "vitest";
import { simulatedPose } from "../demo/simulator";
import { computeMetrics } from "./metrics";
import { MetricSmoother } from "./smoothing";

const normal = computeMetrics(simulatedPose(0).points, 0.55);

describe("metric smoothing", () => {
  it("rejects an isolated angle and position spike", () => {
    const smoother = new MetricSmoother();
    smoother.filter(normal, 0, 120);
    const spike = smoother.filter({ ...normal, headTiltDeg: 40, torsoDx: 1 }, 80, 120);
    expect(spike.headTiltDeg).toBeCloseTo(normal.headTiltDeg);
    expect(spike.torsoDx).toBeCloseTo(normal.torsoDx);
    expect(smoother.filter(normal, 160, 120).headTiltDeg).toBeCloseTo(normal.headTiltDeg);
  });

  it("follows a sustained change instead of suppressing it", () => {
    const smoother = new MetricSmoother();
    smoother.filter(normal, 0, 120);
    let result = normal;
    for (let t = 80; t <= 800; t += 80) result = smoother.filter({ ...normal, headTiltDeg: 20 }, t, 120);
    expect(result.headTiltDeg).toBeGreaterThan(19);
  });

  it("does not average line angles across the wrong side of the boundary", () => {
    const smoother = new MetricSmoother();
    smoother.filter({ ...normal, headTiltDeg: 89 }, 0, 120);
    smoother.filter({ ...normal, headTiltDeg: -89 }, 100, 120);
    expect(Math.abs(smoother.filter({ ...normal, headTiltDeg: -89 }, 200, 120).headTiltDeg)).toBeGreaterThan(85);
  });

  it("does not preserve old data through occlusion or a long gap", () => {
    const smoother = new MetricSmoother();
    smoother.filter(normal, 0, 120);
    expect(smoother.filter({ ...normal, valid: false }, 100, 120).valid).toBe(false);
    expect(smoother.filter({ ...normal, headTiltDeg: 20 }, 200, 120).headTiltDeg).toBe(20);
    expect(smoother.filter(normal, 4000, 120).headTiltDeg).toBe(normal.headTiltDeg);
  });

  it("clears history on a camera-position change and supports switching off", () => {
    const smoother = new MetricSmoother();
    smoother.filter(normal, 0, 120);
    expect(smoother.filter({ ...normal, cameraPosition: "left", headTiltDeg: 30 }, 100, 120).headTiltDeg).toBe(30);
    expect(smoother.filter({ ...normal, headTiltDeg: 40 }, 200, 0).headTiltDeg).toBe(40);
  });
});
