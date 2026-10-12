"""브라우저 미리보기용 로컬 서버. 판단 엔진은 wit.engine과 동일하다."""

from __future__ import annotations

import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wit.csv_log import HEADERS, SessionLogger
from wit.engine import CoachEngine, EngineConfig, Sample

STATIC = ROOT / "web"
LOG_DIR = ROOT / "logs"


class SessionHub:
    def __init__(self) -> None:
        self.engine = CoachEngine(config=EngineConfig(), demo=True, feedback_enabled=True)
        self.logger = SessionLogger(LOG_DIR / "web_session.csv")
        self.engine.start_session(0.0)

    def reset(self, demo: bool, feedback: bool) -> dict:
        self.engine = CoachEngine(config=EngineConfig(), demo=demo, feedback_enabled=feedback)
        self.logger = SessionLogger(LOG_DIR / "web_session.csv")
        snap = self.engine.start_session(0.0)
        return self._pack(snap)

    def step(self, payload: dict) -> dict:
        snap = self.engine.feed(
            Sample(
                t=float(payload.get("t", 0.0)),
                angle_deg=float(payload.get("angle_deg", 25.0)),
                visibility=float(payload.get("visibility", 1.0)),
                occluded=bool(payload.get("occluded", False)),
            )
        )
        self.engine.demo = bool(payload.get("demo", True))
        self.logger.append(snap)
        return self._pack(snap)

    def save_csv(self) -> dict:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        path = self.logger.save(LOG_DIR / "web_session.csv")
        return {"path": str(path), "rows": len(self.logger.rows), "headers": HEADERS}

    def _pack(self, snap) -> dict:
        return {
            "t": snap.t,
            "state": snap.state.value,
            "angle_deg": snap.angle_deg,
            "baseline_deg": snap.baseline_deg,
            "delta_deg": snap.delta_deg,
            "sustain_elapsed_s": snap.sustain_elapsed_s,
            "recovery_elapsed_s": snap.recovery_elapsed_s,
            "calibration_elapsed_s": snap.calibration_elapsed_s,
            "alert_count": snap.alert_count,
            "recovery_count": snap.recovery_count,
            "interrupt_count": snap.interrupt_count,
            "mean_recovery_s": snap.mean_recovery_s,
            "valid": snap.valid,
            "demo": snap.demo,
            "feedback_enabled": snap.feedback_enabled,
            "reason": snap.reason,
        }


HUB = SessionHub()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("[web] " + (fmt % args) + "\n")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid json"})
            return
        if parsed.path == "/api/reset":
            data = HUB.reset(
                demo=bool(payload.get("demo", True)),
                feedback=bool(payload.get("feedback_enabled", True)),
            )
            self._json(200, data)
            return
        if parsed.path == "/api/step":
            self._json(200, HUB.step(payload))
            return
        if parsed.path == "/api/save":
            self._json(200, HUB.save_csv())
            return
        self._json(404, {"error": "not found"})

    def _json(self, code: int, data: dict) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    port = 43123
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"목격자 preview http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
