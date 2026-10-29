import { DropPool } from "./drop-pool";
export type SoundSettings = { music: number; effects: number; muted: boolean };
const defaults: SoundSettings = { music: 0.24, effects: 0.45, muted: false };
export function loadSound(): SoundSettings {
  try {
    const s = JSON.parse(localStorage.getItem("ripple:sound") || "{}");
    return {
      music: Number.isFinite(s.music)
        ? Math.max(0, Math.min(1, s.music))
        : defaults.music,
      effects: Number.isFinite(s.effects)
        ? Math.max(0, Math.min(1, s.effects))
        : defaults.effects,
      muted: s.muted === true,
    };
  } catch {
    return defaults;
  }
}
const playlist = [
  { name: "Nostalgic Morning", url: "/audio/nostalgic-morning.mp3" },
  { name: "Nostalgic Echoes", url: "/audio/nostalgic-echoes.mp3" },
  { name: "Cozy Drift", url: "/audio/cozy-drift.mp3" },
];

class RippleAudio {
  context?: AudioContext;
  music?: GainNode;
  effects?: GainNode;
  water?: GainNode;
  audio?: HTMLAudioElement;
  settings = defaults;
  playing = false;
  track = 0;
  private pool = new DropPool(64);
  private rawDrops?: Promise<(ArrayBuffer | null)[]>;
  private drops: (AudioBuffer | null)[] = [];
  private loading?: Promise<void>;
  private rumbleRaw?: Promise<ArrayBuffer | null>;
  onTrack?: (name: string) => void;
  get trackName() {
    return playlist[this.track].name;
  }

  preload() {
    this.rawDrops ??= Promise.all(
      Array.from({ length: 64 }, async (_, i) => {
        try {
          const response = await fetch(
            `/audio/drops/drop-${String(i + 1).padStart(2, "0")}.wav`,
          );
          return response.ok ? await response.arrayBuffer() : null;
        } catch {
          return null;
        }
      }),
    );
    this.rumbleRaw ??= fetch("/audio/water-rumble.wav")
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    return this.rawDrops;
  }
  async unlock() {
    try {
      if (!this.context) {
        const ctx = new AudioContext();
        this.context = ctx;
        this.music = ctx.createGain();
        this.music.gain.value = 0;
        this.music.connect(ctx.destination);
        this.effects = ctx.createGain();
        this.effects.connect(ctx.destination);
        this.audio = new Audio(playlist[this.track].url);
        this.audio.preload = "auto";
        ctx.createMediaElementSource(this.audio).connect(this.music);
        this.audio.addEventListener("ended", () => {
          this.track = (this.track + 1) % playlist.length;
          this.audio!.src = playlist[this.track].url;
          this.onTrack?.(this.trackName);
          if (this.playing) void this.audio!.play().catch(() => {});
        });
        this.water = ctx.createGain();
        this.water.gain.value = 0;
        this.water.connect(this.effects);
      }
      if (!this.loading) {
        this.loading = (async () => {
          const raw = await this.preload();
          this.drops = await Promise.all(
            raw.map(async (data) => {
              try {
                return data ? await this.context!.decodeAudioData(data) : null;
              } catch {
                return null;
              }
            }),
          );
          const rawWater = await this.rumbleRaw;
          if (rawWater && this.context) {
            try {
              const buffer = await this.context.decodeAudioData(rawWater);
              const source = this.context.createBufferSource();
              source.buffer = buffer;
              source.loop = true;
              source.connect(this.water!);
              source.start();
            } catch {
              /* Failed samples stay silent; never replace them with generated sound. */
            }
          }
        })();
      }
      if (this.context.state === "suspended") await this.context.resume();
      this.apply();
    } catch {
      /* An unavailable audio device must never prevent a round. */
    }
  }

  configure(settings: SoundSettings) {
    this.settings = settings;
    this.apply();
  }
  private apply() {
    if (!this.context) return;
    const at = this.context.currentTime;
    this.music?.gain.setTargetAtTime(
      this.playing && !this.settings.muted ? this.settings.music * 0.52 : 0,
      at,
      0.3,
    );
    this.effects?.gain.setTargetAtTime(
      this.settings.muted ? 0 : this.settings.effects,
      at,
      0.08,
    );
    this.water?.gain.setTargetAtTime(this.playing ? 0.32 : 0, at, 0.8);
  }
  async start() {
    this.playing = true;
    await this.unlock();
    if (this.playing) void this.audio?.play().catch(() => {});
    this.apply();
  }
  stop() {
    this.playing = false;
    this.apply();
    const current = this.audio;
    setTimeout(() => {
      if (!this.playing) current?.pause();
    }, 1300);
  }
  async drip(x = 0.5, end = false) {
    const index = this.pool.next();
    await this.unlock();
    await this.loading;
    const ctx = this.context;
    const buffer = this.drops[index];
    if (!ctx || !this.effects || !buffer || ctx.state !== "running") return;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (x - 0.5) * 0.75;
    pan.connect(this.effects);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = end ? 0.32 : 0.6;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = end ? 750 : 8500;
    source.connect(low).connect(gain).connect(pan);
    source.start();
    source.onended = () => {
      source.disconnect();
      low.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
  }
}
export const sound = new RippleAudio();
