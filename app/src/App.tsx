import { useCallback, useEffect, useRef, useState } from "react";
import { cameraErrorMessage, listCameras } from "./camera";
import { simulatedPose } from "./demo/simulator";
import { CoachEngine } from "./engine/coach";
import {
  DEMO_SHORT_SETTINGS,
  type CameraPosition,
  type AppState,
  type CoachSettings,
  type CoachSnapshot,
} from "./engine/types";
import { drawOverlay } from "./overlay";
import { CAMERA_POSITIONS, cameraPositionGuide, cameraPositionLabel, isCameraPosition } from "./engine/cameraPosition";
import { createPoseLandmarker, detectPose } from "./pose/landmarker";
import { personalCoachLines } from "./coachGuide";
import {
  deleteLearning,
  entryFromSession,
  learningToMarkdown,
  loadLearning,
  saveLearning,
  updateLearningMemo,
  type LearningEntry,
} from "./learningStore";
import { createPerson, currentPerson, listPeople, renamePerson, switchPerson, type Person } from "./person";
import {
  deletePersonSessions,
  deleteSession,
  loadSessions,
  saveSession,
  sessionsForPerson,
  toCsv,
  type StoredSession,
} from "./storage";
import { APP_VERSION } from "./version";
import { loadSettings, POSTURE_PRESETS, saveSettings, selectedPosturePreset } from "./settings";

