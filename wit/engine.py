"""규칙 기반 자세 상태 판단 엔진.

MediaPipe 등은 각도만 넘기고, 알림·회복·중단은 이 모듈이 처리한다.
각도는 귀-어깨 연결선과 수직선 사이의 2D 대리지표이며 임상 CVA가 아니다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class CoachState(str, Enum):
    IDLE = "idle"
    CALIBRATING = "calibrating"
    STABLE = "stable"
    WATCH = "watch"
    SUSTAINED = "sustained"
    ALERT = "alert"
    RECOVERING = "recovering"
    INTERRUPTED = "interrupted"


class EventKind(str, Enum):
    SESSION_START = "session_start"
    CALIBRATION_DONE = "calibration_done"
    ALERT = "alert"
    RECOVERY = "recovery"
    INTERRUPT = "interrupt"
    RESUME = "resume"


@dataclass(frozen=True)
class EngineConfig:
    calibration_s: float = 5.0
    deviation_deg: float = 12.0
    recovery_deg: float = 8.0
    sustain_s: float = 5.0
    recovery_hold_s: float = 2.0
    gap_timeout_s: float = 1.5
    min_visibility: float = 0.5


@dataclass
class Sample:
    t: float
    angle_deg: float
    visibility: float = 1.0
    occluded: bool = False


@dataclass
class EngineEvent:
    t: float
    kind: EventKind
    detail: str = ""


@dataclass
class EngineSnapshot:
    t: float
    state: CoachState
    angle_deg: Optional[float]
    baseline_deg: Optional[float]
    delta_deg: Optional[float]
    sustain_elapsed_s: float
    recovery_elapsed_s: float
    calibration_elapsed_s: float
    alert_count: int
    recovery_count: int
    interrupt_count: int
    mean_recovery_s: Optional[float]
    last_event: Optional[str]
    valid: bool
    demo: bool
    feedback_enabled: bool
    reason: str = ""


@dataclass
class CoachEngine:
    config: EngineConfig = field(default_factory=EngineConfig)
    demo: bool = True
    feedback_enabled: bool = True

    state: CoachState = CoachState.IDLE
    baseline_deg: Optional[float] = None
    session_start_t: Optional[float] = None
    last_sample_t: Optional[float] = None
    calib_start_t: Optional[float] = None
    calib_sum: float = 0.0
    calib_n: int = 0
    sustain_start_t: Optional[float] = None
    recovery_start_t: Optional[float] = None
    pending_alert_t: Optional[float] = None
    alert_count: int = 0
    recovery_count: int = 0
    interrupt_count: int = 0
    recovery_times: list[float] = field(default_factory=list)
    events: list[EngineEvent] = field(default_factory=list)
    last_angle: Optional[float] = None
    last_reason: str = ""

    def start_session(self, t: float) -> EngineSnapshot:
        self.state = CoachState.CALIBRATING
        self.baseline_deg = None
        self.session_start_t = t
        self.last_sample_t = None
        self.calib_start_t = t
        self.calib_sum = 0.0
        self.calib_n = 0
        self.sustain_start_t = None
        self.recovery_start_t = None
        self.pending_alert_t = None
        self.alert_count = 0
        self.recovery_count = 0
        self.interrupt_count = 0
        self.recovery_times = []
        self.events = [EngineEvent(t, EventKind.SESSION_START, "새 세션")]
        self.last_angle = None
        self.last_reason = "기준 자세를 5초간 기록합니다."
        return self.snapshot(t)

    def feed(self, sample: Sample) -> EngineSnapshot:
        if self.state == CoachState.IDLE:
            return self.start_session(sample.t)

        if self.last_sample_t is not None:
            gap = sample.t - self.last_sample_t
            if gap > self.config.gap_timeout_s and self.state not in (
                CoachState.CALIBRATING,
                CoachState.IDLE,
            ):
                self._interrupt(sample.t, f"입력 공백 {gap:.2f}s")
                self.last_sample_t = sample.t
                self.last_angle = sample.angle_deg
                return self.snapshot(sample.t, valid=False)

        self.last_sample_t = sample.t
        self.last_angle = sample.angle_deg

        invalid = sample.occluded or sample.visibility < self.config.min_visibility
        if invalid:
            if self.state == CoachState.CALIBRATING:
                self.last_reason = "가림 또는 저신뢰로 보정을 일시 중단합니다."
                return self.snapshot(sample.t, valid=False)
            self._interrupt(sample.t, "가림 또는 저신뢰")
            return self.snapshot(sample.t, valid=False)

        if self.state == CoachState.INTERRUPTED:
            self._resume_after_interrupt(sample)
            return self.snapshot(sample.t)

        if self.state == CoachState.CALIBRATING:
            self._calibrate(sample)
            return self.snapshot(sample.t)

        assert self.baseline_deg is not None
        delta = sample.angle_deg - self.baseline_deg
        self._update_posture(sample.t, delta)
        return self.snapshot(sample.t)

    def snapshot(self, t: float, valid: bool = True) -> EngineSnapshot:
        delta = None
        if self.baseline_deg is not None and self.last_angle is not None:
            delta = self.last_angle - self.baseline_deg
        mean_rec = (
            sum(self.recovery_times) / len(self.recovery_times)
            if self.recovery_times
            else None
        )
        calib_elapsed = 0.0
        if self.state == CoachState.CALIBRATING and self.calib_start_t is not None:
            calib_elapsed = max(0.0, t - self.calib_start_t)
        sustain_elapsed = 0.0
        if self.sustain_start_t is not None:
            sustain_elapsed = max(0.0, t - self.sustain_start_t)
        rec_elapsed = 0.0
        if self.recovery_start_t is not None:
            rec_elapsed = max(0.0, t - self.recovery_start_t)
        last = self.events[-1].kind.value if self.events else None
        return EngineSnapshot(
            t=t,
            state=self.state,
            angle_deg=self.last_angle,
            baseline_deg=self.baseline_deg,
            delta_deg=delta,
            sustain_elapsed_s=sustain_elapsed,
            recovery_elapsed_s=rec_elapsed,
            calibration_elapsed_s=calib_elapsed,
            alert_count=self.alert_count,
            recovery_count=self.recovery_count,
            interrupt_count=self.interrupt_count,
            mean_recovery_s=mean_rec,
            last_event=last,
            valid=valid,
            demo=self.demo,
            feedback_enabled=self.feedback_enabled,
            reason=self.last_reason,
        )

    def _calibrate(self, sample: Sample) -> None:
        self.calib_sum += sample.angle_deg
        self.calib_n += 1
        start = self.calib_start_t if self.calib_start_t is not None else sample.t
        elapsed = sample.t - start
        remain = max(0.0, self.config.calibration_s - elapsed)
        self.last_reason = f"기준 기록 중 ({remain:.1f}s)"
        if elapsed + 1e-6 >= self.config.calibration_s and self.calib_n > 0:
            self.baseline_deg = self.calib_sum / self.calib_n
            self.state = CoachState.STABLE
            self.events.append(
                EngineEvent(
                    sample.t,
                    EventKind.CALIBRATION_DONE,
                    f"기준 {self.baseline_deg:.1f}°",
                )
            )
            self.last_reason = "기준 범위입니다."

    def _update_posture(self, t: float, delta: float) -> None:
        in_recovery_band = delta <= self.config.recovery_deg
        in_deviation = delta >= self.config.deviation_deg

        if self.state in (CoachState.ALERT, CoachState.RECOVERING):
            if in_recovery_band:
                if self.recovery_start_t is None:
                    self.recovery_start_t = t
                    self.state = CoachState.RECOVERING
                    self.sustain_start_t = None
                    self.last_reason = "기준 범위 복귀 확인 중"
                elif t - self.recovery_start_t + 1e-6 >= self.config.recovery_hold_s:
                    self._confirm_recovery(t)
            else:
                self.recovery_start_t = None
                if in_deviation:
                    self.state = CoachState.ALERT
                    self.last_reason = "알림 이후에도 이탈이 유지됩니다."
                else:
                    self.state = CoachState.WATCH
                    self.last_reason = "경계 구간 — 회복 타이머를 초기화합니다."
            return

        if in_deviation:
            self.recovery_start_t = None
            if self.sustain_start_t is None:
                self.sustain_start_t = t
                self.state = CoachState.SUSTAINED
                self.last_reason = "기준에서 벗어난 상태를 측정합니다."
            else:
                held = t - self.sustain_start_t
                self.state = CoachState.SUSTAINED
                self.last_reason = f"변화 지속 {held:.1f}s"
                if held + 1e-6 >= self.config.sustain_s:
                    self._fire_alert(t)
            return

        self.sustain_start_t = None
        if in_recovery_band:
            self.state = CoachState.STABLE
            self.last_reason = "기준 범위입니다."
        else:
            self.state = CoachState.WATCH
            self.last_reason = "경계 구간 — 흔들림으로 보고 지속 타이머를 초기화합니다."

    def _fire_alert(self, t: float) -> None:
        if self.state == CoachState.ALERT:
            return
        self.state = CoachState.ALERT
        self.alert_count += 1
        self.pending_alert_t = t
        self.recovery_start_t = None
        self.events.append(EngineEvent(t, EventKind.ALERT, "지속 이탈 알림"))
        self.last_reason = "기준에서 벗어난 상태가 이어져 알립니다."

    def _confirm_recovery(self, t: float) -> None:
        if self.pending_alert_t is not None:
            dt = t - self.pending_alert_t
            self.recovery_times.append(dt)
            self.recovery_count += 1
            self.events.append(
                EngineEvent(t, EventKind.RECOVERY, f"회복 {dt:.2f}s")
            )
        self.pending_alert_t = None
        self.recovery_start_t = None
        self.sustain_start_t = None
        self.state = CoachState.STABLE
        self.last_reason = "회복을 확인했습니다."

    def _interrupt(self, t: float, reason: str) -> None:
        if self.state in (CoachState.IDLE, CoachState.CALIBRATING):
            return
        if self.state != CoachState.INTERRUPTED:
            self.interrupt_count += 1
            self.events.append(EngineEvent(t, EventKind.INTERRUPT, reason))
        # 중단된 경고는 회복 성공으로 집계하지 않음
        self.pending_alert_t = None
        self.recovery_start_t = None
        self.sustain_start_t = None
        self.state = CoachState.INTERRUPTED
        self.last_reason = f"측정 불가 — {reason}"

    def _resume_after_interrupt(self, sample: Sample) -> None:
        self.events.append(EngineEvent(sample.t, EventKind.RESUME, "측정 재개"))
        self.sustain_start_t = None
        self.recovery_start_t = None
        if self.baseline_deg is None:
            self.state = CoachState.CALIBRATING
            self.calib_start_t = sample.t
            self.calib_sum = 0.0
            self.calib_n = 0
            self.last_reason = "재보정합니다."
            return
        delta = sample.angle_deg - self.baseline_deg
        if delta >= self.config.deviation_deg:
            self.state = CoachState.SUSTAINED
            self.sustain_start_t = sample.t
            self.last_reason = "측정 재개 — 이탈 지속 여부를 다시 봅니다."
        elif delta <= self.config.recovery_deg:
            self.state = CoachState.STABLE
            self.last_reason = "측정 재개 — 기준 범위입니다."
        else:
            self.state = CoachState.WATCH
            self.last_reason = "측정 재개 — 경계 구간입니다."
