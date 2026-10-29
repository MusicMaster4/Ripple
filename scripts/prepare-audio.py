"""Prepare recorded CC0 water assets. Requires Python, NumPy, SciPy, and FFmpeg.

No synthesis, generated noise, oscillators, pitch shifting, reverb, or AI audio is used.
Every shipped file is a single contiguous cut of one real recording; processing is
limited to mono conversion, resampling, filtering, level matching, and fades.
Original recordings are cached in ignored .research/audio; only game excerpts ship.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import urllib.request
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, find_peaks, sosfilt, sosfiltfilt, stft

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.research' / 'audio'
OUTPUT = ROOT / 'public' / 'audio'
CACHE.mkdir(parents=True, exist_ok=True)
(OUTPUT / 'drops').mkdir(parents=True, exist_ok=True)
RATE = 44100          # droplets and sink sounds keep their natural high end
RUMBLE_RATE = 22050   # the low rumble loop needs no more bandwidth
HOP = 88              # 2 ms analysis frames
BANK_SIZE = 24
SOURCES = [
    # role 'drop': each isolated bubble pinch-off rings at its Minnaert resonance,
    # the same physical mechanism as a droplet's "plop" into still water.
    {'id': 3560, 'name': 'Fermentation airlock #1', 'slug': 'fermentation-airlock-1', 'role': 'drop', 'author': 'Joseph Sardin', 'equipment': 'SoundDevices MixPre-3 + Neumann KM184'},
    {'id': 3561, 'name': 'Fermentation airlock #2', 'slug': 'fermentation-airlock-2', 'role': 'drop', 'author': 'Joseph Sardin', 'equipment': 'SoundDevices MixPre-3 + Neumann KM184'},
    {'id': 3562, 'name': 'Fermentation airlock #3', 'slug': 'fermentation-airlock-3', 'role': 'drop', 'author': 'Joseph Sardin', 'equipment': 'SoundDevices MixPre-3 + Neumann KM184'},
    # role 'sink': a hydrophone plunged into water, recorded from below the surface.
    {'id': 3427, 'name': 'Water Blop #1', 'slug': 'water-blop-1', 'role': 'sink', 'file': 'sink-1.wav', 'author': 'Joseph Sardin', 'equipment': 'SoundDevices MixPre-3 + Hydrophone'},
    {'id': 3428, 'name': 'Water Blop #2', 'slug': 'water-blop-2', 'role': 'sink', 'file': 'sink-2.wav', 'author': 'Joseph Sardin', 'equipment': 'SoundDevices MixPre-3 + Hydrophone'},
    {'id': 3430, 'name': 'Underwater', 'slug': 'underwater', 'role': 'rumble', 'author': 'Joseph Sardin & Axeline T.', 'equipment': 'SoundDevices MixPre-3 + Hydrophone'},
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(source, rate):
    original = CACHE / f"source-{source['id']}.wav"
    source['url'] = f"https://bigsoundbank.com/{source['slug']}-s{source['id']:04d}.html"
    source['download'] = f"https://bigsoundbank.com/UPLOAD/bwf-en/{source['id']}.wav"
    if not original.exists():
        urllib.request.urlretrieve(source['download'], original)
    if original.read_bytes()[:4] != b'RIFF':
        raise ValueError('Source download is not a WAV recording')
    source['sha256'] = sha(original)
    # The rumble has always been decoded through 16-bit PCM; keep that so it stays byte-identical.
    fmt, dtype, scale = ('s16le', '<i2', 32768) if source['role'] == 'rumble' else ('f32le', '<f4', 1)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(original), '-ac', '1', '-ar', str(rate), '-f', fmt, '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=dtype).astype(np.float64) / scale


def write(path, samples, rate=RATE):
    wavfile.write(path, rate, np.round(np.clip(samples, -.999, .999) * 32767).astype(np.int16))


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))


def envelope(x):
    n = len(x) // HOP
    return db(np.sqrt(np.mean(x[:n * HOP].reshape(n, HOP) ** 2, axis=1)))


# Approximate perceptual weighting (high shelf + highpass) for relative level matching.
K_SHELF = butter(1, 1500, btype='highpass', fs=RATE, output='sos')
K_RLB = butter(2, 38, btype='highpass', fs=RATE, output='sos')


def loudness(clip):
    weighted = sosfilt(K_RLB, clip + (10 ** (4 / 20) - 1) * sosfilt(K_SHELF, clip))
    env = envelope(weighted)
    gated = env[env > env.max() - 20]
    return 10 * np.log10(np.mean(10 ** (gated / 10)))


def fade(clip, fade_in, fade_out):
    clip[:fade_in] *= np.sin(np.linspace(0, np.pi / 2, fade_in)) ** 2
    clip[-fade_out:] *= np.cos(np.linspace(0, np.pi / 2, fade_out)) ** 2
    return clip


def tonal_metrics(seg):
    """Dominant 250-4000 Hz partial: prominence over the band median, pitch, chirp, flatness."""
    f, _, z = stft(seg, RATE, nperseg=1024, noverlap=1024 - 220)
    mag = np.abs(z)
    band = (f >= 250) & (f <= 4000)
    mb = mag[band]
    energy = db(mb.max(axis=0))
    live = np.where(energy > energy.max() - 25)[0]
    live = live[live < int(.15 * RATE / 220)]
    if len(live) < 3:
        return None
    peaks = mb[:, live].argmax(axis=0)
    prominence = np.median([db(mb[k, j]) - db(np.median(mb[:, j])) for k, j in zip(peaks, live)])
    pitch = f[band][peaks]
    spectrum = mag[(f >= 60) & (f <= 8000), :max(2, int(.06 * RATE / 220))].mean(axis=1) + 1e-12
    flatness = np.exp(np.mean(np.log(spectrum))) / np.mean(spectrum)
    chirp = np.polyfit(np.arange(len(pitch)) * 220 / RATE, pitch, 1)[0]
    return float(prominence), float(np.median(pitch)), float(chirp), float(flatness)


def droplet_candidates(source, data):
    # Pre-filter: the airlock rooms carry a steady sub-200 Hz hum; bubbles ring above 330 Hz.
    clean = sosfiltfilt(butter(4, 160, btype='highpass', fs=RATE, output='sos'), data - np.mean(data))
    env = envelope(clean)
    floor = np.percentile(env, 20)
    peaks, _ = find_peaks(env, prominence=8, distance=12)
    found = []
    for i, peak in enumerate(peaks):
        onset = peak
        while onset > 0 and env[onset - 1] > env[peak] - 24 and peak - onset < 25:
            onset -= 1
        start = max(0, onset * HOP - round(.004 * RATE))
        following = [p for p in peaks[i + 1:] if env[p] > env[peak] - 32]
        limit = min(len(clean), start + round(.6 * RATE))
        if following:
            limit = min(limit, following[0] * HOP - round(.012 * RATE))
        # The tail must decay to 42 dB below the peak (or the floor) before anything else sounds.
        tail = peak
        target = max(env[peak] - 42, floor + 4)
        while tail < len(env) - 1 and env[tail] > target:
            tail += 1
        end = min(limit, tail * HOP + round(.03 * RATE))
        if end <= tail * HOP or end - start < round(.12 * RATE):
            continue
        before = env[max(0, onset - 25):max(1, onset - 3)]
        quiet = env[peak] - np.max(before) if len(before) else 0
        if quiet < 26 or env[peak] - floor < 30:
            continue
        if np.max(np.abs(data[start:end])) > .97:
            continue  # reject clipped originals
        metrics = tonal_metrics(clean[start:end])
        if not metrics:
            continue
        prominence, pitch, chirp, flatness = metrics
        if prominence < 30 or flatness > .12 or not 330 <= pitch <= 2200:
            continue
        found.append({'source': source['id'], 'start': start, 'end': end, 'peak_db': float(env[peak]),
                      'isolation_db': float(quiet), 'prominence_db': prominence, 'pitch_hz': pitch,
                      'chirp_hz_per_s': chirp, 'flatness': flatness, 'decay_s': (tail - peak) * HOP / RATE,
                      'clip': clean[start:end].copy()})
    return found


def pick_bank(candidates):
    """Best-scoring clips, at most two per semitone of pitch so the bank stays varied."""
    ranked = sorted(candidates, key=lambda c: -(c['prominence_db'] + .5 * c['isolation_db'] + 20 * min(c['decay_s'], .15)))
    chosen, per_note, per_source = [], {}, {}
    cap = BANK_SIZE // 2
    for c in ranked:
        note = round(12 * np.log2(c['pitch_hz'] / 440))
        if per_note.get(note, 0) >= 2 or per_source.get(c['source'], 0) >= cap:
            continue
        if any(o['source'] == c['source'] and abs(o['start'] - c['start']) < RATE * .05 for o in chosen):
            continue
        chosen.append(c)
        per_note[note] = per_note.get(note, 0) + 1
        per_source[c['source']] = per_source.get(c['source'], 0) + 1
        if len(chosen) == BANK_SIZE:
            break
    assert len(chosen) == BANK_SIZE, f'only {len(chosen)} droplets qualified'
    return sorted(chosen, key=lambda c: c['pitch_hz'])


DROP_LOUDNESS = -21.0  # weighted and gated relative level; peak-limited below
SINK_LOUDNESS = -19.0

manifest = []
candidates = []
for source in SOURCES:
    if source['role'] == 'rumble':
        data = load(source, RUMBLE_RATE)
        # Real water below the surface, shaped into a soft dense rumble.
        clip = data[10 * RUMBLE_RATE:35 * RUMBLE_RATE].copy()
        clip -= np.mean(clip)
        clip = sosfiltfilt(butter(3, [38, 420], btype='bandpass', fs=RUMBLE_RATE, output='sos'), clip)
        clip *= min(.12 / max(np.sqrt(np.mean(clip * clip)), 1e-8), .65 / max(np.max(abs(clip)), 1e-8))
        # Crossfade one second of the actual recording at the loop boundary.
        seam = RUMBLE_RATE
        mix = np.linspace(0, 1, seam)
        joined = clip[-seam:] * (1 - mix) + clip[:seam] * mix
        loop = np.concatenate([joined, clip[seam:-seam]])
        out = OUTPUT / 'water-rumble.wav'
        write(out, loop, RUMBLE_RATE)
        manifest.append({'file': 'water-rumble.wav', 'source': source['id'], 'start': 10, 'end': 35, 'sampleRate': RUMBLE_RATE,
                         'duration': round(len(loop) / RUMBLE_RATE, 5), 'sha256': sha(out),
                         'processing': '38-420Hz bandpass; level adjustment; one-second crossfade loop'})
        continue
    data = load(source, RATE)
    if source['role'] == 'drop':
        found = droplet_candidates(source, data)
        source['qualified'] = len(found)
        candidates += found
        continue
    # Sink: the whole plunge, from entry through the last rising bubbles.
    clean = sosfiltfilt(butter(2, 60, btype='highpass', fs=RATE, output='sos'), data - np.mean(data))
    env = envelope(clean)
    peak = int(np.argmax(env))
    onset = peak
    while onset > 0 and env[onset - 1] > env[peak] - 50:
        onset -= 1
    start = max(0, onset * HOP - round(.01 * RATE))
    tail = len(env) - 1
    while tail > peak and env[tail] < env[peak] - 50:
        tail -= 1
    end = min(len(clean), tail * HOP + round(.08 * RATE))
    clip = clean[start:end].copy()
    clip *= min(10 ** ((SINK_LOUDNESS - loudness(clip)) / 20), .6 / np.max(np.abs(clip)))
    clip = fade(clip, round(.003 * RATE), min(len(clip) // 4, round(.06 * RATE)))
    out = OUTPUT / source['file']
    write(out, clip)
    manifest.append({'file': source['file'], 'source': source['id'], 'start': round(start / RATE, 5), 'end': round(end / RATE, 5),
                     'sampleRate': RATE, 'sha256': sha(out), 'processing': '60Hz highpass; loudness match; fades'})

bank = pick_bank(candidates)
for old in (OUTPUT / 'drops').glob('drop-*.wav'):
    old.unlink()
for index, c in enumerate(bank, 1):
    clip = c['clip']
    # Gentle de-harsh: tame the airlock's upper-mid hiss above 9 kHz without dulling the ring.
    clip = sosfiltfilt(butter(1, 9000, btype='lowpass', fs=RATE, output='sos'), clip) * .35 + clip * .65
    clip *= min(10 ** ((DROP_LOUDNESS - loudness(clip)) / 20), .7 / np.max(np.abs(clip)))
    clip = fade(clip, round(.0015 * RATE), min(len(clip) // 3, round(.04 * RATE)))
    name = f'drops/drop-{index:02d}.wav'
    out = OUTPUT / name
    write(out, clip)
    manifest.append({'file': name, 'source': c['source'], 'start': round(c['start'] / RATE, 5), 'end': round(c['end'] / RATE, 5),
                     'sampleRate': RATE, 'pitchHz': round(c['pitch_hz']), 'tonalProminenceDb': round(c['prominence_db'], 1),
                     'isolationDb': round(c['isolation_db'], 1), 'spectralFlatness': round(c['flatness'], 3),
                     'decaySeconds': round(c['decay_s'], 3), 'sha256': sha(out)})

drops = [entry for entry in manifest if entry['file'].startswith('drops/')]
assert len(drops) == BANK_SIZE and len({entry['sha256'] for entry in drops}) == BANK_SIZE
(ROOT / 'docs' / 'audio-manifest.json').write_text(json.dumps(
    {'license': 'CC0-1.0', 'sampleRate': RATE, 'channels': 1, 'sources': SOURCES, 'assets': manifest}, indent=2) + '\n', encoding='utf-8')
print(f'Prepared {BANK_SIZE} real recorded bubble-drop excerpts from {len(candidates)} qualifying events, '
      f'{sum(s["role"] == "sink" for s in SOURCES)} sink plunges, and one underwater loop.')
