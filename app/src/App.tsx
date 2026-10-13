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
  const [camStatus, setCamStatus] = useState("");
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
  const t0 = useRef(performance.now());
  const demoT0 = useRef(0);
  const hiddenRef = useRef(false);
  const landmarksRef = useRef(true);
  const demoRef = useRef(false);

  useEffect(() => {
    engine.settings = { ...settings };
  }, [engine, settings]);

  useEffect(() => {
    void ensureModel();
  }, []);

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
    const bind = () => {
      const el = videoRef.current;
      if (!el) return;
      el.srcObject = stream;
      el.muted = true;
      el.playsInline = true;
      void el.play().catch(() => {});
    };
    bind();
    requestAnimationFrame(bind);
  }

  async function openCamera(): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 960 }, height: { ideal: 540 } }
        : { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    attachStream(stream);
    void listCameras().then(setCameras);
    return stream;
  }

  async function startWebcam() {
    setError("");
    setDemo(false);
    demoRef.current = false;
    engine.settings = { ...settings, demoShortDurations: false };
    setCamStatus("웹캠을 켜는 중…");
    setView("live");
    t0.current = performance.now();
    setSnap(engine.startSession(0, false));
    const modelTask = ensureModel();
    try {
      await openCamera();
      setCamStatus("");
      startLoop(false);
      await modelTask;
    } catch (e) {
      setCamStatus("");
      setView("start");
      setError(cameraErrorMessage(e));
    }
  }

  async function startDemo() {
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
      await openCamera();
      setCamStatus("");
    } catch {
      setCamStatus("웹캠을 열 수 없어 시연 데이터로 진행합니다. 권한을 허용하면 다시 시작해 주세요.");
    }
    engine.beginCalibration(0);
    startLoop(true);
    await modelTask;
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
            const liveReady = Boolean(v && landmarkerRef.current && v.readyState >= 2 && v.videoWidth > 0);
            if (liveReady && v && landmarkerRef.current) {
              const frame = detectPose(landmarkerRef.current, v, performance.now());
              points = frame.points;
              setSnap(engine.feed({ t, points: frame.points, poseCount: frame.poseCount }, frame.inferMs));
            } else if (isDemo) {
              const sim = simulatedPose(performance.now() - demoT0.current);
              points = sim.points;
              setSnap(engine.feed({ t, points: sim.points, poseCount: 1 }, 4));
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
          onRefreshCams={async () => setCameras(await listCameras())}
        />
      )}

      {view !== "start" && (
        <>
          <header className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div className="kicker">목격자 W.I.T · v{APP_VERSION}</div>
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
              <button type="button" onClick={() => setView("learning")}>
                학습 기록
              </button>
            </div>
          </header>
        </>
      )}

      {(view === "live" || view === "settings") && (
        <div style={{ display: view === "live" ? "block" : "none" }}>
          {demo && (
            <div className="banner-sim">시연 모드 · 웹캠 실시간 미리보기 · 단축 타이머 · 실측 기록과 섞지 않음</div>
          )}
          <p className="muted">
            노트북을 안정된 위치에 놓고 화면 각도를 고정해 주세요. 얼굴과 양쪽 어깨가 보이도록 앉은 뒤 기준
            자세를 등록하세요. 기준 등록은 7초입니다. 노트북 위치나 화면 각도를 바꾸면 재등록하세요.
          </p>
          <div className="live-grid">
            <div>
              <div className="monitor">
                <video ref={videoRef} playsInline muted autoPlay />
                <canvas ref={canvasRef} />
                <div className="guide-caption">얼굴과 양쪽 어깨가 안내선 안에 오게 앉으세요</div>
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
  onHistory: () => void;
  onRename: (name: string) => void;
  onCreate: () => void;
  onSwitch: (id: string) => void;
  onRefreshCams: () => void;
}) {
  return (
    <div>
      <p className="kicker">온디바이스 · 영상 외부 전송 없음</p>
      <h1>목격자 W.I.T</h1>
      <p className="kicker">v{APP_VERSION} · 노트북 웹캠 프로토타입</p>
      <p style={{ fontSize: "1.2rem" }}>당신의 자세 변화를 살피는 개인 코치</p>
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
      <div className="row" style={{ margin: "1rem 0" }}>
        <button type="button" className="primary" onClick={onWebcam}>
          웹캠 시작
        </button>
        <button type="button" onClick={onDemo}>
          데모 시작
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
      <p style={{ fontSize: "1.6rem", fontWeight: 700, letterSpacing: "0.04em", margin: "0.2rem 0" }}>{person.id}</p>
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
                <td>{(s.sessionMs / 1000).toFixed(1)}초</td>
                <td>시작부터 종료까지</td>
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
