import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { authClient } from "./lib/auth";
import { loadSound, sound } from "./lib/audio";
import {
  MAX_DURATION,
  RULES_VERSION,
  validateBounds,
  type Arena,
} from "./game/engine";
import { validateSeed } from "./game/arena";
import { GameCanvas, type GameResult, type GameStats } from "./game/GameCanvas";
import { LineField } from "./components/LineField";
import { grainTexture } from "./game/ink";
import { DotCursor } from "./components/DotCursor";

type Screen = "menu" | "game" | "board";
type Panel = "sound" | "auth" | null;
type PendingRun = GameResult & { token: string };
const PENDING_KEY = `ripple:pending:v${RULES_VERSION}`;
const number = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
function readBest() {
  try {
    const n = Number(localStorage.getItem(`ripple:best:v${RULES_VERSION}`));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
/** A finished run waiting for sign-in survives reloads within the tab. */
function readPending(): PendingRun | null {
  try {
    const run = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
    if (
      !run ||
      typeof run.token !== "string" ||
      !/^[0-9a-f-]{36}$/.test(run.token) ||
      !Array.isArray(run.moves) ||
      run.moves.length < 1 ||
      run.moves.length > 2251 ||
      run.clicks !== run.moves.length ||
      run.interrupted !== false ||
      !Number.isFinite(run.score) ||
      run.score < 0 ||
      !Number.isFinite(run.milliseconds) ||
      run.milliseconds < 0 ||
      run.milliseconds > MAX_DURATION ||
      !run.moves.every(
        (m: { x: number; y: number; t: number }) =>
          m &&
          Number.isFinite(m.x) &&
          Number.isFinite(m.y) &&
          Number.isFinite(m.t),
      )
    )
      return null;
    validateBounds(run.bounds);
    validateSeed(run.bounds.seed);
    return run;
  } catch {
    return null;
  }
}
function writePending(run: PendingRun | null) {
  try {
    if (run) sessionStorage.setItem(PENDING_KEY, JSON.stringify(run));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* Storage is optional. */
  }
}
const screenFromPath = (): Screen =>
  location.pathname === "/leaderboard" ? "board" : "menu";

/** SVG filters that roughen edges like ink bleeding into cheap paper. */
function InkFilters() {
  return (
    <svg className="ink-filters" aria-hidden="true" focusable="false">
      <filter id="ink-bleed" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves="2"
          seed="4"
        />
        <feDisplacementMap in="SourceGraphic" scale="2.4" />
      </filter>
      <filter id="ink-torn" x="-5%" y="-10%" width="110%" height="120%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.035 0.6"
          numOctaves="3"
          seed="9"
        />
        <feDisplacementMap in="SourceGraphic" scale="7" />
      </filter>
    </svg>
  );
}

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      prev?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-sheet">
        <button
          className="icon-button modal-close"
          aria-label="Close"
          onClick={close}
        >
          <X size={20} strokeWidth={1.6} />
        </button>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}

function AuthForm({ done }: { done: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email")).trim();
    const password = String(data.get("password"));
    const name = String(data.get("name") || "").trim();
    if (mode === "signup" && name.length < 2) {
      setError("Name: 2+ characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result =
        mode === "signin"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name });
      if (result.error) setError(result.error.message || "Try again.");
      else done();
    } catch {
      setError("No connection.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form onSubmit={submit} className="auth-form">
        {mode === "signup" && (
          <input
            name="name"
            aria-label="Display name"
            autoComplete="nickname"
            minLength={2}
            maxLength={24}
            required
            placeholder="name"
            autoFocus
          />
        )}
        <input
          name="email"
          type="email"
          aria-label="Email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="email"
          autoFocus={mode === "signin"}
        />
        <input
          name="password"
          type="password"
          aria-label="Password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 10 : 1}
          maxLength={128}
          required
          placeholder={mode === "signup" ? "password (10+)" : "password"}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="ink-button" type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={20} />
          ) : mode === "signin" ? (
            "Sign in"
          ) : (
            "Join"
          )}
        </button>
      </form>
      <button
        className="quiet-button auth-switch"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError("");
        }}
      >
        {mode === "signin" ? "New? Join" : "Have an account? Sign in"}
      </button>
      <details className="fine-print">
        <summary>Privacy</summary>
        <p>
          Your name and best score are shown to signed-in players. Email,
          password hash, and session are stored with Convex and Better Auth.
          Emails are not verified or shown. No analytics, no ads. For account
          deletion, open an issue on{" "}
          <a
            href="https://github.com/MusicMaster4/Ripple/issues"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          .
        </p>
      </details>
    </>
  );
}

