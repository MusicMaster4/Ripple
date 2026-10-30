# Water-engine performance

Measured locally on Windows with Node 24.18.0 and Vitest 4.1.12. These are CPU timings, not measured browser FPS. Background system activity and garbage collection affect individual samples.

## Reproduce

```sh
npm run bench:water
npm run check
npm run build
```

The benchmark uses 32 independent drops in a 1000 by 640 arena with a thin rectangular barrier and a circle, at the actual gameplay speed. It separates initialization/propagation, continuous contour extraction within one physical interval, and complete animation frames including numerical steps and contour-band preparation.

## Results

| Workload                                                             |  Original | Optimized |
| -------------------------------------------------------------------- | --------: | --------: |
| 32 continuously interpolated fronts, mean CPU time per display frame |  25.65 ms |   5.36 ms |
| 32 drops initialized and propagated for 8 simulated seconds          | 923.72 ms | 920.35 ms |
| 32 drops initialized, propagated, and contoured at different ages    | 476.61 ms | 441.62 ms |

Continuous contour extraction is approximately 4.8 times faster. Initialization/propagation timings overlap within benchmark variance; there is no established improvement to that aggregate workload. The optimized interior stencil reduced the measured warm, aged-wave step from roughly 13.0 ms to 11.4 ms in a separate local comparison.

The complete-frame benchmark requests 144 Hz timing with 32 synchronized drops. This is a stress workload: it includes CPU simulation and contour extraction, and excludes Canvas rasterization, React, and the browser compositor. It must not be interpreted as a guaranteed display frame rate.

| Complete frame           | Compact contours before scheduling | With staggered prefetch |
| ------------------------ | ---------------------------------: | ----------------------: |
| Mean CPU time            |                            8.41 ms |                10.20 ms |
| p99 CPU time             |                           40.86 ms |                19.06 ms |
| Maximum sampled CPU time |                           42.18 ms |                20.83 ms |

Prefetch deliberately trades some mean work and a second compact contour band for substantially lower spikes. It computes each drop's next fixed step at a different phase within the physical clock. It uses the existing third height buffer to retain the displayed interval and does not change wave speed, simulation resolution, contact times, or replay results.

## Flicker and correctness

A local comparison sampled the previously reported seed 412366530, source (570.8333333333333, 231.76040494938132), at 120 Hz from 8 to 12 seconds. The original extractor produced 655 frame appearances of connected components shorter than 36 logical units. The optimized extractor produced zero, with no empty frames; maximum component count fell from 12 to 8. These are component appearances across sampled frames, not 655 unique waves, and do not establish absence of every possible visual artifact.

Connected positive crests are filtered as complete arcs. Tiny fragments and components dominated by stationary interference are discarded. The display interpolates the narrow crest band every frame instead of snapping it to a 20 Hz mesh. Amplitude bounds skip tiles that cannot contain a visible crest; solid-face halos preserve boundary and diffraction data.

The regression suite covers reflection, diffraction, sub-cell walls, closed crests moving continuously at 120 Hz, shared scratch-space isolation, backward sampling, exact numerical boundaries, near-player contour cleanup, prefetched versus unprefetched fields, and dense rendered rounds matching server replay at 60 and 144 Hz. All 177 tests passed, along with TypeScript, the secret scan, and the production build.

Live Chrome inspection was interrupted when Computer Use could not determine the active Windows browser URL confidently enough to enforce its policy. No final live-browser FPS claim is made.

## Rules compatibility

Crest filtering and thin-wall impulse handling can affect contact outcomes. Rules version 13 separates these results from version 12 through the existing leaderboard/ticket filters and versioned local-storage keys. Frontend and Convex functions must be deployed with the same rules version. No deployment or leaderboard deletion is performed by these code changes.
