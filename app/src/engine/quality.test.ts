import { describe, expect, it } from "vitest";
import { simulatedPose } from "../demo/simulator";
import { CoachEngine } from "./coach";
import { LM } from "./metrics";
import { DEFAULT_SETTINGS } from "./types";

function sample(t: number, head = 0, valid = true) {
  const points = simulatedPose(0).points;
  const leftEye = points[LM.LEFT_EYE];
  points[LM.RIGHT_EYE] = { x: leftEye.x + Math.cos(head * Math.PI / 180) * 0.12, y: leftEye.y + Math.sin(head * Math.PI / 180) * 0.12, visibility: 1 };
  if (!valid) points[LM.NOSE].visibility = 0;
  return { t, points, poseCount: 1 };
}

function engine(calibrationMs = 1000) {
  const result = new CoachEngine({ ...DEFAULT_SETTINGS, calibrationMs, sustainMs: 1000, recoveryMs: 300 });
  result.startSession(0);
  result.beginCalibration(0);
  return result;
}

describe("stable calibration time", () => {
  it("keeps collecting when a short timer finishes before eight frames are available", () => {
    const coach = engine(1200);
    for (let t = 0; t <= 1200; t += 200) coach.feed(sample(t));
    expect(coach.state).toBe("calibrating");
    expect(coach.calibrationStableMs).toBe(1200);
    expect(coach.feed(sample(1400)).state).toBe("in_range");
    expect(coach.baseline).not.toBeNull();
  });

  it("does not register from a few good frames followed by a long unseen gap", () => {
    const coach = engine(7000);
    for (let t = 0; t <= 700; t += 100) coach.feed(sample(t));
    const snap = coach.feed(sample(7000));
    expect(snap.baseline).toBeNull();
    expect(snap.calibrationStableMs).toBe(700);
    expect(snap.state).toBe("calibrating");
  });

  it("preserves progress but excludes occlusion and the first frame after it", () => {
    const coach = engine();
    for (let t = 0; t <= 300; t += 100) coach.feed(sample(t));
    for (let t = 400; t <= 2000; t += 100) coach.feed(sample(t, 0, false));
    expect(coach.snapshot(2000).calibrationStableMs).toBe(300);
    expect(coach.feed(sample(2100)).calibrationStableMs).toBe(300);
    for (let t = 2200; t <= 2800; t += 100) coach.feed(sample(t));
    expect(coach.state).toBe("in_range");
    expect(coach.calibrationStableMs).toBe(1000);
  });

  it("changes the registration pose only after a sustained change, preserving progress for a brief spike", () => {
    const coach = engine();
    for (let t = 0; t <= 600; t += 100) coach.feed(sample(t));
    expect(coach.feed(sample(700, 15)).calibrationStableMs).toBeGreaterThanOrEqual(600);
    for (let t = 800; t <= 1600; t += 100) coach.feed(sample(t, 15));
    expect(coach.baseline).toBeNull();
    expect(coach.calibrationStableMs).toBeGreaterThanOrEqual(600);
    for (let t = 1700; t <= 2000; t += 100) coach.feed(sample(t, 15));
    expect(coach.baseline?.headTiltDeg).toBeCloseTo(15);
  });

  it("finishes registration despite regular single-frame landmark spikes", () => {
    const coach = engine(7000);
    let snap = coach.snapshot(0);
    let previousProgress = 0;
    for (let t = 0; t <= 9000 && !snap.baseline; t += 100) {
      const head = t > 0 && t % 700 === 0 ? 35 : Math.sin(t / 250) * 5;
      snap = coach.feed(sample(t, head));
      expect(snap.calibrationStableMs).toBeGreaterThanOrEqual(previousProgress);
      previousProgress = snap.calibrationStableMs;
    }
    expect(snap.baseline).not.toBeNull();
    expect(Math.abs(snap.baseline!.headTiltDeg)).toBeLessThan(4);
  });

  it("does not discard progress when an out-of-band movement is shorter than the confirmation time", () => {
    const coach = engine(3000);
    for (let t = 0; t <= 1000; t += 100) coach.feed(sample(t));
    for (let t = 1100; t <= 1500; t += 100) coach.feed(sample(t, 25));
    expect(coach.calibrationStableMs).toBeGreaterThanOrEqual(1000);
    for (let t = 1600; t <= 5000 && !coach.baseline; t += 100) coach.feed(sample(t));
    expect(coach.baseline?.headTiltDeg).toBeCloseTo(0);
  });

  it("accepts stable samples at a slower inference rate without treating them as a lost camera", () => {
    const coach = engine(7000);
    for (let t = 0; t <= 7800 && !coach.baseline; t += 600) coach.feed(sample(t), 400);
    expect(coach.baseline).not.toBeNull();
  });

  it("rejects slow drift as well as sudden movement", () => {
    const coach = engine();
    for (let t = 0; t <= 1600; t += 100) coach.feed(sample(t, t / 100));
    expect(coach.baseline).toBeNull();
    expect(coach.calibrationStableMs).toBeLessThan(1000);
  });

  it("excludes a pause during registration", () => {
    const coach = engine();
    for (let t = 0; t <= 300; t += 100) coach.feed(sample(t));
    coach.pause(350, "hidden");
    coach.resume(10000);
    const snap = coach.feed(sample(10000));
    expect(snap.calibrationStableMs).toBe(300);
    expect(snap.baseline).toBeNull();
    expect(snap.pausedMs).toBe(9650);
  });

  it("does not smooth an occluded face into a valid calibration frame", () => {
    const coach = engine();
    for (let t = 0; t <= 900; t += 100) coach.feed(sample(t));
    const invalid = coach.feed(sample(1000, 0, false));
    expect(invalid.metrics?.valid).toBe(false);
    expect(invalid.calibrationStableMs).toBe(900);
    expect(invalid.baseline).toBeNull();
  });
});

