import { useEffect, useRef, useState } from "react";
import { cameraErrorMessage, listCameras } from "./camera";
import { simulatedPose } from "./demo/simulator";
import { CoachEngine } from "./engine/coach";
import {
  DEFAULT_SETTINGS,
  DEMO_SHORT_SETTINGS,
  type AppState,
  type CoachSettings,
  type CoachSnapshot,
} from "./engine/types";
import { drawOverlay } from "./overlay";
import { createPoseLandmarker, detectPose } from "./pose/landmarker";
import { deleteSessions, loadSessions, saveSession, toCsv, type StoredSession } from "./storage";

type View = "start" | "live" | "results" | "settings";
const STATE_KO: Record<AppState, string> = {
  ready: "준비",
  calibrating: "기준 자세 등록 중",
  in_range: "기준 범위",
  change_detected: "자세 변화 감지",
  coaching: "교정 안내",
  unavailable: "측정 불가",
  paused: "일시정지",
};

export default function App() {
  const [view, setView] = useState<View>("start");
  const [settings, setSettings] = useState<CoachSettings>(DEFAULT_SETTINGS);
  const [engine] = useState(() => new CoachEngine(DEFAULT_SETTINGS));
  const [snap, setSnap] = useState<CoachSnapshot>(() => engine.snapshot(0));
  const [error, setError] = useState("");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [demo, setDemo] = useState(false);
  const [landmarksOn, setLandmarksOn] = useState(true);
  const [devOpen, setDevOpen] = useState(true);
  const [inferFps, setInferFps] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [sessions, setSessions] = useState<StoredSession[]>(() => loadSessions());
  const [result, setResult] = useState<StoredSession | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createPoseLandmarker>> | null>(null);
  const inferLock = useRef(false);
  const lastInfer = useRef(0);
  const fpsWindow = useRef<number[]>([]);
  const loopRef = useRef(0);
  const t0 = useRef(performance.now());
  const demoT0 = useRef(0);
  const hiddenRef = useRef(false);
  const landmarksRef = useRef(true);
  const demoRef = useRef(false);

  useEffect(() => {
    engine.settings = { ...settings };
  }, [engine, settings]);

  useEffect(() => {
    const onVis = () => {
      hiddenRef.current = document.hidden;
      if (document.hidden && engine.state !== "paused" && view === "live") {
        setSnap(engine.pause(now()));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [engine, view]);

  function now() {
    return performance.now() - t0.current;
  }

  async function ensureModel() {
    if (landmarkerRef.current) return landmarkerRef.current;
    try {
      landmarkerRef.current = await createPoseLandmarker();
      setModelReady(true);
      return landmarkerRef.current;
    } catch (e) {
      setError(
        "자세 모델을 불러오지 못했습니다. 로컬 파일(/models/pose_landmarker_lite.task, /mediapipe)을 확인하세요. " +
          (e instanceof Error ? e.message : ""),
      );
      setModelReady(false);
      throw e;
    }
  }

  async function startWebcam() {
    setError("");
    setDemo(false);
    demoRef.current = false;
    engine.settings = { ...settings, demoShortDurations: false };
    try {
      await ensureModel();
      const cams = await listCameras();
      setCameras(cams);
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play();
      }
      const after = await listCameras();
      setCameras(after);
      t0.current = performance.now();
      setSnap(engine.startSession(0, false));
      setView("live");
      requestAnimationFrame(() => {
        const el = videoRef.current;
        if (el && streamRef.current) {
          el.srcObject = streamRef.current;
          void el.play();
        }
        startLoop(false);
      });
    } catch (e) {
      setError(cameraErrorMessage(e));
    }
  }

  function startDemo() {
    setError("");
    setDemo(true);
    demoRef.current = true;
    engine.settings = { ...settings, ...DEMO_SHORT_SETTINGS };
    t0.current = performance.now();
    demoT0.current = performance.now();
    setSnap(engine.startSession(0, true));
    engine.beginCalibration(0);
    setView("live");
    requestAnimationFrame(() => startLoop(true));
  }

  function startLoop(isDemo: boolean) {
    cancelAnimationFrame(loopRef.current);
    const tick = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      const t = now();
      if (engine.state !== "paused" && !hiddenRef.current) {
        if (!inferLock.current && t - lastInfer.current >= engine.settings.inferEveryMs) {
          inferLock.current = true;
          lastInfer.current = t;
          try {
            let points = null;
            let inferMs = 0;
            let poseCount = 1;
            if (isDemo) {
              const sim = simulatedPose(performance.now() - demoT0.current);
              points = sim.points;
              poseCount = 1;
              inferMs = 4;
              setSnap(engine.feed({ t, points: sim.points, poseCount }, inferMs));
            } else if (v && landmarkerRef.current && v.readyState >= 2) {
              const frame = detectPose(landmarkerRef.current, v, performance.now());
              points = frame.points;
              poseCount = frame.poseCount;
              inferMs = frame.inferMs;
              setSnap(engine.feed({ t, points: frame.points, poseCount }, inferMs));
            }
            fpsWindow.current.push(performance.now());
            fpsWindow.current = fpsWindow.current.filter((x) => performance.now() - x < 1000);
            setInferFps(fpsWindow.current.length);
            if (c) drawOverlay(c, v, points, landmarksRef.current);
          } finally {
            inferLock.current = false;
          }
        }
      }
      loopRef.current = requestAnimationFrame(tick);
    };
    loopRef.current = requestAnimationFrame(tick);
  }

  function stopCameraTracks() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function endSession() {
    cancelAnimationFrame(loopRef.current);
    stopCameraTracks();
    const s = engine.snapshot(now());
    const row: StoredSession = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      demo,
      sessionMs: s.sessionMs,
      validMs: s.validMs,
      unavailableMs: s.unavailableMs,
      inRangeMs: s.inRangeMs,
      coachingCount: s.coachingCount,
      recoveryCount: s.recoveryCount,
      meanRecoveryMs: s.meanRecoveryMs,
      timeline: engine.events,
    };
    if (!demo) saveSession(row);
    else {
      const demoRows = loadSessions();
      localStorage.setItem(
        "wit.demo.last",
        JSON.stringify(row),
      );
      void demoRows;
    }
    setResult(row);
    setSessions(loadSessions());
    setView("results");
  }

  function exportCsv() {
    const blob = new Blob([toCsv(loadSessions())], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wit-sessions.csv";
    a.click();
  }

  const ratio =
    snap.validMs > 0 ? `${((snap.inRangeMs / snap.validMs) * 100).toFixed(0)}%` : "—";

  return (
    <div className="wrap">
      {view === "start" && (
        <StartScreen
          error={error}
          sessions={sessions}
          cameras={cameras}
          deviceId={deviceId}
          onDevice={setDeviceId}
          onWebcam={startWebcam}
          onDemo={startDemo}
          onRefreshCams={async () => setCameras(await listCameras())}
        />
      )}

      {view !== "start" && (
        <>
          <header className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div className="kicker">목격자 W.I.T</div>
              <strong>당신의 자세 변화를 살피는 개인 코치</strong>
            </div>
            <div className="row">
              <button type="button" onClick={() => setView("settings")}>
                설정
              </button>
              <button type="button" onClick={() => setView("live")}>
                측정
              </button>
              <button type="button" onClick={() => setView("results")}>
                결과
              </button>
            </div>
          </header>
        </>
      )}

      {(view === "live" || view === "settings") && (
        <div style={{ display: view === "live" ? "block" : "none" }}>
          {demo && (
            <div className="banner-sim">시연 모드 · 시뮬레이션 데이터 · 단축 타이머 · 실측 기록과 섞지 않음</div>
          )}
          <p className="muted">
            노트북을 안정된 위치에 놓고 화면 각도를 고정해 주세요. 얼굴과 양쪽 어깨가 보이도록 앉은 뒤 기준
            자세를 등록하세요. 노트북 위치나 화면 각도를 바꾸면 재등록하세요.
          </p>
          <div className="live-grid">
            <div>
              <div className="monitor">
                <video ref={videoRef} playsInline muted autoPlay />
                <canvas ref={canvasRef} />
                <div className="guide-caption">얼굴과 양쪽 어깨가 안내선 안에 오게 앉으세요</div>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setSnap(engine.beginCalibration(now()))}
                  disabled={snap.state === "paused"}
                >
                  {snap.baseline ? "재등록" : "기준 등록"}
                </button>
                {snap.state === "paused" ? (
                  <button type="button" onClick={() => setSnap(engine.resume(now()))}>
                    재시작
                  </button>
                ) : (
                  <button type="button" onClick={() => setSnap(engine.pause(now()))}>
                    일시정지
                  </button>
                )}
                <button type="button" onClick={endSession}>
                  종료
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={landmarksOn}
                    onChange={(e) => {
                      landmarksRef.current = e.target.checked;
                      setLandmarksOn(e.target.checked);
                    }}
                  />{" "}
                  랜드마크
                </label>
              </div>
            </div>
            <div className="card">
              <div className={`status ${snap.state}`}>
                <div className="kicker" style={{ color: "#fff" }}>
                  현재 상태
                </div>
                <h2>{STATE_KO[snap.state]}</h2>
                <p>{snap.message}</p>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                기준은 의료적으로 검증된 정상 자세가 아니라, 지금 등록한 비교 기준입니다. 전방 머리 자세를
                거북목 각도로 표시하지 않습니다.
              </p>
              <div className="metrics-list" style={{ marginTop: 8 }}>
                <div>
                  고개 기울기 Δ
                  <strong>
                    {" "}
                    {snap.deltas ? `${snap.deltas.head >= 0 ? "+" : ""}${snap.deltas.head.toFixed(1)}°` : "—"}
                  </strong>
                </div>
                <div>
                  어깨 기울기 Δ
                  <strong>
                    {" "}
                    {snap.deltas ? `${snap.deltas.shoulder >= 0 ? "+" : ""}${snap.deltas.shoulder.toFixed(1)}°` : "—"}
                  </strong>
                </div>
                <div>
                  상체 보조 지표
                  <strong> {snap.deltas ? snap.deltas.torso.toFixed(3) : "—"}</strong>
                </div>
                <div>
                  기준 유지(유효)
                  <strong> {ratio}</strong>
                </div>
              </div>
              <div className="footer-stats">
                <span>측정 {(snap.sessionMs / 1000).toFixed(0)}초</span>
                <span>안내 {snap.coachingCount}회</span>
                <span>복귀 {snap.recoveryCount}회</span>
              </div>
              {devOpen && (
                <div className="dev">
                  개발 정보 · 추론 {inferFps} fps · 지연 {snap.inferMs.toFixed(0)} ms · 모델{" "}
                  {modelReady || demo ? (demo ? "시뮬레이션" : "로컬 Pose Landmarker Lite") : "미로드"} · 감지{" "}
                  {snap.metrics?.valid ? "유효" : "불가"}
                  <button type="button" style={{ marginLeft: 8 }} onClick={() => setDevOpen(false)}>
                    숨기기
                  </button>
                </div>
              )}
              {!devOpen && (
                <button type="button" className="dev" onClick={() => setDevOpen(true)}>
                  개발 정보 보기
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {view === "settings" && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          cameras={cameras}
          deviceId={deviceId}
          onDevice={setDeviceId}
        />
      )}

      {view === "results" && (
        <Results
          current={result}
          sessions={sessions}
          onCsv={exportCsv}
          onDelete={() => {
            deleteSessions();
            setSessions([]);
          }}
          onHome={() => setView("start")}
        />
      )}
    </div>
  );
}

function StartScreen({
  error,
  sessions,
  cameras,
  deviceId,
  onDevice,
  onWebcam,
  onDemo,
  onRefreshCams,
}: {
  error: string;
  sessions: StoredSession[];
  cameras: MediaDeviceInfo[];
  deviceId: string;
  onDevice: (id: string) => void;
  onWebcam: () => void;
  onDemo: () => void;
  onRefreshCams: () => void;
}) {
  return (
    <div>
      <p className="kicker">온디바이스 · 영상 외부 전송 없음</p>
      <h1>목격자 W.I.T</h1>
      <p style={{ fontSize: "1.2rem" }}>당신의 자세 변화를 살피는 개인 코치</p>
      <p className="notice">
        카메라 프레임과 좌표는 이 브라우저에서만 처리합니다. 영상과 사진은 저장하지 않습니다. 결과 기록은
        사용자 브라우저(localStorage)에만 남습니다.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ margin: "1rem 0" }}>
        <button type="button" className="primary" onClick={onWebcam}>
          웹캠 시작
        </button>
        <button type="button" onClick={onDemo}>
          데모 시작
        </button>
        <button type="button" onClick={onRefreshCams}>
          카메라 목록
        </button>
        {cameras.length > 0 && (
          <select value={deviceId} onChange={(e) => onDevice(e.target.value)}>
            <option value="">기본 카메라</option>
            {cameras.map((c, i) => (
              <option key={c.deviceId || i} value={c.deviceId}>
                {c.label || `카메라 ${i + 1}`}
              </option>
            ))}
          </select>
        )}
      </div>
      <h3>최근 사용 기록</h3>
      {sessions.length === 0 ? (
        <p className="muted">저장된 실측 기록이 없습니다.</p>
      ) : (
        <ul className="session-list">
          {sessions.slice(0, 8).map((s) => (
            <li key={s.id}>
              <span>{new Date(s.startedAt).toLocaleString("ko-KR")}</span>
              <span>
                안내 {s.coachingCount} · 유효 {(s.validMs / 1000).toFixed(0)}초
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SettingsPanel({
  settings,
  onChange,
  cameras,
  deviceId,
  onDevice,
}: {
  settings: CoachSettings;
  onChange: (s: CoachSettings) => void;
  cameras: MediaDeviceInfo[];
  deviceId: string;
  onDevice: (id: string) => void;
}) {
  const set = (k: keyof CoachSettings, v: number | boolean) => onChange({ ...settings, [k]: v });
  return (
    <div className="card">
      <h2>시제품 설정</h2>
      <p className="muted">값은 검증용 가정이며 의료 기준이 아닙니다. 발표용 단축과 실사용 기본을 구분하세요.</p>
      <label className="field">
        변화 지속(ms) <input type="number" value={settings.sustainMs} onChange={(e) => set("sustainMs", +e.target.value)} />
      </label>
      <label className="field">
        반복 안내 간격(ms){" "}
        <input type="number" value={settings.repeatAlertMs} onChange={(e) => set("repeatAlertMs", +e.target.value)} />
      </label>
      <label className="field">
        복귀 확인(ms) <input type="number" value={settings.recoveryMs} onChange={(e) => set("recoveryMs", +e.target.value)} />
      </label>
      <label className="field">
        고개 이탈(°) <input type="number" value={settings.headEnterDeg} onChange={(e) => set("headEnterDeg", +e.target.value)} />
      </label>
      <label className="field">
        고개 복귀(°) <input type="number" value={settings.headExitDeg} onChange={(e) => set("headExitDeg", +e.target.value)} />
      </label>
      <label className="field">
        어깨 이탈(°) <input type="number" value={settings.shoulderEnterDeg} onChange={(e) => set("shoulderEnterDeg", +e.target.value)} />
      </label>
      <label className="field">
        어깨 복귀(°) <input type="number" value={settings.shoulderExitDeg} onChange={(e) => set("shoulderExitDeg", +e.target.value)} />
      </label>
      <label className="field">
        상체 이탈 <input type="number" step="0.01" value={settings.torsoEnter} onChange={(e) => set("torsoEnter", +e.target.value)} />
      </label>
      <label className="field">
        추론 간격(ms) <input type="number" value={settings.inferEveryMs} onChange={(e) => set("inferEveryMs", +e.target.value)} />
      </label>
      {cameras.length > 0 && (
        <label className="field">
          카메라
          <select value={deviceId} onChange={(e) => onDevice(e.target.value)}>
            <option value="">기본</option>
            {cameras.map((c, i) => (
              <option key={c.deviceId || i} value={c.deviceId}>
                {c.label || `카메라 ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function Results({
  current,
  sessions,
  onCsv,
  onDelete,
  onHome,
}: {
  current: StoredSession | null;
  sessions: StoredSession[];
  onCsv: () => void;
  onDelete: () => void;
  onHome: () => void;
}) {
  const s = current;
  const ratio = s && s.validMs > 0 ? `${((s.inRangeMs / s.validMs) * 100).toFixed(1)}%` : "—";
  const rec =
    s && s.meanRecoveryMs != null && s.recoveryCount > 0
      ? `${(s.meanRecoveryMs / 1000).toFixed(1)}초 (${s.recoveryCount}건)`
      : "계산할 기록 없음";
  return (
    <div className="card">
      <h2>세션 결과</h2>
      {s?.demo && <p className="banner-sim" style={{ position: "relative" }}>시뮬레이션 데이터</p>}
      {!s ? (
        <p className="muted">방금 끝난 세션이 없습니다. 최근 실측 기록만 아래에 있습니다.</p>
      ) : (
        <>
          <div className="metrics-list">
            <div>전체 세션 {(s.sessionMs / 1000).toFixed(1)}초</div>
            <div>유효 측정 {(s.validMs / 1000).toFixed(1)}초</div>
            <div>측정 불가 {(s.unavailableMs / 1000).toFixed(1)}초</div>
            <div>기준 범위 유지 {ratio}</div>
            <div>교정 안내 {s.coachingCount}회</div>
            <div>복귀 {s.recoveryCount}회</div>
            <div>평균 복귀 {rec}</div>
          </div>
          <p className="muted">유지 비율 분모는 유효 측정 시간입니다. 측정 불가는 정상으로 넣지 않습니다.</p>
          <div className="timeline" title="상태 변화">
            {s.timeline.map((ev, i) => {
              const next = s.timeline[i + 1]?.t ?? s.sessionMs;
              const w = Math.max(2, ((next - ev.t) / Math.max(1, s.sessionMs)) * 100);
              const color: Record<string, string> = {
                in_range: "#2f6f4e",
                coaching: "#c45c26",
                change_detected: "#b8860b",
                unavailable: "#5a6270",
                calibrating: "#3d5a80",
                paused: "#3a4a6b",
                ready: "#d9d1c4",
              };
              return <span key={i} style={{ width: `${w}%`, background: color[ev.state] || "#ccc" }} />;
            })}
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="primary" onClick={onCsv}>
          CSV 내보내기
        </button>
        <button type="button" onClick={onDelete}>
          기록 삭제
        </button>
        <button type="button" onClick={onHome}>
          시작 화면
        </button>
      </div>
      <h3 style={{ marginTop: 16 }}>저장된 실측 (데모 제외)</h3>
      {sessions.length === 0 ? (
        <p className="muted">없음</p>
      ) : (
        <ul className="session-list">
          {sessions.map((r) => (
            <li key={r.id}>
              <span>
                {new Date(r.startedAt).toLocaleString("ko-KR")} · 안내 {r.coachingCount}
              </span>
              <span>{(r.validMs / 1000).toFixed(0)}초</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
