import { describe, expect, it } from "vitest";
import { CoachEngine } from "./coach";
import { DEFAULT_SETTINGS, type CoachSettings, type Point } from "./types";

const S: CoachSettings = {
  ...DEFAULT_SETTINGS,
  calibrationMs: 5000,
  sustainMs: 10000,
  recoveryMs: 3000,
  repeatAlertMs: 30000,
};
import { LM } from "./metrics";

function pose(t: number, opts?: { headDeg?: number; vis?: number; extra?: boolean }): {
  t: number;
  points: Point[];
  poseCount: number;
} {
  const head = ((opts?.headDeg ?? 0) * Math.PI) / 180;
  const vis = opts?.vis ?? 1;
  const pts: Point[] = Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5, visibility: vis }));
  pts[LM.NOSE] = { x: 0.5, y: 0.32, visibility: vis };
  pts[LM.LEFT_EYE] = { x: 0.44, y: 0.3, visibility: vis };
  pts[LM.RIGHT_EYE] = {
    x: 0.44 + Math.cos(head) * 0.12,
    y: 0.3 + Math.sin(head) * 0.12,
    visibility: vis,
  };
  pts[LM.LEFT_SHOULDER] = { x: 0.35, y: 0.5, visibility: vis };
  pts[LM.RIGHT_SHOULDER] = { x: 0.65, y: 0.5, visibility: vis };
  return { t, points: pts, poseCount: opts?.extra ? 2 : 1 };
}

function hold(eng: CoachEngine, t0: number, ms: number, sample: (t: number) => ReturnType<typeof pose>, step = 100) {
  let t = t0;
  let snap = eng.snapshot(t);
  const end = t0 + ms;
  while (t <= end) {
    snap = eng.feed(sample(t));
    t += step;
  }
  return { snap, t: t - step };
}

describe("CoachEngine", () => {
  it("registers a baseline after 5s of valid frames", () => {
    const eng = new CoachEngine(S);
    eng.startSession(0);
    eng.beginCalibration(0);
    const { snap } = hold(eng, 0, 5000, (t) => pose(t));
    expect(snap.state).toBe("in_range");
    expect(snap.baseline).not.toBeNull();
  });

  it("does not coach a 1s head dip", () => {
    const eng = new CoachEngine(S);
    eng.startSession(0);
    eng.beginCalibration(0);
    let { t } = hold(eng, 0, 5000, (x) => pose(x));
    t += 100;
    const brief = hold(eng, t, 1000, (x) => pose(x, { headDeg: 20 }));
    expect(eng.coachingCount).toBe(0);
    expect(brief.snap.state).not.toBe("coaching");
  });

  it("coaches after sustained change of 10s", () => {
    const eng = new CoachEngine(S);
    eng.startSession(0);
    eng.beginCalibration(0);
    let { t } = hold(eng, 0, 5000, (x) => pose(x));
    const long = hold(eng, t + 100, 10500, (x) => pose(x, { headDeg: 20 }));
    expect(long.snap.state).toBe("coaching");
    expect(eng.coachingCount).toBe(1);
  });

  it("confirms recovery after 3s in range", () => {
    const eng = new CoachEngine(S);
    eng.startSession(0);
    eng.beginCalibration(0);
    let { t } = hold(eng, 0, 5000, (x) => pose(x));
    ({ t } = hold(eng, t + 100, 10500, (x) => pose(x, { headDeg: 20 })));
    expect(eng.coachingCount).toBe(1);
    const rec = hold(eng, t + 100, 3500, (x) => pose(x, { headDeg: 0 }));
    expect(rec.snap.state).toBe("in_range");
    expect(eng.recoveryCount).toBe(1);
    expect(rec.snap.meanRecoveryMs).not.toBeNull();
  });

  it("treats occlusion as unavailable, not in-range", () => {
    const eng = new CoachEngine(S);
    eng.startSession(0);
    eng.beginCalibration(0);
    let { t } = hold(eng, 0, 5000, (x) => pose(x));
    const occ = hold(eng, t + 100, 400, (x) => pose(x, { vis: 0.1 }));
    expect(occ.snap.state).toBe("unavailable");
    expect(occ.snap.inRangeMs).toBeLessThan(occ.snap.validMs + 1);
  });

  it("pause does not accumulate sustain time", () => {
    const eng = new CoachEngine(S);
    eng.startSession(0);
    eng.beginCalibration(0);
    let { t } = hold(eng, 0, 5000, (x) => pose(x));
    ({ t } = hold(eng, t + 100, 4000, (x) => pose(x, { headDeg: 20 })));
    eng.pause(t + 50);
    hold(eng, t + 100, 8000, (x) => pose(x, { headDeg: 20 }));
    expect(eng.coachingCount).toBe(0);
    expect(eng.state).toBe("paused");
  });
});