type View = "start" | "live" | "results" | "settings" | "learning" | "history";
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
  const [settings, setSettings] = useState<CoachSettings>(loadSettings);
  const [engine] = useState(() => new CoachEngine(settings));
  const [snap, setSnap] = useState<CoachSnapshot>(() => engine.snapshot(0));
  const [error, setError] = useState("");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [demo, setDemo] = useState(false);
  const [landmarksOn, setLandmarksOn] = useState(true);
  const [devOpen, setDevOpen] = useState(true);
  const [inferFps, setInferFps] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [camStatus, setCamStatus] = useState("");
  const [tabNotice, setTabNotice] = useState("");
  const modelPromise = useRef<Promise<unknown> | null>(null);
  const [person, setPerson] = useState<Person>(() => currentPerson());
  const [people, setPeople] = useState<Person[]>(() => listPeople());
  const [sessions, setSessions] = useState<StoredSession[]>(() => loadSessions());
  const [learning, setLearning] = useState<LearningEntry[]>(() => loadLearning());
  const [result, setResult] = useState<StoredSession | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createPoseLandmarker>> | null>(null);
  const inferLock = useRef(false);
  const lastInfer = useRef(0);
  const fpsWindow = useRef<number[]>([]);
  const loopRef = useRef(0);
  const loopTimer = useRef(0);
  const t0 = useRef(performance.now());
  const demoT0 = useRef(0);
  const landmarksRef = useRef(true);
  const demoRef = useRef(false);
  const cameraSessionRef = useRef(0);
  const sessionActiveRef = useRef(false);

  const bindVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    if (video && streamRef.current) {
      if (video.srcObject !== streamRef.current) video.srcObject = streamRef.current;
      video.muted = true;
      video.playsInline = true;
      void video.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    engine.settings = { ...settings, ...(demoRef.current ? DEMO_SHORT_SETTINGS : {}) };
    saveSettings(settings);
  }, [engine, settings]);

  useEffect(() => {
    void ensureModel().catch(() => {});
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (!sessionActiveRef.current) return;
      if (document.hidden && engine.settings.pauseWhenHidden && engine.state !== "paused") {
        setSnap(engine.pause(now(), "hidden"));
        setTabNotice("다른 탭·최소화 상태에서는 측정을 쉬며, 이 시간은 기록에서 제외됩니다.");
      } else if (document.hidden && !engine.settings.pauseWhenHidden) {
        const el = videoRef.current;
        if (el && streamRef.current) void el.play().catch(() => {});
      } else if (!document.hidden && engine.state === "paused" && engine.pauseReason === "hidden") {
        if (settings.autoResumeOnReturn) {
          setSnap(engine.resume(now()));
          setTabNotice("화면으로 돌아와 측정을 자동 재개했습니다. 쉬었던 시간은 기록에서 제외했습니다.");
        } else {
          setSnap({ ...engine.snapshot(now()), message: "화면으로 돌아왔습니다. 측정 재개를 눌러 이어서 측정하세요." });
          setTabNotice("화면으로 돌아왔습니다. 측정 재개를 눌러 이어서 측정하세요. 쉬었던 시간은 기록에서 제외됩니다.");
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [engine, settings.autoResumeOnReturn, settings.pauseWhenHidden]);

  function now() {
    return performance.now() - t0.current;
  }

  function changeSettings(next: CoachSettings) {
    if (next.cameraPosition !== engine.settings.cameraPosition) {
      setSnap(engine.setCameraPosition(next.cameraPosition, now()));
    }
    engine.settings = { ...next, ...(demoRef.current ? DEMO_SHORT_SETTINGS : {}) };
    if (!next.pauseWhenHidden && engine.pauseReason === "hidden") {
      setSnap(engine.resume(now()));
      setTabNotice("");
    }
    setSettings(next);
  }

  async function ensureModel() {
    if (landmarkerRef.current) return landmarkerRef.current;
    if (!modelPromise.current) {
      modelPromise.current = createPoseLandmarker()
        .then((lm) => {
          landmarkerRef.current = lm;
          setModelReady(true);
          return lm;
        })
        .catch((e) => {
          modelPromise.current = null;
          setModelReady(false);
          setError(
            "자세 모델을 불러오지 못했습니다. 로컬 파일(/models/pose_landmarker_lite.task, /mediapipe)을 확인하세요. " +
              (e instanceof Error ? e.message : ""),
          );
          throw e;
        });
    }
    return modelPromise.current as Promise<NonNullable<typeof landmarkerRef.current>>;
  }

  function attachStream(stream: MediaStream) {
    streamRef.current = stream;
    bindVideo(videoRef.current);
  }

  async function openCamera(sessionId: number): Promise<void> {
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 960 }, height: { ideal: 540 } }
        : { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (sessionId !== cameraSessionRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    attachStream(stream);
    void listCameras().then(setCameras).catch(() => {});
  }

  async function startWebcam() {
    const sessionId = ++cameraSessionRef.current;
    stopLoop();
    stopCameraTracks();
    sessionActiveRef.current = true;
    setTabNotice("");
    setError("");
    setDemo(false);
    demoRef.current = false;
    engine.settings = { ...settings, demoShortDurations: false };
    setCamStatus("웹캠을 켜는 중…");
    setView("live");
    t0.current = performance.now();
    setSnap(engine.startSession(0, false));
    try {
      // Wait for both so a late camera response cannot leak tracks after a model failure.
      const startup = await Promise.allSettled([openCamera(sessionId), ensureModel()]);
      if (sessionId !== cameraSessionRef.current) return;
      for (const task of startup) {
        if (task.status === "rejected") throw task.reason;
      }
      setCamStatus("");
      startLoop(false);
    } catch (e) {
      if (sessionId !== cameraSessionRef.current) return;
      sessionActiveRef.current = false;
      stopCameraTracks();
      setCamStatus("");
      setView("start");
      setError(cameraErrorMessage(e));
    }
  }

  async function startDemo() {
    const sessionId = ++cameraSessionRef.current;
    stopLoop();
    stopCameraTracks();
    sessionActiveRef.current = true;
    setTabNotice("");
    setError("");
    setDemo(true);
    demoRef.current = true;
    engine.settings = { ...settings, ...DEMO_SHORT_SETTINGS };
    t0.current = performance.now();
    demoT0.current = performance.now();
    setSnap(engine.startSession(0, true));
    setCamStatus("웹캠을 켜는 중…");
    setView("live");
    const modelTask = ensureModel().catch(() => null);
    try {
      await openCamera(sessionId);
      if (sessionId !== cameraSessionRef.current) return;
      setCamStatus("");
    } catch {
      if (sessionId !== cameraSessionRef.current) return;
      setCamStatus("웹캠을 열 수 없어 시연 데이터로 진행합니다. 권한을 허용하면 다시 시작해 주세요.");
    }
    engine.beginCalibration(0);
    startLoop(true);
    await modelTask;
  }

  function stopLoop() {
    cancelAnimationFrame(loopRef.current);
    window.clearInterval(loopTimer.current);
    loopTimer.current = 0;
  }

  function startLoop(isDemo: boolean) {
    stopLoop();
    // Session-relative time must never be compared with the previous session.
    lastInfer.current = -Infinity;
    inferLock.current = false;
    fpsWindow.current = [];
    setInferFps(0);
    if (document.hidden && engine.settings.pauseWhenHidden && engine.state !== "paused") {
      setSnap(engine.pause(now(), "hidden"));
    }
    let lastPoints: ReturnType<typeof simulatedPose>["points"] | null = null;
    let lastFrameCount = -1;
    const overlay = () => {
      const c = canvasRef.current;
      if (c) drawOverlay(c, videoRef.current, lastPoints, landmarksRef.current, engine.settings.cameraPosition, engine.settings.minVisibility);
    };
    const tick = () => {
      const v = videoRef.current;
      const t = now();
      try {
        if (document.hidden && engine.settings.pauseWhenHidden && engine.state !== "paused") {
          setSnap(engine.pause(t, "hidden"));
        }
        if (engine.state !== "paused" && !inferLock.current && t - lastInfer.current >= engine.settings.inferEveryMs) {
          inferLock.current = true;
          lastInfer.current = t;
          try {
            const liveReady = Boolean(v && landmarkerRef.current && v.readyState >= 2 && v.videoWidth > 0);
            const decoded = v ? (v as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount : undefined;
            const frameMoved = decoded == null || decoded !== lastFrameCount;
            if (decoded != null) lastFrameCount = decoded;
            if (liveReady && v && landmarkerRef.current && frameMoved) {
              try {
                const frame = detectPose(landmarkerRef.current, v, performance.now());
                lastPoints = frame.points;
                setCamStatus("");
                setSnap(engine.feed({ t, points: frame.points, poseCount: frame.poseCount }, frame.inferMs));
              } catch {
                lastPoints = null;
                const broken = landmarkerRef.current;
                landmarkerRef.current = null;
                modelPromise.current = null;
                setModelReady(false);
                setCamStatus("자세 인식기를 다시 연결하는 중입니다.");
                try { broken?.close(); } catch { /* Already closed. */ }
                void ensureModel().catch(() => {});
              }
            } else if (isDemo && !liveReady) {
              const sim = simulatedPose(performance.now() - demoT0.current);
              lastPoints = sim.points;
              setSnap(engine.feed({ t, points: sim.points, poseCount: 1 }, 4));
            }
            fpsWindow.current.push(performance.now());
            fpsWindow.current = fpsWindow.current.filter((x) => performance.now() - x < 1000);
            setInferFps(fpsWindow.current.length);
          } finally {
            inferLock.current = false;
          }
        }
        if (streamRef.current && v && v.srcObject !== streamRef.current) attachStream(streamRef.current);
        overlay();
      } catch {
        // One failed frame must not stop the session timer.
      }
    };
    const draw = () => {
      loopRef.current = requestAnimationFrame(draw);
      overlay();
    };
    // Preserve the upstream timer loop; animation frames stop in hidden tabs.
    loopTimer.current = window.setInterval(tick, Math.max(200, engine.settings.inferEveryMs));
    loopRef.current = requestAnimationFrame(draw);
  }

  function stopCameraTracks() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    const el = videoRef.current;
    if (el) {
      el.pause();
      el.srcObject = null;
    }
  }

  function endSession() {
    sessionActiveRef.current = false;
    setTabNotice("");
    cameraSessionRef.current += 1;
    demoRef.current = false;
    stopLoop();
    stopCameraTracks();
    const s = engine.snapshot(now());
    const kindCounts = { head: 0, shoulder: 0, torso: 0 };
    for (const ev of engine.events) {
      if (ev.state === "coaching" && ev.kind) kindCounts[ev.kind] += 1;
    }
    const who = currentPerson();
    const row: StoredSession = {
      id: crypto.randomUUID(),
      personId: who.id,
      personName: who.name,
      startedAt: new Date().toISOString(),
      demo,
      sessionMs: s.sessionMs,
      pausedMs: s.pausedMs,
      validMs: s.validMs,
      unavailableMs: s.unavailableMs,
      inRangeMs: s.inRangeMs,
      coachingCount: s.coachingCount,
      recoveryCount: s.recoveryCount,
      meanRecoveryMs: s.meanRecoveryMs,
      kindCounts,
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
    saveLearning(entryFromSession(row));
    setLearning(loadLearning());
    setView("results");
  }

  function refreshPeople(next?: Person) {
    const peopleNow = listPeople();
    setPeople(peopleNow);
    setPerson(next ?? currentPerson());
  }

  function exportCsv() {
    const who = currentPerson();
    const mine = sessionsForPerson(loadSessions(), who.id);
    const blob = new Blob([toCsv(mine)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wit-${who.id}.csv`;
    a.click();
  }

  const ratio =
    snap.validMs > 0 ? `${((snap.inRangeMs / snap.validMs) * 100).toFixed(0)}%` : "—";

  return (
    <div className="wrap">
      {view === "start" && (
        <StartScreen
          error={error}
          person={person}
          people={people}
          sessions={sessionsForPerson(sessions, person.id)}
          learningCount={learning.length}
          cameras={cameras}
          deviceId={deviceId}
          onDevice={setDeviceId}
          onWebcam={startWebcam}
          onDemo={startDemo}
          onHistory={() => setView("history")}
          onRename={(name) => {
            const next = renamePerson(person.id, name);
            if (next) refreshPeople(next);
          }}
          onCreate={() => refreshPeople(createPerson(""))}
          onSwitch={(id) => {
            const next = switchPerson(id);
            if (next) refreshPeople(next);
          }}
          onLearning={() => setView("learning")}
          onSettings={() => setView("settings")}
          cameraPosition={settings.cameraPosition}
          onCameraPosition={(cameraPosition) => changeSettings({ ...settings, cameraPosition })}
          onRefreshCams={async () => setCameras(await listCameras())}
        />
      )}

      {view !== "start" && (
        <>
          <header className="topbar">
            <div>
              <div className="kicker">목격자 W.I.T · v{APP_VERSION}</div>
              <strong>당신의 자세 변화를 살피는 개인 코치</strong>
            </div>
            <nav className="nav">
              <button type="button" onClick={() => setView("settings")}>
                설정
              </button>
              <button type="button" onClick={() => setView("live")}>
                측정
              </button>
              <button type="button" onClick={() => setView("results")}>
                결과
              </button>
              <button type="button" onClick={() => setView("learning")}>
                학습 기록
              </button>
            </nav>
          </header>
        </>
      )}

      <div style={{ display: view === "live" ? "block" : "none" }} aria-hidden={view !== "live"}>
          {demo && (
            <div className="banner-sim">시연 모드 · 웹캠 실시간 미리보기 · 단축 타이머 · 실측 기록과 섞지 않음</div>
          )}
          <p className="muted">
            카메라와 화면 위치를 고정해 주세요. 안정적으로 인식된 시간 {(engine.settings.calibrationMs / 1000).toFixed(1)}초를 모아 기준을 등록합니다.
            카메라 위치를 바꾸면 새 위치에서 기준을 다시 등록하세요.
          </p>
          <div className="notice" role="status" style={{ marginBottom: 12 }}>
            {snap.pauseReason === "manual" ? "사용자가 일시정지했습니다. 탭으로 돌아와도 자동 재개하지 않습니다. 측정 재개를 눌러 주세요." : tabNotice || (!settings.pauseWhenHidden
              ? "탭 전환·최소화 중에도 측정을 시도합니다. 브라우저의 절전·카메라 제한으로 인식이 중단될 수 있습니다. 설정에서 탭을 벗어나면 일시정지하도록 선택할 수 있습니다."
              : settings.autoResumeOnReturn
              ? "탭을 바꾸거나 최소화하면 측정을 쉬고, 돌아오면 자동 재개합니다. 계속 측정하려면 이 화면을 다른 작업 창 옆에 띄워 두세요."
              : "탭을 바꾸거나 최소화하면 측정을 쉽니다. 돌아온 뒤 측정 재개를 눌러 주세요.")}
          </div>
          <CameraPositionPicker
            position={settings.cameraPosition}
            onChange={(cameraPosition) => changeSettings({ ...settings, cameraPosition })}
          />
          <div className="live-grid">
            <div>
              <div className="monitor">
                <video ref={bindVideo} playsInline muted autoPlay />
                <canvas ref={canvasRef} />
                <div className="guide-caption">
                  {cameraPositionLabel(settings.cameraPosition)} · {settings.cameraPosition === "front" ? "양쪽 눈·어깨" : "카메라 쪽 눈·귀와 양쪽 어깨"}가 보이게 앉으세요
                </div>
                {camStatus && <div className="cam-status">{camStatus}</div>}
                {!demo && !modelReady && !camStatus && (
                  <div className="cam-status">미리보기 표시 중 · 자세 모델 준비</div>
                )}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setSnap(engine.beginCalibration(now()))}
                  disabled={snap.state === "paused" || !snap.metrics?.valid}
                >
                  {snap.baseline ? "재등록" : "기준 등록"}
                </button>
                {snap.state === "paused" ? (
                  <button type="button" onClick={() => {
                    setTabNotice("");
                    setSnap(engine.resume(now()));
                  }}>
                    측정 재개
                  </button>
                ) : (
                  <button type="button" onClick={() => {
                    setTabNotice("");
                    setSnap(engine.pause(now(), "manual"));
                  }}>
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
              {(snap.state === "calibrating" || (snap.state === "paused" && !snap.baseline && snap.calibrationStableMs > 0)) && (
                <div className="notice" style={{ marginTop: 12 }}>
                  <label>
                    기준 등록 진행 · 안정 인식 {(snap.calibrationStableMs / 1000).toFixed(1)} / {(snap.calibrationTargetMs / 1000).toFixed(1)}초
                    <progress aria-label="기준 등록 진행" max={snap.calibrationTargetMs} value={snap.calibrationStableMs} style={{ display: "block", width: "100%", marginTop: 6 }} />
                  </label>
                  <small>짧은 흔들림에는 진행률을 유지합니다. 가려진 시간은 제외하고, 다른 자세가 계속될 때만 새 자세로 기준을 모읍니다.</small>
                </div>
              )}
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
              <p className="muted" aria-live="polite">
                구도 인식: {snap.metrics?.valid ? "인식됨" : snap.metrics?.reason || "얼굴과 어깨를 확인하는 중입니다."}
                {snap.baseline ? ` · ${cameraPositionLabel(snap.baseline.cameraPosition)} 기준 등록됨` : " · 현재 위치의 기준 등록 필요"}
              </p>
              <div className="metrics-list" style={{ marginTop: 8 }}>
                <div>
                  {settings.cameraPosition === "front" ? "고개 기울기 Δ" : "옆얼굴 기울기 Δ"}
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
                  {settings.cameraPosition === "front" ? "상체 보조 지표" : "귀·어깨 위치 변화"}
                  <strong> {snap.deltas ? snap.deltas.torso.toFixed(3) : "—"}</strong>
                </div>
                <div>
                  기준 유지(유효)
                  <strong> {ratio}</strong>
                </div>
              </div>
              <div className="footer-stats">
                <span>측정 {(snap.sessionMs / 1000).toFixed(0)}초</span>
                <span>일시정지 {(snap.pausedMs / 1000).toFixed(0)}초 제외</span>
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

      {view === "settings" && (
        <SettingsPanel
          settings={settings}
          onChange={changeSettings}
          cameras={cameras}
          deviceId={deviceId}
          onDevice={setDeviceId}
          onBack={() => setView(streamRef.current || demoRef.current ? "live" : "start")}
        />
      )}

      {view === "results" && (
        <Results
          current={result}
          sessions={sessionsForPerson(sessions, person.id)}
          person={person}
          onCsv={exportCsv}
          onDelete={() => {
            deletePersonSessions(person.id);
            setSessions(loadSessions());
          }}
          onHome={() => setView("start")}
          onLearning={() => setView("learning")}
        />
      )}

      {view === "history" && (
        <HistoryScreen
          person={person}
          people={people}
          sessions={sessionsForPerson(sessions, person.id)}
          onRename={(name) => {
            const next = renamePerson(person.id, name);
            if (next) refreshPeople(next);
          }}
          onCreate={() => refreshPeople(createPerson(""))}
          onSwitch={(id) => {
            const next = switchPerson(id);
            if (next) refreshPeople(next);
          }}
          onDeleteOne={(id) => {
            deleteSession(id);
            setSessions(loadSessions());
          }}
          onDeleteAll={() => {
            deletePersonSessions(person.id);
            setSessions(loadSessions());
          }}
          onCsv={exportCsv}
          onHome={() => setView("start")}
        />
      )}

      {view === "learning" && (
        <LearningScreen
          entries={learning}
          onMemo={(id, memo) => {
            updateLearningMemo(id, memo);
            setLearning(loadLearning());
          }}
          onExport={() => {
            const blob = new Blob([learningToMarkdown(loadLearning())], { type: "text/markdown;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "wit-learning.md";
            a.click();
          }}
          onDelete={() => {
            deleteLearning();
            setLearning([]);
          }}
          onHome={() => setView("start")}
        />
      )}
    </div>
  );
}

function StartScreen({
  error,
  person,
  people,
  sessions,
  learningCount,
  cameras,
  deviceId,
  onDevice,
  onWebcam,
  onDemo,
  onLearning,
  onSettings,
  cameraPosition,
  onCameraPosition,
  onHistory,
  onRename,
  onCreate,
  onSwitch,
  onRefreshCams,
}: {
  error: string;
  person: Person;
  people: Person[];
  sessions: StoredSession[];
  learningCount: number;
  cameras: MediaDeviceInfo[];
  deviceId: string;
  onDevice: (id: string) => void;
  onWebcam: () => void;
  onDemo: () => void;
  onLearning: () => void;
  onSettings: () => void;
  cameraPosition: CameraPosition;
  onCameraPosition: (position: CameraPosition) => void;
  onHistory: () => void;
  onRename: (name: string) => void;
  onCreate: () => void;
  onSwitch: (id: string) => void;
  onRefreshCams: () => void;
}) {
  return (
    <div className="hero">
      <p className="kicker">온디바이스 · 영상 외부 전송 없음</p>
      <h1>목격자 W.I.T</h1>
      <p className="kicker">v{APP_VERSION} · 노트북 웹캠</p>
      <p className="lede">당신의 자세 변화를 살피는 개인 코치</p>
      <p className="notice">
        카메라 프레임과 좌표는 이 브라우저에서만 처리합니다. 영상과 사진은 저장하지 않습니다. 결과 기록은
        사용자 브라우저(localStorage)에만 남습니다. 같은 주소를 여러 사람이 동시에 열어도 각자 기기에서
        따로 측정합니다.
      </p>
      <PersonCard
        person={person}
        people={people}
        onRename={onRename}
        onCreate={onCreate}
        onSwitch={onSwitch}
        onHistory={onHistory}
      />
      {error && <p className="error">{error}</p>}
      <CameraPositionPicker position={cameraPosition} onChange={onCameraPosition} />
      <div className="row" style={{ margin: "1rem 0" }}>
        <button type="button" className="primary" onClick={onWebcam}>
          웹캠 시작
        </button>
        <button type="button" onClick={onDemo}>
          데모 시작
        </button>
        <button type="button" onClick={onSettings}>
          자세 허용 범위 설정
        </button>
        <button type="button" onClick={onLearning}>
          학습 기록 ({learningCount})
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
      <h3>이 아이디의 최근 실측</h3>
      {sessions.length === 0 ? (
        <p className="muted">이 아이디로 저장된 실측 기록이 없습니다.</p>
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

function CameraPositionPicker({ position, onChange }: {
  position: CameraPosition;
  onChange: (position: CameraPosition) => void;
}) {
  return (
    <div style={{ margin: "1rem 0" }}>
      <label className="field">
        카메라 위치 (사용자 기준)
        <select aria-label="카메라 위치" value={position} onChange={(event) => {
          if (isCameraPosition(event.target.value)) onChange(event.target.value);
        }}>
          {CAMERA_POSITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <p className="muted">{cameraPositionGuide(position)}</p>
      {position !== "front" && <p className="muted">대각 촬영용 비교 지표입니다. 완전한 옆모습이나 목의 실제 각도를 측정하지 않습니다.</p>}
    </div>
  );
}

function SettingsPanel({
  settings,
  onChange,
  cameras,
  deviceId,
  onDevice,
  onBack,
}: {
  settings: CoachSettings;
  onChange: (s: CoachSettings) => void;
  cameras: MediaDeviceInfo[];
  deviceId: string;
  onDevice: (id: string) => void;
  onBack: () => void;
}) {
  const set = (k: keyof CoachSettings, v: number | boolean) => {
    if (typeof v === "number" && !Number.isFinite(v)) return;
    onChange({ ...settings, [k]: v });
  };
  return (
    <div className="card">
      <button type="button" onClick={onBack} style={{ marginBottom: 12 }}>돌아가기</button>
      <h2>시제품 설정</h2>
      <label className="field">
        탭을 벗어나면 일시정지
        <input type="checkbox" checked={settings.pauseWhenHidden} onChange={(event) => set("pauseWhenHidden", event.target.checked)} />
      </label>
      <p className="muted">기본은 탭 전환·최소화 중에도 측정 유지입니다. 브라우저 제한으로 새 영상이 없으면 그 시간은 유효한 자세 측정으로 계산하지 않습니다.</p>
      <label className="field">
        탭 복귀 시 자동 재개
        <input type="checkbox" disabled={!settings.pauseWhenHidden} checked={settings.autoResumeOnReturn} onChange={(event) => set("autoResumeOnReturn", event.target.checked)} />
      </label>
      <p className="muted">탭을 벗어나면 일시정지를 선택했을 때 적용합니다. 카메라 연결은 유지하며, 직접 누른 일시정지는 자동으로 풀리지 않습니다.</p>
      <label className="field">
        판정값 흔들림 완화
        <select value={settings.smoothingMs} onChange={(event) => set("smoothingMs", Number(event.target.value))}>
          <option value={0}>끄기</option>
          <option value={120}>기본</option>
          <option value={250}>강하게</option>
        </select>
      </label>
      <p className="muted">짧은 인식값 떨림을 줄입니다. 강하게 설정하면 자세 변화가 화면에 반영되는 데 조금 더 시간이 걸립니다.</p>
      <CameraPositionPicker
        position={settings.cameraPosition}
        onChange={(cameraPosition) => onChange({ ...settings, cameraPosition })}
      />
      <h3>자세 허용 범위</h3>
      <p className="muted">작은 업무 움직임을 허용하도록 기본 범위를 넓혔습니다. 허용 범위만 바뀌며 등록한 기준 자세는 유지됩니다.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        {POSTURE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={selectedPosturePreset(settings) === preset.id}
            className={selectedPosturePreset(settings) === preset.id ? "primary" : ""}
            onClick={() => onChange({ ...settings, ...preset.values })}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="muted">
        현재 이탈 기준: 고개 {settings.headEnterDeg}° · 어깨 {settings.shoulderEnterDeg}° · 상체 {settings.torsoEnter.toFixed(2)}.
        숫자가 클수록 더 큰 움직임을 허용합니다. 선택한 범위는 이 브라우저에 저장됩니다.
      </p>
      <p className="muted">값은 검증용 가정이며 의료 기준이 아닙니다. 발표용 단축과 실사용 기본을 구분하세요.</p>
      <label className="field">
        기준 등록(ms){" "}
        <input type="number" value={settings.calibrationMs} onChange={(e) => set("calibrationMs", +e.target.value)} />
      </label>
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
        상체 복귀 <input type="number" step="0.01" value={settings.torsoExit} onChange={(e) => set("torsoExit", +e.target.value)} />
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

function PersonCard({
  person,
  people,
  onRename,
  onCreate,
  onSwitch,
  onHistory,
}: {
  person: Person;
  people: Person[];
  onRename: (name: string) => void;
  onCreate: () => void;
  onSwitch: (id: string) => void;
  onHistory: () => void;
}) {
  const [name, setName] = useState(person.name);
  useEffect(() => setName(person.name), [person.id, person.name]);
  return (
    <div className="card" style={{ margin: "1rem 0" }}>
      <p className="kicker">개인 아이디</p>
      <p className="person-id">{person.id}</p>
      <p className="muted">이 브라우저에 부여된 아이디입니다. 측정 이력은 이 아이디로만 이 기기에 남습니다.</p>
      <div className="row">
        <label>
          이름
          <input
            value={name}
            maxLength={40}
            placeholder="표시 이름"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onRename(name)}
          />
        </label>
        {people.length > 1 && (
          <label>
            이 기기의 다른 아이디
            <select value={person.id} onChange={(e) => onSwitch(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                  {p.name ? ` · ${p.name}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={onCreate}>
          새 아이디
        </button>
        <button type="button" onClick={onHistory}>
          이력
        </button>
      </div>
    </div>
  );
}

function HistoryScreen({
  person,
  people,
  sessions,
  onRename,
  onCreate,
  onSwitch,
  onDeleteOne,
  onDeleteAll,
  onCsv,
  onHome,
}: {
  person: Person;
  people: Person[];
  sessions: StoredSession[];
  onRename: (name: string) => void;
  onCreate: () => void;
  onSwitch: (id: string) => void;
  onDeleteOne: (id: string) => void;
  onDeleteAll: () => void;
  onCsv: () => void;
  onHome: () => void;
}) {
  return (
    <div>
      <PersonCard person={person} people={people} onRename={onRename} onCreate={onCreate} onSwitch={onSwitch} onHistory={() => {}} />
      <h2>측정 이력</h2>
      <p className="muted">실측만 남깁니다. 시연 기록은 이 목록에 넣지 않습니다. 다른 컴퓨터의 기록은 여기로 모이지 않습니다.</p>
      <div className="row" style={{ margin: "0.8rem 0" }}>
        <button type="button" className="primary" onClick={onCsv}>
          이 아이디 CSV
        </button>
        <button type="button" onClick={onDeleteAll}>
          이 아이디 기록 삭제
        </button>
        <button type="button" onClick={onHome}>
          시작 화면
        </button>
      </div>
      {sessions.length === 0 ? (
        <p className="muted">기록이 없습니다.</p>
      ) : (
        <table className="result-table">
          <caption>
            {person.id}
            {person.name ? ` · ${person.name}` : ""} 실측 {sessions.length}건
          </caption>
          <thead>
            <tr>
              <th>시작</th>
              <th>세션</th>
              <th>유효</th>
              <th>안내</th>
              <th>복귀</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.startedAt).toLocaleString("ko-KR")}</td>
                <td>{(s.sessionMs / 1000).toFixed(0)}초</td>
                <td>{(s.validMs / 1000).toFixed(0)}초</td>
                <td>{s.coachingCount}</td>
                <td>{s.recoveryCount}</td>
                <td>
                  <button type="button" onClick={() => onDeleteOne(s.id)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Results({
  current,
  sessions,
  person,
  onCsv,
  onDelete,
  onHome,
  onLearning,
}: {
  current: StoredSession | null;
  sessions: StoredSession[];
  person: Person;
  onCsv: () => void;
  onDelete: () => void;
  onHome: () => void;
  onLearning: () => void;
}) {
  const s = current;
  const ratio = s && s.validMs > 0 ? `${((s.inRangeMs / s.validMs) * 100).toFixed(1)}%` : "—";
  const rec =
    s && s.meanRecoveryMs != null && s.recoveryCount > 0
      ? `${(s.meanRecoveryMs / 1000).toFixed(1)}초 (${s.recoveryCount}건)`
      : "계산할 기록 없음";
  const kinds = s?.kindCounts ?? { head: 0, shoulder: 0, torso: 0 };
  const coachLines = s ? personalCoachLines(s) : [];
  return (
    <div className="card">
      <h2>세션 결과</h2>
      {s?.demo && <p className="banner-sim" style={{ position: "relative" }}>시연 모드 · 시뮬레이션 데이터</p>}
      {!s ? (
        <p className="muted">방금 끝난 세션이 없습니다. 최근 실측 기록만 아래에 있습니다.</p>
      ) : (
        <>
          <table className="result-table">
            <caption>이번 세션 요약</caption>
            <thead>
              <tr>
                <th>항목</th>
                <th>값</th>
                <th>설명</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>개인 아이디</td>
                <td>
                  {s.personId || person.id}
                  {s.personName ? ` · ${s.personName}` : ""}
                </td>
                <td>이 브라우저에 부여된 아이디</td>
              </tr>
              <tr>
                <td>모드</td>
                <td>{s.demo ? "시연(시뮬레이션)" : "웹캠 실측"}</td>
                <td>실측과 시연 기록은 구분합니다</td>
              </tr>
              <tr>
                <td>전체 세션</td>
                <td>{((s.sessionMs + (s.pausedMs ?? 0)) / 1000).toFixed(1)}초</td>
                <td>시작부터 종료까지</td>
              </tr>
              <tr>
                <td>측정 진행</td>
                <td>{(s.sessionMs / 1000).toFixed(1)}초</td>
                <td>일시정지 시간을 제외한 시간</td>
              </tr>
              <tr>
                <td>일시정지</td>
                <td>{((s.pausedMs ?? 0) / 1000).toFixed(1)}초</td>
                <td>탭 전환·수동 정지 시간은 측정에서 제외</td>
              </tr>
              <tr>
                <td>유효 측정</td>
                <td>{(s.validMs / 1000).toFixed(1)}초</td>
                <td>얼굴·어깨가 인식된 시간</td>
              </tr>
              <tr>
                <td>측정 불가</td>
                <td>{(s.unavailableMs / 1000).toFixed(1)}초</td>
                <td>기준 유지·이탈 시간에 넣지 않음</td>
              </tr>
              <tr>
                <td>기준 범위 유지</td>
                <td>{ratio}</td>
                <td>분모는 유효 측정 시간</td>
              </tr>
              <tr>
                <td>교정 안내</td>
                <td>{s.coachingCount}회</td>
                <td>지속된 자세 변화에 대한 알림</td>
              </tr>
              <tr>
                <td>　· 고개</td>
                <td>{kinds.head}회</td>
                <td>좌우 기울어짐 안내</td>
              </tr>
              <tr>
                <td>　· 어깨</td>
                <td>{kinds.shoulder}회</td>
                <td>좌우 높이 차이 안내</td>
              </tr>
              <tr>
                <td>　· 상체</td>
                <td>{kinds.torso}회</td>
                <td>보조 지표 안내</td>
              </tr>
              <tr>
                <td>기준 복귀</td>
                <td>{s.recoveryCount}회</td>
                <td>안내 후 기준 범위로 돌아온 횟수</td>
              </tr>
              <tr>
                <td>평균 복귀</td>
                <td>{rec}</td>
                <td>복귀가 없으면 계산하지 않음</td>
              </tr>
            </tbody>
          </table>
          <p className="muted">유지 비율 분모는 유효 측정 시간입니다. 측정 불가는 정상 자세로 집계하지 않습니다.</p>
          <div className="timeline" title="상태 변화 (일시정지 포함)">
            {s.timeline.map((ev, i) => {
              const totalMs = s.sessionMs + (s.pausedMs ?? 0);
              const next = s.timeline[i + 1]?.t ?? totalMs;
              const w = Math.max(2, ((next - ev.t) / Math.max(1, totalMs)) * 100);
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
          <section className="coach-guide">
            <h3>개인 코치 가이드</h3>
            <p className="muted">이번 세션의 자세 변화 기록을 규칙으로 정리한 안내입니다.</p>
            <p className="legal-warn">의료 진단이 아닙니다</p>
            <p className="legal-warn">목격자는 질환을 진단하지 않습니다</p>
            {coachLines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </section>
        </>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="primary" onClick={onCsv}>
          CSV 내보내기
        </button>
        <button type="button" onClick={onDelete}>
          이 아이디 기록 삭제
        </button>
        <button type="button" onClick={onLearning}>
          학습 기록
        </button>
        <button type="button" onClick={onHome}>
          시작 화면
        </button>
      </div>
      <h3 style={{ marginTop: 16 }}>이 아이디의 실측</h3>
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

function LearningScreen({
  entries,
  onMemo,
  onExport,
  onDelete,
  onHome,
}: {
  entries: LearningEntry[];
  onMemo: (id: string, memo: string) => void;
  onExport: () => void;
  onDelete: () => void;
  onHome: () => void;
}) {
  return (
    <div className="card">
      <h2>학습 기록</h2>
      <p className="muted">
        세션을 종료하면 결과와 개인 코치 문구가 이 브라우저에 버전(v{APP_VERSION})과 함께 쌓입니다. 팀 공유는
        마크다운으로 보낸 뒤 저장소 <code>learning/entries/</code>에 붙입니다. 영상은 저장하지 않습니다.
      </p>
      <p className="legal-warn">의료 진단이 아닙니다</p>
      <p className="legal-warn">목격자는 질환을 진단하지 않습니다</p>
      <div className="row" style={{ margin: "0.8rem 0" }}>
        <button type="button" className="primary" onClick={onExport}>
          마크다운 내보내기
        </button>
        <button type="button" onClick={onDelete}>
          학습 기록 삭제
        </button>
        <button type="button" onClick={onHome}>
          시작 화면
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="muted">아직 학습 기록이 없습니다. 측정을 종료하면 여기에 남습니다.</p>
      ) : (
        entries.map((e) => {
          const s = e.session;
          const k = s.kindCounts ?? { head: 0, shoulder: 0, torso: 0 };
          const ratio = s.validMs > 0 ? `${((s.inRangeMs / s.validMs) * 100).toFixed(1)}%` : "—";
          return (
            <article key={e.id} className="learn-card">
              <header className="row" style={{ justifyContent: "space-between" }}>
                <strong>v{e.appVersion}</strong>
                <span className="muted">
                  {s.demo ? "시연" : "웹캠"} · {new Date(e.savedAt).toLocaleString("ko-KR")}
                </span>
              </header>
              <table className="result-table">
                <tbody>
                  <tr>
                    <td>유효 / 불가</td>
                    <td>
                      {(s.validMs / 1000).toFixed(1)}초 / {(s.unavailableMs / 1000).toFixed(1)}초
                    </td>
                    <td>기준 유지 {ratio}</td>
                  </tr>
                  <tr>
                    <td>안내</td>
                    <td>{s.coachingCount}회</td>
                    <td>
                      고개 {k.head} · 어깨 {k.shoulder} · 상체 {k.torso} · 복귀 {s.recoveryCount}
                    </td>
                  </tr>
                </tbody>
              </table>
              <ul>
                {e.coachLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <label className="muted">메모 (환경, 다음에 바꿀 점)</label>
              <textarea
                rows={3}
                defaultValue={e.memo}
                onBlur={(ev) => onMemo(e.id, ev.target.value)}
                placeholder="예: 오후 형광등, 화면을 낮췄더니 고개 안내가 늘었다"
              />
            </article>
          );
        })
      )}
    </div>
  );
}
