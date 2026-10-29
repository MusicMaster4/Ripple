import {
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
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  LoaderCircle,
  LogOut,
  RotateCcw,
  SlidersHorizontal,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { authClient } from "./lib/auth";
import { loadSound, sound } from "./lib/audio";
import { RULES_VERSION, type Bounds } from "./game/engine";
import { GameCanvas, type GameResult, type GameStats } from "./game/GameCanvas";

type Panel = "settings" | "help" | "auth" | "privacy" | null;
type PendingRun = GameResult & { token: string };
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
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`wordmark ${small ? "small" : ""}`}>
      <svg viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <ellipse
          cx="18"
          cy="18"
          rx="15"
          ry="14"
          stroke="currentColor"
          strokeWidth=".8"
        />
        <ellipse
          cx="18"
          cy="18"
          rx="9"
          ry="9.5"
          stroke="currentColor"
          strokeWidth=".8"
        />
        <circle cx="18" cy="18" r="2.7" fill="currentColor" />
      </svg>
      ripple
    </span>
  );
}

function Modal({
  title,
  close,
  children,
  className = "",
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
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
      className={`modal ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-paper">
        <button
          className="icon-button modal-close"
          aria-label="Close"
          onClick={close}
        >
          <X size={19} />
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
    if (mode === "signup" && password !== data.get("confirm")) {
      setError("The passwords do not match.");
      return;
    }
    const name = String(data.get("name") || "").trim();
    if (mode === "signup" && name.length < 2) {
      setError("Use at least 2 characters for your name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result =
        mode === "signin"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name });
      if (result.error)
        setError(result.error.message || "Could not sign in. Try again.");
      else done();
    } catch {
      setError("Could not connect. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="modal-intro">
        A name for your ripples. A place on the board.
      </p>
      <form onSubmit={submit}>
        {mode === "signup" && (
          <label>
            Display name
            <input
              name="name"
              autoComplete="nickname"
              minLength={2}
              maxLength={24}
              required
              placeholder="Your name"
              autoFocus
            />
          </label>
        )}
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            placeholder="you@example.com"
            autoFocus={mode === "signin"}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            minLength={mode === "signup" ? 10 : 1}
            maxLength={128}
            required
            placeholder={
              mode === "signup" ? "At least 10 characters" : "Your password"
            }
          />
        </label>
        {mode === "signup" && (
          <label>
            Confirm password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              required
              placeholder="One more time"
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button solid full" type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : mode === "signin" ? (
            "Sign in"
          ) : (
            "Create account"
          )}
          {!busy && <ArrowRight size={16} />}
        </button>
      </form>
      <p className="auth-switch">
        {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError("");
          }}
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
      <p className="fine-print">
        Your name and best score appear on the board.
        <br />
        Your email stays private.
      </p>
    </>
  );
}

function Leaderboard({
  back,
  signIn,
  signOut,
}: {
  back: () => void;
  signIn: () => void;
  signOut: () => void;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const data = useQuery(api.leaderboard.board, isAuthenticated ? {} : "skip");
  return (
    <section className="leaderboard-page">
      <button className="text-button back-link" onClick={back}>
        <ArrowLeft size={16} />
        Back to the water
      </button>
      <div className="board-heading">
        <div>
          <h1>
            Lasting ripples<span>.</span>
          </h1>
          <p>A little movement. A little more time.</p>
        </div>
        <Trophy size={35} strokeWidth={1} />
      </div>
      {isLoading ? (
        <div className="board-empty">
          <LoaderCircle className="spin" />
          <p>Opening the board...</p>
        </div>
      ) : !isAuthenticated ? (
        <div className="board-empty">
          <div className="empty-rings">
            <span />
          </div>
          <h2>A place for your best.</h2>
          <p>
            Sign in to see the leaderboard
            <br />
            and leave your mark.
          </p>
          <button className="button solid" onClick={signIn}>
            Sign in
            <ArrowRight size={16} />
          </button>
        </div>
      ) : !data ? (
        <div className="board-empty">
          <LoaderCircle className="spin" />
          <p>Gathering ripples...</p>
        </div>
      ) : (
        <>
          {data.mine && (
            <div className="your-best">
              <span>Your personal best</span>
              <strong>{number(data.mine.score)}</strong>
            </div>
          )}
          <div className="score-table">
            <div className="table-row table-head">
              <span>Place</span>
              <span>Name</span>
              <span>Clicks</span>
              <span>Time</span>
              <span>Score</span>
            </div>
            {data.rows.length ? (
              data.rows.map((row, i) => (
                <div
                  className={`table-row ${row.isYou ? "is-you" : ""}`}
                  key={row.id}
                >
                  <span className="rank">{String(i + 1).padStart(2, "0")}</span>
                  <span className="player-name">
                    {row.name}
                    {row.isYou && <small>you</small>}
                  </span>
                  <span>{row.clicks}</span>
                  <span>
                    {(row.milliseconds / 1000).toFixed(3)}
                    <small>s</small>
                  </span>
                  <strong>{number(row.score)}</strong>
                </div>
              ))
            ) : (
              <div className="board-empty">
                <div className="empty-rings">
                  <span />
                </div>
                <h2>The water is still.</h2>
                <p>Play a round. Set the first score.</p>
                <button className="button" onClick={back}>
                  Make a ripple
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
          <div className="board-footer">
            <span>Best score per player &middot; Top 100</span>
            <button className="text-button" onClick={signOut}>
              Sign out
              <LogOut size={14} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default function App() {
  const [view, setView] = useState(() =>
    location.pathname === "/leaderboard" ? "leaderboard" : "game",
  );
  const [panel, setPanel] = useState<Panel>(null);
  const [resetKey, setResetKey] = useState(0);
  const [stats, setStats] = useState<GameStats>({
    score: 0,
    clicks: 0,
    time: 0,
    phase: "idle",
  });
  const [result, setResult] = useState<GameResult | null>(null);
  const [best, setBest] = useState(readBest);
  const [audioSettings, setAudioSettings] = useState(loadSound);
  const [track, setTrack] = useState(sound.trackName);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const [saveError, setSaveError] = useState("");
  const [pending, setPending] = useState<PendingRun | null>(null);
  const { isAuthenticated } = useConvexAuth();
  const session = authClient.useSession();
  const begin = useMutation(api.leaderboard.begin);
  const submit = useMutation(api.leaderboard.submit);
  const token = useRef("");
  const ticket = useRef<Promise<unknown> | null>(null);
  const interrupt = useRef<() => void>(() => {});
  const saving = useRef<string | null>(null);
  useEffect(() => {
    sound.configure(audioSettings);
    try {
      localStorage.setItem("ripple:sound", JSON.stringify(audioSettings));
    } catch {
      /* Storage is optional. */
    }
  }, [audioSettings]);
  useEffect(() => {
    sound.onTrack = setTrack;
    void sound.preload();
    return () => {
      sound.onTrack = undefined;
      sound.stop();
    };
  }, []);
  useEffect(() => {
    const pop = () => {
      interrupt.current();
      setPanel(null);
      setView(location.pathname === "/leaderboard" ? "leaderboard" : "game");
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
  const navigate = (next: string) => {
    interrupt.current();
    setPanel(null);
    setView(next);
    history.pushState({}, "", next === "game" ? "/" : "/leaderboard");
  };
  const openPanel = (next: Panel) => {
    interrupt.current();
    setPanel(next);
  };
  const start = (bounds: Bounds) => {
    token.current = crypto.randomUUID();
    ticket.current = begin({ token: token.current, ...bounds }).catch(
      () => null,
    );
    setResult(null);
    setPending(null);
    setSaveStatus("idle");
  };
  const finish = (r: GameResult) => {
    setResult(r);
    if (r.score > best && !r.interrupted) {
      setBest(r.score);
      try {
        localStorage.setItem(`ripple:best:v${RULES_VERSION}`, String(r.score));
      } catch {
        /* Storage is optional. */
      }
    }
    if (!r.interrupted) setPending({ ...r, token: token.current });
  };
  const save = async () => {
    if (!pending || !isAuthenticated || saving.current === pending.token)
      return;
    const savingToken = pending.token;
    saving.current = savingToken;
    setSaveStatus("saving");
    setSaveError("");
    try {
      await ticket.current;
      await submit({ token: pending.token, moves: pending.moves });
      if (token.current === savingToken) setSaveStatus("saved");
    } catch {
      if (token.current === savingToken) {
        setSaveStatus("failed");
        setSaveError(
          "Could not save this run. Check your connection or play again.",
        );
      }
    } finally {
      if (saving.current === savingToken) saving.current = null;
    }
  };
  useEffect(() => {
    if (pending && isAuthenticated && saveStatus === "idle") void save();
  }, [pending, isAuthenticated, saveStatus]);
  const reset = () => {
    token.current = "";
    setResult(null);
    setStats({ score: 0, clicks: 0, time: 0, phase: "idle" });
    setResetKey((k) => k + 1);
    setPending(null);
    setSaveStatus("idle");
  };
  const closePanel = () => {
    if (panel === "settings") sound.stop();
    setPanel(null);
  };
  const signOut = async () => {
    await authClient.signOut();
    setPanel(null);
  };
  return (
    <div className="app-shell">
      <header className="site-header">
        <button
          className="brand-button"
          onClick={() => navigate("game")}
          aria-label="Ripple home"
        >
          <Logo />
        </button>
        <nav>
          <button
            className={`nav-link ${view === "leaderboard" ? "active" : ""}`}
            onClick={() => navigate(view === "game" ? "leaderboard" : "game")}
          >
            {view === "game" ? (
              <>
                <Trophy size={16} strokeWidth={1.4} />
                Leaderboard
                <ArrowUpRight size={14} />
              </>
            ) : (
              <>
                Play
                <ArrowUpRight size={15} />
              </>
            )}
          </button>
          {session.data && (
            <button
              className="account-button"
              onClick={() => navigate("leaderboard")}
              aria-label="Your leaderboard"
            >
              {session.data.user.name.slice(0, 1).toUpperCase()}
            </button>
          )}
        </nav>
      </header>
      <main>
        {view === "leaderboard" ? (
          <Leaderboard
            back={() => navigate("game")}
            signIn={() => setPanel("auth")}
            signOut={() => void signOut()}
          />
        ) : (
          <>
            <div
              className={`game-wrap ${stats.phase === "playing" ? "is-playing" : ""}`}
            >
              <div className="game-topline">
                <div className="score-display">
                  <span className="metric-label">Score</span>
                  <strong>{number(stats.score)}</strong>
                </div>
                <div className="run-details">
                  <span>
                    {stats.clicks}
                    <small>clicks</small>
                  </span>
                  <i>&times;</i>
                  <span>
                    {(stats.time / 1000).toFixed(3)}
                    <small>seconds</small>
                  </span>
                </div>
              </div>
              <div
                className={`arena ${stats.phase === "over" ? "finished" : ""}`}
              >
                <GameCanvas
                  resetKey={resetKey}
                  blocked={panel !== null}
                  onStart={start}
                  onEnd={finish}
                  onStats={setStats}
                  onReady={(fn) => {
                    interrupt.current = fn;
                  }}
                />
                {stats.phase === "idle" && (
                  <div className="intro" aria-hidden="true">
                    <h1>
                      ripple<span>.</span>
                    </h1>
                    <p>Every move comes back.</p>
                    <span className="begin-hint">
                      <span />
                      Click anywhere to begin
                    </span>
                  </div>
                )}
                {result && (
                  <div
                    className="result-overlay"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="result-card">
                      <span className="result-mark">
                        <svg viewBox="0 0 50 50" fill="none">
                          <ellipse
                            cx="25"
                            cy="25"
                            rx="21"
                            ry="20"
                            stroke="currentColor"
                            strokeWidth=".7"
                          />
                          <ellipse
                            cx="25"
                            cy="25"
                            rx="12"
                            ry="13"
                            stroke="currentColor"
                            strokeWidth=".7"
                          />
                          <circle cx="25" cy="25" r="3" fill="currentColor" />
                        </svg>
                      </span>
                      <h2>
                        {result.interrupted
                          ? "A moment of stillness."
                          : "It all comes back."}
                      </h2>
                      <strong className="final-score">
                        {number(result.score)}
                      </strong>
                      <p className="result-equation">
                        {result.clicks} clicks <span>&times;</span>{" "}
                        {(result.milliseconds / 1000).toFixed(3)} seconds
                      </p>
                      <button className="button solid" onClick={reset}>
                        <RotateCcw size={15} />
                        Another ripple
                      </button>
                      {!result.interrupted &&
                        (isAuthenticated ? (
                          <div className="save-message">
                            {saveStatus === "saving" ? (
                              <>
                                <LoaderCircle size={13} className="spin" />
                                Saving score...
                              </>
                            ) : saveStatus === "saved" ? (
                              <>
                                <Check size={14} />
                                Your best is on the board.
                              </>
                            ) : saveStatus === "failed" ? (
                              <button
                                className="text-button"
                                onClick={() => void save()}
                              >
                                Try saving again
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <button
                            className="text-button save-link"
                            onClick={() => setPanel("auth")}
                          >
                            Sign in to save your score
                            <ChevronRight size={14} />
                          </button>
                        ))}
                      {saveError && (
                        <p className="save-error" role="alert">
                          {saveError}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="game-bottomline">
                <span className="how-to">Click to move. Avoid your waves.</span>
                <span className="personal-best">
                  Best <strong>{number(best)}</strong>
                </span>
              </div>
            </div>
            <div className="below-game">
              <span></span>
              <div className="tools">
                <button
                  className="icon-button"
                  aria-label="How to play"
                  title="How to play"
                  onClick={() => openPanel("help")}
                >
                  <CircleHelp size={18} strokeWidth={1.4} />
                </button>
                <button
                  className="icon-button"
                  aria-label={
                    audioSettings.muted ? "Unmute sound" : "Mute sound"
                  }
                  title="Mute sound (M)"
                  onClick={() => {
                    void sound.unlock();
                    setAudioSettings((s) => ({ ...s, muted: !s.muted }));
                  }}
                >
                  {audioSettings.muted ? (
                    <VolumeX size={18} strokeWidth={1.4} />
                  ) : (
                    <Volume2 size={18} strokeWidth={1.4} />
                  )}
                </button>
                <button
                  className="icon-button"
                  aria-label="Sound settings"
                  title="Sound settings"
                  onClick={() => openPanel("settings")}
                >
                  <SlidersHorizontal size={18} strokeWidth={1.4} />
                </button>
              </div>
            </div>
          </>
        )}
      </main>
      <footer className="site-footer">
        <span>A small game of cause & effect.</span>
        <div>
          <a
            href="https://github.com/MusicMaster4/Ripple"
            target="_blank"
            rel="noreferrer"
          >
            Source
            <ArrowUpRight size={11} />
          </a>
          <button className="text-button" onClick={() => openPanel("privacy")}>
            Privacy
          </button>
        </div>
      </footer>
      {panel === "auth" && (
        <Modal title="Leave a ripple." close={closePanel}>
          <AuthForm done={() => setPanel(null)} />
        </Modal>
      )}
      {panel === "settings" && (
        <Modal
          title="A quieter kind of play."
          close={closePanel}
          className="settings-modal"
        >
          <p className="modal-intro">Find your own balance.</p>
          <div className="sound-control">
            <label htmlFor="music">
              Music<span>{Math.round(audioSettings.music * 100)}%</span>
            </label>
            <input
              id="music"
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
          </div>
          <div className="sound-control">
            <label htmlFor="effects">
              Water & effects
              <span>{Math.round(audioSettings.effects * 100)}%</span>
            </label>
            <input
              id="effects"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={audioSettings.effects}
              onChange={(e) => {
                void sound.unlock();
                setAudioSettings((s) => ({
                  ...s,
                  effects: Number(e.target.value),
                  muted: false,
                }));
                sound.drip();
              }}
            />
          </div>
          <div className="now-playing">
            <span className="music-dot" />
            <div>
              <span>{track}</span>
              <small>3 tracks &middot; on repeat</small>
            </div>
            <button
              className="icon-button"
              aria-label={audioSettings.muted ? "Unmute sound" : "Mute sound"}
              onClick={() =>
                setAudioSettings((s) => ({ ...s, muted: !s.muted }))
              }
            >
              {audioSettings.muted ? (
                <VolumeX size={17} />
              ) : (
                <Volume2 size={17} />
              )}
            </button>
          </div>
        </Modal>
      )}
      {panel === "help" && (
        <Modal title="Every move comes back." close={closePanel}>
          <div className="help-illustration">
            <span />
            <span />
            <b />
          </div>
          <div className="help-copy">
            <p>Click anywhere to begin. Click again to move.</p>
            <p>
              Every click leaves a wave. Waves reflect off the edges. Touch one,
              and your round ends.
            </p>
            <p>Clicks &times; seconds = your score.</p>
            <small>
              Tap to move. Arrow keys aim; Enter moves. M to mute.
              <br />
              Leaving the tab, resizing, or opening a panel ends your round.
            </small>
          </div>
          <button className="button solid full" onClick={() => setPanel(null)}>
            Let it ripple
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {panel === "privacy" && (
        <Modal title="A little privacy." close={closePanel}>
          <div className="privacy-copy">
            <p>You can play without an account.</p>
            <p>
              If you join the leaderboard, Convex and Better Auth store your
              email, display name, password hash, and session. Only your display
              name and best score are shown to other signed-in players.
            </p>
            <p>
              Sound preferences and your local best are stored in this browser.
              Run tickets expire after 24 hours. There are no analytics or
              advertising cookies.
            </p>
            <p>Email addresses are not verified.</p>
            <p>
              For account deletion, contact the maintainer through the{" "}
              <a
                href="https://github.com/MusicMaster4/Ripple/issues"
                target="_blank"
                rel="noreferrer"
              >
                repository
              </a>
              .
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
