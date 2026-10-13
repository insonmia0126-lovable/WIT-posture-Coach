import { baselineFromFrames, computeMetrics, deltas } from "./metrics";
import {
  DEFAULT_SETTINGS,
  type AppState,
  type Baseline,
  type ChangeKind,
  type CoachSettings,
  type CoachSnapshot,
  type Metrics,
  type PoseSample,
} from "./types";

function abs(n: number) {
  return Math.abs(n);
}

export class CoachEngine {
  settings: CoachSettings;
  state: AppState = "ready";
  baseline: Baseline | null = null;
  lastMetrics: Metrics | null = null;
  lastDeltas: CoachSnapshot["deltas"] = null;
  message = "웹캠을 시작한 뒤 기준 자세를 등록하세요.";
  changeKind: ChangeKind | null = null;
  coachingCount = 0;
  recoveryCount = 0;
  recoveryTimes: number[] = [];
  pendingCoachT: number | null = null;
  lastCoachT = -1e12;
  sustainStart: number | null = null;
  recoveryStart: number | null = null;
  calibStart: number | null = null;
  calibFrames: Metrics[] = [];
  lastT = 0;
  sessionStart = 0;
  validMs = 0;
  unavailableMs = 0;
  inRangeMs = 0;
  lastInferMs = 0;
  events: { t: number; state: AppState }[] = [];
  pausedAt: number | null = null;
  prePause: AppState = "ready";
  demo = false;

  constructor(settings: CoachSettings = DEFAULT_SETTINGS) {
    this.settings = { ...settings };
  }

  startSession(t: number, demo = false) {
    this.demo = demo;
    this.sessionStart = t;
    this.lastT = t;
    this.state = "ready";
    this.baseline = null;
    this.coachingCount = 0;
    this.recoveryCount = 0;
    this.recoveryTimes = [];
    this.pendingCoachT = null;
    this.lastCoachT = -1e12;
    this.sustainStart = null;
    this.recoveryStart = null;
    this.calibStart = null;
    this.calibFrames = [];
    this.validMs = 0;
    this.unavailableMs = 0;
    this.inRangeMs = 0;
    this.events = [{ t, state: "ready" }];
    this.message = demo
      ? "시뮬레이션 데이터로 시연합니다."
      : "얼굴과 양쪽 어깨가 보이도록 앉은 뒤 기준 자세를 등록하세요.";
    return this.snapshot(t);
  }

  beginCalibration(t: number) {
    if (this.state === "paused") return this.snapshot(t);
    this.state = "calibrating";
    this.calibStart = t;
    this.calibFrames = [];
    this.baseline = null;
    this.sustainStart = null;
    this.recoveryStart = null;
    this.pendingCoachT = null;
    this.message = "기준 자세를 기록하는 중입니다. 정면을 편하게 바라봐 주세요.";
    this.pushEvent(t);
    return this.snapshot(t);
  }

  pause(t: number) {
    if (this.state === "paused") return this.snapshot(t);
    this.prePause = this.state;
    this.state = "paused";
    this.pausedAt = t;
    this.sustainStart = null;
    this.recoveryStart = null;
    this.message = "일시정지되었습니다. 중지된 시간은 지속 시간에 넣지 않습니다.";
    this.pushEvent(t);
    return this.snapshot(t);
  }

  resume(t: number) {
    if (this.state !== "paused") return this.snapshot(t);
    this.state = this.prePause === "paused" ? "ready" : this.prePause;
    if (this.state === "change_detected" || this.state === "coaching") {
      this.state = this.baseline ? "in_range" : "ready";
    }
    this.pausedAt = null;
    this.sustainStart = null;
    this.recoveryStart = null;
    this.message = "측정을 다시 시작합니다.";
    this.pushEvent(t);
    return this.snapshot(t);
  }

