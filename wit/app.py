"""목격자 PC GUI. 추가 패키지 없이 DEMO 시연이 가능하다."""

from __future__ import annotations

import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wit.csv_log import SessionLogger
from wit.engine import CoachEngine, CoachState, EngineConfig, Sample

STATE_KO = {
    CoachState.IDLE: "대기",
    CoachState.CALIBRATING: "기준 기록",
    CoachState.STABLE: "안정",
    CoachState.WATCH: "경계",
    CoachState.SUSTAINED: "변화 지속",
    CoachState.ALERT: "알림",
    CoachState.RECOVERING: "회복 확인",
    CoachState.INTERRUPTED: "측정 불가",
}

STATE_BG = {
    CoachState.IDLE: "#1e293b",
    CoachState.CALIBRATING: "#334155",
    CoachState.STABLE: "#14532d",
    CoachState.WATCH: "#854d0e",
    CoachState.SUSTAINED: "#9a3412",
    CoachState.ALERT: "#7f1d1d",
    CoachState.RECOVERING: "#1e3a5f",
    CoachState.INTERRUPTED: "#3f3f46",
}


class WitApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("목격자 W.I.T  v0.1 — 연구용 프로토타입")
        self.geometry("1080x860")
        self.minsize(920, 760)
        self.configure(bg="#0f172a")

        self.config_engine = EngineConfig()
        self.engine = CoachEngine(config=self.config_engine, demo=True, feedback_enabled=True)
        self.logger = SessionLogger(Path("logs") / "session.csv")
        self.t0 = time.monotonic()
        self.running = True
        self.camera_mode = False
        self.camera = None
        self.camera_thread_stop = threading.Event()

        self.angle_var = tk.DoubleVar(value=25.0)
        self.occluded_var = tk.BooleanVar(value=False)
        self.feedback_var = tk.BooleanVar(value=True)
        self.side_var = tk.StringVar(value="left")
        self.cam_index_var = tk.StringVar(value="0")

        self._build()
        self.engine.start_session(0.0)
        self.after(50, self._tick)

    def _build(self) -> None:
        pad = {"padx": 12, "pady": 6}
        banner = tk.Label(
            self,
            text="DEMO  ·  합성 입력으로 상태 판단 흐름을 시연합니다. 인식 정확도·사용자 개선 결과가 아닙니다.",
            bg="#b45309",
            fg="white",
            font=("Pretendard", 12, "bold"),
            pady=8,
        )
        self.banner = banner
        banner.pack(fill="x")

        head = tk.Frame(self, bg="#0f172a")
        head.pack(fill="x", **pad)
        tk.Label(
            head,
            text="목격자",
            bg="#0f172a",
            fg="#f8fafc",
            font=("Pretendard", 22, "bold"),
        ).pack(side="left")
        tk.Label(
            head,
            text="개인 기준 대비 자세 변화 감지 · 알림 이후 회복 확인  ·  PC 온디바이스 v0.1",
            bg="#0f172a",
            fg="#94a3b8",
            font=("Pretendard", 11),
        ).pack(side="left", padx=12)

        monitor = tk.Frame(self, bg="#020617", highlightbackground="#475569", highlightthickness=6)
        monitor.pack(fill="x", padx=12, pady=8)
        tk.Label(
            monitor,
            text="웹캠 모니터  ·  측정 중 모습이 여기에 표시됩니다  ·  영상은 저장하지 않습니다",
            bg="#020617",
            fg="#94a3b8",
            font=("Pretendard", 10),
        ).pack(anchor="w", padx=8, pady=(6, 0))
        self.video_lbl = tk.Label(
            monitor,
            text="카메라를 켜면 모니터에 모습이 나옵니다.\nDEMO는 슬라이더, 실측은 [카메라 시작]",
            bg="#0b1220",
            fg="#64748b",
            font=("Pretendard", 13),
            width=96,
            height=12,
            justify="center",
        )
        self.video_lbl.pack(fill="x", padx=8, pady=8)
        self._photo = None

        self.state_lbl = tk.Label(
            self,
            text="안정",
            bg="#14532d",
            fg="white",
            font=("Pretendard", 28, "bold"),
            pady=18,
        )
        self.state_lbl.pack(fill="x", padx=12, pady=8)

        self.reason_lbl = tk.Label(
            self,
            text="",
            bg="#0f172a",
            fg="#e2e8f0",
            font=("Pretendard", 13),
            wraplength=900,
            justify="left",
        )
        self.reason_lbl.pack(fill="x", padx=16)

        metrics = tk.Frame(self, bg="#0f172a")
        metrics.pack(fill="x", padx=12, pady=8)
        self.metric_labels = {}
        for key, title in [
            ("angle", "현재 각도"),
            ("baseline", "개인 기준"),
            ("delta", "기준 대비"),
            ("alerts", "알림 횟수"),
            ("recoveries", "회복 확인"),
            ("mean_rec", "평균 회복(s)"),
        ]:
            card = tk.Frame(metrics, bg="#1e293b", padx=10, pady=8)
            card.pack(side="left", expand=True, fill="both", padx=4)
            tk.Label(card, text=title, bg="#1e293b", fg="#94a3b8", font=("Pretendard", 9)).pack()
            val = tk.Label(card, text="—", bg="#1e293b", fg="#f8fafc", font=("Pretendard", 16, "bold"))
            val.pack()
            self.metric_labels[key] = val

        controls = tk.LabelFrame(
            self,
            text=" 모의 입력 (DEMO) ",
            bg="#0f172a",
            fg="#cbd5e1",
            font=("Pretendard", 11),
        )
        controls.pack(fill="x", padx=12, pady=8)
        row = tk.Frame(controls, bg="#0f172a")
        row.pack(fill="x", padx=8, pady=8)
        tk.Label(row, text="각도(°)", bg="#0f172a", fg="#e2e8f0").pack(side="left")
        scale = tk.Scale(
            row,
            from_=0,
            to=70,
            orient="horizontal",
            variable=self.angle_var,
            length=520,
            bg="#0f172a",
            fg="#f8fafc",
            highlightthickness=0,
            troughcolor="#334155",
        )
        scale.pack(side="left", padx=8)
        tk.Checkbutton(
            row,
            text="모의 가림",
            variable=self.occluded_var,
            bg="#0f172a",
            fg="#e2e8f0",
            selectcolor="#1e293b",
            activebackground="#0f172a",
            activeforeground="#f8fafc",
        ).pack(side="left", padx=12)

        opts = tk.Frame(self, bg="#0f172a")
        opts.pack(fill="x", padx=12)
        tk.Checkbutton(
            opts,
            text="교정 피드백 표시 (B조건). 해제 시 A조건 — 내부 판단만 CSV 기록",
            variable=self.feedback_var,
            command=self._on_feedback,
            bg="#0f172a",
            fg="#e2e8f0",
            selectcolor="#1e293b",
            activebackground="#0f172a",
        ).pack(side="left")

        cam = tk.LabelFrame(
            self,
            text=" 카메라 (측면만 · 선택) ",
            bg="#0f172a",
            fg="#cbd5e1",
            font=("Pretendard", 11),
        )
        cam.pack(fill="x", padx=12, pady=8)
        crow = tk.Frame(cam, bg="#0f172a")
        crow.pack(fill="x", padx=8, pady=6)
        tk.Label(crow, text="장치", bg="#0f172a", fg="#e2e8f0").pack(side="left")
        ttk.Entry(crow, textvariable=self.cam_index_var, width=4).pack(side="left", padx=4)
        tk.Label(crow, text="측면", bg="#0f172a", fg="#e2e8f0").pack(side="left", padx=(12, 4))
        ttk.Combobox(crow, textvariable=self.side_var, values=["left", "right"], width=8, state="readonly").pack(
            side="left"
        )
        ttk.Button(crow, text="카메라 시작", command=self._start_camera).pack(side="left", padx=8)
        ttk.Button(crow, text="DEMO로 복귀", command=self._stop_camera).pack(side="left")

        btns = tk.Frame(self, bg="#0f172a")
        btns.pack(fill="x", padx=12, pady=10)
        ttk.Button(btns, text="새 세션 (재보정)", command=self._new_session).pack(side="left")
        ttk.Button(btns, text="CSV 저장", command=self._save_csv).pack(side="left", padx=8)
        ttk.Button(btns, text="시연 프리셋: 짧은 움직임", command=lambda: self.angle_var.set(50)).pack(
            side="left", padx=8
        )
        ttk.Button(btns, text="시연 프리셋: 기준 복귀", command=lambda: self.angle_var.set(25)).pack(side="left")

        foot = tk.Label(
            self,
            text="실험용 설정  보정 5초  ·  이탈 +12°  ·  지속 5초  ·  회복 +8° / 2초  ·  공백 1.5초 중단  ·  실측 성능 미검증",
            bg="#0f172a",
            fg="#64748b",
            font=("Pretendard", 9),
        )
        foot.pack(side="bottom", pady=8)

        self.hidden_notice = tk.Label(
            self,
            text="A조건: 교정 피드백이 숨겨져 있습니다. 내부 판단은 CSV에만 기록됩니다.",
            bg="#1e293b",
            fg="#fde68a",
            font=("Pretendard", 11),
        )

    def now(self) -> float:
        return time.monotonic() - self.t0

    def _on_feedback(self) -> None:
        self.engine.feedback_enabled = bool(self.feedback_var.get())
        self._new_session()

    def _new_session(self) -> None:
        self.t0 = time.monotonic()
        self.engine = CoachEngine(
            config=self.config_engine,
            demo=not self.camera_mode,
            feedback_enabled=bool(self.feedback_var.get()),
        )
        self.logger = SessionLogger(Path("logs") / "session.csv")
        self.engine.start_session(0.0)
        if not self.camera_mode:
            self.angle_var.set(25.0)
            self.occluded_var.set(False)

    def _tick(self) -> None:
        if not self.running:
            return
        if not self.camera_mode:
            snap = self.engine.feed(
                Sample(
                    t=self.now(),
                    angle_deg=float(self.angle_var.get()),
                    occluded=bool(self.occluded_var.get()),
                )
            )
            self.logger.append(snap)
            self._render(snap)
        self.after(100, self._tick)

    def _show_frame(self, frame) -> None:
        if frame is None:
            return
        try:
            import cv2
        except ImportError:
            return
        h, w = frame.shape[:2]
        max_w = 960
        if w > max_w:
            scale = max_w / w
            frame = cv2.resize(frame, (max_w, int(h * scale)))
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        hh, ww = rgb.shape[:2]
        header = f"P6 {ww} {hh} 255\n".encode("ascii")
        self._photo = tk.PhotoImage(data=header + rgb.tobytes(), format="PPM")
        self.video_lbl.config(image=self._photo, text="", width=ww, height=hh)

    def _render(self, snap, frame=None) -> None:
        if frame is not None:
            self._show_frame(frame)
        show = snap.feedback_enabled
        if show:
            self.hidden_notice.pack_forget()
            label = STATE_KO.get(snap.state, snap.state.value)
            self.state_lbl.config(text=label, bg=STATE_BG.get(snap.state, "#1e293b"))
            self.reason_lbl.config(text=snap.reason)
            self.metric_labels["alerts"].config(text=str(snap.alert_count))
            self.metric_labels["recoveries"].config(text=str(snap.recovery_count))
            mean = f"{snap.mean_recovery_s:.1f}" if snap.mean_recovery_s is not None else "—"
            self.metric_labels["mean_rec"].config(text=mean)
        else:
            if not self.hidden_notice.winfo_ismapped():
                self.hidden_notice.pack(fill="x", padx=12, pady=4)
            self.state_lbl.config(text="기록 중 (A)", bg="#1e293b")
            self.reason_lbl.config(text="피드백이 숨겨져 있습니다.")
            self.metric_labels["alerts"].config(text="숨김")
            self.metric_labels["recoveries"].config(text="숨김")
            self.metric_labels["mean_rec"].config(text="숨김")

        ang = f"{snap.angle_deg:.1f}°" if snap.angle_deg is not None else "—"
        base = f"{snap.baseline_deg:.1f}°" if snap.baseline_deg is not None else "기록 중"
        delta = f"{snap.delta_deg:+.1f}°" if snap.delta_deg is not None else "—"
        self.metric_labels["angle"].config(text=ang)
        self.metric_labels["baseline"].config(text=base)
        self.metric_labels["delta"].config(text=delta)

        if snap.demo:
            self.banner.config(
                text="DEMO  ·  합성 입력으로 상태 판단 흐름을 시연합니다. 인식 정확도·사용자 개선 결과가 아닙니다.",
                bg="#b45309",
            )
        else:
            self.banner.config(
                text="CAMERA  ·  측면 카메라 로컬 추론. 정면·임상 CVA가 아닙니다.",
                bg="#1d4ed8",
            )

        if show and snap.state == CoachState.ALERT:
            try:
                self.bell()
            except tk.TclError:
                pass

    def _save_csv(self) -> None:
        path = filedialog.asksaveasfilename(
            defaultextension=".csv",
            filetypes=[("CSV", "*.csv")],
            initialfile="wit_session.csv",
        )
        if not path:
            return
        saved = self.logger.save(Path(path))
        messagebox.showinfo("저장", f"기록했습니다.\n{saved}\nmode={'DEMO' if self.engine.demo else 'CAMERA'}")

    def _start_camera(self) -> None:
        try:
            from wit.pose import SideCameraPose
        except ImportError as exc:
            messagebox.showerror("카메라", str(exc))
            return
        try:
            idx = int(self.cam_index_var.get())
        except ValueError:
            messagebox.showerror("카메라", "장치 번호가 올바르지 않습니다.")
            return
        cam = SideCameraPose(camera_index=idx, side=self.side_var.get())
        try:
            cam.open()
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("카메라", f"{exc}\nDEMO 모드를 유지합니다.")
            return
        self.camera = cam
        self.camera_mode = True
        self.camera_thread_stop.clear()
        self._new_session()
        threading.Thread(target=self._camera_loop, daemon=True).start()

    def _stop_camera(self) -> None:
        self.camera_thread_stop.set()
        if self.camera is not None:
            try:
                self.camera.close()
            except Exception:
                pass
        self.camera = None
        self.camera_mode = False
        self._photo = None
        self.video_lbl.config(
            image="",
            text="카메라를 켜면 모니터에 모습이 나옵니다.\nDEMO는 슬라이더, 실측은 [카메라 시작]",
            width=96,
            height=12,
        )
        self._new_session()

    def _camera_loop(self) -> None:
        start_ms = int(time.time() * 1000)
        while not self.camera_thread_stop.is_set() and self.camera is not None:
            ts = int(time.time() * 1000) - start_ms
            try:
                _frame, reading = self.camera.read(ts)
            except Exception:
                break
            if reading is None:
                time.sleep(0.03)
                continue
            snap = self.engine.feed(
                Sample(
                    t=self.now(),
                    angle_deg=reading.angle_deg,
                    visibility=reading.visibility,
                    occluded=reading.occluded,
                )
            )
            self.logger.append(snap)
            frame = _frame
            self.after(0, lambda s=snap, f=frame: self._render(s, f))
            time.sleep(0.03)

    def destroy(self) -> None:
        self.running = False
        self._stop_camera()
        super().destroy()


def main() -> None:
    app = WitApp()
    app.mainloop()


if __name__ == "__main__":
    main()
