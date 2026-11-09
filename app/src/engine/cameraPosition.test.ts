import { describe, expect, it } from "vitest";
import { CoachEngine } from "./coach";
import { baselineFromFrames, cameraFaceLandmarks, computeMetrics, deltas, LM } from "./metrics";
import { DEFAULT_SETTINGS, type CameraPosition, type Point } from "./types";

function points(): Point[] {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  pose[LM.NOSE] = { x: 0.5, y: 0.3, visibility: 1 };
  pose[LM.LEFT_EYE] = { x: 0.55, y: 0.28, visibility: 1 };
  pose[LM.RIGHT_EYE] = { x: 0.45, y: 0.28, visibility: 1 };
  pose[LM.LEFT_EAR] = { x: 0.63, y: 0.3, visibility: 1 };
  pose[LM.RIGHT_EAR] = { x: 0.37, y: 0.3, visibility: 1 };
  pose[LM.LEFT_SHOULDER] = { x: 0.65, y: 0.55, visibility: 1 };
  pose[LM.RIGHT_SHOULDER] = { x: 0.35, y: 0.55, visibility: 1 };
  return pose;
}

function frame(position: CameraPosition, pose = points()) {
  return computeMetrics(pose, 0.55, position);
}

function baseline(position: CameraPosition) {
  return baselineFromFrames(Array.from({ length: 8 }, () => frame(position)))!;
}

function moved(position: "left" | "right", offset: number) {
  const pose = points();
  const side = cameraFaceLandmarks(position);
  pose[side.eye].x += offset;
  pose[side.ear].x += offset;
  return pose;
}

describe.each(["left", "right"] as const)("%s oblique camera", (position) => {
  it("can use the visible eye and ear when the far side of the face is occluded", () => {
    const pose = points();
    const farSide = cameraFaceLandmarks(position === "left" ? "right" : "left");
    pose[farSide.eye].visibility = 0.1;
    pose[farSide.ear].visibility = 0.1;
    expect(frame(position, pose).valid).toBe(true);
    expect(frame("front", pose).valid).toBe(false);
  });

  it("rejects the view if the selected side's ear is hidden", () => {
    const pose = points();
    pose[cameraFaceLandmarks(position).ear].visibility = 0.1;
    expect(frame(position, pose).valid).toBe(false);
    expect(frame(position, pose).reason).toContain("눈·귀");
  });

  it("does not accept a full side view with a missing shoulder", () => {
    const pose = points();
    pose[LM.RIGHT_SHOULDER].visibility = 0.1;
    expect(frame(position, pose).valid).toBe(false);
  });

  it("does not amplify movement just because the far shoulder projects closer", () => {
    const pose = points();
    const farShoulder = position === "left" ? LM.RIGHT_SHOULDER : LM.LEFT_SHOULDER;
    pose[farShoulder].x = position === "left" ? 0.58 : 0.42;
    const result = deltas(frame(position, pose), baseline(position));
    expect(result.torso).toBeCloseTo(0);
    expect(result.head).toBeCloseTo(0);
  });

  it("measures head movement against the registered ear-to-shoulder scale", () => {
    const base = baseline(position);
    expect(deltas(frame(position, moved(position, 0.08)), base).torso).toBeCloseTo(0.08 / base.torsoScale);
  });

  it("uses the selected side's head angle", () => {
    const pose = points();
    const side = cameraFaceLandmarks(position);
    const ear = pose[side.ear];
    const eye = pose[side.eye];
    const radians = 20 * Math.PI / 180;
    const dx = eye.x - ear.x;
    const dy = eye.y - ear.y;
    eye.x = ear.x + dx * Math.cos(radians) - dy * Math.sin(radians);
    eye.y = ear.y + dx * Math.sin(radians) + dy * Math.cos(radians);
    expect(deltas(frame(position, pose), baseline(position)).head).toBeCloseTo(20);
  });

  it("calibrates, coaches sustained movement and confirms recovery", () => {
    const engine = new CoachEngine({ ...DEFAULT_SETTINGS, cameraPosition: position, calibrationMs: 800, sustainMs: 500, recoveryMs: 300 });
    engine.startSession(0);
    engine.beginCalibration(0);
    for (let t = 0; t <= 800; t += 100) engine.feed({ t, points: points(), poseCount: 1 });
    expect(engine.baseline?.cameraPosition).toBe(position);
    expect(engine.state).toBe("in_range");
    for (let t = 900; t <= 1800; t += 100) engine.feed({ t, points: moved(position, 0.08), poseCount: 1 });
    expect(engine.state).toBe("coaching");
    expect(engine.changeKind).toBe("torso");
    for (let t = 1900; t <= 2800; t += 100) engine.feed({ t, points: moved(position, 0.02), poseCount: 1 });
    expect(engine.state).toBe("in_range");
    expect(engine.recoveryCount).toBe(1);
  });
});

describe("camera position changes", () => {
  it("shows framing quality before registration", () => {
    const engine = new CoachEngine();
    engine.startSession(0);
    expect(engine.feed({ t: 0, points: points(), poseCount: 1 }).metrics?.valid).toBe(true);
    expect(engine.feed({ t: 100, points: [], poseCount: 0 }).metrics?.valid).toBe(false);
    expect(engine.baseline).toBeNull();
  });

  it("clears the previous baseline and cancels an in-progress registration", () => {
    const engine = new CoachEngine({ ...DEFAULT_SETTINGS, calibrationMs: 800 });
    engine.startSession(0);
    engine.beginCalibration(0);
    for (let t = 0; t <= 800; t += 100) engine.feed({ t, points: points(), poseCount: 1 });
    expect(engine.baseline).not.toBeNull();
    expect(engine.setCameraPosition("left", 900).baseline).toBeNull();
    expect(engine.state).toBe("ready");
    expect(engine.lastDeltas).toBeNull();
    engine.beginCalibration(1000);
    for (let t = 1000; t <= 1400; t += 100) engine.feed({ t, points: points(), poseCount: 1 });
    engine.setCameraPosition("right", 1500);
    expect(engine.calibFrames).toEqual([]);
    expect(engine.feed({ t: 2000, points: points(), poseCount: 1 }).baseline).toBeNull();
    expect(engine.state).toBe("ready");
  });

  it("rejects mixed-view calibration frames and comparisons", () => {
    expect(baselineFromFrames([frame("front"), ...Array.from({ length: 8 }, () => frame("left"))])).toBeNull();
    expect(() => deltas(frame("right"), baseline("left"))).toThrow("기준을 다시 등록");
  });

  it("fails closed even if settings are changed outside the position setter", () => {
    const engine = new CoachEngine();
    engine.baseline = baseline("front");
    engine.state = "in_range";
    engine.settings.cameraPosition = "right";
    const snap = engine.feed({ t: 100, points: points(), poseCount: 1 });
    expect(snap.state).toBe("ready");
    expect(snap.baseline).toBeNull();
  });
});