describe("pause accounting and return", () => {
  it.each(["hidden", "manual"] as const)("excludes %s time from the session", (reason) => {
    const coach = engine();
    coach.pause(1000, reason);
    expect(coach.snapshot(5500)).toMatchObject({ sessionMs: 1000, pausedMs: 4500, pauseReason: reason });
    coach.resume(6000);
    expect(coach.snapshot(6100)).toMatchObject({ sessionMs: 1100, pausedMs: 5000, pauseReason: null });
    coach.startSession(0);
    expect(coach.snapshot(100)).toMatchObject({ sessionMs: 100, pausedMs: 0, pauseReason: null });
  });

  it("retains a manual pause when the tab is then hidden", () => {
    const coach = engine();
    coach.pause(500, "manual");
    expect(coach.pause(800, "hidden").pauseReason).toBe("manual");
    expect(coach.snapshot(1000).pausedMs).toBe(500);
  });

  it("does not turn time away into a sustained posture alert", () => {
    const coach = engine();
    for (let t = 0; t <= 1000; t += 100) coach.feed(sample(t));
    for (let t = 1100; t <= 1500; t += 100) coach.feed(sample(t, 25));
    coach.pause(1600, "hidden");
    coach.resume(20000);
    const snap = coach.feed(sample(20000, 25));
    expect(snap.coachingCount).toBe(0);
    expect(snap.sessionMs).toBe(1600);
    expect(snap.state).toBe("change_detected");
  });

  it("does not bridge an inference stall into the sustain timer", () => {
    const coach = engine();
    for (let t = 0; t <= 1000; t += 100) coach.feed(sample(t));
    for (let t = 1100; t <= 1500; t += 100) coach.feed(sample(t, 25));
    expect(coach.feed(sample(20000, 25)).coachingCount).toBe(0);
  });

  it("continues to coach a real sustained change after smoothing", () => {
    const coach = engine();
    for (let t = 0; t <= 1000; t += 100) coach.feed(sample(t));
    for (let t = 1100; t <= 2700; t += 100) coach.feed(sample(t, 25));
    expect(coach.coachingCount).toBe(1);
  });

  it("ignores a single-frame landmark spike", () => {
    const coach = engine();
    for (let t = 0; t <= 1000; t += 100) coach.feed(sample(t));
    expect(coach.feed(sample(1100, 40)).state).toBe("in_range");
    expect(coach.feed(sample(1200)).state).toBe("in_range");
    expect(coach.coachingCount).toBe(0);
  });
});
