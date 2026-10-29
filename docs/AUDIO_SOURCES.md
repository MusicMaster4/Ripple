# Recorded water sound sources

All sound effects in Ripple are excerpts of real microphone/hydrophone recordings. The droplet bank is **64 distinct recorded excerpts**, not 64 pitch shifts, synthesized tones, or independent recording sessions. No generated noise or AI audio is used in these assets.

The source recordings are released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) by their recordists. CC0 permits editing and redistribution without requiring on-screen attribution. These assets retain their CC0 status; the game's noncommercial source-code license does not add restrictions to them.

## Sources

| Source | Recordist | Recording | Used for |
| --- | --- | --- | --- |
| [Drops of water #1, sound 1384](https://bigsoundbank.com/drops-of-water-1-s1384.html) | Joseph Sardin | Real water drops, SoundDevices MixPre-3 + Rode NT5 | Samples 01-23 |
| [Drops of Water #3, sound 1386](https://bigsoundbank.com/drops-of-water-3-s1386.html) | Joseph Sardin | Real water drops, SoundDevices MixPre-3 + Rode NT5 | Samples 24-45 |
| [Drops of water #4, sound 1387](https://bigsoundbank.com/drops-of-water-4-s1387.html) | Joseph Sardin | Real water drops, SoundDevices MixPre-3 + Rode NT5 | Samples 46-64 |
| [Underwater, sound 3430](https://bigsoundbank.com/underwater-s3430.html) | Joseph Sardin & Axeline T. | Waterfall recorded underwater with a hydrophone, SoundDevices MixPre-3 | Water rumble loop |

Each source's page identifies the recording as realistic and displays a CC0 public-domain license. The site's [license explanation](https://bigsoundbank.com/licenses.html) and source-page FAQ allow processing, remixing, and redistribution. Sources were retrieved on October 29, 2026. No source credit is displayed in the game UI.

## Processing

- The 64 droplet files are cuts around individual recorded transients from three recordings. Natural pitch and timing are preserved. Source offsets and SHA-256 hashes appear in [the asset manifest](audio-manifest.json).
- Processing is limited to mono conversion, 22,050 Hz resampling, gentle 100-6,000 Hz filtering, loudness matching, and short boundary fades. The clips vary naturally in timbre and duration. There is no artificial pitch shifting, oscillation, or synthetic sound generation.
- `water-rumble.wav` uses seconds 10-35 of the real underwater recording. A 38-420 Hz bandpass emphasizes its dense low-frequency water movement. A one-second crossfade makes a 24-second loop; level matching and a crossfade do not generate new sound content.
- The half-pool selection algorithm is separate from the recordings. After a droplet plays, it cannot be selected again until at least 32 other droplets have played.

## Reproduce the bank

The small processed assets are checked into `public/audio/`; ordinary app builds do not download audio from another site.

With Python, NumPy, SciPy, and FFmpeg installed:

```sh
python scripts/prepare-audio.py
```

The script downloads the original CC0 WAV files into the ignored `.research/audio/` cache, extracts the same 64 samples and water loop, checks that all 64 droplet hashes differ, and writes `docs/audio-manifest.json`. The manifest includes the original download URLs and original-file hashes. Original full-length recordings are not shipped with the game.

The three background music tracks were separately supplied by the project owner. They are not these CC0 sound effects and are not relicensed by this notice. See [third-party assets](THIRD_PARTY.md).