  feed(sample: PoseSample, inferMs = 0): CoachSnapshot {
    const t = sample.t;
    const dt = Math.max(0, Math.min(250, t - this.lastT));
    this.lastT = t;
    this.lastInferMs = inferMs;

    if (this.state === "paused" || this.state === "ready") {
      return this.snapshot(t);
    }

    if (sample.poseCount > 1) {
      return this.markUnavailable(t, dt, "여러 사람이 보입니다. 한 명만 들어오도록 해 주세요.");
    }

    const m = computeMetrics(sample.points, this.settings.minVisibility);
    this.lastMetrics = m;
    if (!m.valid) {
      return this.markUnavailable(t, dt, m.reason || "측정 불가");
    }

    this.validMs += dt;

    if (this.state === "calibrating") {
      this.calibFrames.push(m);
      const elapsed = t - (this.calibStart ?? t);
      if (elapsed >= this.settings.calibrationMs) {
        const base = baselineFromFrames(this.calibFrames);
        if (!base) {
          this.message = "유효한 자세가 부족합니다. 얼굴과 어깨가 보이게 다시 등록하세요.";
          this.state = "ready";
          this.pushEvent(t);
          return this.snapshot(t);
        }
        this.baseline = base;
        this.state = "in_range";
        this.message =
          "기준 자세가 등록되었습니다. 의료적 정상 자세가 아니라 비교 기준입니다.";
        this.pushEvent(t);
      } else {
        this.message = `기준 기록 중 (${((this.settings.calibrationMs - elapsed) / 1000).toFixed(1)}초)`;
      }
      return this.snapshot(t);
    }

    if (!this.baseline) {
      this.state = "ready";
      return this.snapshot(t);
    }

    const d = deltas(m, this.baseline);
    this.lastDeltas = d;
    const out = this.isOut(d, "enter");
    const stillOut = this.isOut(d, "exit");

    if (this.state === "unavailable") {
      this.state = stillOut ? "change_detected" : "in_range";
      this.sustainStart = stillOut ? t : null;
      this.message = stillOut ? "자세 변화를 확인하고 있습니다." : "기준 범위입니다.";
      this.pushEvent(t);
      return this.snapshot(t);
    }

    if (this.state === "in_range") {
      this.inRangeMs += dt;
      if (out) {
        const kind = this.primaryKind(d);
        this.changeKind = kind;
        this.state = "change_detected";
        this.sustainStart = t;
        this.message = "자세 변화를 감지했습니다. 순간 움직임은 안내하지 않습니다.";
        this.pushEvent(t);
      }
      return this.snapshot(t);
    }

    if (this.state === "change_detected") {
      if (!stillOut) {
        this.state = "in_range";
        this.sustainStart = null;
        this.message = "기준 범위입니다.";
        this.pushEvent(t);
        this.inRangeMs += dt;
        return this.snapshot(t);
      }
      this.changeKind = this.primaryKind(d);
      const held = t - (this.sustainStart ?? t);
      if (held >= this.settings.sustainMs && t - this.lastCoachT >= this.settings.repeatAlertMs) {
        this.fireCoach(t);
      } else {
        this.message = `자세 변화 지속 ${(held / 1000).toFixed(1)}초`;
      }
      return this.snapshot(t);
    }

    if (this.state === "coaching") {
      if (!this.isOut(d, "exit")) {
        if (this.recoveryStart == null) this.recoveryStart = t;
        if (t - this.recoveryStart >= this.settings.recoveryMs) {
          this.confirmRecovery(t);
        } else {
          this.message = "기준 자세에 가까워지고 있습니다.";
        }
      } else {
        this.recoveryStart = null;
        this.changeKind = this.primaryKind(d);
        if (t - this.lastCoachT >= this.settings.repeatAlertMs) {
          this.fireCoach(t);
        } else {
          this.message = this.coachCopy(this.changeKind);
        }
      }
      return this.snapshot(t);
    }

    return this.snapshot(t);
  }

  snapshot(t: number): CoachSnapshot {
    const mean =
      this.recoveryTimes.length === 0
        ? null
        : this.recoveryTimes.reduce((a, b) => a + b, 0) / this.recoveryTimes.length;
    return {
      t,
      state: this.state,
      metrics: this.lastMetrics,
      baseline: this.baseline,
      deltas: this.lastDeltas,
      coachingCount: this.coachingCount,
      recoveryCount: this.recoveryCount,
      meanRecoveryMs: mean,
      message: this.message,
      changeKind: this.changeKind,
      validMs: this.validMs,
      unavailableMs: this.unavailableMs,
      inRangeMs: this.inRangeMs,
      sessionMs: Math.max(0, t - this.sessionStart),
      inferMs: this.lastInferMs,
    };
  }

  private isOut(d: { head: number; shoulder: number; torso: number }, band: "enter" | "exit") {
    const s = this.settings;
    const h = band === "enter" ? s.headEnterDeg : s.headExitDeg;
    const sh = band === "enter" ? s.shoulderEnterDeg : s.shoulderExitDeg;
    const to = band === "enter" ? s.torsoEnter : s.torsoExit;
    return abs(d.head) >= h || abs(d.shoulder) >= sh || d.torso >= to;
  }

  private primaryKind(d: { head: number; shoulder: number; torso: number }): ChangeKind {
    const nh = abs(d.head) / this.settings.headEnterDeg;
    const ns = abs(d.shoulder) / this.settings.shoulderEnterDeg;
    const nt = d.torso / this.settings.torsoEnter;
    if (nh >= ns && nh >= nt) return "head";
    if (ns >= nt) return "shoulder";
    return "torso";
  }

  private fireCoach(t: number) {
    this.state = "coaching";
    this.coachingCount += 1;
    this.lastCoachT = t;
    if (this.pendingCoachT == null) this.pendingCoachT = t;
    this.recoveryStart = null;
    this.message = this.coachCopy(this.changeKind);
    this.pushEvent(t);
  }

  private coachCopy(kind: ChangeKind | null) {
    if (kind === "shoulder") return "어깨 높이가 기준과 달라졌습니다. 앉은 자세를 확인해 주세요.";
    if (kind === "torso") return "상체 위치가 기준과 달라졌습니다. 자세를 다시 확인해 주세요.";
    return "고개가 기준보다 기울었습니다. 정면을 바라봐 주세요.";
  }

  private confirmRecovery(t: number) {
    if (this.pendingCoachT != null) {
      this.recoveryTimes.push(t - this.pendingCoachT);
      this.recoveryCount += 1;
    }
    this.pendingCoachT = null;
    this.recoveryStart = null;
    this.sustainStart = null;
    this.state = "in_range";
    this.message = "기준 자세에 가까워졌습니다.";
    this.pushEvent(t);
  }

  private markUnavailable(t: number, dt: number, reason: string) {
    this.unavailableMs += dt;
    this.lastMetrics = this.lastMetrics
      ? { ...this.lastMetrics, valid: false, reason }
      : computeMetrics([], this.settings.minVisibility);
    if (this.state !== "unavailable" && this.state !== "calibrating") {
      this.pendingCoachT = null;
      this.sustainStart = null;
      this.recoveryStart = null;
      this.state = "unavailable";
      this.message = `측정 불가 — ${reason}`;
      this.pushEvent(t);
    } else if (this.state === "calibrating") {
      this.message = `등록 보류 — ${reason}`;
    } else {
      this.message = `측정 불가 — ${reason}`;
    }
    return this.snapshot(t);
  }

  private pushEvent(t: number) {
    const last = this.events[this.events.length - 1];
    if (!last || last.state !== this.state) this.events.push({ t, state: this.state });
  }
}
