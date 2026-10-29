"""Prepare recorded CC0 water assets. Requires Python, NumPy, SciPy, and FFmpeg.

No synthesis, generated noise, oscillators, pitch shifting, or AI audio is used.
Original recordings are cached in ignored .research/audio; only game excerpts ship.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import urllib.request
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, find_peaks, sosfiltfilt

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.research' / 'audio'
OUTPUT = ROOT / 'public' / 'audio'
CACHE.mkdir(parents=True, exist_ok=True)
(OUTPUT / 'drops').mkdir(parents=True, exist_ok=True)
RATE = 22050
SOURCES = [
    {'id': 1384, 'name': 'Drops of water #1', 'slug': 'drops-of-water-1', 'count': 23, 'author': 'Joseph Sardin'},
    {'id': 1386, 'name': 'Drops of Water #3', 'slug': 'drops-of-water-3', 'count': 22, 'author': 'Joseph Sardin'},
    {'id': 1387, 'name': 'Drops of water #4', 'slug': 'drops-of-water-4', 'count': 19, 'author': 'Joseph Sardin'},
    {'id': 3430, 'name': 'Underwater', 'slug': 'underwater', 'count': 0, 'author': 'Joseph Sardin & Axeline T.'},
]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load(source):
    original = CACHE / f"source-{source['id']}.wav"
    source['url'] = f"https://bigsoundbank.com/{source['slug']}-s{source['id']}.html"
    source['download'] = f"https://bigsoundbank.com/UPLOAD/bwf-en/{source['id']}.wav"
    if not original.exists():
        urllib.request.urlretrieve(source['download'], original)
    if original.read_bytes()[:4] != b'RIFF':
        raise ValueError('Source download is not a WAV recording')
    source['sha256'] = sha(original)
    pcm = CACHE / f"source-{source['id']}-pcm.wav"
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(original), '-ac', '1', '-ar', str(RATE), '-c:a', 'pcm_s16le', str(pcm)], check=True)
    sr, data = wavfile.read(pcm)
    assert sr == RATE
    return data.astype(np.float64) / 32768

def write(path, samples):
    wavfile.write(path, RATE, np.round(np.clip(samples, -.999, .999) * 32767).astype(np.int16))

manifest = []
index = 0
for source in SOURCES:
    data = load(source)
    if not source['count']:
        # Real water below the surface, shaped into a soft dense rumble.
        clip = data[10 * RATE:35 * RATE].copy()
        clip -= np.mean(clip)
        clip = sosfiltfilt(butter(3, [38, 420], btype='bandpass', fs=RATE, output='sos'), clip)
        clip *= min(.12 / max(np.sqrt(np.mean(clip * clip)), 1e-8), .65 / max(np.max(abs(clip)), 1e-8))
        # Crossfade one second of the actual recording at the loop boundary.
        seam = RATE
        mix = np.linspace(0, 1, seam)
        joined = clip[-seam:] * (1 - mix) + clip[:seam] * mix
        loop = np.concatenate([joined, clip[seam:-seam]])
        out = OUTPUT / 'water-rumble.wav'
        write(out, loop)
        manifest.append({'file': 'water-rumble.wav', 'source': source['id'], 'start': 10, 'end': 35, 'duration': round(len(loop) / RATE, 5), 'sha256': sha(out), 'processing': '38-420Hz bandpass; level adjustment; one-second crossfade loop'})
        continue
    hop = int(RATE * .005)
    rms = np.sqrt(np.mean(data[:len(data)//hop*hop].reshape(-1, hop) ** 2, axis=1))
    peaks, props = find_peaks(rms, prominence=.004, distance=50)
    # Select strong isolated physical events, then preserve source chronology.
    selected = sorted(peaks[np.argsort(props['prominences'])[-source['count']:]].tolist())
    assert len(selected) == source['count']
    all_peaks = sorted(peaks.tolist())
    for peak in selected:
        # Look back to the onset, rather than cutting into the droplet attack.
        onset = peak
        while onset > max(0, peak - 16) and rms[onset - 1] > rms[peak] * .12:
            onset -= 1
        start = max(0, onset * hop - round(.008 * RATE))
        following = next((p for p in all_peaks if p > peak), None)
        end = min(len(data), start + round(.38 * RATE))
        if following is not None:
            end = min(end, following * hop - round(.035 * RATE))
        end = max(end, min(len(data), start + round(.12 * RATE)))
        clip = data[start:end].copy()
        clip -= np.mean(clip)
        clip = sosfiltfilt(butter(2, [100, 6000], btype='bandpass', fs=RATE, output='sos'), clip)
        # Level matching only; natural recorded pitches/timbres stay intact.
        clip *= min(.065 / max(np.sqrt(np.mean(clip ** 2)), 1e-8), .43 / max(np.max(abs(clip)), 1e-8))
        fade_in = min(len(clip) // 8, round(.002 * RATE))
        fade_out = min(len(clip) // 4, round(.028 * RATE))
        clip[:fade_in] *= np.linspace(0, 1, fade_in)
        clip[-fade_out:] *= np.linspace(1, 0, fade_out)
        index += 1
        name = f'drops/drop-{index:02d}.wav'
        out = OUTPUT / name
        write(out, clip)
        manifest.append({'file': name, 'source': source['id'], 'start': round(start / RATE, 5), 'end': round(end / RATE, 5), 'sha256': sha(out)})

assert index == 64
assert len({entry['sha256'] for entry in manifest if entry['file'].startswith('drops/')}) == 64
(ROOT / 'docs' / 'audio-manifest.json').write_text(json.dumps({'license': 'CC0-1.0', 'sampleRate': RATE, 'channels': 1, 'sources': SOURCES, 'assets': manifest}, indent=2) + '\n', encoding='utf-8')
print(f'Prepared {index} distinct real recorded droplet excerpts and one real underwater loop.')
