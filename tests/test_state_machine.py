"""상태 전이 자동 테스트 8개. 판단 로직 검증이며 인식 정확도 주장이 아니다."""

from __future__ import annotations

import unittest

from wit.engine import CoachEngine, CoachState, EngineConfig, Sample


CFG = EngineConfig()


def run_hold(engine: CoachEngine, t0: float, duration: float, angle: float, step: float = 0.1, **kw):
    steps = int(round(duration / step))
    snap = None
    t = t0
    for i in range(steps + 1):
        t = t0 + i * step
        snap = engine.feed(Sample(t=t, angle_deg=angle, **kw))
    return snap, t


class StateMachineTests(unittest.TestCase):
    def calibrated(self, baseline: float = 25.0) -> tuple[CoachEngine, float]:
        eng = CoachEngine(config=CFG, demo=True)
        snap, t = run_hold(eng, 0.0, CFG.calibration_s, baseline)
        self.assertEqual(snap.state, CoachState.STABLE)
        self.assertAlmostEqual(eng.baseline_deg or 0.0, baseline, places=1)
        return eng, t

    def test_01_calibration_completes_after_five_seconds(self):
        eng = CoachEngine(config=CFG, demo=True)
        early, _ = run_hold(eng, 0.0, 4.0, 25.0)
        self.assertEqual(early.state, CoachState.CALIBRATING)
        done, _ = run_hold(eng, 4.1, 1.0, 25.0)
        self.assertEqual(done.state, CoachState.STABLE)
        self.assertIsNotNone(eng.baseline_deg)

    def test_02_brief_motion_does_not_alert(self):
        eng, t = self.calibrated()
        spike, t = run_hold(eng, t + 0.1, 1.0, 50.0)
        self.assertNotEqual(spike.state, CoachState.ALERT)
        self.assertEqual(eng.alert_count, 0)
        back, _ = run_hold(eng, t + 0.1, 1.0, 25.0)
        self.assertEqual(back.state, CoachState.STABLE)
        self.assertEqual(eng.alert_count, 0)

    def test_03_sustained_deviation_triggers_alert(self):
        eng, t = self.calibrated()
        snap, _ = run_hold(eng, t + 0.1, 6.0, 50.0)
        self.assertEqual(snap.state, CoachState.ALERT)
        self.assertEqual(eng.alert_count, 1)

    def test_04_recovery_confirmed_after_two_seconds(self):
        eng, t = self.calibrated()
        _, t = run_hold(eng, t + 0.1, 6.0, 50.0)
        self.assertEqual(eng.alert_count, 1)
        rec, _ = run_hold(eng, t + 0.1, 3.0, 25.0)
        self.assertEqual(rec.state, CoachState.STABLE)
        self.assertEqual(eng.recovery_count, 1)
        self.assertIsNotNone(eng.recovery_times)
        self.assertGreater(eng.recovery_times[0], 0.0)

    def test_05_watch_band_resets_sustain_timer(self):
        eng, t = self.calibrated()
        # +12 이탈 4초 → 아직 알림 전
        _, t = run_hold(eng, t + 0.1, 4.0, 50.0)
        self.assertEqual(eng.state, CoachState.SUSTAINED)
        self.assertEqual(eng.alert_count, 0)
        # 경계 구간(기준+10°)에서 타이머 초기화
        watch, t = run_hold(eng, t + 0.1, 1.0, 35.0)
        self.assertEqual(watch.state, CoachState.WATCH)
        # 다시 이탈 4초 — 누적 8초가 아니라 새로 세므로 알림 없음
        again, _ = run_hold(eng, t + 0.1, 4.0, 50.0)
        self.assertEqual(eng.alert_count, 0)
        self.assertIn(again.state, (CoachState.SUSTAINED, CoachState.WATCH))

    def test_06_occlusion_interrupts_observation(self):
        eng, t = self.calibrated()
        _, t = run_hold(eng, t + 0.1, 6.0, 50.0)
        self.assertEqual(eng.alert_count, 1)
        occ, _ = run_hold(eng, t + 0.1, 0.3, 50.0, occluded=True)
        self.assertEqual(occ.state, CoachState.INTERRUPTED)
        self.assertFalse(occ.valid)

    def test_07_interrupted_episode_is_not_recovery_success(self):
        eng, t = self.calibrated()
        _, t = run_hold(eng, t + 0.1, 6.0, 50.0)
        self.assertEqual(eng.alert_count, 1)
        _, t = run_hold(eng, t + 0.1, 0.3, 50.0, occluded=True)
        self.assertEqual(eng.state, CoachState.INTERRUPTED)
        back, _ = run_hold(eng, t + 0.1, 3.0, 25.0)
        self.assertEqual(eng.recovery_count, 0)
        self.assertEqual(back.state, CoachState.STABLE)

    def test_08_input_gap_over_1_5s_interrupts(self):
        eng, t = self.calibrated()
        eng.feed(Sample(t=t + 0.1, angle_deg=50.0))
        later = t + 0.1 + 1.6
        snap = eng.feed(Sample(t=later, angle_deg=50.0))
        self.assertEqual(snap.state, CoachState.INTERRUPTED)
        self.assertGreaterEqual(eng.interrupt_count, 1)


if __name__ == "__main__":
    unittest.main()