function Leaderboard({
  back,
  signIn,
  signOut,
  saveNotice,
}: {
  back: () => void;
  signIn: () => void;
  signOut: () => void;
  saveNotice: ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const data = useQuery(api.leaderboard.board, isAuthenticated ? {} : "skip");
  return (
    <section className="board">
      <button
        className="icon-button board-back"
        aria-label="Back"
        onClick={back}
      >
        <ArrowLeft size={26} strokeWidth={1.5} />
      </button>
      <h1 className="board-title">Leaderboard</h1>
      {saveNotice}
      {isLoading || (isAuthenticated && !data) ? (
        <div className="board-empty">
          <LoaderCircle className="spin" size={26} />
        </div>
      ) : !isAuthenticated ? (
        <div className="board-empty">
          <button className="ink-button big" onClick={signIn}>
            Sign in
          </button>
        </div>
      ) : data && data.rows.length ? (
        <>
          <ol className="board-rows">
            {data.rows.map((row, i) => (
              <li key={row.id} className={row.isYou ? "is-you" : ""}>
                <span className="rank">{i + 1}</span>
                <span className="name">{row.name}</span>
                <span
                  className="score"
                  title={`${row.clicks} × ${(row.milliseconds / 1000).toFixed(3)}s`}
                >
                  {number(row.score)}
                </span>
              </li>
            ))}
          </ol>
          <button className="quiet-button board-signout" onClick={signOut}>
            Sign out
          </button>
        </>
      ) : (
        <div className="board-empty">
          <p>Still water.</p>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    screenFromPath() === "menu" && readPending() ? "game" : screenFromPath(),
  );
  const [panel, setPanel] = useState<Panel>(null);
  const [resetKey, setResetKey] = useState(0);
  const [stats, setStats] = useState<GameStats>({
    score: 0,
    clicks: 0,
    time: 0,
    phase: "idle",
  });
  const [pending, setPending] = useState<PendingRun | null>(readPending);
  const [result, setResult] = useState<GameResult | null>(pending);
  // A run restored after a reload has no canvas behind it.
  const [restored, setRestored] = useState(pending !== null);
  const [best, setBest] = useState(readBest);
  const [newBest, setNewBest] = useState(false);
  const [audioSettings, setAudioSettings] = useState(loadSound);
  // Clicks still landing as the round ends must not hit the death screen.
  const [deathReady, setDeathReady] = useState(pending !== null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const [saveError, setSaveError] = useState("");
  const { isAuthenticated } = useConvexAuth();
  const begin = useMutation(api.leaderboard.begin);
  const submit = useMutation(api.leaderboard.submit);
  const token = useRef(pending?.token ?? "");
  const ticket = useRef<Promise<unknown> | null>(null);
  const interrupt = useRef<() => void>(() => {});
  const saving = useRef<string | null>(null);
  const canvasHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sound.configure(audioSettings);
    try {
      localStorage.setItem("ripple:sound:v2", JSON.stringify(audioSettings));
    } catch {
      /* Storage is optional. */
    }
  }, [audioSettings]);
  useEffect(() => {
    void sound.preload();
    document.documentElement.style.setProperty(
      "--grain",
      `url("${grainTexture()}")`,
    );
    return () => {
      sound.stop();
    };
  }, []);
  useEffect(() => {
    if (!result) return setDeathReady(false);
    if (restored) return setDeathReady(true);
    const timer = setTimeout(() => setDeathReady(true), 1100);
    return () => clearTimeout(timer);
  }, [result, restored]);
  useEffect(() => {
    const pop = () => {
      interrupt.current();
      setPanel(null);
      setScreen(screenFromPath());
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.matches("input,textarea") ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key.toLowerCase() === "m")
        setAudioSettings((s) => ({ ...s, muted: !s.muted }));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const go = (next: Screen) => {
    interrupt.current();
    setPanel(null);
    setScreen(next);
    const path = next === "board" ? "/leaderboard" : "/";
    if (location.pathname !== path) history.pushState({}, "", path);
  };
  const reset = () => {
    token.current = "";
    setResult(null);
    setRestored(false);
    setNewBest(false);
    setStats({ score: 0, clicks: 0, time: 0, phase: "idle" });
    setResetKey((k) => k + 1);
    setPending(null);
    writePending(null);
    setSaveStatus("idle");
  };
  const play = () => {
    reset();
    go("game");
    requestAnimationFrame(() =>
      canvasHost.current
        ?.querySelector("canvas")
        ?.focus({ preventScroll: true }),
    );
  };
  const start = (bounds: Arena) => {
    token.current = crypto.randomUUID();
    ticket.current = begin({ token: token.current, ...bounds }).catch(
      () => null,
    );
    setResult(null);
    setPending(null);
    writePending(null);
    setSaveStatus("idle");
  };
  const finish = (r: GameResult) => {
    setResult(r);
    if (r.score > best && !r.interrupted) {
      setBest(r.score);
      setNewBest(true);
      try {
        localStorage.setItem(`ripple:best:v${RULES_VERSION}`, String(r.score));
      } catch {
        /* Storage is optional. */
      }
    }
    if (!r.interrupted && r.clicks > 0) {
      const run = { ...r, token: token.current };
      setPending(run);
      // Kept until it's saved, so signing in first never loses the run.
      writePending(run);
    }
  };
  const save = useCallback(async () => {
    if (!pending || saving.current === pending.token) return;
    const savingToken = pending.token;
    saving.current = savingToken;
    setSaveStatus("saving");
    setSaveError("");
    // Right after sign-in the backend can briefly lag the new session.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await ticket.current;
        await submit({ token: pending.token, moves: pending.moves });
        if (readPending()?.token === savingToken) writePending(null);
        if (token.current === savingToken) setSaveStatus("saved");
        if (saving.current === savingToken) saving.current = null;
        return;
      } catch (error) {
        const auth = String((error as Error)?.message).includes("Sign in");
        if (!auth || attempt === 3) {
          if (token.current === savingToken)
            setSaveError(
              String((error as Error)?.message).includes("expired")
                ? "Run expired. Play again."
                : "Could not save. Try again.",
            );
          break;
        }
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    if (token.current === savingToken) setSaveStatus("failed");
    if (saving.current === savingToken) saving.current = null;
  }, [pending, submit]);
  useEffect(() => {
    if (pending && isAuthenticated && saveStatus === "idle") void save();
  }, [pending, isAuthenticated, saveStatus, save]);
  const signOut = async () => {
    await authClient.signOut();
    setPanel(null);
  };

  const playing = screen === "game" && stats.phase === "playing";
  const ready = screen === "game" && stats.phase === "idle" && !result;
  const dead = screen === "game" && result !== null;
  const muted =
    audioSettings.muted ||
    (audioSettings.effects === 0 && audioSettings.music === 0);

  return (
    <div className={`app screen-${screen} ${playing ? "is-playing" : ""}`}>
      <DotCursor playing={playing} />
      <InkFilters />
      <div className="stage" ref={canvasHost}>
        <GameCanvas
          resetKey={resetKey}
          blocked={screen !== "game" || panel !== null || result !== null}
          onStart={start}
          onEnd={finish}
          onStats={setStats}
          onReady={(fn) => {
            interrupt.current = fn;
          }}
        />
      </div>

      {screen === "menu" && (
        <section className="menu">
          <LineField title="RIPPLE" />
          <h1 className="sr-only">Ripple</h1>
          <nav className="menu-actions">
            <button className="ink-button huge" onClick={play}>
              Play
            </button>
            <button
              className="quiet-button menu-board"
              onClick={() => go("board")}
            >
              Leaderboard
            </button>
          </nav>
        </section>
      )}

      {ready && (
        <p className="ready-hint" aria-live="polite">
          click an open space
        </p>
      )}

      {playing && (
        <output className="live-score" aria-live="off">
          {number(stats.score)}
        </output>
      )}

      {dead && result && (
        <section
          className={`death ${restored ? "restored" : ""} ${deathReady ? "ready" : ""}`}
          role="status"
          aria-live="polite"
        >
          <strong className="death-score">{number(result.score)}</strong>
          <p className="death-equation">
            {(result.milliseconds / 1000).toFixed(3)}s
            {newBest && <em className="tag">best</em>}
          </p>
          <div className="death-actions">
            <button
              className="ink-button huge"
              onClick={play}
              disabled={!deathReady}
            >
              Again
            </button>
            <button className="quiet-button" onClick={() => go("board")}>
              Leaderboard
            </button>
          </div>
          {!result.interrupted && pending && (
            <div className="save-line">
              {!isAuthenticated ? (
                <button
                  className="quiet-button underline"
                  onClick={() => setPanel("auth")}
                >
                  Save score
                </button>
              ) : saveStatus === "saving" || saveStatus === "idle" ? (
                <LoaderCircle className="spin" size={18} aria-label="Saving" />
              ) : saveStatus === "saved" ? (
                <span className="saved">
                  <Check size={18} strokeWidth={2} /> saved
                </span>
              ) : (
                <button
                  className="quiet-button underline"
                  onClick={() => {
                    setSaveStatus("idle");
                  }}
                >
                  Retry save
                </button>
              )}
            </div>
          )}
          {saveStatus === "failed" && (
            <p className="save-error" role="alert">
              {saveError}
            </p>
          )}
          <button
            className="quiet-button death-menu"
            onClick={() => go("menu")}
          >
            Menu
          </button>
        </section>
      )}

      {screen === "board" && (
        <>
          <LineField strength={0.35} interactive={false} />
          <Leaderboard
            back={() => (result ? go("game") : go("menu"))}
            signIn={() => setPanel("auth")}
            signOut={() => void signOut()}
            saveNotice={
              pending && isAuthenticated ? (
                <div className="board-save" role="status">
                  {saveStatus === "saved" ? (
                    <span className="saved">
                      <Check size={16} /> saved
                    </span>
                  ) : saveStatus === "failed" ? (
                    <>
                      <p>{saveError}</p>
                      <button
                        className="quiet-button underline"
                        onClick={() => setSaveStatus("idle")}
                      >
                        Retry save
                      </button>
                    </>
                  ) : (
                    <LoaderCircle
                      className="spin"
                      size={18}
                      aria-label="Saving score"
                    />
                  )}
                </div>
              ) : null
            }
          />
        </>
      )}

      {!playing && !ready && (
        <button
          className="icon-button sound-toggle"
          aria-label="Sound"
          onClick={() => {
            void sound.unlock();
            setPanel("sound");
          }}
        >
          {muted ? (
            <VolumeX size={22} strokeWidth={1.5} />
          ) : (
            <Volume2 size={22} strokeWidth={1.5} />
          )}
        </button>
      )}

      {panel === "auth" && (
        <Modal
          title={pending ? "Save score" : "Sign in"}
          close={() => setPanel(null)}
        >
          <AuthForm
            done={() => {
              setPanel(null);
              if (pending) go("board");
            }}
          />
        </Modal>
      )}
      {panel === "sound" && (
        <Modal
          title="Sound"
          close={() => {
            sound.stop();
            setPanel(null);
          }}
        >
          <div className="sliders">
            <label>
              <span>Music</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={audioSettings.music}
                onChange={(e) => {
                  void sound.start();
                  setAudioSettings((s) => ({
                    ...s,
                    music: Number(e.target.value),
                    muted: false,
                  }));
                }}
              />
            </label>
            <label>
              <span>Water</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={audioSettings.effects}
                onChange={(e) => {
                  setAudioSettings((s) => ({
                    ...s,
                    effects: Number(e.target.value),
                    muted: false,
                  }));
                }}
                onPointerUp={() => void sound.drip()}
                onKeyUp={() => void sound.drip()}
              />
            </label>
          </div>
          <button
            className="quiet-button underline"
            onClick={() => setAudioSettings((s) => ({ ...s, muted: !s.muted }))}
          >
            {audioSettings.muted ? "Unmute" : "Mute"}
          </button>
        </Modal>
      )}
    </div>
  );
}
