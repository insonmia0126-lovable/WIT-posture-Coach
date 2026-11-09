import { baselineFromFrames, computeMetrics, deltas } from "./metrics";
import { cameraPositionGuide, cameraPositionLabel } from "./cameraPosition";
import { MetricSmoother } from "./smoothing";
import {
  DEFAULT_SETTINGS,
  type AppState,
  type Baseline,
  type CameraPosition,
  type ChangeKind,
  type CoachSettings,
  type CoachSnapshot,
  type Metrics,
  type PoseSample,
  type PauseReason,
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
  calibrationStableMs = 0;
  private calibrationAnchor: Metrics | null = null;
  private calibrationSmoother = new MetricSmoother();
  private calibrationChange: { anchor: Metrics; lastT: number; stableMs: number; frames: Metrics[] } | null = null;
  private lastCalibrationT: number | null = null;
  private smoother = new MetricSmoother();
  private totalPausedMs = 0;
  pauseReason: PauseReason | null = null;
  lastT = 0;
  sessionStart = 0;
  validMs = 0;
  unavailableMs = 0;
  inRangeMs = 0;
  lastInferMs = 0;
  events: { t: number; state: AppState; kind?: ChangeKind }[] = [];
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
    this.lastMetrics = null;
    this.lastDeltas = null;
    this.changeKind = null;
    this.lastInferMs = 0;
    this.pausedAt = null;
    this.prePause = "ready";
    this.pauseReason = null;
    this.totalPausedMs = 0;
    this.resetCalibration();
    this.smoother.reset();
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
      : cameraPositionGuide(this.settings.cameraPosition);
    return this.snapshot(t);
  }

  beginCalibration(t: number) {
    if (this.state === "paused") return this.snapshot(t);
    this.state = "calibrating";
    this.calibStart = t;
    this.resetCalibration();
    this.smoother.reset();
    this.baseline = null;
    this.lastDeltas = null;
    this.changeKind = null;
    this.sustainStart = null;
    this.recoveryStart = null;
    this.pendingCoachT = null;
    this.message = `${cameraPositionLabel(this.settings.cameraPosition)} 기준을 기록하는 중입니다. 평소 업무 화면을 편하게 바라봐 주세요.`;
    this.pushEvent(t);
    return this.snapshot(t);
  }

  setCameraPosition(position: CameraPosition, t: number) {
    if (position === this.settings.cameraPosition && (!this.baseline || this.baseline.cameraPosition === position)) {
      return this.snapshot(t);
    }
    this.settings = { ...this.settings, cameraPosition: position };
    this.state = "ready";
    this.baseline = null;
    this.lastMetrics = null;
    this.lastDeltas = null;
    this.changeKind = null;
    this.resetCalibration();
    this.smoother.reset();
    this.calibStart = null;
    this.sustainStart = null;
    this.recoveryStart = null;
    this.pendingCoachT = null;
    if (this.pausedAt != null) this.totalPausedMs += Math.max(0, t - this.pausedAt);
    this.pausedAt = null;
    this.pauseReason = null;
    this.prePause = "ready";
    this.message = "카메라 위치가 변경되었습니다. 새 위치에서 기준을 다시 등록하세요.";
    this.pushEvent(t);
    return this.snapshot(t);
  }

  pause(t: number, reason: PauseReason = "manual") {
    if (this.state === "paused") return this.snapshot(t);
    this.prePause = this.state;
    this.state = "paused";
    this.pausedAt = t;
    this.pauseReason = reason;
    this.sustainStart = null;
    this.recoveryStart = null;
    this.pendingCoachT = null;
    this.lastCalibrationT = null;
    this.calibrationChange = null;
    this.calibrationSmoother.reset();
    this.smoother.reset();
    this.message = reason === "hidden"
      ? "다른 탭이나 최소화 상태여서 측정을 쉬고 있습니다. 이 시간은 측정·기준 등록·알림 시간에서 제외됩니다."
      : "일시정지되었습니다. 측정 재개를 누르면 이어서 측정합니다. 중지된 시간은 기록에서 제외됩니다.";
    this.pushEvent(t);
    return this.snapshot(t);
  }

  resume(t: number) {
    if (this.state !== "paused") return this.snapshot(t);
    this.state = this.prePause === "paused" ? "ready" : this.prePause;
    if (this.state === "change_detected" || this.state === "coaching") {
      this.state = this.baseline ? "in_range" : "ready";
    }
    if (this.pausedAt != null) this.totalPausedMs += Math.max(0, t - this.pausedAt);
    this.pausedAt = null;
    this.pauseReason = null;
    this.lastT = t;
    this.lastCalibrationT = null;
    this.smoother.reset();
    this.sustainStart = null;
    this.recoveryStart = null;
    this.message = "측정을 다시 시작합니다.";
    this.pushEvent(t);
    return this.snapshot(t);
  }

  feed(sample: PoseSample, inferMs = 0): CoachSnapshot {
    const t = sample.t;
    const gap = t - this.lastT;
    const maxGap = Math.max(500, this.settings.inferEveryMs * 3, inferMs * 2);
    const continuous = gap >= 0 && gap <= maxGap;
    const dt = continuous ? gap : 0;
    this.lastT = t;
    this.lastInferMs = inferMs;

    if (this.baseline && this.baseline.cameraPosition !== this.settings.cameraPosition) {
      return this.setCameraPosition(this.settings.cameraPosition, t);
    }
    if (this.state === "paused") {
      return this.snapshot(t);
    }
    if (!continuous) {
      this.lastCalibrationT = null;
      this.calibrationChange = null;
      this.calibrationSmoother.reset();
      this.smoother.reset();
      this.sustainStart = this.state === "change_detected" ? t : null;
      this.recoveryStart = null;
    }

    if (sample.poseCount > 1) {
      return this.markUnavailable(t, dt, "여러 사람이 보입니다. 한 명만 들어오도록 해 주세요.");
    }

    let m = computeMetrics(sample.points, this.settings.minVisibility, this.settings.cameraPosition);
    this.lastMetrics = m;
    if (this.state === "ready") {
      this.message = m.valid
        ? `${cameraPositionLabel(this.settings.cameraPosition)} 구도가 인식되었습니다. 평소 업무 화면을 보며 기준을 등록하세요.`
        : `등록 대기 — ${m.reason}`;
      return this.snapshot(t);
    }
    if (!m.valid) {
      return this.markUnavailable(t, dt, m.reason || "측정 불가");
    }

    this.validMs += dt;

    if (this.state === "calibrating") {
      const raw = m;
      // Calibration also needs spike rejection; raw visibility was checked above.
      m = this.calibrationSmoother.filter(m, t, 120);
      if (this.calibrationAnchor && !this.isCalibrationStable(m, this.calibrationAnchor)) {
        this.lastCalibrationT = null;
        let change = this.calibrationChange;
        if (!change || !this.isCalibrationStable(m, change.anchor)) {
          change = { anchor: m, lastT: t, stableMs: 0, frames: [raw] };
        } else {
          change.stableMs += Math.max(0, t - change.lastT);
          change.lastT = t;
          change.frames.push(raw);
        }
        this.calibrationChange = change;
        const newBase = change.stableMs >= 800 ? baselineFromFrames(change.frames) : null;
        if (newBase) {
          // A genuinely different pose must persist, rather than one noisy frame
          // repeatedly erasing all of the user's accepted registration time.
          this.resetCalibration();
          this.calibrationAnchor = { ...raw, ...newBase };
          this.calibFrames = change.frames;
          this.calibrationStableMs = change.stableMs;
          this.lastCalibrationT = t;
          this.message = "자세 변화가 계속되어 새 자세로 기준을 모으고 있습니다. 평소 업무 화면을 보며 편하게 유지해 주세요.";
        } else {
          this.message = `움직임을 확인하는 중입니다. 등록 진행 ${(this.calibrationStableMs / 1000).toFixed(1)}초는 유지됩니다.`;
        }
        return this.snapshot(t);
      }
      this.calibrationChange = null;
      this.calibrationAnchor ??= m;
      if (this.lastCalibrationT != null) this.calibrationStableMs += Math.max(0, t - this.lastCalibrationT);
      this.lastCalibrationT = t;
      this.calibFrames.push(raw);
      if (this.calibrationStableMs >= this.settings.calibrationMs) {
        const base = baselineFromFrames(this.calibFrames);
        if (!base) {
          this.message = "등록 시간은 채웠습니다. 기준 계산에 필요한 인식 결과를 조금 더 모으고 있습니다.";
          return this.snapshot(t);
        }
        this.baseline = base;
        this.smoother.filter({ ...m, ...base }, t, this.settings.smoothingMs);
        this.state = "in_range";
        this.message =
          "기준 자세가 등록되었습니다. 의료적 정상 자세가 아니라 비교 기준입니다.";
        this.pushEvent(t);
      } else {
        this.message = `안정적으로 인식된 시간 ${(this.calibrationStableMs / 1000).toFixed(1)} / ${(this.settings.calibrationMs / 1000).toFixed(1)}초`;
      }
      return this.snapshot(t);
    }

    if (!this.baseline) {
      this.state = "ready";
      this.message = "구도가 인식되었습니다. 현재 카메라 위치에서 기준을 등록하세요.";
      return this.snapshot(t);
    }

    m = this.smoother.filter(m, t, this.settings.smoothingMs);
    this.lastMetrics = m;
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
    const pausedMs = this.totalPausedMs + (this.pausedAt == null ? 0 : Math.max(0, t - this.pausedAt));
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
      sessionMs: Math.max(0, t - this.sessionStart - pausedMs),
      pausedMs,
      pauseReason: this.pauseReason,
      calibrationStableMs: this.calibrationStableMs,
      calibrationTargetMs: this.settings.calibrationMs,
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
    if (kind === "torso") return this.settings.cameraPosition === "front"
      ? "상체 위치가 기준과 달라졌습니다. 자세를 다시 확인해 주세요."
      : "카메라 쪽 귀와 어깨의 상대 위치가 기준과 달라졌습니다. 업무 화면을 보며 자세를 확인해 주세요.";
    return "고개 기울기가 등록한 기준과 달라졌습니다. 평소 업무 화면을 보며 자세를 확인해 주세요.";
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
    this.lastCalibrationT = null;
    this.calibrationChange = null;
    this.calibrationSmoother.reset();
    this.smoother.reset();
    this.unavailableMs += dt;
    this.lastMetrics = {
      ...(this.lastMetrics ?? computeMetrics([], this.settings.minVisibility, this.settings.cameraPosition)),
      valid: false,
      reason,
    };
    this.lastDeltas = null;
    if (this.state !== "unavailable" && this.state !== "calibrating") {
      this.pendingCoachT = null;
      this.sustainStart = null;
      this.recoveryStart = null;
      this.state = "unavailable";
      this.message = `측정 불가 — ${reason}`;
      this.pushEvent(t);
    } else if (this.state === "calibrating") {
      this.message = `등록 보류 (${(this.calibrationStableMs / 1000).toFixed(1)}초 누적) — ${reason}`;
    } else {
      this.message = `측정 불가 — ${reason}`;
    }
    return this.snapshot(t);
  }

  private resetCalibration() {
    this.calibFrames = [];
    this.calibrationStableMs = 0;
    this.calibrationAnchor = null;
    this.lastCalibrationT = null;
    this.calibrationChange = null;
    this.calibrationSmoother.reset();
  }

  private isCalibrationStable(metrics: Metrics, anchor: Metrics): boolean {
    const d = deltas(metrics, anchor);
    return Math.abs(d.head) <= Math.max(4, Math.min(8, this.settings.headEnterDeg * 0.75))
      && Math.abs(d.shoulder) <= Math.max(4, Math.min(8, this.settings.shoulderEnterDeg * 0.75))
      && d.torso <= Math.max(0.06, Math.min(0.15, this.settings.torsoEnter * 0.75));
  }

  private pushEvent(t: number) {
    const last = this.events[this.events.length - 1];
    if (!last || last.state !== this.state) {
      this.events.push({
        t,
        state: this.state,
        kind: this.state === "coaching" ? this.changeKind ?? undefined : undefined,
      });
    }
  }
}
