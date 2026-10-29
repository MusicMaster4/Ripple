# Recorded water sound sources

Ripple uses 24 new, isolated bubble-drop recordings for movement and two hydrophone plunges for the end of a round. These replace the previous 64-drop bank. All effects come from real recordings released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Music supplied by the project owner has separate rights.

## Sources

| Recording                                                                             | Recordist                  | Use                         |
| ------------------------------------------------------------------------------------- | -------------------------- | --------------------------- |
| [Fermentation airlock #1](https://bigsoundbank.com/fermentation-airlock-1-s3560.html) | Joseph Sardin              | Isolated bubble drops       |
| [Fermentation airlock #2](https://bigsoundbank.com/fermentation-airlock-2-s3561.html) | Joseph Sardin              | Isolated bubble drops       |
| [Fermentation airlock #3](https://bigsoundbank.com/fermentation-airlock-3-s3562.html) | Joseph Sardin              | Isolated bubble drops       |
| [Water Blop #1](https://bigsoundbank.com/water-blop-1-s3427.html)                     | Joseph Sardin              | End-of-round plunge         |
| [Water Blop #2](https://bigsoundbank.com/water-blop-2-s3428.html)                     | Joseph Sardin              | End-of-round plunge         |
| [Underwater](https://bigsoundbank.com/underwater-s3430.html)                          | Joseph Sardin & Axeline T. | Existing low water ambience |

The source pages identify the recordings and their CC0 license. See the site's [license explanation](https://bigsoundbank.com/licenses.html). Source URLs, original-file hashes, excerpt offsets, and output hashes appear in [audio-manifest.json](audio-manifest.json).

## Processing and playback

The movement bank selects 24 isolated, resonant bubble events from 129 qualifying candidates. Selection checks background separation, tonal prominence, spectral flatness, and pitch variety. Each file is one contiguous excerpt; there is no pitch shifting, synthetic noise, added reverb, or AI audio.

Drops and plunges are mono 44.1 kHz PCM, with high-pass filtering, level matching, and boundary fades. Drops receive gentle high-frequency filtering. The 24 distinct drops use the half-pool cooldown: a sample cannot repeat until 12 others have played. Two full plunge excerpts alternate when a round ends, rather than reusing a muffled movement drop.

The existing 22.05 kHz underwater loop uses seconds 10?35, a 38?420 Hz bandpass, and a one-second crossfade. It is unchanged. Music defaults to zero; music and water/effects retain separate controls.

## Reproduction

With Python, NumPy, SciPy, and FFmpeg installed, run:

```sh
python scripts/prepare-audio.py
```

The script caches originals in ignored `.research/audio/`, selects the bank, and writes the shipped WAVs and manifest. Builds use the checked-in assets without external audio downloads. The source-code license does not restrict the rights granted by CC0. See [THIRD_PARTY.md](THIRD_PARTY.md) for music and dependency rights.
