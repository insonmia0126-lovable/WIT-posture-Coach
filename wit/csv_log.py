"""세션 CSV 기록. 모의 시연과 실측을 mode 열로 분리한다."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from wit.engine import EngineSnapshot


HEADERS = [
    "timestamp_iso",
    "t_s",
    "mode",
    "feedback_enabled",
    "state",
    "angle_deg",
    "baseline_deg",
    "delta_deg",
    "valid",
    "alert_count",
    "recovery_count",
    "interrupt_count",
    "mean_recovery_s",
    "reason",
]


@dataclass
class SessionLogger:
    path: Path
    rows: list[dict] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.rows is None:
            self.rows = []

    def append(self, snap: EngineSnapshot) -> None:
        self.rows.append(
            {
                "timestamp_iso": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "t_s": f"{snap.t:.3f}",
                "mode": "DEMO" if snap.demo else "CAMERA",
                "feedback_enabled": "1" if snap.feedback_enabled else "0",
                "state": snap.state.value,
                "angle_deg": _fmt(snap.angle_deg),
                "baseline_deg": _fmt(snap.baseline_deg),
                "delta_deg": _fmt(snap.delta_deg),
                "valid": "1" if snap.valid else "0",
                "alert_count": str(snap.alert_count),
                "recovery_count": str(snap.recovery_count),
                "interrupt_count": str(snap.interrupt_count),
                "mean_recovery_s": _fmt(snap.mean_recovery_s),
                "reason": snap.reason,
            }
        )

    def save(self, dest: Optional[Path] = None) -> Path:
        out = dest or self.path
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=HEADERS)
            writer.writeheader()
            writer.writerows(self.rows)
        return out


def write_rows(path: Path, rows: Iterable[dict]) -> Path:
    logger = SessionLogger(path)
    logger.rows = list(rows)
    return logger.save()


def _fmt(value: Optional[float]) -> str:
    if value is None:
        return ""
    return f"{value:.3f}"
